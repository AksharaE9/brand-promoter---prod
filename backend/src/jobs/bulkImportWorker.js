'use strict';
const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const prisma = require("../config/db");
const sse = require('../utils/sse');
const cacheInvalidation = require('../utils/cacheInvalidation');

const BULK_IMPORT_QUEUE_NAME = 'bulk-import';

const connectionConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
};

const connectionOptions = {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableOfflineQueue: true,
  keepAlive: 30000,
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ENOTFOUND'];
    return targetErrors.some(e => err.message.includes(e));
  },
};

let queueConnection;
let workerConnection;

if (typeof connectionConfig === 'string') {
  queueConnection = new Redis(connectionConfig, connectionOptions);
  workerConnection = new Redis(connectionConfig, connectionOptions);
} else {
  queueConnection = new Redis({ ...connectionConfig, ...connectionOptions });
  workerConnection = new Redis({ ...connectionConfig, ...connectionOptions });
}

queueConnection.on('error', (err) => console.error('[BullMQ Import Queue Redis] Error:', err.message));
workerConnection.on('error', (err) => console.error('[BullMQ Import Worker Redis] Error:', err.message));

const bulkImportQueue = new Queue(BULK_IMPORT_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

const worker = new Worker(
  BULK_IMPORT_QUEUE_NAME,
  async (job) => {
    const { sessionData, columnMapping, userId, organizationId } = job.data;
    const rows = sessionData.rows;
    
    const results = {
      total: rows.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    let lastEmitAt = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i];
      const mappedCandidate = {};
      
      // Map columns
      Object.keys(columnMapping).forEach(rawCol => {
        const systemField = columnMapping[rawCol];
        if (systemField !== "ignore") {
          mappedCandidate[systemField] = String(rawRow[rawCol] || "").trim();
        }
      });

      const errors = [];
      
      // Skip completely empty rows
      const hasNoCandidateData = !mappedCandidate.fullName && !mappedCandidate.email && !mappedCandidate.phone;
      if (hasNoCandidateData) {
        continue;
      }

      // Validation
      if (!mappedCandidate.fullName) errors.push("fullName is required");
      if (mappedCandidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedCandidate.email)) {
        errors.push("Invalid email format");
      }

      if (!mappedCandidate.phone) {
        errors.push("Phone is required");
      } else {
        const phoneDigits = mappedCandidate.phone.replace(/\D/g, "");
        if (phoneDigits.length !== 10) {
          errors.push("Phone must be 10 digits");
        }
      }

      if (errors.length > 0) {
        results.failed++;
        results.errors.push({
          rowNumber: rawRow._rowIndex || (i + 2),
          rawData: rawRow,
          errors
        });
      } else {
        // Deduplication by phone
        const phoneDigits = mappedCandidate.phone.replace(/\D/g, "");
        const existing = await prisma.candidate.findFirst({
          where: { phone: phoneDigits, organizationId, isDeleted: false }
        });
          
        if (existing) {
          results.skipped++;
        } else {
          try {
            const candidateDoc = {
              fullName: mappedCandidate.fullName,
              email: mappedCandidate.email || "N/A",
              phone: phoneDigits,
              location: mappedCandidate.location || null,
              preferredRole: mappedCandidate.role || mappedCandidate.preferredRole || null,
              organizationId,
              source: "Bulk Import Wizard",
              createdById: userId,
              status: "ACTIVE"
            };

            await prisma.candidate.create({ data: candidateDoc });
            results.imported++;
          } catch (err) {
            results.failed++;
            results.errors.push({
              rowNumber: rawRow._rowIndex || (i + 2),
              rawData: rawRow,
              errors: ["Database insertion error: " + err.message]
            });
          }
        }
      }

      // Update progress & broadcast
      const processed = results.imported + results.skipped + results.failed;
      const progress = Math.round((processed / results.total) * 100);
      await job.updateProgress(progress);

      const now = Date.now();
      if (processed === 1 || processed === results.total || (now - lastEmitAt >= 800) || processed % 25 === 0) {
        lastEmitAt = now;
        sse.broadcastToOrg(organizationId, 'BULK_IMPORT_PROGRESS', {
          jobId: job.id,
          processed,
          total: results.total,
          percent: progress,
          imported: results.imported,
          failed: results.failed,
          skipped: results.skipped,
        });
      }
    }

    // Invalidate candidate list cache after bulk import
    await cacheInvalidation.candidateList(organizationId);

    // Broadcast completion
    sse.broadcastToOrg(organizationId, 'BULK_IMPORT_COMPLETE', {
      jobId: job.id,
      total: results.total,
      imported: results.imported,
      failed: results.failed,
      skipped: results.skipped,
      hasErrors: results.failed > 0,
    });

    return results;
  },
  {
    connection: workerConnection,
    concurrency: 3,
    lockDuration: 60000,
    stalledInterval: 15000,
    maxStalledCount: 2,
  }
);

worker.on('completed', (job, result) => {
  console.log(`[BulkImportWorker] Job ${job.id} completed: ${result.imported} candidates imported`);
});

worker.on('failed', (job, err) => {
  console.error(`[BulkImportWorker] Job ${job.id} failed:`, err.message);
});

module.exports = { worker, bulkImportQueue };
