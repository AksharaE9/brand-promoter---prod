'use strict';

/**
 * importJobManager.js — Lifecycle management, Graceful Shutdown, Stuck-Job Reaper, and Auto-Recovery.
 */

const { getInterruptedJobs, getStuckJobs, markJobStatus, updateCheckpoint } = require('./importJobRepository');

// Map of active jobs: jobId -> { controller, inFlightBatchPromise, lastRow }
const activeJobsMap = new Map();
let isShuttingDown = false;
let reaperInterval = null;

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
 * Graceful shutdown handler for SIGTERM / SIGINT on Render.
 * 1. Stops accepting new rows/batches.
 * 2. Awaits current in-flight database batch.
 * 3. Writes checkpoint and marks active jobs as INTERRUPTED.
 * 4. Exits cleanly without corrupting state.
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
          await markJobStatus(jobId, 'INTERRUPTED');
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
  console.log('[ImportJobManager] Graceful shutdown of import jobs complete.');
}

/**
 * Stuck-Job Reaper: Finds jobs in PROCESSING with no checkpoint update for >10 mins.
 * Marks them INTERRUPTED and triggers alert logging.
 */
async function runStuckJobReaper() {
  try {
    const stuckJobs = await getStuckJobs(10);
    if (stuckJobs && stuckJobs.length > 0) {
      console.warn(`[StuckJobReaper] DETECTED ${stuckJobs.length} stalled bulk import job(s) with no progress > 10 mins.`);
      for (const job of stuckJobs) {
        console.warn(`[StuckJobReaper] Marking stalled job ${job.id} (flow: ${job.flow_type}, row: ${job.last_committed_row}/${job.total_rows}) as INTERRUPTED for resumption.`);
        await markJobStatus(job.id, 'INTERRUPTED');
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
 * Startup recovery sweep: Runs on server boot to find any jobs left in INTERRUPTED state.
 */
async function runStartupRecoverySweep() {
  try {
    const interrupted = await getInterruptedJobs();
    if (interrupted && interrupted.length > 0) {
      console.log(`[StartupRecovery] Found ${interrupted.length} interrupted import job(s) eligible for auto-resumption:`, interrupted.map(j => j.id));
    }
    return interrupted;
  } catch (err) {
    console.warn('[StartupRecovery] Notice during recovery sweep:', err.message);
    return [];
  }
}

module.exports = {
  registerActiveJob,
  unregisterActiveJob,
  isServerShuttingDown,
  handleGracefulShutdown,
  runStuckJobReaper,
  startStuckJobReaper,
  runStartupRecoverySweep,
};
