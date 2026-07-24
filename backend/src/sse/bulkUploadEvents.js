'use strict';

const sse = require('../utils/sse');

/**
 * Emits real-time progress for a bulk candidate upload job via SSE.
 *
 * @param {string} organizationId 
 * @param {string} jobId 
 * @param {object} payload - { processed, succeeded, duplicates, failed, totalRows }
 */
function emitBulkUploadProgress(organizationId, jobId, { processed, succeeded, duplicates, failed, totalRows }) {
  const data = {
    jobId,
    processed,
    succeeded,
    duplicates: duplicates || 0,
    failed,
    totalRows: totalRows || null,
  };

  // Broadcast to organization channel for listeners on SSE
  sse.broadcastToOrg(organizationId || 'defaultOrg', 'bulk-upload:progress', data);
}

/**
 * Emits completion event for a bulk candidate upload job via SSE.
 *
 * @param {string} organizationId 
 * @param {string} jobId 
 * @param {object} payload - { processed, succeeded, duplicates, failed, errorReportUrl }
 */
function emitBulkUploadCompleted(organizationId, jobId, { processed, succeeded, duplicates, failed, errorReportUrl }) {
  const data = {
    jobId,
    processed,
    succeeded,
    duplicates: duplicates || 0,
    failed,
    errorReportUrl: errorReportUrl || null,
  };

  sse.broadcastToOrg(organizationId || 'defaultOrg', 'bulk-upload:completed', data);
}

module.exports = {
  emitBulkUploadProgress,
  emitBulkUploadCompleted,
};
