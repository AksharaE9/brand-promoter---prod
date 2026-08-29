/**
 * Shared config for follow-up attachments (Phone Follow-up, Email Follow-up, Morning Follow-up).
 * Centralizes allowed extensions, MIME types, size limits, and error messages.
 */

import { validateUploadFile, CATEGORY_CONFIGS } from '../lib/fileValidation';

export const MAX_UPLOAD_BYTES = CATEGORY_CONFIGS.followUp.maxBytes;

export const ALLOWED_EXTENSIONS = CATEGORY_CONFIGS.followUp.allowedExtensions;

export const ALLOWED_MIME_TYPES = CATEGORY_CONFIGS.followUp.allowedMimes;

// HTML file picker accept attribute
export const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/jpg,image/pjpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

export const ERROR_UNSUPPORTED = 'Unsupported file type. Please upload a JPG, PNG, WEBP, HEIC, or PDF file.';
export const ERROR_TOO_LARGE = 'File size exceeds the 15 MB limit. Please select a smaller file.';

export { validateUploadFile };
