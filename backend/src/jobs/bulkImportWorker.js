// src/jobs/bulkImportWorker.js
const prisma = require("../config/db");
const sse = require('../utils/sse');
const cacheInvalidation = require('../utils/cacheInvalidation');

const BULK_IMPORT_QUEUE_NAME = 'bulk-import';

const { v4: uuidv4 } = require("uuid");

class MockQueue {
  constructor(name) {
    this.name = name;
    this.jobs = new Map();
  }

  async add(name, data, opts = {}) {
    const jobId = opts.jobId || uuidv4();
    const job = {
      id: jobId,
      name,
      data,
      progress: 0,
      state: 'active',
      returnvalue: null,
      updateProgress: async (p) => {
        job.progress = p;
      },
      getState: async () => job.state,
    };
    
    this.jobs.set(jobId, job);

    setImmediate(async () => {
      try {
        console.log(`[MockQueue:BulkImport] Running job ${jobId} in-process`);
        const results = await importProcessor(job);
        job.state = 'completed';
        job.returnvalue = results;
        console.log(`[MockQueue:BulkImport] Job ${jobId} completed successfully`);
      } catch (err) {
        job.state = 'failed';
        job.returnvalue = { error: err.message };
        console.error(`[MockQueue:BulkImport] Job ${jobId} failed:`, err);
      }
    });

    return job;
  }

  async getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }
}

class MockWorker {
  constructor(name) {
    this.name = name;
  }
  async close() { return true; }
}

const importProcessor = async (job) => {
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

    // Update progress
    const processed = results.imported + results.skipped + results.failed;
    const progress = Math.round((processed / results.total) * 100);
    job.progress = progress;

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
};

const bulkImportQueue = new MockQueue(BULK_IMPORT_QUEUE_NAME);
const worker = new MockWorker(BULK_IMPORT_QUEUE_NAME);

module.exports = {
  worker,
  bulkImportQueue
};
