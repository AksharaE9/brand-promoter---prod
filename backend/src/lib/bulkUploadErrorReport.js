'use strict';

const fs = require('fs');
const path = require('path');
const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');

// Ensure reports directory exists inside uploads/
const REPORTS_DIR = path.join(__dirname, '..', '..', 'uploads', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Memory map of active report files: jobId → filePath
const jobReports = new Map();

// Purge timer handles: jobId → setTimeout handle (so we can cancel on early delete)
const purgeTimers = new Map();

/**
 * Purges report files older than REPORT_TTL_MS on startup.
 * Called once at module load time — cleans up orphans from previous process crashes.
 */
function purgeStaleReportsOnStartup() {
  try {
    const now = Date.now();
    const files = fs.readdirSync(REPORTS_DIR);
    for (const file of files) {
      if (!file.startsWith('bulk_upload_report_') || !file.endsWith('.csv')) continue;
      const filePath = path.join(REPORTS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > BULK_UPLOAD_LIMITS.REPORT_TTL_MS) {
          fs.unlinkSync(filePath);
          console.log(`[BulkUploadReport] Purged stale report: ${file}`);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// Run startup purge
purgeStaleReportsOnStartup();

/**
 * Schedules a report file for deletion after REPORT_TTL_MS (24 hours).
 * @param {string} jobId
 */
function scheduleReportPurge(jobId) {
  const filePath = path.join(REPORTS_DIR, `bulk_upload_report_${jobId}.csv`);

  // Clear any existing timer for this job
  const existing = purgeTimers.get(jobId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(() => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[BulkUploadReport] TTL expired — purged report for job ${jobId}`);
      }
    } catch (_) {}
    jobReports.delete(jobId);
    purgeTimers.delete(jobId);
  }, BULK_UPLOAD_LIMITS.REPORT_TTL_MS);

  // Don't block process exit
  if (handle.unref) handle.unref();

  purgeTimers.set(jobId, handle);
}

/**
 * Initializes a new CSV error report for a bulk upload job.
 * @param {string} jobId
 */
function initErrorReport(jobId) {
  const filePath = path.join(REPORTS_DIR, `bulk_upload_report_${jobId}.csv`);
  // Write CSV headers
  fs.writeFileSync(filePath, 'row_number,severity,reason\n', 'utf8');
  jobReports.set(jobId, filePath);
  return filePath;
}

/**
 * Appends a row failure, duplicate warning, or soft warning to the job's report file.
 * @param {string} jobId
 * @param {number} rowNumber
 * @param {string} reason
 * @param {string|boolean} [severity='error'] - 'error', 'duplicate', 'warning', or boolean
 */
function appendFailedRow(jobId, rowNumber, reason, severity = 'error') {
  let filePath = jobReports.get(jobId);
  if (!filePath || !fs.existsSync(filePath)) {
    filePath = initErrorReport(jobId);
  }

  let sevText = 'error';
  if (severity === true || severity === 'warning') {
    sevText = 'warning';
  } else if (severity === 'duplicate') {
    sevText = 'duplicate';
  }

  // Escape quotes in reason
  const safeReason = String(reason || '').replace(/"/g, '""');
  const line = `${rowNumber},"${sevText}","${safeReason}"\n`;

  fs.appendFileSync(filePath, line, 'utf8');
}

/**
 * Finalizes report file and returns public download URL or path.
 * Also schedules the report for deletion after REPORT_TTL_MS.
 * @param {string} jobId
 * @returns {string|null} Relative URL for download
 */
function finalizeErrorReport(jobId) {
  const filePath = jobReports.get(jobId);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  // Schedule 24h purge so reports don't accumulate indefinitely on disk
  scheduleReportPurge(jobId);
  return `/api/candidates/bulk-upload/${jobId}/report`;
}

/**
 * Returns the absolute path to the CSV report file for serving.
 * @param {string} jobId
 * @returns {string|null}
 */
function getErrorReportPath(jobId) {
  const filePath = path.join(REPORTS_DIR, `bulk_upload_report_${jobId}.csv`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

module.exports = {
  initErrorReport,
  appendFailedRow,
  finalizeErrorReport,
  getErrorReportPath,
  scheduleReportPurge,
};
