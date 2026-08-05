'use strict';

const sharp = require('sharp');
const {
  detectFormatFromMagicBytes,
  processFollowUpFile,
  optimizeNotesPayload,
  ERROR_UNSUPPORTED,
  ERROR_TOO_LARGE,
  MAX_RAW_BYTES,
} = require('../../src/utils/followUpOptimizer');
const { ApiError } = require('../../src/utils/errors');

describe('followUpOptimizer Unit Tests', () => {

  let sampleJpegBuffer;
  let samplePngBuffer;
  let sampleWebpBuffer;

  beforeAll(async () => {
    // Generate small valid test buffers using sharp
    sampleJpegBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    samplePngBuffer = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    }).png().toBuffer();

    sampleWebpBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).webp().toBuffer();
  });

  describe('detectFormatFromMagicBytes', () => {
    test('detects JPEG magic bytes correctly', () => {
      expect(detectFormatFromMagicBytes(sampleJpegBuffer)).toBe('jpeg');
    });

    test('detects PNG magic bytes correctly', () => {
      expect(detectFormatFromMagicBytes(samplePngBuffer)).toBe('png');
    });

    test('detects WEBP magic bytes correctly', () => {
      expect(detectFormatFromMagicBytes(sampleWebpBuffer)).toBe('webp');
    });

    test('detects PDF magic bytes correctly', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 header contents...');
      expect(detectFormatFromMagicBytes(pdfBuffer)).toBe('pdf');
    });

    test('detects HEIC magic bytes correctly', () => {
      const heicHeader = Buffer.alloc(16);
      heicHeader.write('ftypheic', 4, 'ascii');
      expect(detectFormatFromMagicBytes(heicHeader)).toBe('heic');
    });

    test('detects SVG and returns svg', () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
      expect(detectFormatFromMagicBytes(svgBuffer)).toBe('svg');
    });

    test('returns null for unknown format or random text', () => {
      const textBuffer = Buffer.from('hello world random string');
      expect(detectFormatFromMagicBytes(textBuffer)).toBeNull();
    });
  });

  describe('processFollowUpFile', () => {
    test('processes and compresses JPEG screenshot', async () => {
      const input = {
        name: 'WhatsApp Image 2026-08-05.jpeg',
        data: `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}`,
        type: 'image/jpeg',
      };

      const result = await processFollowUpFile(input);
      expect(result).toBeDefined();
      expect(result.name).toBe('WhatsApp Image 2026-08-05.jpeg');
      expect(result.type).toBe('image/jpeg');
      expect(result.data).toContain('data:image/jpeg;base64,');
    });

    test('processes PNG screenshot', async () => {
      const input = {
        name: 'screenshot.png',
        data: `data:image/png;base64,${samplePngBuffer.toString('base64')}`,
        type: 'image/png',
      };

      const result = await processFollowUpFile(input);
      expect(result).toBeDefined();
      expect(result.type).toBe('image/png');
    });

    test('processes WEBP image', async () => {
      const input = {
        name: 'photo.webp',
        data: `data:image/webp;base64,${sampleWebpBuffer.toString('base64')}`,
        type: 'image/webp',
      };

      const result = await processFollowUpFile(input);
      expect(result).toBeDefined();
      expect(result.type).toBe('image/webp');
    });

    test('validates and passes through PDF document', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const input = {
        name: 'call_summary.pdf',
        data: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
        type: 'application/pdf',
      };

      const result = await processFollowUpFile(input);
      expect(result).toBeDefined();
      expect(result.name).toBe('call_summary.pdf');
      expect(result.type).toBe('application/pdf');
    });

    test('rejects SVG files with specific unsupported error', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const input = {
        name: 'vector.svg',
        data: `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`,
        type: 'image/svg+xml',
      };

      await expect(processFollowUpFile(input)).rejects.toThrow(ApiError);
      await expect(processFollowUpFile(input)).rejects.toThrow(ERROR_UNSUPPORTED);
    });

    test('rejects unsupported executable files (.exe) with specific error', async () => {
      const exeBuffer = Buffer.from('MZHeaderExecutableFileContents...');
      const input = {
        name: 'malware.exe',
        data: `data:application/x-msdownload;base64,${exeBuffer.toString('base64')}`,
        type: 'application/x-msdownload',
      };

      await expect(processFollowUpFile(input)).rejects.toThrow(ERROR_UNSUPPORTED);
    });

    test('rejects oversized files exceeding 15 MB cap', async () => {
      // Fake buffer larger than MAX_RAW_BYTES
      const largeBuffer = Buffer.alloc(MAX_RAW_BYTES + 100);
      const input = {
        name: 'huge.jpg',
        data: `data:image/jpeg;base64,${largeBuffer.toString('base64')}`,
        type: 'image/jpeg',
      };

      await expect(processFollowUpFile(input)).rejects.toThrow(ERROR_TOO_LARGE);
    });

    test('resizes large images (>2000px) down while maintaining aspect ratio', async () => {
      const largeImgBuffer = await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: { r: 100, g: 100, b: 100 } },
      }).jpeg().toBuffer();

      const input = {
        name: 'large_photo.jpg',
        data: `data:image/jpeg;base64,${largeImgBuffer.toString('base64')}`,
        type: 'image/jpeg',
      };

      const result = await processFollowUpFile(input);
      const outputBuffer = Buffer.from(result.data.split(',')[1], 'base64');
      const metadata = await sharp(outputBuffer).metadata();

      expect(metadata.width).toBeLessThanOrEqual(2000);
      expect(metadata.height).toBeLessThanOrEqual(2000);
    });
  });

  describe('optimizeNotesPayload', () => {
    test('optimizes all three follow-up fields in a notes JSON payload', async () => {
      const notesObj = {
        phoneFollowUp: { name: 'call.png', data: `data:image/png;base64,${samplePngBuffer.toString('base64')}` },
        emailFollowUp: null,
        morningFollowUp: { name: 'WhatsApp Image.jpeg', data: `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}` },
      };

      const resultStr = await optimizeNotesPayload(JSON.stringify(notesObj));
      const parsed = JSON.parse(resultStr);

      expect(parsed.phoneFollowUp.data).toContain('data:image/png;base64,');
      expect(parsed.emailFollowUp).toBeNull();
      expect(parsed.morningFollowUp.data).toContain('data:image/jpeg;base64,');
    });
  });
});
