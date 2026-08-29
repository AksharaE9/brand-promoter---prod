'use strict';

const sharp = require('sharp');
const path = require('path');
const { ApiError } = require('./errors');
const { validateFile, detectFormatFromBuffer } = require('./fileValidator');

const MAX_RAW_BYTES = 15 * 1024 * 1024; // 15 MB cap
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

const ERROR_UNSUPPORTED = 'Unsupported file type. Please upload a JPG, PNG, WEBP, HEIC, or PDF file.';
const ERROR_TOO_LARGE = 'File size exceeds the 15 MB limit. Please select a smaller file.';

/**
 * Sniffs buffer magic bytes to determine actual file format string.
 * Delegates to central detectFormatFromBuffer in fileValidator.js.
 */
function detectFormatFromMagicBytes(buffer) {
  const mime = detectFormatFromBuffer(buffer);
  if (!mime) return null;
  if (mime === 'image/jpeg') return 'jpeg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/svg+xml') return 'svg';
  return mime;
}

/**
 * Validates and optimizes a single follow-up file attachment object.
 *
 * @param {object|string} fileEntry - { name, data, type } or raw base64 data string
 * @returns {Promise<object>} Optimized { name, data, type } object
 */
async function processFollowUpFile(fileEntry) {
  if (!fileEntry) return null;

  let fileName = typeof fileEntry === 'object' ? (fileEntry.name || 'attachment') : 'attachment';
  let dataUrl = typeof fileEntry === 'object' ? fileEntry.data : fileEntry;
  let clientMime = typeof fileEntry === 'object' ? fileEntry.type : '';

  if (!dataUrl || typeof dataUrl !== 'string') return null;

  // Extract base64 payload
  let base64Body = dataUrl;
  if (dataUrl.startsWith('data:')) {
    const parts = dataUrl.split(',');
    if (parts.length > 1) {
      const mimeMatch = parts[0].match(/:(.*?);/);
      if (mimeMatch) clientMime = mimeMatch[1];
      base64Body = parts[1];
    }
  }

  const buffer = Buffer.from(base64Body, 'base64');

  // Validate file using central shared validator (throws diagnostic ApiError if invalid)
  const validationRes = validateFile({ originalname: fileName, buffer, mimetype: clientMime, size: buffer.length }, 'followUp');

  // Format determination from magic bytes or validated type
  let detectedFormat = detectFormatFromMagicBytes(buffer);
  if (!detectedFormat) {
    if (validationRes.detectedType === 'image/jpeg' || validationRes.ext === '.jpg' || validationRes.ext === '.jpeg') {
      detectedFormat = 'jpeg';
    } else if (validationRes.detectedType === 'image/png' || validationRes.ext === '.png') {
      detectedFormat = 'png';
    } else if (validationRes.detectedType === 'image/webp' || validationRes.ext === '.webp') {
      detectedFormat = 'webp';
    } else if (validationRes.detectedType === 'application/pdf' || validationRes.ext === '.pdf') {
      detectedFormat = 'pdf';
    } else if (validationRes.detectedType === 'image/heic' || validationRes.ext === '.heic' || validationRes.ext === '.heif') {
      detectedFormat = 'heic';
    }
  }

  if (!detectedFormat || detectedFormat === 'svg') {
    const displayType = clientMime || path.extname(fileName) || 'unknown format';
    throw new ApiError(400, `Detected type: ${displayType} — please upload a JPG, PNG, WEBP, HEIC, or PDF file.`);
  }

  // PDF handling: pass through validated PDF
  if (detectedFormat === 'pdf') {
    return {
      name: fileName,
      data: `data:application/pdf;base64,${buffer.toString('base64')}`,
      type: 'application/pdf',
    };
  }

  // Fix filename extension if HEIC converted to JPEG
  let finalFileName = fileName;
  if (detectedFormat === 'heic' || detectedFormat === 'heif') {
    finalFileName = fileName.replace(/\.(heic|heif)$/i, '.jpg');
  }

  // Image optimization (JPEG, PNG, WEBP, HEIC):
  try {
    let pipeline = sharp(buffer).rotate(); // auto-rotate & strip EXIF metadata

    pipeline = pipeline.resize({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });

    let outputMime = 'image/jpeg';

    if (detectedFormat === 'png') {
      pipeline = pipeline.png({ quality: 80, compressionLevel: 8 });
      outputMime = 'image/png';
    } else if (detectedFormat === 'webp') {
      pipeline = pipeline.webp({ quality: 80 });
      outputMime = 'image/webp';
    } else {
      // JPEG, HEIC, HEIF -> convert/output as JPEG
      pipeline = pipeline.jpeg({ quality: 80, progressive: true });
      outputMime = 'image/jpeg';
    }

    const optimizedBuffer = await pipeline.toBuffer();

    return {
      name: finalFileName,
      data: `data:${outputMime};base64,${optimizedBuffer.toString('base64')}`,
      type: outputMime,
    };
  } catch (err) {
    console.warn('[FollowUpOptimizer] Sharp optimization failed, falling back to original validated buffer:', err.message);
    const fallbackMime = (detectedFormat === 'heic' || detectedFormat === 'heif') ? 'image/jpeg' : (validationRes.detectedType || clientMime || 'image/jpeg');
    return {
      name: finalFileName,
      data: `data:${fallbackMime};base64,${buffer.toString('base64')}`,
      type: fallbackMime,
    };
  }
}

/**
 * Optimizes all follow-up file attachments inside a stringified or object notes payload.
 *
 * @param {string|object} notesPayload
 * @returns {Promise<string>} Stringified optimized notes JSON
 */
async function optimizeNotesPayload(notesPayload) {
  if (!notesPayload) return notesPayload;

  let parsed = null;
  try {
    parsed = typeof notesPayload === 'string' ? JSON.parse(notesPayload) : notesPayload;
  } catch (_) {
    return notesPayload; // Not JSON — return untouched
  }

  if (!parsed || typeof parsed !== 'object') return notesPayload;

  const updated = { ...parsed };
  let modified = false;

  const keys = ['phoneFollowUp', 'emailFollowUp', 'morningFollowUp'];
  for (const key of keys) {
    if (updated[key]) {
      // If it's a full object with data or base64 data string
      if (typeof updated[key] === 'object' && updated[key].data) {
        updated[key] = await processFollowUpFile(updated[key]);
        modified = true;
      } else if (typeof updated[key] === 'string' && updated[key].startsWith('data:')) {
        updated[key] = await processFollowUpFile({ name: 'attachment', data: updated[key] });
        modified = true;
      }
    }
  }

  return modified ? JSON.stringify(updated) : (typeof notesPayload === 'string' ? notesPayload : JSON.stringify(notesPayload));
}

module.exports = {
  MAX_RAW_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIMES,
  ERROR_UNSUPPORTED,
  ERROR_TOO_LARGE,
  detectFormatFromMagicBytes,
  processFollowUpFile,
  optimizeNotesPayload,
};
