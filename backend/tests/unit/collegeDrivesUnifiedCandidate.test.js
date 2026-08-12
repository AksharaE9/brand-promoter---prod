'use strict';

const { CANDIDATE_IMPORT_SCHEMA } = require('../../src/lib/candidateImportSchema');
const { validateCandidateRow } = require('../../src/lib/candidateRowValidator');
const { normalizeResumeLink } = require('../../src/lib/resumeLinkNormalizer');
const { normalizePhoneNumber, normalizePhoneForDedup } = require('../../src/lib/phoneNormalization');

describe('College Drives Unified Candidate Intake Units', () => {
  describe('Image 2 Bulk Upload Template Schema & Columns', () => {
    test('matches exact 11 columns in order: candidate id, Name, Role, e-mail, phone number, resume link, college, location, course, source, company', () => {
      const keys = CANDIDATE_IMPORT_SCHEMA.map(f => f.key);
      const labels = CANDIDATE_IMPORT_SCHEMA.map(f => f.label);

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

    test('enforces required columns strictly on Name, Role, e-mail, phone number, resume link', () => {
      const requiredMap = Object.fromEntries(CANDIDATE_IMPORT_SCHEMA.map(f => [f.key, f.required]));
      expect(requiredMap.name).toBe(true);
      expect(requiredMap.role).toBe(true);
      expect(requiredMap.email).toBe(true);
      expect(requiredMap.phone).toBe(true);
      expect(requiredMap.resumeLink).toBe(true);

      // Optional college drive context fields
      expect(requiredMap.candidateId).toBe(false);
      expect(requiredMap.college).toBe(false);
      expect(requiredMap.location).toBe(false);
      expect(requiredMap.course).toBe(false);
      expect(requiredMap.source).toBe(false);
      expect(requiredMap.company).toBe(false);
    });
  });

  describe('College Drive Candidate Validation and Resume Normalization', () => {
    test('validates complete college drive candidate row successfully', () => {
      const rawRow = {
        candidateId: 'EXT-1001',
        name: 'Jane Smith',
        role: 'Graduate Trainee',
        email: 'jane.smith@mit.edu',
        phone: '+91 98765 43210',
        resumeLink: 'https://drive.google.com/file/d/1B2xYZ-sample-link/view?usp=sharing',
        college: 'MIT Campus',
        location: 'Bangalore',
        course: 'B.Tech CSE',
        source: 'Campus Placement 2026',
        company: 'Akshara Enterprises',
      };

      const result = validateCandidateRow(rawRow, 2);
      expect(result.valid).toBe(true);
      expect(result.data.candidateId).toBe('EXT-1001');
      expect(result.data.name).toBe('Jane Smith');
      expect(result.data.role).toBe('Graduate Trainee');
      expect(result.data.college).toBe('MIT Campus');
      expect(result.data.course).toBe('B.Tech CSE');
      expect(result.data.location).toBe('Bangalore');
      expect(result.data.company).toBe('Akshara Enterprises');
      expect(result.data.source).toBe('Campus Placement 2026');

      // Normalize resume link
      const normResume = normalizeResumeLink(result.data.resumeLinkRaw);
      expect(normResume).not.toBeNull();
      expect(normResume.provider).toBe('google_drive');
      expect(normResume.downloadUrl).toContain('uc?export=download&id=1B2xYZ-sample-link');
    });

    test('rejects candidate row if resume link is missing', () => {
      const rawRow = {
        name: 'Jane Smith',
        role: 'Graduate Trainee',
        email: 'jane.smith@mit.edu',
        phone: '9876543210',
        college: 'MIT Campus',
      };

      const result = validateCandidateRow(rawRow, 2);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('missing required field "resume link"');
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
