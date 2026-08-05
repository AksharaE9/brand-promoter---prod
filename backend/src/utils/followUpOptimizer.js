'use strict';

const sharp = require('sharp');
const path = require('path');
const { ApiError } = require('./errors');

const MAX_RAW_BYTES = 15 * 1024 * 1024; // 15 MB cap
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

const ERROR_UNSUPPORTED = 'Unsupported file type. Please upload a JPG, PNG, WEBP, HEIC, or PDF file.';
const ERROR_TOO_LARGE = 'File size exceeds the 15 MB limit. Please select a smaller file.';

/**
 * Sniffs buffer magic bytes to determine actual file format.
 */
function detectFormatFromMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'pdf';
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }

  // WEBP: RIFF at [0..3] and WEBP at [8..11]
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  // HEIC / HEIF: ftyp at [4..7] (0x66 0x74 0x79 0x70)
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc'].some(b => brand.includes(b))) {
      return 'heic';
    }
  }

  // SVG check (reject explicitly)
  const headerText = buffer.slice(0, 100).toString('utf8').toLowerCase();
  if (headerText.includes('<svg') || headerText.includes('<?xml')) {
    return 'svg'; // explicitly rejected
  }

  return null;
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

  // Size limit check (15 MB)
  if (buffer.length > MAX_RAW_BYTES) {
    throw new ApiError(400, ERROR_TOO_LARGE);
  }

  // Extension check
  const ext = path.extname(fileName).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new ApiError(400, ERROR_UNSUPPORTED);
  }

  // Magic byte format detection
  const detectedFormat = detectFormatFromMagicBytes(buffer);
  if (!detectedFormat || detectedFormat === 'svg') {
    throw new ApiError(400, ERROR_UNSUPPORTED);
  }

  // PDF handling: pass through validated PDF
  if (detectedFormat === 'pdf') {
    return {
      name: fileName,
      data: `data:application/pdf;base64,${buffer.toString('base64')}`,
      type: 'application/pdf',
    };
  }

  // Image optimization (JPEG, PNG, WEBP, HEIC):
  // 1. Auto-rotate based on EXIF tag
  // 2. Resize longer edge to max 2000px
  // 3. Convert HEIC -> JPEG (universal browser rendering)
  // 4. Strip EXIF metadata for privacy
  // 5. Apply quality compression target (~80 quality, ~300-800KB output)
  try {
    let pipeline = sharp(buffer).rotate(); // auto-rotate & strip EXIF metadata

    pipeline = pipeline.resize({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });

    let outputMime = 'image/jpeg';
    let outputExt = '.jpg';

    if (detectedFormat === 'png') {
      pipeline = pipeline.png({ quality: 80, compressionLevel: 8 });
      outputMime = 'image/png';
      outputExt = '.png';
    } else if (detectedFormat === 'webp') {
      pipeline = pipeline.webp({ quality: 80 });
      outputMime = 'image/webp';
      outputExt = '.webp';
    } else {
      // JPEG, HEIC, HEIF -> convert/output as JPEG
      pipeline = pipeline.jpeg({ quality: 80, progressive: true });
      outputMime = 'image/jpeg';
      outputExt = '.jpg';
    }

    const optimizedBuffer = await pipeline.toBuffer();

    // Fix filename extension if HEIC converted to JPEG
    let finalFileName = fileName;
    if (detectedFormat === 'heic' || detectedFormat === 'heif') {
      finalFileName = fileName.replace(/\.(heic|heif)$/i, '.jpg');
    }

    return {
      name: finalFileName,
      data: `data:${outputMime};base64,${optimizedBuffer.toString('base64')}`,
      type: outputMime,
    };
  } catch (err) {
    console.error('[FollowUpOptimizer] Image processing failed:', err.message);
    throw new ApiError(400, ERROR_UNSUPPORTED);
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
