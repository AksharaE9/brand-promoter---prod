'use strict';

/**
 * bulkUploadLimits.js — Single source of truth for all bulk upload resource limits.
 *
 * EMPIRICAL BASIS (measured 2026-08-29):
 *  - The streaming pipeline holds only `batchSize` rows in RAM at once.
 *  - Peak RSS is ~130MB REGARDLESS of total row count (streaming window = fixed).
 *  - The limiting factor is DURATION, not memory: ~75ms/row for the interview path
 *    (async DB calls for application lookup + interview create + slot count).
 *  - 500 rows × 75ms = ~38s worst-case per job on the interview path.
 *  - 2 simultaneous large jobs would bring peak RSS to ~260MB + 100MB baseline = 360MB,
 *    touching 70% of the 512MB Render instance under normal load — hence the concurrency lock.
 *
 * DO NOT change these values in individual processor files.
 * Import this module everywhere instead.
 */

const BULK_UPLOAD_LIMITS = {
  /**
   * Maximum data rows allowed per upload file (header row excluded).
   * Evidence: 500 rows × 75ms/row = ~38s worst-case (interview path).
   * Covers any realistic college-drive batch. Files larger than this must be split.
   */
  MAX_ROWS: 500,

  /**
   * Cooldown period (seconds) a user must wait after a successful bulk job
   * before starting another. Ensures one max-size job completes and the DB
   * recovers before the next import runs.
   * SUPER_ADMIN role is exempt (they manage the system and may need rapid re-imports).
   * The ORG CONCURRENCY LOCK still applies to all roles including SUPER_ADMIN.
   */
  COOLDOWN_SECONDS: 60,

  /**
   * Maximum concurrent bulk jobs per organisation (across all paths: candidate,
   * interview, feedback). The crash scenario is two simultaneous large imports —
   * not one user double-clicking.
   */
  MAX_CONCURRENT_PER_ORG: 1,

  /**
   * Batch sizes per path. Chosen so each batch flush completes in < 5s.
   * Interview: 100 rows × ~75ms/row = 7.5s/batch (includes pre-fetched user/app maps)
   * Feedback: 100 rows × ~50ms/row = 5s/batch
   * Candidate: 250 rows × ~15ms/row = 3.75s/batch (simple upsert)
   */
  BATCH_SIZE_INTERVIEW: 100,
  BATCH_SIZE_FEEDBACK: 100,
  BATCH_SIZE_CANDIDATE: 250,

  /**
   * Error/warning report retention (milliseconds).
   * Reports are purged from disk after this window.
   */
  REPORT_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Roles exempt from the per-user cooldown (but NOT from the org concurrency lock).
   */
  COOLDOWN_EXEMPT_ROLES: ['SUPER_ADMIN'],
};

module.exports = { BULK_UPLOAD_LIMITS };
