'use strict';

/**
 * dbStorage.js
 *
 * Replaces Cloudinary + local-disk file storage.
 * Files are stored as raw binary (Bytes / BYTEA) directly in the Neon PostgreSQL DB.
 *
 * storageKey / fileUrl format for DB-stored files: "db://<recordId>"
 *
 * Advantages:
 *  - Files survive Render redeploys (no ephemeral disk)
 *  - Zero dependency on Cloudinary
 *  - Downloads are served directly from the DB connection, no HTTP hop
 */

/**
 * Returns true if the given key represents a DB-stored file.
 * @param {string} key
 */
function isDbStorageKey(key) {
  return typeof key === 'string' && key.startsWith('db://');
}

/**
 * Extracts the DB record ID from a db:// storage key.
 * e.g. "db://cmt11q90e00dqib2rqefiqu0e" → "cmt11q90e00dqib2rqefiqu0e"
 * @param {string} key
 */
function getIdFromStorageKey(key) {
  return key.replace(/^db:\/\//, '');
}

/**
 * Builds a db:// storage key from a record ID.
 * @param {string} id
 */
function makeStorageKey(id) {
  return `db://${id}`;
}

/**
 * Stream a file buffer from the database directly to an HTTP response.
 * Call this after you have already set Content-Disposition and Content-Type headers.
 *
 * @param {Buffer|Uint8Array|null} fileData - Raw binary from prisma (Bytes column)
 * @param {import('express').Response} res
 * @param {string} [mimeType]   - Fallback mime type if not yet set on res
 * @param {string} [fileName]   - Fallback filename for Content-Disposition
 */
function streamDbFile(fileData, res, mimeType, fileName) {
  if (!fileData || fileData.length === 0) {
    res.status(404).json({ success: false, message: 'File data not found in database.' });
    return;
  }

  const buf = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);

  if (mimeType && !res.headersSent) {
    res.setHeader('Content-Type', mimeType);
  }
  if (fileName && !res.headersSent) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  }

  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

module.exports = {
  isDbStorageKey,
  getIdFromStorageKey,
  makeStorageKey,
  streamDbFile,
};
