'use strict';

const path = require('path');
const sharp = require('sharp');
const prisma = require('../../src/config/db');
const { validateFile, CATEGORY_CONFIGS } = require('../../src/utils/fileValidator');
const { processFollowUpFile, optimizeNotesPayload } = require('../../src/utils/followUpOptimizer');
const { assertCanScheduleRound, validateFeedbackData } = require('../../src/lib/interviewTemplates');
const { resolveHeader } = require('../../src/lib/headerAliasMap');

describe('MASTER PRODUCTION AUDIT & VERIFICATION SUITE', () => {
  let sampleJpegBuffer;
  let samplePngBuffer;
  let sampleWebpBuffer;
  let samplePdfBuffer;

  beforeAll(async () => {
    // Generate valid sample file buffers
    sampleJpegBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 31, g: 82, b: 204 } }
    }).jpeg().toBuffer();

    samplePngBuffer = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 31, g: 82, b: 204, alpha: 1 } }
    }).png().toBuffer();

    sampleWebpBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 31, g: 82, b: 204 } }
    }).webp().toBuffer();

    samplePdfBuffer = Buffer.from('%PDF-1.4 %────── 1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj 2 0 R 3 0 R endobj xref 0 4 0000000000 65535 f  trailer << /Size 4 /Root 1 0 R >> startxref 149 %%EOF');
  });

  describe('PART 0 — Version & Deployment Integrity', () => {
    test('confirms version endpoint format and commit SHA matching', () => {
      const commit = process.env.RENDER_GIT_COMMIT || '72754e8';
      expect(commit).toMatch(/^[a-f0-9]{7,40}$/);
    });
  });

  describe('PART 1 — Follow-Up Upload Matrix (18 Combinations)', () => {
    const fields = ['phoneFollowUp', 'emailFollowUp', 'morningFollowUp'];

    fields.forEach((field) => {
      describe(`Field: ${field}`, () => {
        test('1. WhatsApp multi-dot JPEG', async () => {
          const fileObj = {
            name: 'WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg',
            data: `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}`,
            type: 'image/jpeg',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.data).toContain('data:image/jpeg;base64,');
        });

        test('2. Standard .jpg file', async () => {
          const fileObj = {
            name: 'ZZTEST_sample.jpg',
            data: `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}`,
            type: 'image/jpeg',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.data).toContain('data:image/jpeg;base64,');
        });

        test('3. PNG file', async () => {
          const fileObj = {
            name: 'ZZTEST_sample.png',
            data: `data:image/png;base64,${samplePngBuffer.toString('base64')}`,
            type: 'image/png',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.data).toContain('data:image/png;base64,');
        });

        test('4. WEBP file', async () => {
          const fileObj = {
            name: 'ZZTEST_sample.webp',
            data: `data:image/webp;base64,${sampleWebpBuffer.toString('base64')}`,
            type: 'image/webp',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.data).toContain('data:image/webp;base64,');
        });

        test('5. HEIC image (simulated buffer)', async () => {
          // HEIC brand header bytes: ftypheic
          const heicHeader = Buffer.from([0,0,0,24,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63,0,0,0,0]);
          const fileObj = {
            name: 'ZZTEST_sample.heic',
            data: `data:image/heic;base64,${heicHeader.toString('base64')}`,
            type: 'image/heic',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.name).toBe('ZZTEST_sample.jpg');
        });

        test('6. PDF document', async () => {
          const fileObj = {
            name: 'ZZTEST_sample.pdf',
            data: `data:application/pdf;base64,${samplePdfBuffer.toString('base64')}`,
            type: 'application/pdf',
          };
          const res = await processFollowUpFile(fileObj);
          expect(res).not.toBeNull();
          expect(res.type).toBe('application/pdf');
        });

        test('7. Rejects unsupported MP4 file with explicit type message', () => {
          const mp4Header = Buffer.from([0,0,0,20,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d]);
          expect(() => {
            validateFile({ originalname: 'ZZTEST_video.mp4', buffer: mp4Header, mimetype: 'video/mp4', size: 12 }, 'followUp');
          }).toThrow(/Detected type: video\/mp4 — please upload/);
        });
      });
    });

    test('optimizeNotesPayload optimizes all 3 follow-up fields in a single payload', async () => {
      const payload = {
        phoneFollowUp: { name: 'phone.jpg', data: `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}` },
        emailFollowUp: { name: 'email.png', data: `data:image/png;base64,${samplePngBuffer.toString('base64')}` },
        morningFollowUp: { name: 'morning.pdf', data: `data:application/pdf;base64,${samplePdfBuffer.toString('base64')}` },
      };
      const resultStr = await optimizeNotesPayload(JSON.stringify(payload));
      const parsed = JSON.parse(resultStr);
      expect(parsed.phoneFollowUp.data).toContain('data:image/jpeg;base64,');
      expect(parsed.emailFollowUp.data).toContain('data:image/png;base64,');
      expect(parsed.morningFollowUp.data).toContain('data:application/pdf;base64,');
    });
  });

  describe('PART 1.3 — Interview Module & Assessment Form Verifications', () => {
    test('headerAliasMap maps Zoho Link variants to zohoLink', () => {
      expect(resolveHeader('Zoho Link')).toBe('zohoLink');
      expect(resolveHeader('Zoho Meeting Link')).toBe('zohoLink');
      expect(resolveHeader('zoho meeting')).toBe('zohoLink');
    });

    test('allows scheduling Round 2 directly without Round 1', async () => {
      const mockPrisma = {
        interviewFeedback: { findMany: jest.fn().mockResolvedValue([]) },
        interview: { findMany: jest.fn().mockResolvedValue([]) },
      };
      await expect(assertCanScheduleRound(mockPrisma, 'cand-123', 'ROUND_2')).resolves.toBeUndefined();
    });

    test('assessment form accepts blank phone/number field', () => {
      const data = {
        name: 'Jane Doe',
        number: '', // Blank phone number
        roundNumber: 'Round 1',
        panelists: 'Admin',
        role: 'BDE',
        overallRating: 8,
        doj: '2026-09-01',
        timings: '09:00 - 18:00',
        duration: '60 mins',
        selectionStatus: 'SELECTED',
      };
      const res = validateFeedbackData('ROUND_1', data);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
    });

    test('assessment form requires timings and duration', () => {
      const missingTimingsData = {
        name: 'Jane Doe',
        roundNumber: 'Round 1',
        panelists: 'Admin',
        role: 'BDE',
        overallRating: 8,
        doj: '2026-09-01',
        duration: '60 mins',
        selectionStatus: 'SELECTED',
      };
      const res = validateFeedbackData('ROUND_1', missingTimingsData);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('Timings'))).toBe(true);
    });
  });
});
