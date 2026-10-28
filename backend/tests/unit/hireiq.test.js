'use strict';

/**
 * Unit Tests for HireIQ Integration DTOs, Email Sanitization,
 * IST Timezone Mapping, and Resume Coverage Rules.
 */

const {
  toHireIqInterviewDto,
  validateCandidateEmail,
  formatIstSchedule,
  resolveHireIqResume,
} = require('../../src/modules/ext/dtos');
const { hashApiKey } = require('../../src/modules/ext/apiKeyService');

describe('HireIQ Integration Unit Tests', () => {

  describe('1. Field Allow-list & Strict DTO Shape (Part 3.2 & 3.3)', () => {
    it('returns exactly the specified fields and never leaks internal data', () => {
      const mockInterview = {
        id: 'cmv_iv_101',
        candidateId: 'cmv_cand_202',
        candidateName: 'Priya Sharma ',
        jobId: 'job_ops_303',
        jobTitle: 'Operations Intern',
        roundNo: 1,
        round: 'Round 1',
        scheduledStart: new Date('2026-10-07T09:00:00.000Z'), // 14:30 IST
        durationMinutes: 30,
        mode: 'ONLINE',
        meetingLink: 'https://meet.zoho.in/demo-slot',
        status: 'SCHEDULED',
        interviewerNames: 'Praneel, Anita',
        feedback: [{ overallRating: 4.5, comments: 'Good potential' }],
        notes: 'Secret panel feedback: High salary expectation',
        updatedAt: new Date('2026-10-06T13:14:00.000Z'),
        application: {
          jobId: 'job_ops_303',
          job: { title: 'Operations Intern' },
          candidate: {
            id: 'cmv_cand_202',
            fullName: 'Priya Sharma ',
            email: 'priya.sharma@example.org',
            phone: '+919876543210',
            preferredRole: 'Operations Trainee',
            customFields: { familyBackground: 'Private' }
          }
        }
      };

      const dto = toHireIqInterviewDto(mockInterview, true, true, 'https://brandpromoter-backend.onrender.com');

      // Top-level allow-list check
      const expectedKeys = ['interviewId', 'candidate', 'role', 'round', 'schedule', 'interviewers', 'status', 'resume', 'updatedAt'];
      expect(Object.keys(dto).sort()).toEqual(expectedKeys.sort());

      // Candidate object
      expect(dto.candidate.id).toBe('cmv_cand_202');
      expect(dto.candidate.name).toBe('Priya Sharma'); // Trimmed
      expect(dto.candidate.email).toBe('priya.sharma@example.org');
      expect(dto.candidate.emailStatus).toBe('valid');

      // Role object
      expect(dto.role.interviewRole).toBe('Operations Intern');
      expect(dto.role.appliedRole).toBe('Operations Trainee');
      expect(dto.role.jobId).toBe('job_ops_303');

      // Round object
      expect(dto.round.number).toBe(1);
      expect(dto.round.label).toBe('Round 1');

      // Interviewers array
      expect(dto.interviewers).toEqual(['Praneel', 'Anita']);

      // DEEP SCAN: verify forbidden internal fields are NOT present anywhere in JSON
      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain('+919876543210');
      expect(serialized).not.toContain('Secret panel feedback');
      expect(serialized).not.toContain('Good potential');
      expect(serialized).not.toContain('familyBackground');
      expect(serialized).not.toContain('overallRating');
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('hash');
    });
  });

  describe('2. Email Sanitization & PII Scoping (Part 3.3)', () => {
    it('returns genuine email when candidates:read:pii is granted', () => {
      const res = validateCandidateEmail('John.Doe@Company.COM', true);
      expect(res.email).toBe('john.doe@company.com');
      expect(res.emailStatus).toBe('valid');
    });

    it('redacts email (returns null) when candidates:read:pii is absent, but preserves valid status', () => {
      const res = validateCandidateEmail('john.doe@company.com', false);
      expect(res.email).toBeNull();
      expect(res.emailStatus).toBe('valid');
    });

    it('identifies placeholder emails and returns null', () => {
      const placeholders = [
        'dummy@gmail.com',
        'dummy123@gmail.com',
        'test@example.com',
        'noemail@domain.com',
        'none@akshara.com',
        'na@na.com'
      ];
      for (const p of placeholders) {
        const res = validateCandidateEmail(p, true);
        expect(res.email).toBeNull();
        expect(res.emailStatus).toBe('placeholder');
      }
    });

    it('identifies missing emails and returns null', () => {
      const missings = [null, undefined, '', 'N/A', 'na', '-', 'null'];
      for (const m of missings) {
        const res = validateCandidateEmail(m, true);
        expect(res.email).toBeNull();
        expect(res.emailStatus).toBe('missing');
      }
    });

    it('identifies invalid malformed emails without @', () => {
      const invalids = ['angelbeulah', 'user123', 'notanemail.com'];
      for (const inv of invalids) {
        const res = validateCandidateEmail(inv, true);
        expect(res.email).toBeNull();
        expect(res.emailStatus).toBe('invalid');
      }
    });
  });

  describe('3. IST Timezone & Schedule Formatting (Part 3.3)', () => {
    it('converts UTC to exact IST (+05:30) with zero day-shift', () => {
      // 07 Oct 2026, 14:30 IST is 2026-10-07T09:00:00Z
      const utcDate = new Date('2026-10-07T09:00:00.000Z');
      const schedule = formatIstSchedule(utcDate, 30, 'Slot 1', 'ONLINE', 'https://meet.zoho.in/test');

      expect(schedule.date).toBe('2026-10-07');
      expect(schedule.startTime).toBe('14:30');
      expect(schedule.endTime).toBe('15:00');
      expect(schedule.durationMinutes).toBe(30);
      expect(schedule.slot).toBe('Slot 1');
      expect(schedule.timezone).toBe('Asia/Kolkata');
      expect(schedule.startsAt).toBe('2026-10-07T14:30:00+05:30');
      expect(schedule.endsAt).toBe('2026-10-07T15:00:00+05:30');
      expect(schedule.mode).toBe('ONLINE');
      expect(schedule.meetingLink).toBe('https://meet.zoho.in/test');
    });

    it('handles evening UTC times that cross into next calendar day in IST', () => {
      // 27 Oct 2026, 19:00 UTC = 28 Oct 2026, 00:30 IST (+5.5h)
      const lateUtc = new Date('2026-10-27T19:00:00.000Z');
      const schedule = formatIstSchedule(lateUtc, 60, 'Slot 1');

      expect(schedule.date).toBe('2026-10-28');
      expect(schedule.startTime).toBe('00:30');
      expect(schedule.startsAt).toBe('2026-10-28T00:30:00+05:30');
    });
  });

  describe('4. Resume Status & Link Classification (Part 3.4)', () => {
    it('marks resume available when stored in PostgreSQL file_metas', () => {
      const cand = {
        id: 'cand_123',
        fullName: 'Aarav Patel',
        resumeFile: {
          originalName: 'aarav_resume.pdf',
          mimeType: 'application/pdf',
          fileData: Buffer.from('%PDF-1.4 sample content')
        }
      };

      const resume = resolveHireIqResume(cand, true, 'https://ats.example.com');
      expect(resume.status).toBe('available');
      expect(resume.fileName).toBe('aarav_resume.pdf');
      expect(resume.mimeType).toBe('application/pdf');
      expect(resume.downloadUrl).toBe('https://ats.example.com/api/v1/ext/candidates/cand_123/resume');
      expect(resume.externalUrl).toBeNull();
      expect(resume.isSharedFolder).toBe(false);
    });

    it('marks individual external cloud link as external_link', () => {
      const cand = {
        id: 'cand_124',
        fullName: 'Kavya Nair',
        resumeLinkOriginal: 'https://drive.google.com/file/d/1a2b3c4d/view'
      };

      const resume = resolveHireIqResume(cand, true, 'https://ats.example.com');
      expect(resume.status).toBe('external_link');
      expect(resume.externalUrl).toBe('https://drive.google.com/file/d/1a2b3c4d/view');
      expect(resume.downloadUrl).toBeNull();
      expect(resume.isSharedFolder).toBe(false);
    });

    it('detects shared drive folder and sets isSharedFolder: true', () => {
      const cand = {
        id: 'cand_125',
        fullName: 'Batch Student',
        resumeLinkOriginal: 'https://drive.google.com/drive/folders/1ABCxyz789'
      };

      const resume = resolveHireIqResume(cand, true, 'https://ats.example.com');
      expect(resume.status).toBe('external_link');
      expect(resume.isSharedFolder).toBe(true);
    });

    it('marks file_missing if resumeFileId is set but binary data is empty', () => {
      const cand = {
        id: 'cand_126',
        fullName: 'Orphan File Cand',
        resumeFileId: 'missing_file_id',
        resumeFile: null
      };

      const resume = resolveHireIqResume(cand, true, 'https://ats.example.com');
      expect(resume.status).toBe('file_missing');
      expect(resume.downloadUrl).toBeNull();
      expect(resume.externalUrl).toBeNull();
    });

    it('marks none when no resume is attached', () => {
      const cand = { id: 'cand_127', fullName: 'No Resume Cand' };
      const resume = resolveHireIqResume(cand, true, 'https://ats.example.com');
      expect(resume.status).toBe('none');
      expect(resume.downloadUrl).toBeNull();
      expect(resume.externalUrl).toBeNull();
    });
  });

  describe('5. API Key Hashing & Verification (Part 2.2)', () => {
    it('hashes API key deterministically using pepper and sha256', () => {
      const pepper = 'test_pepper_at_least_32_characters_long_123456';
      const key = 'tos_live_abcdef12_12345678901234567890123456789012';
      const hash1 = hashApiKey(key, pepper);
      const hash2 = hashApiKey(key, pepper);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex string
    });
  });

});
