'use strict';

/**
 * qa/tests/external_api_and_hireiq.test.js
 *
 * Automated QA tests for External API (v1) and HireIQ Endpoints (Parts 4.L & 4.M)
 */

const crypto = require('crypto');
const {
  toHireIqInterviewDto,
  validateCandidateEmail,
  formatIstSchedule,
  resolveHireIqResume
} = require('../../backend/src/modules/ext/dtos');

describe('QA Suite: External API & HireIQ Feeds (L & M)', () => {
  describe('L5: DTO Allow-list & Privacy Leak Check', () => {
    const mockInterview = {
      id: 'int_test_123',
      roundNo: 1,
      round: 'Round 1',
      jobTitle: 'Operations Intern',
      scheduledStart: new Date('2026-10-07T09:00:00Z'),
      durationMinutes: 30,
      mode: 'ONLINE',
      meetingLink: 'https://meet.zoho.in/abc-xyz',
      status: 'SCHEDULED',
      updatedAt: new Date('2026-10-06T13:14:00Z'),
      application: {
        candidate: {
          id: 'cand_test_456',
          fullName: 'Priya Sharma ',
          email: 'priya.sharma@ats-company.in',
          phone: '+919876543210',
          preferredRole: 'Operations Intern',
          resumeFileId: 'file_meta_789',
          resumeFile: {
            id: 'file_meta_789',
            originalName: 'Priya_Resume.pdf',
            mimeType: 'application/pdf',
            fileData: Buffer.from('%PDF-1.4 test binary data')
          }
        },
        job: { id: 'job_001', title: 'Operations Intern' }
      }
    };

    test('L5: DTO contains only allowed fields and strictly excludes forbidden fields', () => {
      const dto = toHireIqInterviewDto(mockInterview, true, true, 'https://brandpromoter-backend.onrender.com');

      // Allowed fields must exist
      expect(dto.interviewId).toBe('int_test_123');
      expect(dto.candidate.name).toBe('Priya Sharma');
      expect(dto.candidate.email).toBe('priya.sharma@ats-company.in');
      expect(dto.role.interviewRole).toBe('Operations Intern');
      expect(dto.round.number).toBe(1);
      expect(dto.schedule.slot).toBe('Slot 1');
      expect(dto.schedule.startsAt).toBe('2026-10-07T14:30:00+05:30');
      expect(dto.resume.status).toBe('available');

      // Forbidden sensitive fields must NEVER be present anywhere in DTO
      const dtoStr = JSON.stringify(dto).toLowerCase();
      expect(dtoStr).not.toContain('password');
      expect(dtoStr).not.toContain('hash');
      expect(dtoStr).not.toContain('feedback');
      expect(dtoStr).not.toContain('rating');
      expect(dtoStr).not.toContain('family');
      expect(dtoStr).not.toContain('notes');
      expect(dtoStr).not.toContain('+919876543210'); // Phone must NOT appear in HireIQ feed
    });

    test('L5: Email is null when candidates:read:pii scope is false', () => {
      const dto = toHireIqInterviewDto(mockInterview, false, true, 'https://brandpromoter-backend.onrender.com');
      expect(dto.candidate.email).toBeNull();
      expect(dto.candidate.emailStatus).toBe('valid');
    });

    test('M1: Dummy/placeholder emails map to null with status placeholder', () => {
      const p1 = validateCandidateEmail('dummy@gmail.com', true);
      expect(p1.email).toBeNull();
      expect(p1.emailStatus).toBe('placeholder');

      const p2 = validateCandidateEmail('test@ats-corp.com', true);
      expect(p2.email).toBeNull();
      expect(p2.emailStatus).toBe('placeholder');

      const p3 = validateCandidateEmail('invalidformat', true);
      expect(p3.email).toBeNull();
      expect(p3.emailStatus).toBe('invalid');

      const p4 = validateCandidateEmail('real.candidate@gmail.com', true);
      expect(p4.email).toBe('real.candidate@gmail.com');
      expect(p4.emailStatus).toBe('valid');
    });

    test('M1: Schedule formatting contains explicit +05:30 IST offset and no day-shift', () => {
      const utcDate = new Date('2026-10-07T09:00:00.000Z'); // 14:30 IST
      const sched = formatIstSchedule(utcDate, 30, 'Slot 1', 'ONLINE', 'https://meet.zoho.in/abc');

      expect(sched.timezone).toBe('Asia/Kolkata');
      expect(sched.date).toBe('2026-10-07');
      expect(sched.startTime).toBe('14:30');
      expect(sched.endTime).toBe('15:00');
      expect(sched.startsAt).toBe('2026-10-07T14:30:00+05:30');
      expect(sched.endsAt).toBe('2026-10-07T15:00:00+05:30');
    });

    test('M3: Flags batch Drive folders with isSharedFolder: true', () => {
      const candidate = {
        id: 'c1',
        resumeLinkOriginal: 'https://drive.google.com/drive/folders/1abc987xyz'
      };
      const resume = resolveHireIqResume(candidate, true, 'https://brandpromoter-backend.onrender.com');
      expect(resume.status).toBe('external_link');
      expect(resume.isSharedFolder).toBe(true);
      expect(resume.externalUrl).toBe('https://drive.google.com/drive/folders/1abc987xyz');
    });
  });
});
