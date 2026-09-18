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
 * Builds an RFC 5987 compliant Content-Disposition header value.
 * e.g. attachment; filename="Sathish_KM_Resume.pdf"; filename*=UTF-8''Sathish%20K.M.%20(Updated)%20-%20Resume.pdf
 *
 * @param {string} fileName
 * @param {'attachment'|'inline'} [dispositionType='attachment']
 */
function makeContentDisposition(fileName, dispositionType = 'attachment') {
  if (!fileName || typeof fileName !== 'string') return dispositionType;
  const cleanName = fileName.trim();
  if (!cleanName) return dispositionType;

  // ASCII-safe fallback filename
  const fallback = cleanName.replace(/["\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
  // RFC 5987 UTF-8 encoding
  const encoded = encodeURIComponent(cleanName)
    .replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');


  return `${dispositionType}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Corrects multi-byte UTF-8 filenames that were parsed as Latin-1 by multipart handlers.
 * e.g. "updated_rÃ©sumÃ©.docx" -> "updated_résumé.docx"
 *
 * @param {string} filename
 * @returns {string}
 */
function fixUtf8Filename(filename) {
  if (!filename || typeof filename !== 'string') return filename || '';
  try {
    const fixed = Buffer.from(filename, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && fixed !== filename) {
      return fixed;
    }
  } catch (_) {}
  return filename;
}

/**
 * Extracts a lowercase file extension taking the last dot segment.
 * Multi-dot and special character safe.
 *
 * @param {string} filename
 * @returns {string} e.g. "pdf", "docx"
 */
function getSafeExtension(filename) {
  if (typeof filename !== 'string' || !filename.includes('.')) return '';
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
}


/**
 * Verifies that a DB-stored file exists in FileMeta and has non-zero byte length.
 * Must be called immediately post-write before committing candidate row.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} fileMetaId
 * @param {number} [expectedMinBytes=1]
 * @returns {Promise<object>} The verified FileMeta record
 */
async function verifyDbFile(prisma, fileMetaId, expectedMinBytes = 1) {
  if (!fileMetaId || typeof fileMetaId !== 'string') {
    throw new Error('Post-write verification failed: Invalid fileMetaId.');
  }

  const meta = await prisma.fileMeta.findUnique({
    where: { id: fileMetaId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      fileData: true,
      storageKey: true,
    },
  });

  if (!meta) {
    throw new Error(`Post-write verification failed: FileMeta record [${fileMetaId}] does not exist in database.`);
  }

  const actualLen = meta.fileData ? meta.fileData.length : (meta.sizeBytes || 0);
  if (actualLen < expectedMinBytes) {
    throw new Error(`Post-write verification failed: FileMeta record [${fileMetaId}] is empty (0 bytes).`);
  }

  return meta;
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
    res.setHeader('Content-Disposition', makeContentDisposition(fileName, 'attachment'));
  }

  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

module.exports = {
  isDbStorageKey,
  getIdFromStorageKey,
  makeStorageKey,
  makeContentDisposition,
  getSafeExtension,
  fixUtf8Filename,
  verifyDbFile,
  streamDbFile,
};


