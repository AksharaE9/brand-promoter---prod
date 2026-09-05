'use strict';

/**
 * bulkUploadPreview.js — Pre-flight Dry-Run Preview Engine.
 * Parses, maps headers, validates every row, and resolves references WITHOUT writing to DB.
 */

const BoundedLRU = require('./lruCache');
const previewTokenCache = new BoundedLRU({ max: 100, ttl: 30 * 60 * 1000 }); // 30 min TTL

/**
 * Stores preview metadata and returns a reusable preview token.
 */
function storePreviewSession(token, data) {
  previewTokenCache.set(token, {
    ...data,
    createdAt: Date.now(),
  });
}

/**
 * Retrieves a stored preview session by token.
 */
function getPreviewSession(token) {
  return previewTokenCache.get(token);
}

/**
 * Formats a clean dry-run preview response.
 */
function formatPreviewResponse({
  jobId,
  sourceFilename,
  detectedHeaders,
  totalRows,
  projectedCreated,
  projectedUpdated,
  projectedDuplicates,
  projectedErrors,
  sampleErrors = [],
  autoCreatedJobs = [],
  previewToken,
}) {
  return {
    success: true,
    preview: true,
    jobId,
    sourceFilename,
    summary: {
      totalRows,
      projectedCreated,
      projectedUpdated,
      projectedDuplicates,
      projectedErrors,
    },
    detectedHeaders,
    sampleErrors: sampleErrors.slice(0, 10),
    autoCreatedJobs: [...new Set(autoCreatedJobs)],
    previewToken,
    message: `Preview complete for ${totalRows} rows: ${projectedCreated} to create, ${projectedDuplicates} duplicates, ${projectedErrors} invalid rows. Zero database records were modified.`,
  };
}

module.exports = {
  storePreviewSession,
  getPreviewSession,
  formatPreviewResponse,
};
