/**
 * fileValidation.js — Unified Browser File Validation Module
 * Centralizes file type detection (magic bytes, MIME type, extension) and size validation
 * across all upload surfaces in the application.
 */

export const CATEGORY_CONFIGS = {
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
 * Multi-dot safe extension extraction. Returns lowercase extension starting with dot e.g. ".jpeg".
 */
export function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot).toLowerCase();
}

/**
 * Sniffs format from ArrayBuffer or Uint8Array magic bytes.
 */
export function detectFormatFromBytes(uint8Array) {
  if (!uint8Array || uint8Array.length < 2) return null;

  // JPEG: 0xFF 0xD8 (SOI marker)
  if (uint8Array[0] === 0xff && uint8Array[1] === 0xd8) {
    return 'image/jpeg';
  }

  // PNG: 0x89 0x50 0x4E 0x47
  if (
    uint8Array.length >= 4 &&
    uint8Array[0] === 0x89 &&
    uint8Array[1] === 0x50 &&
    uint8Array[2] === 0x4e &&
    uint8Array[3] === 0x47
  ) {
    return 'image/png';
  }

  // WEBP: RIFF at 0..3 & WEBP at 8..11
  if (
    uint8Array.length >= 12 &&
    uint8Array[0] === 0x52 &&
    uint8Array[1] === 0x49 &&
    uint8Array[2] === 0x46 &&
    uint8Array[3] === 0x46 &&
    uint8Array[8] === 0x57 &&
    uint8Array[9] === 0x45 &&
    uint8Array[10] === 0x42 &&
    uint8Array[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (
    uint8Array.length >= 4 &&
    uint8Array[0] === 0x25 &&
    uint8Array[1] === 0x50 &&
    uint8Array[2] === 0x44 &&
    uint8Array[3] === 0x46
  ) {
    return 'application/pdf';
  }

  // HEIC / HEIF: ftyp at 4..7 with brand check at 8..11
  if (
    uint8Array.length >= 12 &&
    uint8Array[4] === 0x66 &&
    uint8Array[5] === 0x74 &&
    uint8Array[6] === 0x79 &&
    uint8Array[7] === 0x70
  ) {
    const brand = String.fromCharCode(...uint8Array.subarray(8, 12)).toLowerCase();
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc'].some(b => brand.includes(b))) {
      return 'image/heic';
    }
  }

  // ZIP / OpenXML (.xlsx, .docx, .pptx, .zip): PK\x03\x04
  if (
    uint8Array.length >= 4 &&
    uint8Array[0] === 0x50 &&
    uint8Array[1] === 0x4b &&
    uint8Array[2] === 0x03 &&
    uint8Array[3] === 0x04
  ) {
    return 'application/zip';
  }

  // MS Compound File Binary Format (.xls, .doc, .ppt)
  if (
    uint8Array.length >= 8 &&
    uint8Array[0] === 0xd0 &&
    uint8Array[1] === 0xcf &&
    uint8Array[2] === 0x11 &&
    uint8Array[3] === 0xe0
  ) {
    return 'application/vnd.ms-excel';
  }

  return null;
}

/**
 * Synchronous / Asynchronous File validator for Frontend.
 *
 * @param {File|Blob|Object} file - Browser File object or { name, size, type, data }
 * @param {string} category - Upload category ('followUp' | 'posted' | 'candidate' | 'bulkData' | 'profilePhoto')
 * @returns {Promise<{ valid: boolean, error?: string, detectedType?: string, ext?: string }>}
 */
export async function validateUploadFile(file, category = 'followUp') {
  const config = CATEGORY_CONFIGS[category] || CATEGORY_CONFIGS.followUp;

  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  const name = file.name || file.filename || 'attachment';
  const size = typeof file.size === 'number' ? file.size : 0;
  const mimeType = (file.type || '').toLowerCase();
  const ext = getFileExtension(name);

  // 1. Size Limit Check
  if (size > config.maxBytes) {
    const maxMb = Math.round(config.maxBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size exceeds the ${maxMb} MB limit. Please select a smaller file.`,
    };
  }

  // Determine detected format
  let detectedType = mimeType || null;

  // Try magic byte inspection if File/Blob or ArrayBuffer is available
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    try {
      const slice = file.slice(0, 32);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const magicDetected = detectFormatFromBytes(bytes);
      if (magicDetected) {
        detectedType = magicDetected;
      }
    } catch (_) {
      // Fall back to MIME / Extension
    }
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
  const displayType = detectedType || mimeType || ext || 'unknown format';
  return {
    valid: false,
    error: `Detected type: ${displayType} — please upload ${config.label}.`,
    detectedType: displayType,
    ext,
  };
}
