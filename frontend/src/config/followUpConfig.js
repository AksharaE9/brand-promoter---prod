/**
 * Shared config for follow-up attachments (Phone Follow-up, Email Follow-up, Morning Follow-up).
 * Centralizes allowed extensions, MIME types, size limits, and error messages.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

// HTML file picker accept attribute
export const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

export const ERROR_UNSUPPORTED = 'Unsupported file type. Please upload a JPG, PNG, WEBP, HEIC, or PDF file.';
export const ERROR_TOO_LARGE = 'File size exceeds the 15 MB limit. Please select a smaller file.';
