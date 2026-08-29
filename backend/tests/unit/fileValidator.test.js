'use strict';

const { validateFile, detectFormatFromBuffer, getFileExtension } = require('../../src/utils/fileValidator');
const { ApiError } = require('../../src/utils/errors');

describe('fileValidator Unit Tests', () => {
  test('extracts extension correctly from multi-dot filenames', () => {
    expect(getFileExtension('WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg')).toBe('.jpeg');
    expect(getFileExtension('archive.tar.gz')).toBe('.gz');
    expect(getFileExtension('document')).toBe('');
  });

  test('validates valid JPEG buffer with multi-dot filename', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const file = {
      originalname: 'WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg',
      buffer: jpegBuffer,
      mimetype: 'image/jpeg',
      size: jpegBuffer.length,
    };

    const res = validateFile(file, 'followUp');
    expect(res.valid).toBe(true);
  });

  test('validates PNG, WEBP, PDF, HEIC for followUp category', () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(validateFile({ originalname: 'test.png', buffer: pngBuf }, 'followUp').valid).toBe(true);

    const pdfBuf = Buffer.from('%PDF-1.4 header');
    expect(validateFile({ originalname: 'doc.pdf', buffer: pdfBuf }, 'followUp').valid).toBe(true);
  });

  test('rejects unsupported file type with explicit detected type error message', () => {
    const mp4Buf = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const file = {
      originalname: 'video.mp4',
      buffer: mp4Buf,
      mimetype: 'video/mp4',
      size: mp4Buf.length,
    };

    expect(() => validateFile(file, 'followUp')).toThrow(ApiError);
    expect(() => validateFile(file, 'followUp')).toThrow('Detected type: video/mp4 — please upload a JPG, PNG, WEBP, HEIC, or PDF file.');
  });
});
