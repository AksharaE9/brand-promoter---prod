'use strict';

const { resolveHeader, HEADER_ALIASES } = require('../../src/lib/headerAliasMap');
const { validateCandidateRow } = require('../../src/lib/candidateRowValidator');
const { normalizeResumeLink } = require('../../src/lib/resumeLinkNormalizer');

describe('Bulk Candidate Upload Pipeline Units', () => {
  describe('Header Alias Mapping', () => {
    test('resolves standard and variant headers correctly', () => {
      expect(resolveHeader('name')).toBe('name');
      expect(resolveHeader('Full Name')).toBe('name');
      expect(resolveHeader('\uFEFFcandidate name ')).toBe('name');
      expect(resolveHeader('PHONE NUMBER ')).toBe('phone');
      expect(resolveHeader('Mobile')).toBe('phone');
      expect(resolveHeader('e-mail')).toBe('email');
      expect(resolveHeader('Email Address')).toBe('email');
      expect(resolveHeader('resume link')).toBe('resumeLink');
      expect(resolveHeader('resume lonk')).toBe('resumeLink');
      expect(resolveHeader('CV Link')).toBe('resumeLink');
      expect(resolveHeader('Random Unknown Column')).toBeNull();
    });
  });

  describe('Candidate Row Validation', () => {
    test('accepts valid row with all required fields', () => {
      const rawRow = {
        name: 'John Doe',
        role: 'Tech Lead',
        email: 'john@example.com',
        phone: '+919876543210',
      };
      const result = validateCandidateRow(rawRow, 2);

      expect(result.valid).toBe(true);
      expect(result.data.name).toBe('John Doe');
      expect(result.data.role).toBe('Tech Lead');
      expect(result.data.email).toBe('john@example.com');
      expect(result.data.phone).toBe('+919876543210');
      expect(result.data.resumeLinkRaw).toBeNull();
      expect(result.data.college).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });

    test('preserves leading 0 or + in phone numbers', () => {
      const rawRow1 = { name: 'Alice', role: 'Dev', email: 'alice@test.com', phone: '09876543210' };
      const res1 = validateCandidateRow(rawRow1, 2);
      expect(res1.valid).toBe(true);
      expect(res1.data.phone).toBe('09876543210');

      const rawRow2 = { name: 'Bob', role: 'QA', email: 'bob@test.com', phone: '+14155552671' };
      const res2 = validateCandidateRow(rawRow2, 3);
      expect(res2.valid).toBe(true);
      expect(res2.data.phone).toBe('+14155552671');
    });

    test('hard-fails when name is missing', () => {
      const rawRow = { name: '   ', role: 'Dev', email: 'test@test.com', phone: '9876543210' };
      const result = validateCandidateRow(rawRow, 4);

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('missing required field "name"');
    });

    test('hard-fails when phone is missing or unnormalizable', () => {
      const rawRow = { name: 'No Phone Candidate', role: 'Dev', email: 'test@test.com', phone: 'abc' };
      const result = validateCandidateRow(rawRow, 5);

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('missing or invalid required field "phone number"');
    });

    test('hard-fails when email is missing or invalid', () => {
      const rawRow1 = {
        name: 'Jane Doe',
        role: 'Dev',
        phone: '9876543210',
        email: '   ',
      };
      const res1 = validateCandidateRow(rawRow1, 6);
      expect(res1.valid).toBe(false);
      expect(res1.failureReason).toContain('missing required field "e-mail"');

      const rawRow2 = {
        name: 'Jane Doe',
        role: 'Dev',
        phone: '9876543210',
        email: 'invalid-email-address',
      };
      const res2 = validateCandidateRow(rawRow2, 7);
      expect(res2.valid).toBe(false);
      expect(res2.failureReason).toContain('invalid required field "e-mail"');
    });

    test('hard-fails when role is missing', () => {
      const rawRow = {
        name: 'Jane Doe',
        phone: '9876543210',
        email: 'jane@test.com',
        role: '',
      };
      const result = validateCandidateRow(rawRow, 8);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('missing required field "role"');
    });
  });

  describe('Resume Link Normalizer', () => {
    test('normalizes Google Drive file view links to direct download', () => {
      const rawUrl = 'https://drive.google.com/file/d/1A2B3C4D5E6F/view?usp=sharing';
      const norm = normalizeResumeLink(rawUrl);

      expect(norm).toBeDefined();
      expect(norm.provider).toBe('google_drive');
      expect(norm.downloadUrl).toBe('https://drive.google.com/uc?export=download&id=1A2B3C4D5E6F');
    });

    test('normalizes Dropbox links with dl=1 parameter', () => {
      const rawUrl = 'https://www.dropbox.com/s/xyz123/my_resume.pdf?dl=0';
      const norm = normalizeResumeLink(rawUrl);

      expect(norm).toBeDefined();
      expect(norm.provider).toBe('dropbox');
      expect(norm.downloadUrl).toContain('dl=1');
    });

    test('normalizes OneDrive links with download=1 parameter', () => {
      const rawUrl = 'https://onedrive.live.com/view.aspx?cid=123&id=456';
      const norm = normalizeResumeLink(rawUrl);

      expect(norm).toBeDefined();
      expect(norm.provider).toBe('onedrive');
      expect(norm.downloadUrl).toContain('download=1');
    });

    test('handles generic unknown domain links without failing', () => {
      const rawUrl = 'https://example.com/resumes/john_resume.pdf';
      const norm = normalizeResumeLink(rawUrl);

      expect(norm).toBeDefined();
      expect(norm.provider).toBe('unknown');
      expect(norm.downloadUrl).toBe(rawUrl);
    });
  });
});
