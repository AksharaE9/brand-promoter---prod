'use strict';

const fs = require('fs');
const path = require('path');
const { parseFileStream } = require('./csvXlsxStreamParser');
const { initErrorReport, appendFailedRow, finalizeErrorReport } = require('./bulkUploadErrorReport');
const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');
const {
  computeIdempotencyKey,
  createJobRecord,
  updateCheckpoint,
  markJobStatus,
  recordProcessedKeys,
  isKeyProcessed,
  getJobById,
} = require('./importJobRepository');
const { registerActiveJob, unregisterActiveJob, isServerShuttingDown } = require('./importJobManager');
const { storePreviewSession, formatPreviewResponse } = require('./bulkUploadPreview');

const DEFAULT_BATCH_SIZE = BULK_UPLOAD_LIMITS.BATCH_SIZE_CANDIDATE; // conservative default

// Active job status store for immediate status querying across all pipeline jobs
const pipelineJobStatusMap = new Map();

// In-memory set of processed keys per job for O(1) duplicate prevention during re-runs
const processedKeysCache = new Map(); // jobId -> Set<idempotencyKey>

/**
 * Per-user cooldown tracking.
 * Map of userId → { expiresAt: Date, rowsProcessed: number }
 */
const userCooldownMap = new Map();

/**
 * Checks if an organisation already has a running bulk upload job.
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
 */
function checkUserCooldown(userId, role) {
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
 * Sets a cooldown for a user after a bulk job.
 */
function applyUserCooldown(userId, rowsProcessed, role) {
  if (!userId) return;
  if (role && BULK_UPLOAD_LIMITS.COOLDOWN_EXEMPT_ROLES.includes(role)) return;
  if (rowsProcessed === 0) return;

  const expiresAt = Date.now() + (BULK_UPLOAD_LIMITS.COOLDOWN_SECONDS * 1000);
  userCooldownMap.set(userId, { expiresAt, rowsProcessed });

  const timer = setTimeout(() => userCooldownMap.delete(userId), BULK_UPLOAD_LIMITS.COOLDOWN_SECONDS * 1000 + 1000);
  if (timer.unref) timer.unref();
}

/**
 * Gets status for a pipeline job by jobId.
 */
function getPipelineJobStatus(jobId) {
  return pipelineJobStatusMap.get(jobId) || null;
}

/**
 * Universal streaming bulk upload pipeline with Crash Resilience, Checkpointing,
 * Resumability, Row-Level Idempotency, Backpressure, Poison-Pill Isolation, and Preview Mode.
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
    preview = false,
  } = options;

  const flowType = options.flowType || (
    (options.validateRow?.name && options.validateRow.name.toLowerCase().includes('candidate')) ? 'candidates' :
    (options.validateRow?.name && options.validateRow.name.toLowerCase().includes('feedback')) ? 'interview-feedback' :
    (options.validateRow?.name && options.validateRow.name.toLowerCase().includes('interview')) ? 'interviews' :
    (options.validateRow?.name && options.validateRow.name.toLowerCase().includes('lead')) ? 'lead_list' : 'candidates'
  );

  const sourceFilename = options.sourceFilename || (filePath ? path.basename(filePath) : 'uploaded_file');

  // Admission control: check process memory before beginning work
  const startRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (startRssMb > 307) { // 60% of 512MB
    console.warn(`[AdmissionControl] Instance memory elevated before starting job ${jobId}: ${startRssMb}MB. Running GC and cooling down.`);
    if (global.gc) global.gc();
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Check if this is a resumption of a previously interrupted job
  let startFromRow = options.startFromRow || 0;
  let resumeAttempts = 0;
  let existingCreatedEntityIds = [];

  let processed = 0;
  let created = 0;
  let updated = 0;
  let duplicates = 0;
  let failed = 0;

  if (!preview) {
    const existingJob = await getJobById(jobId).catch(() => null);
    if (existingJob) {
      if (existingJob.status === 'COMPLETED') {
        console.log(`[StreamingBulkUpload] Job ${jobId} already marked COMPLETED.`);
      }
      startFromRow = existingJob.last_committed_row || 0;
      resumeAttempts = (existingJob.resume_attempts || 0) + 1;
      created = existingJob.created_count || 0;
      updated = existingJob.updated_count || 0;
      duplicates = existingJob.duplicates_count || 0;
      failed = existingJob.failed_count || 0;
      try {
        existingCreatedEntityIds = Array.isArray(existingJob.created_entity_ids)
          ? existingJob.created_entity_ids
          : JSON.parse(existingJob.created_entity_ids || '[]');
      } catch (_) {}
      console.log(`[Resumption] Resuming job ${jobId} from row ${startFromRow + 1} (attempt #${resumeAttempts}). Cumulative counts: created=${created}, updated=${updated}, duplicates=${duplicates}, failed=${failed}`);
    } else {
      await createJobRecord({
        jobId,
        flowType,
        filePath,
        sourceFilename,
        uploadedBy,
        organizationId,
      }).catch(err => console.warn('[JobRepo] Notice creating job record:', err.message));
    }
  }

  initErrorReport(jobId);

  let systemErrorCount = 0;
  let dataErrorCount = 0;
  let totalRows = 0;
  let currentEffectiveBatchSize = batchSize;
  let batch = [];
  let pendingKeyEntries = [];
  let collectedEntityIds = [...existingCreatedEntityIds];
  let firstErrorReason = null;
  let isAbortingForShutdown = false;
  let detectedHeaders = {};
  const sampleErrors = [];
  const autoCreatedJobs = [];

  // Metrics collection
  const startTime = Date.now();
  let peakRssMb = startRssMb;
  let totalBatchesCommitted = 0;
  let throttlingEvents = 0;
  let isolatedRetries = 0;

  if (!processedKeysCache.has(jobId)) {
    processedKeysCache.set(jobId, new Set());
  }
  const jobKeySet = processedKeysCache.get(jobId);

  const generateSystemErrorId = () =>
    `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const statusObj = {
    jobId,
    state: 'active',
    uploadedBy,
    processed: 0,
    succeeded: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
    totalRows: 0,
    progress: 0,
    errorReportUrl: null,
    error: null,
    summaryError: null,
    startTime,
  };
  pipelineJobStatusMap.set(jobId, statusObj);

  const pipelineContext = {
    jobId,
    uploadedBy,
    organizationId,
    userRole: options.userRole || null,
    flowType,
    preview,
    ...context,
  };

  // Controller for graceful shutdown hook
  const controller = {
    abortForShutdown: async () => {
      isAbortingForShutdown = true;
      console.log(`[StreamingBulkUpload] Graceful abort requested for job ${jobId}. Flushing in-flight batch...`);
      await flushBatch();
    },
  };
  registerActiveJob(jobId, controller);

  /**
   * Commits the current batch to DB with atomic Checkpointing and Poison-Pill Isolation.
   */
  const flushBatch = async () => {
    if (batch.length === 0 || preview) {
      batch = [];
      pendingKeyEntries = [];
      return;
    }

    const currentBatch = batch;
    const currentKeys = pendingKeyEntries;
    batch = [];
    pendingKeyEntries = [];

    const preBatchRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    peakRssMb = Math.max(peakRssMb, preBatchRss);

    let batchCreated = 0;
    let batchUpdated = 0;
    let batchFailed = 0;
    let newIds = [];

    try {
      const res = await batchInsert(currentBatch, pipelineContext);
      if (res) {
        if (typeof res.created === 'number') batchCreated = res.created;
        else if (typeof res.succeeded === 'number') batchCreated = res.succeeded;
        else batchCreated = currentBatch.length;

        if (typeof res.updated === 'number') batchUpdated = res.updated;
        if (typeof res.duplicates === 'number') duplicates += res.duplicates;
        if (typeof res.failed === 'number') {
          batchFailed = res.failed;
          dataErrorCount += res.failed;
        }
        if (Array.isArray(res.createdEntityIds)) {
          newIds = res.createdEntityIds;
          collectedEntityIds.push(...newIds);
        }
      } else {
        batchCreated = currentBatch.length;
      }
      created += batchCreated;
      updated += batchUpdated;
      failed += batchFailed;
      totalBatchesCommitted++;
    } catch (batchErr) {
      // ── Row-Level Poison Pill Isolation Fallback ─────────────────────────
      isolatedRetries++;
      console.warn(`[PoisonPillIsolation] Batch of ${currentBatch.length} items on job ${jobId} failed (${batchErr.message}). Isolating row-by-row...`);

      for (let i = 0; i < currentBatch.length; i++) {
        const singleItem = currentBatch[i];
        try {
          const singleRes = await batchInsert([singleItem], pipelineContext);
          if (singleRes && typeof singleRes.created === 'number') {
            created += singleRes.created;
          } else if (singleRes && typeof singleRes.updated === 'number') {
            updated += singleRes.updated;
          } else {
            created++;
          }
          if (singleRes && Array.isArray(singleRes.createdEntityIds)) {
            collectedEntityIds.push(...singleRes.createdEntityIds);
          }
        } catch (singleErr) {
          failed++;
          dataErrorCount++;
          const rowNum = singleItem.rowNumber || 'N/A';
          appendFailedRow(
            jobId,
            rowNum,
            `Isolated row write error: ${singleErr.message}`,
            'error',
            'DATA_ERROR'
          );
        }
      }
    }

    // Record processed idempotency keys
    if (currentKeys.length > 0) {
      await recordProcessedKeys(jobId, currentKeys).catch(() => {});
      for (const k of currentKeys) {
        jobKeySet.add(k.idempotencyKey);
      }
    }

    // Write Atomic Checkpoint
    const lastRow = currentBatch[currentBatch.length - 1]?.rowNumber || processed;
    const currentMetrics = {
      durationMs: Date.now() - startTime,
      peakRssMb,
      totalBatches: totalBatchesCommitted,
      throttlingEvents,
      isolatedRetries,
    };

    await updateCheckpoint(jobId, {
      lastProcessedRow: processed,
      lastCommittedRow: lastRow,
      created,
      updated,
      duplicates,
      failed,
      newEntityIds: newIds,
      metrics: currentMetrics,
    }).catch(err => console.warn('[Checkpoint] Notice updating checkpoint:', err.message));

    // ── Adaptive Backpressure & Throttling Check ────────────────────────────
    const postBatchRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    peakRssMb = Math.max(peakRssMb, postBatchRss);

    if (postBatchRss >= 384) { // 75% of 512MB: Hard Backpressure
      throttlingEvents++;
      console.warn(`[AdaptiveBackpressure HARD] High RSS on job ${jobId}: ${postBatchRss}MB. Pausing for GC and cool-down.`);
      if (global.gc) global.gc();
      await new Promise(resolve => setTimeout(resolve, 800));
      currentEffectiveBatchSize = Math.max(25, Math.floor(batchSize / 4));
    } else if (postBatchRss >= 307) { // 60% of 512MB: Soft Backpressure
      throttlingEvents++;
      console.warn(`[AdaptiveBackpressure SOFT] Elevated RSS on job ${jobId}: ${postBatchRss}MB. Halving batch size and throttling.`);
      currentEffectiveBatchSize = Math.max(50, Math.floor(batchSize / 2));
      await new Promise(resolve => setTimeout(resolve, 300));
    } else {
      currentEffectiveBatchSize = batchSize;
    }
  };

  try {
    const parseResult = await parseFileStream(filePath, fileType, async (rawRow, rowNumber) => {
      // If graceful shutdown requested, stop accepting new rows
      if (isAbortingForShutdown || isServerShuttingDown()) {
        return;
      }

      processed++;
      totalRows = Math.max(totalRows, rowNumber - 1);

      // Skip already committed rows during resumption
      if (startFromRow > 0 && rowNumber <= startFromRow) {
        return;
      }

      // Check row-level idempotency key
      const dedupField = rawRow.Phone || rawRow.phone || rawRow['Phone Number'] || rawRow.Email || rawRow.email || rawRow.Name || rowNumber;
      const idempotencyKey = computeIdempotencyKey(jobId, rowNumber, dedupField);

      if (jobKeySet.has(idempotencyKey)) {
        return; // Already processed in earlier run of this job
      }

      let valResult;
      try {
        valResult = await validateRow(rawRow, rowNumber, pipelineContext);
      } catch (valErr) {
        const errorId = generateSystemErrorId();
        const rowId = rawRow.Name || rawRow.name || rawRow['Candidate Name'] || rawRow.Phone || rawRow.phone || rawRow['Phone Number'] || '';
        console.error(`[SYSTEM_ERROR ${errorId}] Row ${rowNumber} validation exception:`, valErr.stack || valErr);
        valResult = {
          valid: false,
          errorType: 'SYSTEM_ERROR',
          errors: [`${rowId ? `[Row Info: ${rowId}] ` : ''}System error while processing this row — please report this. (Reference: ${errorId})`],
        };
      }

      if (!valResult || !valResult.valid) {
        failed++;
        const isSysErr = valResult?.errorType === 'SYSTEM_ERROR';
        if (isSysErr) systemErrorCount++;
        else dataErrorCount++;

        const rowId = rawRow.Name || rawRow.name || rawRow['Candidate Name'] || rawRow.Phone || rawRow.phone || rawRow['Phone Number'] || '';
        const prefix = (rowId && !isSysErr) ? `[Row Info: ${rowId}] ` : '';
        const reason = (valResult?.errors && valResult.errors.length > 0)
          ? valResult.errors.join('; ')
          : (valResult?.failureReason || 'Row validation failed');
        if (!firstErrorReason) {
          firstErrorReason = (valResult?.errors && valResult.errors.length > 0) ? valResult.errors[0] : reason;
        }
        appendFailedRow(jobId, rowNumber, isSysErr ? reason : `${prefix}${reason}`, 'error', isSysErr ? 'SYSTEM_ERROR' : 'DATA_ERROR');

        if (preview && sampleErrors.length < 10) {
          sampleErrors.push({
            rowNumber,
            reason: isSysErr ? reason : `${prefix}${reason}`,
            severity: 'error',
          });
        }
      } else {
        // Duplicate checks
        if (typeof duplicateCheck === 'function') {
          let dupResult = null;
          try {
            dupResult = await duplicateCheck(valResult.data, rowNumber, pipelineContext);
          } catch (dupErr) {
            console.error(`[DuplicateCheck] Row ${rowNumber} check exception:`, dupErr.message);
          }

          if (dupResult && dupResult.isDuplicate) {
            duplicates++;
            appendFailedRow(jobId, rowNumber, dupResult.reason || 'Duplicate skipped', 'duplicate', 'N/A');
            return;
          }
          if (dupResult && Array.isArray(dupResult.warnings)) {
            dupResult.warnings.forEach((warn) => {
              appendFailedRow(jobId, rowNumber, warn, 'warning', 'N/A');
            });
          }
        }

        // Add validator warnings
        if (Array.isArray(valResult.warnings)) {
          valResult.warnings.forEach((warn) => {
            appendFailedRow(jobId, rowNumber, warn, 'warning', 'N/A');
          });
        }

        let item = null;
        try {
          item = transformRow
            ? await transformRow(valResult.data, rowNumber, pipelineContext)
            : valResult.data;
        } catch (transErr) {
          const errorId = generateSystemErrorId();
          console.error(`[SYSTEM_ERROR ${errorId}] Row ${rowNumber} transform exception:`, transErr.stack || transErr);
          failed++;
          systemErrorCount++;
          const transReason = `System error while transforming row — please report this. (Reference: ${errorId})`;
          if (!firstErrorReason) firstErrorReason = transReason;
          appendFailedRow(jobId, rowNumber, transReason, 'error', 'SYSTEM_ERROR');
          return;
        }

        if (item) {
          if (!preview) {
            batch.push({ ...item, rowNumber });
            pendingKeyEntries.push({
              rowNumber,
              idempotencyKey,
              action: 'CREATED',
            });
          } else {
            created++;
            if (item.jobRole || item.preferredRole) {
              autoCreatedJobs.push(item.jobRole || item.preferredRole);
            }
          }
        } else {
          duplicates++;
          appendFailedRow(jobId, rowNumber, 'Row skipped (no data to insert)', 'duplicate', 'N/A');
        }

        if (!preview && batch.length >= currentEffectiveBatchSize) {
          await flushBatch();
        }
      }

      if (processed % 100 === 0 || processed === 1) {
        const percent = totalRows ? Math.min(99, Math.round((processed / totalRows) * 100)) : 50;
        statusObj.processed = processed;
        statusObj.succeeded = created + updated;
        statusObj.created = created;
        statusObj.updated = updated;
        statusObj.duplicates = duplicates;
        statusObj.failed = failed;
        statusObj.totalRows = totalRows;
        statusObj.progress = percent;

        if (emitProgress) {
          emitProgress(organizationId, jobId, {
            processed,
            succeeded: created + updated,
            created,
            updated,
            duplicates,
            failed,
            totalRows,
          });
        }
      }
    });

    await flushBatch();

    // ── Dry-Run Preview Mode Return ─────────────────────────────────────────
    if (preview) {
      unregisterActiveJob(jobId);
      const previewToken = `prev_${jobId}_${Date.now()}`;
      const previewResult = formatPreviewResponse({
        jobId,
        sourceFilename,
        detectedHeaders,
        totalRows: processed,
        projectedCreated: created,
        projectedUpdated: updated,
        projectedDuplicates: duplicates,
        projectedErrors: failed,
        sampleErrors,
        autoCreatedJobs,
        previewToken,
      });

      storePreviewSession(previewToken, {
        jobId,
        filePath,
        fileType,
        sourceFilename,
        uploadedBy,
        organizationId,
        options,
      });

      return previewResult;
    }

    if (parseResult && parseResult.extraSheetNames && parseResult.extraSheetNames.length > 0) {
      appendFailedRow(
        jobId,
        0,
        `Note: Workbook contained multiple sheets. Only the first sheet ("${parseResult.sheetName}") was processed. Sheets ignored: ${parseResult.extraSheetNames.join(', ')}`,
        'warning',
        'N/A'
      );
    }

    // Enforce Strict Accounting Invariant
    const succeeded = created + updated;
    const expectedTotal = succeeded + duplicates + failed;
    if (processed !== expectedTotal && !isAbortingForShutdown) {
      throw new Error(`Row accounting invariant violated: total processed rows (${processed}) does not equal created/updated (${succeeded}) [created: ${created}, updated: ${updated}] + duplicates (${duplicates}) + errors/failed (${failed})`);
    }

    if (onComplete) {
      await onComplete({
        processed,
        succeeded,
        created,
        updated,
        duplicates,
        failed,
        totalRows: processed,
      }, pipelineContext);
    }

    const errorReportUrl = await finalizeErrorReport(jobId, flowType);

    // Summary intelligence
    if (systemErrorCount > 0 && (systemErrorCount === processed || systemErrorCount >= failed * 0.5)) {
      if (systemErrorCount === processed) {
        statusObj.summaryError = `${processed} of ${processed} rows failed with the same system error. This is likely a bug, not a data problem.`;
      } else {
        statusObj.summaryError = `${systemErrorCount} of ${processed} rows failed with a system error. This is likely a bug, not a data problem.`;
      }
    } else if (failed === processed && processed > 0 && firstErrorReason) {
      statusObj.summaryError = `All ${processed} rows failed: ${firstErrorReason}`;
    } else if (failed > 0 && firstErrorReason) {
      statusObj.summaryError = `${failed} of ${processed} rows failed. First error: ${firstErrorReason}`;
    }

    const finalDurationMs = Date.now() - startTime;
    const finalMetrics = {
      durationMs: finalDurationMs,
      durationSec: (finalDurationMs / 1000).toFixed(2),
      rowsPerSec: (processed / Math.max(1, finalDurationMs / 1000)).toFixed(1),
      peakRssMb,
      totalBatches: totalBatchesCommitted,
      throttlingEvents,
      isolatedRetries,
    };

    statusObj.state = isAbortingForShutdown ? 'interrupted' : 'completed';
    statusObj.processed = processed;
    statusObj.succeeded = succeeded;
    statusObj.created = created;
    statusObj.updated = updated;
    statusObj.duplicates = duplicates;
    statusObj.failed = failed;
    statusObj.totalRows = processed;
    statusObj.progress = 100;
    statusObj.errorReportUrl = errorReportUrl;

    await markJobStatus(jobId, isAbortingForShutdown ? 'INTERRUPTED' : 'COMPLETED', {
      errorReportUrl,
      metrics: finalMetrics,
      created,
      updated,
      duplicates,
      failed,
      createdEntityIds: collectedEntityIds,
    }).catch(() => {});

    applyUserCooldown(uploadedBy, processed, options.userRole);

    if (emitCompleted) {
      emitCompleted(organizationId, jobId, {
        processed,
        succeeded,
        created,
        updated,
        duplicates,
        failed,
        errorReportUrl,
        summaryError: statusObj.summaryError,
      });
    }

    unregisterActiveJob(jobId);
    processedKeysCache.delete(jobId);

    return {
      jobId,
      processed,
      succeeded,
      created,
      updated,
      duplicates,
      failed,
      totalRows: processed,
      errorReportUrl,
      metrics: finalMetrics,
    };
  } catch (err) {
    unregisterActiveJob(jobId);
    processedKeysCache.delete(jobId);

    const finalDurationMs = Date.now() - startTime;
    const finalMetrics = {
      durationMs: finalDurationMs,
      peakRssMb,
      error: err.message,
    };

    await markJobStatus(jobId, 'FAILED', {
      metrics: finalMetrics,
      created,
      updated,
      duplicates,
      failed,
    }).catch(() => {});

    statusObj.state = 'failed';
    statusObj.error = err.message;
    throw err;
  }
}

module.exports = {
  runStreamingBulkUploadPipeline,
  getPipelineJobStatus,
  checkOrgConcurrency,
  checkUserCooldown,
  applyUserCooldown,
};
