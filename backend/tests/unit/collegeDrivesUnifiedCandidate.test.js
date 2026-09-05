'use strict';

const { ALL_CANDIDATES_IMPORT_SCHEMA, COLLEGE_DRIVE_IMPORT_SCHEMA, CANDIDATE_IMPORT_SCHEMA } = require('../../src/lib/candidateImportSchema');
const { validateCandidateRow } = require('../../src/lib/candidateRowValidator');
const { normalizeResumeLink } = require('../../src/lib/resumeLinkNormalizer');
const { normalizePhoneNumber, normalizePhoneForDedup } = require('../../src/lib/phoneNormalization');

describe('College Drives & All Candidates Bulk Upload Schemas', () => {
  describe('Schema Columns and Required Fields', () => {
    test('matches exact 11 columns in order', () => {
      const keys = ALL_CANDIDATES_IMPORT_SCHEMA.map(f => f.key);
      const labels = ALL_CANDIDATES_IMPORT_SCHEMA.map(f => f.label);

      expect(keys).toEqual([
        'candidateId',
        'name',
        'role',
        'email',
        'phone',
        'resumeLink',
        'college',
        'location',
        'course',
        'source',
        'company',
      ]);

      expect(labels).toEqual([
        'candidate id',
        'Name',
        'Role',
        'e-mail',
        'phone number',
        'resume link',
        'college',
        'location',
        'course',
        'source',
        'company',
      ]);
    });

    test('All Candidates schema enforces Name, Role, e-mail, phone number, resume link', () => {
      const requiredMap = Object.fromEntries(ALL_CANDIDATES_IMPORT_SCHEMA.map(f => [f.key, f.required]));
      expect(requiredMap.name).toBe(true);
      expect(requiredMap.role).toBe(true);
      expect(requiredMap.email).toBe(true);
      expect(requiredMap.phone).toBe(true);
      expect(requiredMap.resumeLink).toBe(true);

      expect(requiredMap.candidateId).toBe(false);
      expect(requiredMap.college).toBe(false);
      expect(requiredMap.location).toBe(false);
      expect(requiredMap.course).toBe(false);
      expect(requiredMap.source).toBe(false);
      expect(requiredMap.company).toBe(false);
    });

    test('College Drive schema relaxes resume link only (Name, Role, e-mail, phone number required)', () => {
      const requiredMap = Object.fromEntries(COLLEGE_DRIVE_IMPORT_SCHEMA.map(f => [f.key, f.required]));
      expect(requiredMap.name).toBe(true);
      expect(requiredMap.role).toBe(true);
      expect(requiredMap.email).toBe(true);
      expect(requiredMap.phone).toBe(true);

      // Only resume link is relaxed to false
      expect(requiredMap.resumeLink).toBe(false);

      expect(requiredMap.candidateId).toBe(false);
      expect(requiredMap.college).toBe(false);
      expect(requiredMap.location).toBe(false);
      expect(requiredMap.course).toBe(false);
      expect(requiredMap.source).toBe(false);
      expect(requiredMap.company).toBe(false);
    });
  });

  describe('Row Validation: All Candidates vs College Drive Contexts', () => {
    test('All Candidates path rejects row if resume link, role, or email is missing', () => {
      const rowNoResume = {
        name: 'Jane Smith',
        role: 'Developer',
        email: 'jane@example.com',
        phone: '9876543210',
      };
      const res1 = validateCandidateRow(rowNoResume, 2);
      expect(res1.valid).toBe(false);
      expect(res1.failureReason).toContain('missing required field "resume link"');

      const rowNoRole = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '9876543210',
        resumeLink: 'https://drive.google.com/file/d/123/view',
      };
      const res2 = validateCandidateRow(rowNoRole, 3);
      expect(res2.valid).toBe(false);
      expect(res2.failureReason).toContain('missing required field "role"');
    });

    test('College Drive context accepts candidate with Name, Role, Email, Phone when resume link is BLANK', () => {
      const driveRow = {
        name: 'Arjun Kumar',
        role: 'Trainee',
        email: 'arjun@college.edu',
        phone: '+91 98765 43210',
        college: 'Bangalore University',
      };

      const result = validateCandidateRow(driveRow, 2, { isDriveContext: true });
      expect(result.valid).toBe(true);
      expect(result.data.name).toBe('Arjun Kumar');
      expect(result.data.role).toBe('Trainee');
      expect(result.data.email).toBe('arjun@college.edu');
      expect(result.data.phone).toBe('9876543210');
      expect(result.data.resumeLinkRaw).toBeNull();
      expect(result.data.college).toBe('Bangalore University');
    });

    test('College Drive context rejects row with malformed resume URL', () => {
      const malformedRow = {
        name: 'Arjun Kumar',
        role: 'Trainee',
        email: 'arjun@college.edu',
        phone: '+91 98765 43210',
        resumeLink: 'not-a-valid-url',
      };
      const res = validateCandidateRow(malformedRow, 2, { isDriveContext: true });
      expect(res.valid).toBe(false);
      expect(res.failureReason).toContain('is not a valid URL');
    });

    test('College Drive context rejects row missing still-required fields (e.g. phone or email)', () => {
      const noPhoneRow = {
        name: 'Arjun Kumar',
        role: 'Trainee',
        email: 'arjun@college.edu',
      };
      const res1 = validateCandidateRow(noPhoneRow, 2, { isDriveContext: true });
      expect(res1.valid).toBe(false);
      expect(res1.failureReason).toContain('missing required field "phone number"');

      const noEmailRow = {
        name: 'Arjun Kumar',
        role: 'Trainee',
        phone: '9876543210',
      };
      const res2 = validateCandidateRow(noEmailRow, 3, { isDriveContext: true });
      expect(res2.valid).toBe(false);
      expect(res2.failureReason).toContain('missing required field "e-mail"');
    });

    test('College Drive context normalizes optional resume link when valid URL is provided', () => {
      const driveRowWithResume = {
        name: 'Priya Verma',
        role: 'Associate',
        email: 'priya@college.edu',
        phone: '9876543211',
        resumeLink: 'https://drive.google.com/file/d/1B2xYZ-sample-link/view?usp=sharing',
      };

      const result = validateCandidateRow(driveRowWithResume, 2, { isDriveContext: true });
      expect(result.valid).toBe(true);
      const normResume = normalizeResumeLink(result.data.resumeLinkRaw);
      expect(normResume).not.toBeNull();
      expect(normResume.provider).toBe('google_drive');
    });
  });

  describe('Deduplication & Phone Normalization', () => {
    test('normalizes 10-digit Indian phone, +91 prefixed, and formatted phone numbers for unified dedup matching', () => {
      const p1 = '9876543210';
      const p2 = '+91 98765 43210';
      const p3 = '09876543210';
      const p4 = '+91-98765-43210';

      const key1 = normalizePhoneForDedup(p1);
      const key2 = normalizePhoneForDedup(p2);
      const key3 = normalizePhoneForDedup(p3);
      const key4 = normalizePhoneForDedup(p4);

      expect(key1).toBe('9876543210');
      expect(key2).toBe('9876543210');
      expect(key3).toBe('9876543210');
      expect(key4).toBe('9876543210');
    });
  });
});
