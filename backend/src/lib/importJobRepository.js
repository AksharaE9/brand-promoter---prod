'use strict';

/**
 * importJobRepository.js — Persistence layer for import jobs, checkpoints, and idempotency keys.
 */

const crypto = require('crypto');
const prisma = require('../config/db');
const { initImportDb } = require('./importDbInit');

/**
 * Generates a stable row idempotency key.
 */
function computeIdempotencyKey(jobId, rowNumber, canonicalDedupKey) {
  const input = `${jobId}:${rowNumber}:${String(canonicalDedupKey || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Creates a new import job record in PostgreSQL.
 */
async function createJobRecord(data) {
  await initImportDb();
  const {
    jobId,
    flowType,
    filePath,
    sourceFilename,
    uploadedBy,
    organizationId = 'defaultOrg',
    totalRows = 0,
  } = data;

  await prisma.$executeRawUnsafe(
    `INSERT INTO import_jobs (
      id, flow_type, status, file_path, source_filename, uploaded_by, organization_id, total_rows,
      last_processed_row, last_committed_row, created_count, updated_count, duplicates_count,
      failed_count, resume_attempts, created_entity_ids, checkpoint_at, created_at, updated_at
    ) VALUES ($1, $2, 'PROCESSING', $3, $4, $5, $6, $7, 0, 0, 0, 0, 0, 0, 0, '[]'::jsonb, NOW(), NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      status = 'PROCESSING',
      updated_at = NOW();`,
    jobId,
    flowType,
    filePath || null,
    sourceFilename || null,
    uploadedBy || null,
    organizationId,
    totalRows
  );
}

/**
 * Updates progress checkpoint atomically.
 */
async function updateCheckpoint(jobId, checkpoint) {
  await initImportDb();
  const {
    lastProcessedRow = 0,
    lastCommittedRow = 0,
    created = 0,
    updated = 0,
    duplicates = 0,
    failed = 0,
    newEntityIds = [],
    metrics = {},
  } = checkpoint;

  const entityIdsJson = JSON.stringify(newEntityIds);
  const metricsJson = JSON.stringify(metrics);

  await prisma.$executeRawUnsafe(
    `UPDATE import_jobs SET
      last_processed_row = $1,
      last_committed_row = $2,
      created_count = $3,
      updated_count = $4,
      duplicates_count = $5,
      failed_count = $6,
      created_entity_ids = COALESCE(created_entity_ids, '[]'::jsonb) || $7::jsonb,
      metrics = $8::jsonb,
      checkpoint_at = NOW(),
      updated_at = NOW()
    WHERE id = $9;`,
    lastProcessedRow,
    lastCommittedRow,
    created,
    updated,
    duplicates,
    failed,
    entityIdsJson,
    metricsJson,
    jobId
  );
}

/**
 * Marks job final or interrupted status.
 */
async function markJobStatus(jobId, status, details = {}) {
  await initImportDb();
  const {
    errorReportUrl = null,
    metrics = null,
    created = null,
    updated = null,
    duplicates = null,
    failed = null,
    createdEntityIds = null,
  } = details;

  let query = `UPDATE import_jobs SET status = $1, updated_at = NOW()`;
  const params = [status];
  let paramIdx = 2;

  if (errorReportUrl !== null && errorReportUrl !== undefined) {
    query += `, error_report_url = $${paramIdx++}`;
    params.push(errorReportUrl);
  }
  if (metrics !== null && metrics !== undefined) {
    query += `, metrics = $${paramIdx++}::jsonb`;
    params.push(JSON.stringify(metrics));
  }
  if (created !== null) {
    query += `, created_count = $${paramIdx++}`;
    params.push(created);
  }
  if (updated !== null) {
    query += `, updated_count = $${paramIdx++}`;
    params.push(updated);
  }
  if (duplicates !== null) {
    query += `, duplicates_count = $${paramIdx++}`;
    params.push(duplicates);
  }
  if (failed !== null) {
    query += `, failed_count = $${paramIdx++}`;
    params.push(failed);
  }
  if (createdEntityIds !== null && Array.isArray(createdEntityIds)) {
    query += `, created_entity_ids = COALESCE(created_entity_ids, '[]'::jsonb) || $${paramIdx++}::jsonb`;
    params.push(JSON.stringify(createdEntityIds));
  }

  query += ` WHERE id = $${paramIdx}`;
  params.push(jobId);

  await prisma.$executeRawUnsafe(query, ...params);
}

/**
 * Records processed idempotency keys in batch.
 */
async function recordProcessedKeys(jobId, entries) {
  if (!entries || entries.length === 0) return;
  await initImportDb();

  for (const entry of entries) {
    const id = `${jobId}_${entry.rowNumber}_${entry.idempotencyKey.slice(0, 12)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO import_processed_keys (id, job_id, row_number, idempotency_key, entity_id, action, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO NOTHING;`,
      id,
      jobId,
      entry.rowNumber,
      entry.idempotencyKey,
      entry.entityId || null,
      entry.action || 'CREATED'
    ).catch(() => {});
  }
}

/**
 * Checks if a row was already committed for this job.
 */
async function isKeyProcessed(jobId, idempotencyKey) {
  await initImportDb();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, action, entity_id FROM import_processed_keys WHERE job_id = $1 AND idempotency_key = $2 LIMIT 1;`,
    jobId,
    idempotencyKey
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Gets a job record by ID.
 */
async function getJobById(jobId) {
  await initImportDb();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM import_jobs WHERE id = $1 LIMIT 1;`,
    jobId
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Finds jobs in INTERRUPTED or stuck PROCESSING state.
 */
async function getInterruptedJobs(organizationId = null) {
  await initImportDb();
  let query = `SELECT * FROM import_jobs WHERE status IN ('INTERRUPTED', 'PROCESSING') AND resume_attempts < 3`;
  const params = [];
  if (organizationId) {
    query += ` AND organization_id = $1`;
    params.push(organizationId);
  }
  query += ` ORDER BY created_at ASC;`;
  return prisma.$queryRawUnsafe(query, ...params);
}

/**
 * Finds jobs stalled in PROCESSING for more than thresholdMinutes.
 */
async function getStuckJobs(thresholdMinutes = 10) {
  await initImportDb();
  return prisma.$queryRawUnsafe(
    `SELECT * FROM import_jobs
     WHERE status = 'PROCESSING'
       AND checkpoint_at < (NOW() - INTERVAL '${parseInt(thresholdMinutes, 10)} minutes')
       AND resume_attempts < 3;`
  );
}

/**
 * Lists recent job history for admin UI.
 */
async function getJobHistory(organizationId = null, limit = 50) {
  await initImportDb();
  let query = `SELECT * FROM import_jobs`;
  const params = [];
  if (organizationId) {
    query += ` WHERE organization_id = $1`;
    params.push(organizationId);
  }
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1};`;
  params.push(limit);
  return prisma.$queryRawUnsafe(query, ...params);
}

module.exports = {
  computeIdempotencyKey,
  createJobRecord,
  updateCheckpoint,
  markJobStatus,
  recordProcessedKeys,
  isKeyProcessed,
  getJobById,
  getInterruptedJobs,
  getStuckJobs,
  getJobHistory,
};
