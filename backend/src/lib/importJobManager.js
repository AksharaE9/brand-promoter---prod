'use strict';

/**
 * importJobManager.js — Lifecycle management, Graceful Shutdown, Stuck-Job Reaper,
 * and Hardened Crash-Resilient Auto-Recovery with Attempt Cap & Circuit Breaker.
 */

const fs = require('fs');
const jobRepo = require('./importJobRepository');

// Processors for each import flow
const candidateProc = require('../jobs/bulkCandidateUpload.processor');
const joinedProc = require('../jobs/bulkJoinedCandidateUpload.processor');
const offerProc = require('../jobs/bulkOfferLetterUpload.processor');
const interviewProc = require('../jobs/bulkInterviewUpload.processor');
const feedbackProc = require('../jobs/bulkFeedbackUpload.processor');

// Map of active jobs: jobId -> { controller, inFlightBatchPromise, lastRow }
const activeJobsMap = new Map();
let isShuttingDown = false;
let reaperInterval = null;
let recoveryTimeout = null;

// Circuit Breaker State
let consecutiveFailures = 0;
let isCircuitBreakerTripped = false;
const MAX_CONSECUTIVE_FAILURES = 2;
const MAX_RESUME_ATTEMPTS = 3;
const MEMORY_SOFT_THRESHOLD_MB = 280;

/**
 * Registers an active job controller.
 */
function registerActiveJob(jobId, controller) {
  activeJobsMap.set(jobId, {
    controller,
    startedAt: Date.now(),
  });
}

/**
 * Unregisters an active job.
 */
function unregisterActiveJob(jobId) {
  activeJobsMap.delete(jobId);
}

/**
 * Checks if the server is currently shutting down.
 */
function isServerShuttingDown() {
  return isShuttingDown;
}

/**
 * Circuit breaker status & controls.
 */
function isRecoveryCircuitBreakerTripped() {
  return isCircuitBreakerTripped;
}

function resetRecoveryCircuitBreaker() {
  isCircuitBreakerTripped = false;
  consecutiveFailures = 0;
  console.log('[StartupRecovery:CIRCUIT_BREAKER] Circuit breaker manually reset by admin.');
}

function tripCircuitBreaker(reason) {
  isCircuitBreakerTripped = true;
  console.error(`[StartupRecovery:CIRCUIT_BREAKER] ⚠️ Auto-resumption DISABLED: ${reason}. Admin intervention required.`);
}

/**
 * Graceful shutdown handler for SIGTERM / SIGINT on Render.
 */
async function handleGracefulShutdown(signal = 'SIGTERM') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[ImportJobManager] Received ${signal}. Initiating graceful shutdown of ${activeJobsMap.size} active import job(s)...`);

  const shutdownPromises = [];

  for (const [jobId, jobInfo] of activeJobsMap) {
    shutdownPromises.push(
      (async () => {
        try {
          console.log(`[ImportJobManager] Pausing active job ${jobId} and finalizing in-flight batch...`);
          if (jobInfo.controller && typeof jobInfo.controller.abortForShutdown === 'function') {
            await jobInfo.controller.abortForShutdown();
          }
          await jobRepo.markJobStatus(jobId, 'INTERRUPTED');
          console.log(`[ImportJobManager] Job ${jobId} successfully checkpointed as INTERRUPTED.`);
        } catch (err) {
          console.error(`[ImportJobManager] Error checkpointing job ${jobId} during shutdown:`, err.message);
        }
      })()
    );
  }

  // Allow up to 8 seconds for graceful batch finalization
  await Promise.race([
    Promise.allSettled(shutdownPromises),
    new Promise(resolve => setTimeout(resolve, 8000)),
  ]);

  if (reaperInterval) clearInterval(reaperInterval);
  if (recoveryTimeout) clearTimeout(recoveryTimeout);
  console.log('[ImportJobManager] Graceful shutdown of import jobs complete.');
}

/**
 * Stuck-Job Reaper: Finds jobs in PROCESSING with no checkpoint update for >10 mins.
 * Marks them INTERRUPTED if under attempt cap, or FAILED_INCOMPLETE if at cap.
 * NEVER creates synthetic job records.
 */
async function runStuckJobReaper() {
  try {
    const stuckJobs = await jobRepo.getStuckJobs(10);
    if (stuckJobs && stuckJobs.length > 0) {
      console.warn(`[StuckJobReaper] DETECTED ${stuckJobs.length} stalled bulk import job(s) with no progress > 10 mins.`);
      for (const job of stuckJobs) {
        if ((job.resume_attempts || 0) >= MAX_RESUME_ATTEMPTS) {
          console.warn(`[StuckJobReaper] Job ${job.id} exceeded max attempts (${job.resume_attempts}/${MAX_RESUME_ATTEMPTS}). Marking FAILED_INCOMPLETE.`);
          await jobRepo.markJobStatus(job.id, 'FAILED_INCOMPLETE', {
            metrics: { failureReason: `Stalled in PROCESSING for >10m and exceeded max attempts (${job.resume_attempts})` }
          });
        } else {
          console.warn(`[StuckJobReaper] Marking stalled job ${job.id} (flow: ${job.flow_type}, row: ${job.last_committed_row}/${job.total_rows}) as INTERRUPTED for resumption.`);
          await jobRepo.markJobStatus(job.id, 'INTERRUPTED');
        }
      }
    }
  } catch (err) {
    console.error('[StuckJobReaper] Error running stuck job sweep:', err.message);
  }
}

/**
 * Starts the periodic stuck-job reaper timer (every 2 minutes).
 */
function startStuckJobReaper(intervalMs = 120000) {
  if (reaperInterval) return;
  reaperInterval = setInterval(runStuckJobReaper, intervalMs);
  if (reaperInterval.unref) reaperInterval.unref();
  console.log('[StuckJobReaper] Periodic reaper started (sweep interval: 2m, stall threshold: 10m).');
}

/**
 * Resolves the appropriate processor function for a given flow type.
 */
function getProcessorForFlow(flowType) {
  const clean = String(flowType || '').toLowerCase();
  if (clean === 'joined') return joinedProc.processJoinedCandidateUpload;
  if (clean === 'offer' || clean === 'offer-letter') return offerProc.processOfferLetterUpload;
  if (clean === 'interviews' || clean === 'interview-schedule') return interviewProc.processBulkInterviewUpload;
  if (clean === 'feedback' || clean === 'interview-feedback') return feedbackProc.processBulkFeedbackUpload;
  return candidateProc.processCandidateUpload;
}

/**
 * Resumes a single interrupted job with strict validation, attempt capping, and admission control.
 */
async function resumeSingleJob(job) {
  const jobId = job.id;
  const currentAttempts = job.resume_attempts || 0;

  console.log(`[StartupRecovery] Validating job ${jobId} (flow: ${job.flow_type}, attempts: ${currentAttempts}/${MAX_RESUME_ATTEMPTS}, checkpoint row: ${job.last_committed_row || 0})...`);

  // 1. Enforce Hard Attempt Cap before starting
  if (currentAttempts >= MAX_RESUME_ATTEMPTS) {
    console.error(`[StartupRecovery] Job ${jobId} has reached attempt cap (${currentAttempts}/${MAX_RESUME_ATTEMPTS}). Marking FAILED_INCOMPLETE.`);
    await jobRepo.markJobStatus(jobId, 'FAILED_INCOMPLETE', {
      metrics: { failureReason: `Max resumption attempts (${MAX_RESUME_ATTEMPTS}) reached. Terminated without retry.` }
    });
    return false;
  }

  // 2. Pre-Resume File Validation: Confirm source file exists on disk
  if (!job.file_path || !fs.existsSync(job.file_path)) {
    console.error(`[StartupRecovery] Job ${jobId} source file missing or inaccessible on disk: "${job.file_path}". Marking FAILED_INCOMPLETE.`);
    await jobRepo.incrementResumeAttempts(jobId);
    await jobRepo.markJobStatus(jobId, 'FAILED_INCOMPLETE', {
      metrics: { failureReason: `Source file missing or inaccessible on disk: ${job.file_path || 'null'}` }
    });
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      tripCircuitBreaker(`${consecutiveFailures} consecutive recovery jobs failed`);
    }
    return false;
  }

  // 3. Admission Control: Check instance memory before launching
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (rssMb > MEMORY_SOFT_THRESHOLD_MB) {
    console.warn(`[StartupRecovery:AdmissionControl] Memory elevated (${rssMb}MB > ${MEMORY_SOFT_THRESHOLD_MB}MB). Triggering GC and deferring job ${jobId}.`);
    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 2000));
    const postGcRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (postGcRss > MEMORY_SOFT_THRESHOLD_MB) {
      console.warn(`[StartupRecovery:AdmissionControl] Memory still elevated (${postGcRss}MB). Skipping job ${jobId} for this cycle.`);
      return false;
    }
  }

  // 4. Increment and persist attempt count in DB BEFORE launching processor
  const newAttemptCount = await jobRepo.incrementResumeAttempts(jobId);
  console.log(`[StartupRecovery] Launching resumption for job ${jobId} (attempt #${newAttemptCount})...`);

  // 5. Run processor sequentially
  const processor = getProcessorForFlow(job.flow_type);
  try {
    const ext = job.file_path.endsWith('.csv') ? '.csv' : '.xlsx';
    await processor({
      jobId,
      filePath: job.file_path,
      fileType: ext,
      uploadedBy: job.uploaded_by,
      organizationId: job.organization_id || 'defaultOrg',
      sourceFilename: job.source_filename || 'recovered_import.xlsx',
      startFromRow: job.last_committed_row || 0,
    });

    const finalRecord = await jobRepo.getJobById(jobId);
    if (finalRecord && finalRecord.status === 'COMPLETED') {
      console.log(`[StartupRecovery] Job ${jobId} resumed and COMPLETED successfully.`);
      consecutiveFailures = 0;
      return true;
    } else {
      console.warn(`[StartupRecovery] Job ${jobId} finished with status ${finalRecord?.status || 'UNKNOWN'}.`);
      return false;
    }
  } catch (err) {
    console.error(`[StartupRecovery] Resumption failed for job ${jobId}:`, err.message);
    consecutiveFailures++;

    if (newAttemptCount >= MAX_RESUME_ATTEMPTS) {
      await jobRepo.markJobStatus(jobId, 'FAILED_INCOMPLETE', {
        metrics: { failureReason: `Failed on attempt ${newAttemptCount}: ${err.message}` }
      });
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      tripCircuitBreaker(`${consecutiveFailures} consecutive recovery jobs failed`);
    }

    return false;
  }
}

/**
 * Startup recovery sweep: Runs sequentially with concurrency = 1 and circuit breaker protection.
 */
async function runStartupRecoverySweep() {
  if (isCircuitBreakerTripped) {
    console.warn('[StartupRecovery] Auto-resumption is DISABLED by circuit breaker. Sweep skipped.');
    return [];
  }

  if (isShuttingDown) return [];

  try {
    const interrupted = await jobRepo.getInterruptedJobs();
    if (!interrupted || interrupted.length === 0) {
      console.log('[StartupRecovery] Zero interrupted jobs found eligible for resumption. System clean.');
      return [];
    }

    console.log(`[StartupRecovery] Found ${interrupted.length} interrupted import job(s) eligible for sequential auto-resumption:`, interrupted.map(j => j.id));

    // Process jobs SEQUENTIALLY (never concurrently)
    for (const job of interrupted) {
      if (isCircuitBreakerTripped || isShuttingDown) {
        console.warn('[StartupRecovery] Resumption loop aborted (circuit breaker or shutdown).');
        break;
      }

      await resumeSingleJob(job);
      // Brief cooldown between jobs to allow GC and memory stabilization
      await new Promise(r => setTimeout(r, 1000));
    }

    return interrupted;
  } catch (err) {
    console.warn('[StartupRecovery] Notice during recovery sweep:', err.message);
    return [];
  }
}

/**
 * Schedules the startup recovery sweep after a delay (allowing server warm-up and cache priming to complete first).
 */
function scheduleDelayedStartupRecovery(delayMs = 60000) {
  if (recoveryTimeout) clearTimeout(recoveryTimeout);
  console.log(`[StartupRecovery] Auto-recovery scheduled to run in ${Math.round(delayMs / 1000)}s after instance warm-up.`);
  recoveryTimeout = setTimeout(() => {
    runStartupRecoverySweep().catch(err => console.warn('[StartupRecovery] Sweep notice:', err.message));
  }, delayMs);
  if (recoveryTimeout.unref) recoveryTimeout.unref();
}

module.exports = {
  registerActiveJob,
  unregisterActiveJob,
  isServerShuttingDown,
  handleGracefulShutdown,
  runStuckJobReaper,
  startStuckJobReaper,
  runStartupRecoverySweep,
  scheduleDelayedStartupRecovery,
  isRecoveryCircuitBreakerTripped,
  resetRecoveryCircuitBreaker,
  resumeSingleJob,
};
