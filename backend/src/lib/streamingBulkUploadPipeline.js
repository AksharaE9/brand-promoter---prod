'use strict';

const fs = require('fs');
const { parseFileStream } = require('./csvXlsxStreamParser');
const { initErrorReport, appendFailedRow, finalizeErrorReport } = require('./bulkUploadErrorReport');
const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');

const DEFAULT_BATCH_SIZE = BULK_UPLOAD_LIMITS.BATCH_SIZE_CANDIDATE; // conservative default

// Active job status store for immediate status querying across all pipeline jobs
const pipelineJobStatusMap = new Map();

/**
 * Per-user cooldown tracking.
 * Map of userId → { expiresAt: Date, rowsProcessed: number }
 * Cleared automatically when cooldown expires.
 */
const userCooldownMap = new Map();

/**
 * Checks if an organisation already has a running bulk upload job.
 * Must be called before starting any bulk upload.
 *
 * @param {string} organizationId
 * @returns {{ blocked: boolean, jobId?: string, progress?: number, state?: string }}
 */
function checkOrgConcurrency(organizationId) {
  for (const [jobId, status] of pipelineJobStatusMap) {
    if (status.organizationId === organizationId && status.state === 'active') {
      return {
        blocked: true,
        jobId,
        progress: status.progress || 0,
        processed: status.processed || 0,
        total: status.totalRows || 0,
      };
    }
  }
  return { blocked: false };
}

/**
 * Checks if a user is within the cooldown period.
 * SUPER_ADMIN and roles listed in COOLDOWN_EXEMPT_ROLES bypass the cooldown.
 *
 * @param {string} userId
 * @param {string} [role] - User's role string (e.g. 'SUPER_ADMIN')
 * @returns {{ blocked: boolean, retryAfterSeconds?: number }}
 */
function checkUserCooldown(userId, role) {
  // Exempt roles bypass cooldown (but NOT the concurrency lock)
  if (role && BULK_UPLOAD_LIMITS.COOLDOWN_EXEMPT_ROLES.includes(role)) {
    return { blocked: false };
  }

  const entry = userCooldownMap.get(userId);
  if (!entry) return { blocked: false };

  const now = Date.now();
  if (now >= entry.expiresAt) {
    userCooldownMap.delete(userId);
    return { blocked: false };
  }

  const retryAfterSeconds = Math.ceil((entry.expiresAt - now) / 1000);
  return { blocked: true, retryAfterSeconds };
}

/**
 * Sets a cooldown for a user after a bulk job that consumed resources.
 * Not called if the job failed before processing a single row (validation-only failure).
 *
 * @param {string} userId
 * @param {number} rowsProcessed - actual rows touched (0 = validation failure, no cooldown)
 * @param {string} [role]
 */
function applyUserCooldown(userId, rowsProcessed, role) {
  if (!userId) return;
  // Exempt roles get no cooldown
  if (role && BULK_UPLOAD_LIMITS.COOLDOWN_EXEMPT_ROLES.includes(role)) return;
  // Validation-only failure (0 rows processed) — don't penalise the user
  if (rowsProcessed === 0) return;

  const expiresAt = Date.now() + (BULK_UPLOAD_LIMITS.COOLDOWN_SECONDS * 1000);
  userCooldownMap.set(userId, { expiresAt, rowsProcessed });

  // Auto-clean after cooldown expires
  const timer = setTimeout(() => userCooldownMap.delete(userId), BULK_UPLOAD_LIMITS.COOLDOWN_SECONDS * 1000 + 1000);
  if (timer.unref) timer.unref();
}


/**
 * Gets status for a pipeline job by jobId.
 * @param {string} jobId 
 * @returns {object|null}
 */
function getPipelineJobStatus(jobId) {
  return pipelineJobStatusMap.get(jobId) || null;
}

/**
 * Universal streaming bulk upload pipeline.
 * Runs background parsing, validation, batch processing, SSE progress emission,
 * and CSV error/warning report generation.
 *
 * @param {object} options
 * @param {string} options.jobId
 * @param {string} options.filePath
 * @param {string} [options.fileType]
 * @param {string} [options.uploadedBy]
 * @param {string} [options.organizationId]
 * @param {Function} options.validateRow - async (rawRow, rowNumber, context) => { valid: boolean, data?: any, errors?: string[], warnings?: string[] }
 * @param {Function} [options.duplicateCheck] - async (data, rowNumber, context) => { isDuplicate: boolean, reason?: string, warnings?: string[] }
 * @param {Function} [options.transformRow] - async (validatedData, rowNumber, context) => itemToBatch | null
 * @param {Function} options.batchInsert - async (batchItems, context) => { succeeded: number, failed: number }
 * @param {Function} [options.onComplete] - async (summary, context) => void
 * @param {Function} [options.emitProgress] - (organizationId, jobId, progressObj) => void
 * @param {Function} [options.emitCompleted] - (organizationId, jobId, completedObj) => void
 * @param {number} [options.batchSize=500]
 * @param {object} [options.context={}] - custom options or context passed to handlers
 */
async function runStreamingBulkUploadPipeline(options) {
  const {
    jobId,
    filePath,
    fileType,
    uploadedBy,
    organizationId = 'defaultOrg',
    validateRow,
    duplicateCheck,
    transformRow,
    batchInsert,
    onComplete,
    emitProgress,
    emitCompleted,
    batchSize = DEFAULT_BATCH_SIZE,
    context = {},
  } = options;

  initErrorReport(jobId);

  let processed = 0;
  let succeeded = 0;
  let duplicates = 0;
  let failed = 0;
  let totalRows = 0;
  let batch = [];

  const statusObj = {
    jobId,
    state: 'active',
    uploadedBy,
    processed: 0,
    succeeded: 0,
    duplicates: 0,
    failed: 0,
    totalRows: 0,
    progress: 0,
    errorReportUrl: null,
    error: null,
    startTime: Date.now(),
  };
  pipelineJobStatusMap.set(jobId, statusObj);

  const pipelineContext = {
    jobId,
    uploadedBy,
    organizationId,
    userRole: options.userRole || null,
    ...context,
  };

  const flushBatch = async () => {
    if (batch.length === 0) return;
    const currentBatch = batch;
    batch = [];

    try {
      const res = await batchInsert(currentBatch, pipelineContext);
      if (res && typeof res.succeeded === 'number') {
        succeeded += res.succeeded;
      } else {
        succeeded += currentBatch.length;
      }
      if (res && typeof res.failed === 'number') {
        failed += res.failed;
      }
    } catch (err) {
      console.error(`[StreamingBulkPipeline] Batch insert error on job ${jobId}:`, err.message);
      failed += currentBatch.length;
      const rowNumbers = currentBatch.map(b => b.rowNumber).filter(Boolean);
      const rowRange = rowNumbers.length > 0 ? `${rowNumbers[0]}-${rowNumbers[rowNumbers.length - 1]}` : '0';
      appendFailedRow(jobId, rowRange, `Batch insert failed: ${err.message}`, 'error');
    }
  };

  try {
    const parseResult = await parseFileStream(filePath, fileType, async (rawRow, rowNumber) => {
      processed++;
      totalRows = Math.max(totalRows, rowNumber - 1);

      const valResult = await validateRow(rawRow, rowNumber, pipelineContext);

      if (!valResult.valid) {
        failed++;
        const rowId = rawRow.Name || rawRow.name || rawRow['Candidate Name'] || rawRow.Phone || rawRow.phone || rawRow['Phone Number'] || '';
        const prefix = rowId ? `[Row Info: ${rowId}] ` : '';
        const reason = (valResult.errors && valResult.errors.length > 0)
          ? valResult.errors.join('; ')
          : (valResult.failureReason || 'Row validation failed');
        appendFailedRow(jobId, rowNumber, `${prefix}${reason}`, 'error');
      } else {
        // Primary and secondary duplicate checks
        if (typeof duplicateCheck === 'function') {
          const dupResult = await duplicateCheck(valResult.data, rowNumber, pipelineContext);
          if (dupResult && dupResult.isDuplicate) {
            duplicates++;
            appendFailedRow(jobId, rowNumber, dupResult.reason || 'Duplicate skipped', 'duplicate');
            return; // Skip transforming and batching
          }
          if (dupResult && Array.isArray(dupResult.warnings)) {
            dupResult.warnings.forEach((warn) => {
              appendFailedRow(jobId, rowNumber, warn, 'warning');
            });
          }
        }

        // Add any validator warnings
        if (Array.isArray(valResult.warnings)) {
          valResult.warnings.forEach((warn) => {
            appendFailedRow(jobId, rowNumber, warn, 'warning');
          });
        }

        const item = transformRow
          ? await transformRow(valResult.data, rowNumber, pipelineContext)
          : valResult.data;

        if (item) {
          batch.push(item);
        } else {
          // If transform explicitly returns null (e.g. skipped or warning-only row already counted)
          succeeded++;
        }

        if (batch.length >= batchSize) {
          await flushBatch();
        }
      }

      if (processed % 100 === 0 || processed === 1) {
        const percent = totalRows ? Math.min(99, Math.round((processed / totalRows) * 100)) : 50;
        statusObj.processed = processed;
        statusObj.succeeded = succeeded;
        statusObj.duplicates = duplicates;
        statusObj.failed = failed;
        statusObj.totalRows = totalRows;
        statusObj.progress = percent;

        if (emitProgress) {
          emitProgress(organizationId, jobId, { processed, succeeded, duplicates, failed, totalRows });
        }
      }
    });

    await flushBatch();

    if (parseResult && parseResult.extraSheetNames && parseResult.extraSheetNames.length > 0) {
      appendFailedRow(
        jobId,
        0,
        `Note: Workbook contained multiple sheets. Only the first sheet ("${parseResult.sheetName}") was processed. Sheets ignored: ${parseResult.extraSheetNames.join(', ')}`,
        'warning'
      );
    }

    // Enforce Accounting Invariant
    const expectedTotal = succeeded + duplicates + failed;
    if (processed !== expectedTotal) {
      throw new Error(`Row accounting invariant violated: total processed rows (${processed}) does not equal created/succeeded (${succeeded}) + duplicates (${duplicates}) + errors/failed (${failed})`);
    }

    if (onComplete) {
      await onComplete({ processed, succeeded, duplicates, failed, totalRows: processed }, pipelineContext);
    }

    const errorReportUrl = finalizeErrorReport(jobId);

    statusObj.state = 'completed';
    statusObj.processed = processed;
    statusObj.succeeded = succeeded;
    statusObj.duplicates = duplicates;
    statusObj.failed = failed;
    statusObj.totalRows = processed;
    statusObj.progress = 100;
    statusObj.errorReportUrl = errorReportUrl;

    // Apply cooldown after a job that did real work
    // (processed > 0 means it consumed DB resources)
    applyUserCooldown(uploadedBy, processed, options.userRole);

    if (emitCompleted) {
      emitCompleted(organizationId, jobId, {
        processed,
        succeeded,
        duplicates,
        failed,
        errorReportUrl,
      });
    }

    // Emit bulk_upload_completed audit log event
    let fileSize = 0;
    try {
      if (filePath && fs.existsSync(filePath)) {
        fileSize = fs.statSync(filePath).size;
      }
    } catch (_) {}

    const path = require('path');
    const flowType = options.flowType || (
      options.validateRow?.name?.toLowerCase().includes('candidate') ? 'candidate' :
      options.validateRow?.name?.toLowerCase().includes('feedback') ? 'feedback' :
      options.validateRow?.name?.toLowerCase().includes('interview') ? 'interview_schedule' :
      options.validateRow?.name?.toLowerCase().includes('lead') ? 'lead_list' : 'unknown'
    );
    const sourceFilename = options.sourceFilename || (filePath ? path.basename(filePath) : 'uploaded_file');
    
    const { logAudit } = require('../utils/audit');
    logAudit({
      actorUserId: uploadedBy,
      action: 'bulk_upload_completed',
      entityType: 'bulk_upload_job',
      entityId: jobId,
      entityName: `${flowType} upload — ${sourceFilename}`,
      subjectType: 'bulk_upload_job',
      subjectId: jobId,
      subjectName: `${flowType} upload — ${sourceFilename}`,
      newData: {
        flow_type: flowType,
        source_filename: sourceFilename,
        file_size_bytes: fileSize,
        total_rows: processed,
        created: succeeded,
        duplicates: duplicates,
        errors: failed,
        warnings: 0,
        duration_ms: statusObj.startTime ? (Date.now() - statusObj.startTime) : 0,
        errorReportUrl,
      },
      organizationId,
    });

    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }

    return {
      jobId,
      processed,
      succeeded,
      duplicates,
      failed,
      totalRows: processed,
      errorReportUrl,
    };
  } catch (err) {
    console.error(`[StreamingBulkPipeline] Job ${jobId} failed with error:`, err);
    statusObj.state = 'failed';
    statusObj.error = err.message;
    const errorReportUrl = finalizeErrorReport(jobId);
    statusObj.errorReportUrl = errorReportUrl;

    // Apply cooldown if job did real work before failing
    // (processed > 0 means DB was touched, cooldown applies)
    applyUserCooldown(uploadedBy, processed, options.userRole);

    if (emitCompleted) {
      emitCompleted(organizationId, jobId, {
        processed,
        succeeded,
        duplicates,
        failed,
        errorReportUrl,
      });
    }

    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }

    throw err;
  }
}

/**
 * Memory-safe streaming pipeline implementation (explicit code shape).
 * Processes a file stream row-by-row, validating and batching inserts to the database.
 */
async function processUploadStream({
  filePath,
  fileType,
  schema,
  rowValidator,
  batchInsert,
  onProgress,
  emitError,
  jobId,
}) {
  let processed = 0;
  let created = 0;
  let duplicates = 0;
  let errors = 0;
  let warnings = 0;
  let batch = [];

  const BATCH_SIZE = 500;

  // Use parseFileStream to parse row-by-row streamingly
  await parseFileStream(filePath, fileType, async (rawRow, rowNum) => {
    processed++;
    const result = await rowValidator(rawRow, rowNum);

    if (result.severity === 'error') {
      errors++;
      emitError(rowNum, 'error', result.reason);
      return;
    }
    if (result.severity === 'duplicate') {
      duplicates++;
      emitError(rowNum, 'duplicate', result.reason);
      return;
    }

    if (Array.isArray(result.warnings)) {
      for (const w of result.warnings) {
        warnings++;
        emitError(rowNum, 'warning', w);
      }
    }

    if (result.data) {
      batch.push(result.data);
    } else {
      created++; // Row processed but no data to insert (e.g. warning-only or soft-skip)
    }

    if (batch.length >= BATCH_SIZE) {
      await batchInsert(batch);
      created += batch.length;
      batch = [];
      onProgress({ processed, created, duplicates, errors, warnings });
    }
  });

  // Flush remaining rows
  if (batch.length > 0) {
    await batchInsert(batch);
    created += batch.length;
    batch = [];
  }

  // Final progress update
  onProgress({ processed, created, duplicates, errors, warnings });

  // Accounting invariant check
  if (created + duplicates + errors !== processed) {
    throw new Error(`Row accounting invariant violated: total processed rows (${processed}) does not equal created/succeeded (${created}) + duplicates (${duplicates}) + errors/failed (${errors})`);
  }

  return { processed, created, duplicates, errors, warnings };
}

module.exports = {
  runStreamingBulkUploadPipeline,
  processUploadStream,
  getPipelineJobStatus,
  pipelineJobStatusMap,
  checkOrgConcurrency,
  checkUserCooldown,
  applyUserCooldown,
  userCooldownMap,
};
