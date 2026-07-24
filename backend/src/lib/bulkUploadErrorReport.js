'use strict';

const fs = require('fs');
const path = require('path');

// Ensure reports directory exists inside uploads/
const REPORTS_DIR = path.join(__dirname, '..', '..', 'uploads', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Memory map of active report files: jobId -> filePath
const jobReports = new Map();

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
 * @param {string} jobId 
 * @returns {string} Relative URL for download
 */
function finalizeErrorReport(jobId) {
  const filePath = jobReports.get(jobId);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
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
};
