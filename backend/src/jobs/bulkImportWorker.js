// src/jobs/bulkImportWorker.js
//
// DEPRECATED — This legacy MockQueue worker is no longer used.
// All six bulk upload paths now process jobs directly through
// the shared runStreamingBulkUploadPipeline in src/lib/streamingBulkUploadPipeline.js.
//
// This stub is kept to satisfy the require() in src/index.js without crashing.
// It can be safely removed along with the require() in index.js in a future cleanup.

const worker = null;

module.exports = { worker };
