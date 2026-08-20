'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { uploadFileToCloudinary } = require('../../config/cloudinary');
const { asyncHandler, ApiError } = require('../../utils/errors');
const sse = require('../../utils/sse');
const { uploadLimiter } = require('../../middleware/rateLimiter');
const { streamUrlWithRedirects } = require('../../utils/downloadStream');

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

// Helper to parse Cloudinary URL for deletion
function parseCloudinaryUrl(url) {
  const match = url.match(/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (match) {
    const resourceType = match[1];
    let publicId = match[2];
    if (resourceType !== 'raw') {
      publicId = publicId.replace(/\.[^/.]+$/, "");
    }
    return { resourceType, publicId };
  }
  return null;
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

// POST /api/posted-files — upload file
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
    const ext = path.extname(originalName).toLowerCase();

    // 1. Check size limit
    if (size > POSTED_MAX_SIZE_BYTES) {
      throw new ApiError(413, 'File size exceeds the 50 MB limit. Please select a smaller file.');
    }

    // 2. Extension check
    const allowedExtensions = ['.xlsx', '.xls', '.csv', '.doc', '.docx', '.pdf', '.txt', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.webp', '.zip'];
    if (!allowedExtensions.includes(ext)) {
      throw new ApiError(400, `Unsupported file extension: ${ext}`);
    }

    // 3. Magic bytes check
    let isValid = true;
    let expectedFormat = '';

    if (['.xlsx', '.docx', '.pptx', '.zip'].includes(ext)) {
      isValid = startsWith(buffer, [0x50, 0x4B, 0x03, 0x04]);
      expectedFormat = 'ZIP/Office XML (PK...)';
    } else if (['.xls', '.doc', '.ppt'].includes(ext)) {
      isValid = startsWith(buffer, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
      expectedFormat = 'MS Compound File Binary Format';
    } else if (ext === '.pdf') {
      isValid = startsWith(buffer, [0x25, 0x50, 0x44, 0x46]);
      expectedFormat = 'PDF (%PDF)';
    } else if (ext === '.png') {
      isValid = startsWith(buffer, [0x89, 0x50, 0x4E, 0x47]);
      expectedFormat = 'PNG';
    } else if (['.jpg', '.jpeg'].includes(ext)) {
      isValid = startsWith(buffer, [0xFF, 0xD8, 0xFF]);
      expectedFormat = 'JPEG';
    } else if (ext === '.webp') {
      isValid = buffer.length >= 12 &&
                buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
      expectedFormat = 'WEBP';
    } else if (['.csv', '.txt'].includes(ext)) {
      const isMz = startsWith(buffer, [0x4D, 0x5A]);
      const hasNull = buffer.includes(0x00);
      if (isMz || hasNull) {
        isValid = false;
        expectedFormat = 'Plain Text (no binary/null/MZ characters)';
      }
    }

    if (!isValid) {
      throw new ApiError(400, `File content does not match its extension. Expected ${expectedFormat} header.`);
    }

    // 4. Save to persistent storage
    const dest = `posted-files/${Date.now()}_${originalName}`;
    const storageKey = await uploadFileToCloudinary(buffer, dest, req.file.mimetype);
    if (!storageKey) {
      throw new ApiError(500, 'Failed to upload file to storage');
    }

    // 5. Create database record
    const postedFile = await prisma.postedFile.create({
      data: {
        originalName,
        storageKey,
        mimeType: req.file.mimetype || 'application/octet-stream',
        sizeBytes: size,
        uploadedById: req.user.id,
        uploadedByName: req.user.fullName || req.user.email,
        organizationId: orgId
      }
    });

    // 6. Broadcast SSE
    sse.broadcastToOrg(orgId, 'POSTED_FILE_ADDED', {
      id: postedFile.id,
      filename: originalName,
      uploadedByName: postedFile.uploadedByName
    });

    res.status(201).json({
      success: true,
      data: postedFile
    });
  })
);

// DELETE /api/posted-files/:id — delete file (restricted to Admin only)
router.delete(
  '/:id',
  requireRoles('SUPER_ADMIN', 'ADMIN'),
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
      throw new ApiError(403, 'You do not have access to delete this file');
    }

    // 1. Delete physical storage file
    const storageKey = file.storageKey;
    if (storageKey.startsWith('/uploads/')) {
      // Local file
      const relativeKey = storageKey.replace(/^\//, '');
      const localPath = path.join(__dirname, '..', '..', '..', relativeKey);
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      } catch (err) {
        console.warn(`[PostedFiles] Failed to delete local file ${localPath}:`, err.message);
      }
    } else if (storageKey.startsWith('http')) {
      // Cloudinary file
      const parsed = parseCloudinaryUrl(storageKey);
      if (parsed) {
        try {
          const cloudinary = require('../../config/cloudinary');
          await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
        } catch (err) {
          console.warn(`[PostedFiles] Failed to delete from Cloudinary:`, err.message);
        }
      }
    }

    // 2. Delete database record
    await prisma.postedFile.delete({
      where: { id }
    });

    // 3. Broadcast SSE
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

    const { storageKey, originalName, mimeType } = file;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');

    if (storageKey.startsWith('/uploads/')) {
      // Local file
      const relativeKey = storageKey.replace(/^\//, '');
      const localPath = path.join(__dirname, '..', '..', '..', relativeKey);
      if (!fs.existsSync(localPath)) {
        throw new ApiError(404, 'File not found on local storage');
      }
      fs.createReadStream(localPath).pipe(res);
    } else if (storageKey.startsWith('http')) {
      // Cloudinary URL - stream it following redirects
      streamUrlWithRedirects(storageKey, res);
    } else {
      throw new ApiError(400, 'Invalid storage key');
    }
  })
);

module.exports = router;
