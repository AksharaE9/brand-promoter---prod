import { describe, test, expect } from 'vitest';
import { validateUploadFile, getFileExtension, detectFormatFromBytes } from '../../src/lib/fileValidation';

describe('frontend fileValidation Unit Tests', () => {
  test('extracts extension from multi-dot filenames', () => {
    expect(getFileExtension('WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg')).toBe('.jpeg');
    expect(getFileExtension('screenshot.png')).toBe('.png');
    expect(getFileExtension('file_without_ext')).toBe('');
  });

  test('validates valid JPEG file object with multi-dot timestamp filename', async () => {
    const file = new File(['dummy jpeg content'], 'WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg', {
      type: 'image/jpeg',
    });

    const res = await validateUploadFile(file, 'followUp');
    expect(res.valid).toBe(true);
  });

  test('rejects unsupported file type with explicit error stating detected type', async () => {
    const file = new File(['video content'], 'recording.mp4', {
      type: 'video/mp4',
    });

    const res = await validateUploadFile(file, 'followUp');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Detected type: video/mp4 — please upload a JPG, PNG, WEBP, HEIC, or PDF file.');
  });
});
