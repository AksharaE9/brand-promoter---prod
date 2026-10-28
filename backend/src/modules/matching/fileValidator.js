'use strict';

const crypto = require('crypto');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_PAGES = 10;

/**
 * Validates a file buffer using magic bytes, size limits, and zip-bomb safety guards.
 *
 * @param {Buffer} buffer
 * @param {string} [originalName='']
 * @returns {{
 *   isValid: boolean,
 *   format: 'pdf' | 'docx' | 'image' | 'unsupported',
 *   mimeType: string,
 *   sha256: string,
 *   sizeBytes: number,
 *   warnings: string[],
 *   error?: string
 * }}
 */
function validateResumeBuffer(buffer, originalName = '') {
  const warnings = [];

  if (!buffer) {
    return {
      isValid: false,
      format: 'unsupported',
      mimeType: 'unknown',
      sha256: '',
      sizeBytes: 0,
      warnings,
      error: 'Invalid or missing file buffer'
    };
  }

  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const sizeBytes = safeBuffer.length;
  if (sizeBytes === 0) {
    return {
      isValid: false,
      format: 'unsupported',
      mimeType: 'unknown',
      sha256: '',
      sizeBytes: 0,
      warnings,
      error: 'Empty file (0 bytes)'
    };
  }

  if (sizeBytes > MAX_FILE_BYTES) {
    return {
      isValid: false,
      format: 'unsupported',
      mimeType: 'unknown',
      sha256: '',
      sizeBytes,
      warnings,
      error: `File size (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds 10MB limit`
    };
  }

  const sha256 = crypto.createHash('sha256').update(safeBuffer).digest('hex');

  // 1. PDF Magic Bytes: %PDF (0x25 0x50 0x44 0x46)
  if (safeBuffer.length >= 4 && safeBuffer[0] === 0x25 && safeBuffer[1] === 0x50 && safeBuffer[2] === 0x44 && safeBuffer[3] === 0x46) {
    // Basic check for embedded Javascript
    const textPreview = safeBuffer.slice(0, 4096).toString('latin1');
    if (textPreview.includes('/JavaScript') || textPreview.includes('/JS')) {
      warnings.push('PDF contains JavaScript actions; ignored during text extraction.');
    }

    return {
      isValid: true,
      format: 'pdf',
      mimeType: 'application/pdf',
      sha256,
      sizeBytes,
      warnings
    };
  }

  // 2. DOCX / ZIP Magic Bytes: PK\x03\x04 (0x50 0x4B 0x03 0x04)
  if (safeBuffer.length >= 4 && safeBuffer[0] === 0x50 && safeBuffer[1] === 0x4B && safeBuffer[2] === 0x03 && safeBuffer[3] === 0x04) {
    // Quick ZIP entry count & size inspection (zip-bomb protection)
    try {
      let offset = 0;
      let totalUncompressedSize = 0;
      let entryCount = 0;

      while (offset < safeBuffer.length - 30) {
        if (
          safeBuffer[offset] === 0x50 &&
          safeBuffer[offset + 1] === 0x4B &&
          safeBuffer[offset + 2] === 0x03 &&
          safeBuffer[offset + 3] === 0x04
        ) {
          entryCount++;
          if (entryCount > 500) {
            return {
              isValid: false,
              format: 'docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              sha256,
              sizeBytes,
              warnings,
              error: 'DOCX archive contains too many entries (>500); rejected for safety'
            };
          }

          const uncompressedSize = safeBuffer.readUInt32LE(offset + 22);
          totalUncompressedSize += uncompressedSize;

          if (totalUncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES) {
            return {
              isValid: false,
              format: 'docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              sha256,
              sizeBytes,
              warnings,
              error: 'DOCX uncompressed size exceeds 50MB zip-bomb limit'
            };
          }
          offset += 30; // Jump past fixed header
        } else {
          offset++;
        }
      }
    } catch (_) {
      // Continue if quick header scan encountered unusual zip layout
    }

    return {
      isValid: true,
      format: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256,
      sizeBytes,
      warnings
    };
  }

  // 3. Images: JPEG or PNG
  if (
    (safeBuffer.length >= 3 && safeBuffer[0] === 0xFF && safeBuffer[1] === 0xD8 && safeBuffer[2] === 0xFF) || // JPEG
    (safeBuffer.length >= 4 && safeBuffer[0] === 0x89 && safeBuffer[1] === 0x4E && safeBuffer[2] === 0x47 && safeBuffer[3] === 0x0D) || // PNG (0x89 0x50 0x4E 0x47 in hex, safe check: 89 50 4E 47)
    (safeBuffer.length >= 4 && safeBuffer[0] === 0x89 && safeBuffer[1] === 0x50 && safeBuffer[2] === 0x4E && safeBuffer[3] === 0x47)
  ) {
    const isJpeg = safeBuffer[0] === 0xFF;
    return {
      isValid: true,
      format: 'image',
      mimeType: isJpeg ? 'image/jpeg' : 'image/png',
      sha256,
      sizeBytes,
      warnings: ['Resume is an image (JPG/PNG). Text extracted via OCR/Vision layer.']
    };
  }

  // 4. Legacy .doc format: 0xD0 0xCF 0x11 0xE0
  if (safeBuffer.length >= 4 && safeBuffer[0] === 0xD0 && safeBuffer[1] === 0xCF && safeBuffer[2] === 0x11 && safeBuffer[3] === 0xE0) {
    return {
      isValid: false,
      format: 'unsupported',
      mimeType: 'application/msword',
      sha256,
      sizeBytes,
      warnings,
      error: 'Legacy .doc format is not supported; please re-save as .docx or .pdf'
    };
  }

  // Unsupported format
  return {
    isValid: false,
    format: 'unsupported',
    mimeType: 'application/octet-stream',
    sha256,
    sizeBytes,
    warnings,
    error: `Unsupported file format. Magic bytes: ${safeBuffer.slice(0, 4).toString('hex')}`
  };
}

module.exports = {
  validateResumeBuffer,
  MAX_FILE_BYTES,
  MAX_PAGES
};
