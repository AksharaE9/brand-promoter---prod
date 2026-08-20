'use strict';
/**
 * upload.js — Multer middleware
 * All file storage is now handled via PostgreSQL BYTEA (dbStorage.js).
 * Cloudinary and local-disk storage have been removed.
 */
const multer = require('multer');
const { MAX_UPLOAD_BYTES } = require('../config/uploadLimits');

// Memory storage — all uploads are kept in memory as Buffer, then written to DB
const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const upload = (req, res, next) => multerInstance(req, res, next);
upload.single = (...args) => multerInstance.single(...args);
upload.array  = (...args) => multerInstance.array(...args);
upload.fields = (...args) => multerInstance.fields(...args);
upload.none   = (...args) => multerInstance.none(...args);
upload.any    = (...args) => multerInstance.any(...args);

// memoryUpload — identical instance kept for backward compat (some routes import it by name)
const memoryUploadInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const memoryUpload = (req, res, next) => memoryUploadInstance(req, res, next);
memoryUpload.single = (...args) => memoryUploadInstance.single(...args);
memoryUpload.array  = (...args) => memoryUploadInstance.array(...args);
memoryUpload.fields = (...args) => memoryUploadInstance.fields(...args);
memoryUpload.none   = (...args) => memoryUploadInstance.none(...args);
memoryUpload.any    = (...args) => memoryUploadInstance.any(...args);

// offerLetterUpload — was local-disk, now memory (buffer written to DB by the route handler)
const offerLetterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

module.exports = { upload, memoryUpload, offerLetterUpload };
