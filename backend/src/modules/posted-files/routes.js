'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { asyncHandler, ApiError } = require('../../utils/errors');
const { validateFile } = require('../../utils/fileValidator');
const sse = require('../../utils/sse');
const { uploadLimiter } = require('../../middleware/rateLimiter');
const { streamUrlWithRedirects } = require('../../utils/downloadStream');
const { isDbStorageKey, getIdFromStorageKey, makeStorageKey, streamDbFile } = require('../../utils/dbStorage');

const router = express.Router();
router.use(auth);

// Multer memory storage configured up to 50MB
const POSTED_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: POSTED_MAX_SIZE_BYTES }
});

// Helper to check prefix
function startsWith(buf, prefix) {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

// GET /api/posted-files — paginated list
router.get('/', asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || 'defaultOrg';
  const limit = parseInt(req.query.limit, 10) || 20;
  const cursor = req.query.cursor;

  const where = { organizationId: orgId };

  const queryOptions = {
    where,
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      originalName: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      uploadedByName: true,
      createdAt: true
      // NOTE: fileData is intentionally excluded from list queries (would be huge)
    }
  };

  if (cursor) {
    queryOptions.cursor = { id: cursor };
    queryOptions.skip = 1;
  }

  const [total, items] = await Promise.all([
    prisma.postedFile.count({ where }),
    prisma.postedFile.findMany(queryOptions)
  ]);

  const hasMore = items.length > limit;
  if (hasMore) {
    items.pop();
  }

  const nextCursor = hasMore ? items[items.length - 1].id : null;

  res.json({
    success: true,
    data: items,
    nextCursor,
    hasMore,
    pagination: {
      total,
      limit,
      hasMore
    }
  });
}));

// POST /api/posted-files — upload file (stored directly in DB)
router.post(
  '/',
  uploadLimiter,
  (req, res, next) => {
    memoryUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(413, 'File size exceeds the 50 MB limit. Please select a smaller file.'));
        }
        return next(err);
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ApiError(400, 'No file uploaded');
    }

    const orgId = req.user.organizationId || 'defaultOrg';
    const buffer = req.file.buffer;
    const size = req.file.size;
    const originalName = req.file.originalname;

    // Use central shared validator
    validateFile(req.file, 'posted');

    // 4. Save directly to DB (fileData = binary, storageKey = "db://<id>" set after creation)
    //    We create with a placeholder storageKey first, then update with the real ID.
    const postedFile = await prisma.postedFile.create({
      data: {
        originalName,
        storageKey: 'db://pending',  // will be updated below
        mimeType: req.file.mimetype || 'application/octet-stream',
        sizeBytes: size,
        fileData: buffer,
        uploadedById: req.user.id,
        uploadedByName: req.user.fullName || req.user.email,
        organizationId: orgId
      }
    });

    // Update storageKey to reference the record ID
    const updated = await prisma.postedFile.update({
      where: { id: postedFile.id },
      data: { storageKey: makeStorageKey(postedFile.id) },
      select: {
        id: true,
        originalName: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        uploadedById: true,
        uploadedByName: true,
        createdAt: true
      }
    });

    // 5. Broadcast SSE
    sse.broadcastToOrg(orgId, 'POSTED_FILE_ADDED', {
      id: updated.id,
      filename: originalName,
      uploadedByName: updated.uploadedByName
    });

    res.status(201).json({
      success: true,
      data: updated
    });
  })
);

// DELETE /api/posted-files/:id — delete file record (Admin only)
router.delete(
  '/:id',
  requireRoles('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.organizationId || 'defaultOrg';

    const file = await prisma.postedFile.findUnique({
      where: { id },
      select: { id: true, organizationId: true, originalName: true, storageKey: true }
    });

    if (!file) {
      throw new ApiError(404, 'File not found');
    }

    if (file.organizationId !== orgId) {
      throw new ApiError(403, 'You do not have access to delete this file');
    }

    // For Cloudinary-hosted legacy files, attempt deletion from Cloudinary
    const storageKey = file.storageKey;
    if (storageKey && storageKey.startsWith('http')) {
      const cloudinaryUrlMatch = storageKey.match(/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
      if (cloudinaryUrlMatch) {
        try {
          const cloudinary = require('../../config/cloudinary');
          const resourceType = cloudinaryUrlMatch[1];
          let publicId = cloudinaryUrlMatch[2];
          if (resourceType !== 'raw') {
            publicId = publicId.replace(/\.[^/.]+$/, '');
          }
          await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        } catch (err) {
          console.warn(`[PostedFiles] Failed to delete from Cloudinary:`, err.message);
        }
      }
    }
    // DB-stored and local files: just delete the DB record (fileData column is deleted with it)

    // Delete database record
    await prisma.postedFile.delete({ where: { id } });

    // Broadcast SSE
    sse.broadcastToOrg(orgId, 'POSTED_FILE_DELETED', {
      id,
      filename: file.originalName
    });

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  })
);

// GET /api/posted-files/:id/download — download the file
router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.organizationId || 'defaultOrg';

    const file = await prisma.postedFile.findUnique({
      where: { id }
    });

    if (!file) {
      throw new ApiError(404, 'File not found');
    }

    if (file.organizationId !== orgId) {
      throw new ApiError(403, 'You do not have access to download this file');
    }

    const { storageKey, originalName, mimeType, fileData } = file;

    // --- Priority 1: DB-stored binary (new uploads) ---
    if (isDbStorageKey(storageKey) || fileData) {
      if (!fileData || fileData.length === 0) {
        throw new ApiError(404, 'File data not found in database. The file may have been stored externally and is no longer available.');
      }
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      streamDbFile(fileData, res);
      return;
    }

    // --- Priority 2: Legacy Cloudinary URL ---
    if (storageKey && storageKey.startsWith('http')) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      streamUrlWithRedirects(storageKey, res);
      return;
    }

    // --- Priority 3: Legacy local file (dev-only, not available on Render) ---
    if (storageKey && storageKey.startsWith('/uploads/')) {
      const fs = require('fs');
      const relativeKey = storageKey.replace(/^\//, '');
      const localPath = require('path').join(__dirname, '..', '..', '..', relativeKey);
      if (!fs.existsSync(localPath)) {
        throw new ApiError(404, 'File not found. It was stored locally and is no longer available on this server.');
      }
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      fs.createReadStream(localPath).pipe(res);
      return;
    }

    throw new ApiError(400, 'Invalid or unsupported storage key format.');
  })
);

module.exports = router;
