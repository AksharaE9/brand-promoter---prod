'use strict';

/**
 * fileValidator.js — Centralized Server-Side File Validator
 * Validates buffers, streams, or multer file objects based on magic bytes, MIME types,
 * and multi-dot safe extension parsing. Generates precise error messages detailing detected types.
 */

const path = require('path');
const { ApiError } = require('./errors');

const CATEGORY_CONFIGS = {
  followUp: {
    label: 'a JPG, PNG, WEBP, HEIC, or PDF file',
    maxBytes: 15 * 1024 * 1024, // 15 MB
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'],
    allowedMimes: [
      'image/jpeg',
      'image/jpg',
      'image/pjpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
    ],
  },
  posted: {
    label: 'a Document, Image, Spreadsheet, Presentation, or ZIP file',
    maxBytes: 50 * 1024 * 1024, // 50 MB
    allowedExtensions: [
      '.jpg', '.jpeg', '.png', '.webp', '.pdf',
      '.xlsx', '.xls', '.csv', '.doc', '.docx', '.ppt', '.pptx', '.zip', '.txt'
    ],
    allowedMimes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel', 'text/csv', 'text/plain',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip', 'application/x-zip-compressed'
    ],
  },
  candidate: {
    label: 'a PDF, DOC, DOCX, JPG, PNG, or WEBP file',
    maxBytes: 15 * 1024 * 1024, // 15 MB
    allowedExtensions: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'],
    allowedMimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ],
  },
  bulkData: {
    label: 'a CSV (.csv) or Excel (.xlsx, .xls) file',
    maxBytes: 15 * 1024 * 1024, // 15 MB
    allowedExtensions: ['.csv', '.xlsx', '.xls'],
    allowedMimes: [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ],
  },
  profilePhoto: {
    label: 'a JPG, PNG, or WEBP image',
    maxBytes: 15 * 1024 * 1024, // 15 MB
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    allowedMimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  },
};

/**
 * Multi-dot safe extension extraction.
 */
function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  return path.extname(filename).toLowerCase();
}

/**
 * Sniffs format from Buffer magic bytes.
 */
function detectFormatFromBuffer(buffer) {
  if (!buffer || buffer.length < 2) return null;

  // JPEG: 0xFF 0xD8 (SOI marker)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }

  // PNG: 0x89 0x50 0x4E 0x47
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // WEBP: RIFF at 0..3 & WEBP at 8..11
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }

  // HEIC / HEIF: ftyp at 4..7 with brand containing heic/heix/heim/heis/mif1/msf1/hevc at 8..11
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc'].some(b => brand.includes(b))) {
      return 'image/heic';
    }
  }

  // ZIP / OpenXML (.xlsx, .docx, .pptx, .zip): PK\x03\x04
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return 'application/zip';
  }

  // MS Compound File Binary Format (.xls, .doc, .ppt)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return 'application/vnd.ms-excel';
  }

  // Check SVG (explicitly rejected for image categories)
  const headerText = buffer.slice(0, 100).toString('utf8').toLowerCase();
  if (headerText.includes('<svg') || headerText.includes('<?xml')) {
    return 'image/svg+xml';
  }

  return null;
}

/**
 * Validates a file on the backend. Throws ApiError on validation failure.
 *
 * @param {object|Buffer} fileInput - Multer file, Buffer, or { name/originalname, buffer, mimetype/type, size }
 * @param {string} category - Upload category ('followUp' | 'posted' | 'candidate' | 'bulkData' | 'profilePhoto')
 * @returns {{ valid: boolean, detectedType: string, ext: string }}
 */
function validateFile(fileInput, category = 'followUp') {
  const config = CATEGORY_CONFIGS[category] || CATEGORY_CONFIGS.followUp;

  if (!fileInput) {
    throw new ApiError(400, 'No file provided');
  }

  let buffer = null;
  let filename = '';
  let clientMime = '';
  let size = 0;

  if (Buffer.isBuffer(fileInput)) {
    buffer = fileInput;
    size = buffer.length;
  } else if (typeof fileInput === 'object') {
    filename = fileInput.originalname || fileInput.name || fileInput.filename || '';
    clientMime = (fileInput.mimetype || fileInput.type || '').toLowerCase();
    size = typeof fileInput.size === 'number' ? fileInput.size : (fileInput.buffer ? fileInput.buffer.length : 0);
    if (Buffer.isBuffer(fileInput.buffer)) {
      buffer = fileInput.buffer;
    }
  }

  // 1. Size Limit Check
  if (size > config.maxBytes) {
    const maxMb = Math.round(config.maxBytes / (1024 * 1024));
    throw new ApiError(400, `File size exceeds the ${maxMb} MB limit. Please select a smaller file.`);
  }

  const ext = getFileExtension(filename);
  let detectedType = clientMime || null;

  if (buffer) {
    const magic = detectFormatFromBuffer(buffer);
    if (magic) {
      detectedType = magic;
    }
  }

  // Rejection check for SVG
  if (detectedType === 'image/svg+xml' && category !== 'posted') {
    throw new ApiError(400, `Detected type: image/svg+xml — please upload ${config.label}.`);
  }

  // 2. Validate Extension & MIME/Detected Type
  const hasValidExt = ext ? config.allowedExtensions.includes(ext) : false;
  const hasValidMime = detectedType ? config.allowedMimes.includes(detectedType) : false;

  // Secondary extension check for JPEG variations (.jpg vs .jpeg)
  const isJpegExt = ext === '.jpg' || ext === '.jpeg';
  const isJpegMime = detectedType === 'image/jpeg' || detectedType === 'image/jpg' || detectedType === 'image/pjpeg';
  const isJpegValid = isJpegExt && (isJpegMime || !detectedType);

  if (hasValidExt || hasValidMime || isJpegValid) {
    return { valid: true, detectedType: detectedType || ext, ext };
  }

  // 3. Format detailed rejection error message stating the actual detected type
  const displayType = detectedType || clientMime || ext || 'unknown format';
  throw new ApiError(400, `Detected type: ${displayType} — please upload ${config.label}.`);
}

module.exports = {
  validateFile,
  detectFormatFromBuffer,
  getFileExtension,
  CATEGORY_CONFIGS,
};
