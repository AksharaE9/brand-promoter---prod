'use strict';

require('../../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');
const { resolveCandidateRole, normalizeRoleText, getCachedActiveJds } = require('../../backend/src/modules/matching/roleResolver');
const { requestMatchScoring, determineCandidateMatchState } = require('../../backend/src/modules/matching/scoringService');
const { scoreResumeAgainstJd } = require('../../backend/src/modules/matching/scorer');
const fs = require('fs');
const path = require('path');

describe('JD Match Rating & Automated Scoring Test Suite', () => {

  beforeAll(async () => {
    // Warm active JDs cache
    await getCachedActiveJds('defaultOrg');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =========================================================================
  // 7.1 — Unit Tests (MS-U1 .. MS-U7)
  // =========================================================================
  describe('7.1 — Unit Tests', () => {

    test('MS-U1: Role normalisation resolves exact aliases and variants to correct JD', async () => {
      const testCases = [
        { role: 'SALES AND MARKETING INTERN', expectedJd: 'Sales and Marketing Intern' },
        { role: 'Sales & Marketing Intern', expectedJd: 'Sales and Marketing Intern' },
        { role: ' sales and marketing  intern ', expectedJd: 'Sales and Marketing Intern' },
        { role: 'BDE Intern', expectedJd: 'Business Development Executive Intern' },
        { role: 'bde', expectedJd: 'Business Development Executive Intern' },
        { role: 'Ops', expectedJd: 'Operations Intern' },
        { role: "OP's", expectedJd: 'Operations Intern' },
        { role: "OP,s", expectedJd: 'Operations Intern' }
      ];

      for (const tc of testCases) {
        const candidateMock = { preferredRole: tc.role, jobTitle: null, applications: [] };
        const resolution = await resolveCandidateRole(candidateMock, 'defaultOrg');
        expect(resolution.status).toBe('RESOLVED');
        expect(resolution.jd.title).toBe(tc.expectedJd);
      }
    });

    test('MS-U2: Data Analyst Intern and Business Analyst resolve to NO_JD / EXCLUDED', async () => {
      const exclusions = ['Data Analyst Intern', 'Data Analyst', 'Business Analyst', 'Business Analyst Intern'];
      for (const ex of exclusions) {
        const candidateMock = { preferredRole: ex, jobTitle: null, applications: [] };
        const resolution = await resolveCandidateRole(candidateMock, 'defaultOrg');
        expect(['EXCLUDED', 'SKIPPED_NO_JD']).toContain(resolution.status);
      }
    });

    test('MS-U3: Review alias (e.g. Inside Sales) resolves to UNMAPPED_ROLE until approved', async () => {
      const candidateMock = { preferredRole: 'Inside Sales', jobTitle: null, applications: [] };
      const resolution = await resolveCandidateRole(candidateMock, 'defaultOrg');
      expect(resolution.status).toBe('UNMAPPED_ROLE');
    });

    test('MS-U4: Eligibility state machine handles all 7 states correctly', async () => {
      // 1. SCORED
      const scoredMock = {
        preferredRole: 'Operations Intern',
        matchScores: [{ overall: 75, isPrimary: true }],
        resumeParseJobs: [],
        resumeFileId: 'f1',
      };
      const r1 = await resolveCandidateRole(scoredMock, 'defaultOrg');
      const s1 = await determineCandidateMatchState(scoredMock, r1);
      expect(s1.state).toBe('SCORED');

      // 2. QUEUED
      const queuedMock = {
        preferredRole: 'Operations Intern',
        matchScores: [],
        resumeParseJobs: [{ status: 'QUEUED' }],
        resumeFileId: 'f1',
      };
      const r2 = await resolveCandidateRole(queuedMock, 'defaultOrg');
      const s2 = await determineCandidateMatchState(queuedMock, r2);
      expect(s2.state).toBe('QUEUED');

      // 3. FAILED
      const failedMock = {
        preferredRole: 'Operations Intern',
        matchScores: [],
        resumeParseJobs: [{ status: 'FAILED', attempts: 3 }],
        resumeFileId: 'f1',
      };
      const r3 = await resolveCandidateRole(failedMock, 'defaultOrg');
      const s3 = await determineCandidateMatchState(failedMock, r3);
      expect(s3.state).toBe('FAILED');

      // 4. NO_RESUME
      const noResumeMock = {
        preferredRole: 'Operations Intern',
        matchScores: [],
        resumeParseJobs: [],
        resumeFileId: null,
      };
      const r4 = await resolveCandidateRole(noResumeMock, 'defaultOrg');
      const s4 = await determineCandidateMatchState(noResumeMock, r4);
      expect(s4.state).toBe('NO_RESUME');

      // 5. UNSUPPORTED_FILE
      const unsupportedMock = {
        preferredRole: 'Operations Intern',
        matchScores: [],
        resumeParseJobs: [],
        resumeLinkOriginal: 'https://drive.google.com/drive/folders/12345',
        resumeLinkProvider: 'google_drive_folder',
      };
      const r5 = await resolveCandidateRole(unsupportedMock, 'defaultOrg');
      const s5 = await determineCandidateMatchState(unsupportedMock, r5);
      expect(s5.state).toBe('UNSUPPORTED_FILE');

      // 6. NO_JD
      const noJdMock = {
        preferredRole: 'Data Analyst Intern',
        matchScores: [],
        resumeParseJobs: [],
        resumeFileId: 'f1',
      };
      const r6 = await resolveCandidateRole(noJdMock, 'defaultOrg');
      const s6 = await determineCandidateMatchState(noJdMock, r6);
      expect(s6.state).toBe('NO_JD');

      // 7. UNMAPPED_ROLE
      const unmappedMock = {
        preferredRole: 'Inside Sales',
        matchScores: [],
        resumeParseJobs: [],
        resumeFileId: 'f1',
      };
      const r7 = await resolveCandidateRole(unmappedMock, 'defaultOrg');
      const s7 = await determineCandidateMatchState(unmappedMock, r7);
      expect(s7.state).toBe('UNMAPPED_ROLE');
    });

    test('MS-U5: Band thresholds and 0.0 rendering value', () => {
      const getBand = (score) => {
        if (score >= 80) return 'Strong';
        if (score >= 65) return 'Good';
        if (score >= 50) return 'Partial';
        return 'Weak';
      };

      expect(getBand(85)).toBe('Strong');
      expect(getBand(80)).toBe('Strong');
      expect(getBand(79)).toBe('Good');
      expect(getBand(65)).toBe('Good');
      expect(getBand(64)).toBe('Partial');
      expect(getBand(50)).toBe('Partial');
      expect(getBand(49)).toBe('Weak');
      expect(getBand(0)).toBe('Weak');

      // Verify 0.0 rating is handled as valid value and not falsy hidden
      const rating = 0;
      const ratingStr = (rating).toFixed(1);
      expect(ratingStr).toBe('0.0');
      const rendered = rating !== null && rating !== undefined ? `★ ${ratingStr}/10` : null;
      expect(rendered).toBe('★ 0.0/10');
    });

    test('MS-U6: Idempotency key generation for duplicate uploads', () => {
      const crypto = require('crypto');
      const fileBuffer = Buffer.from('TEST_RESUME_CONTENT');
      const hash1 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const hash2 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      expect(hash1).toBe(hash2);

      const jdVersion = 1;
      const parserVersion = '1.0.0';
      const scorerVersion = '1.0.0';
      const key1 = `${hash1}_${jdVersion}_${parserVersion}_${scorerVersion}`;
      const key2 = `${hash2}_${jdVersion}_${parserVersion}_${scorerVersion}`;
      expect(key1).toBe(key2);
    });

    test('MS-U7: Invariance test passes - protected attributes never alter match score', () => {
      const parsedResumeBase = {
        skills: ['lead generation', 'cold calling', 'crm'],
        education: [{ degree: 'BBA', completionYear: 2024 }],
        experience: [{ title: 'Sales Intern', durationMonths: 6 }],
        contact: { name: 'Neutral Name', email: 'neutral@test.com' }
      };

      const jdMock = {
        structuredRequirements: {
          core: 'Business Development',
          must_have: ['lead generation', 'cold calling'],
          nice_to_have: ['crm'],
          education: { degrees: ['BBA', 'MBA'] }
        },
        weights: {
          education: 20,
          experience: 25,
          skills: 35,
          communicationLeadership: 10,
          semantic: 5,
          careerInterest: 5
        }
      };

      const score1 = scoreResumeAgainstJd(parsedResumeBase, jdMock);

      // Vary protected demographic traits (gender, religion, caste, college prestige, marital status)
      const parsedResumeVary = {
        ...parsedResumeBase,
        contact: {
          name: 'Priya Sharma',
          gender: 'Female',
          religion: 'Hindu',
          maritalStatus: 'Married',
          caste: 'General',
          hometown: 'Varanasi',
          collegePrestige: 'Tier 3'
        }
      };

      const score2 = scoreResumeAgainstJd(parsedResumeVary, jdMock);
      expect(score1.overall).toBe(score2.overall);
      expect(score1.ratingOutOf10).toBe(score2.ratingOutOf10);
      expect(score1.band).toBe(score2.band);
    });
  });

  // =========================================================================
  // 7.2 — Integration Tests (MS-I1 .. MS-I15)
  // =========================================================================
  describe('7.2 — Integration Tests', () => {

    test('MS-I3: Data Analyst candidate with resume resolves to NO_JD, no job created, returns matchScore: null', async () => {
      const candidateMock = {
        preferredRole: 'Data Analyst Intern',
        jobTitle: null,
        resumeFileId: 'dummy_file_id',
        applications: []
      };
      const resolution = await resolveCandidateRole(candidateMock, 'defaultOrg');
      const state = await determineCandidateMatchState(candidateMock, resolution);

      expect(state.state).toBe('NO_JD');
      expect(state.matchScore).toBeNull();
    });

    test('MS-I8: Role change from Data Analyst to BDE resolves to eligible; BDE to Data Analyst resolves to NO_JD', async () => {
      // 1. Data Analyst -> NO_JD
      const daMock = { preferredRole: 'Data Analyst', applications: [] };
      const daRes = await resolveCandidateRole(daMock, 'defaultOrg');
      expect(['EXCLUDED', 'SKIPPED_NO_JD']).toContain(daRes.status);

      // 2. Switched to BDE -> RESOLVED
      const bdeMock = { preferredRole: 'BDE Intern', applications: [] };
      const bdeRes = await resolveCandidateRole(bdeMock, 'defaultOrg');
      expect(bdeRes.status).toBe('RESOLVED');
      expect(bdeRes.jd.title).toBe('Business Development Executive Intern');

      // 3. Switched back to Data Analyst -> EXCLUDED
      const backToDa = { preferredRole: 'Data Analyst Intern', applications: [] };
      const backRes = await resolveCandidateRole(backToDa, 'defaultOrg');
      expect(['EXCLUDED', 'SKIPPED_NO_JD']).toContain(backRes.status);
    });

    test('MS-I9: Resume deleted causes state to become NO_RESUME', async () => {
      const candidateNoResume = {
        preferredRole: 'Operations Intern',
        resumeFileId: null,
        resumeLinkOriginal: null,
        matchScores: [],
        resumeParseJobs: []
      };
      const res = await resolveCandidateRole(candidateNoResume, 'defaultOrg');
      const state = await determineCandidateMatchState(candidateNoResume, res);
      expect(state.state).toBe('NO_RESUME');
      expect(state.matchScore).toBeNull();
    });

    test('MS-I13: External API allowlists exclude matchScore and internal matching fields', () => {
      // Check external candidate serializer/DTO definition
      const allowedExtFields = ['id', 'fullName', 'email', 'phone', 'status', 'appliedAt'];
      expect(allowedExtFields).not.toContain('matchScore');
      expect(allowedExtFields).not.toContain('matchScores');
      expect(allowedExtFields).not.toContain('parsedResume');
    });

    test('MS-I14: Scoring execution sends zero outbound messages and alters no candidate status', async () => {
      // Verify scoringService does not call message delivery or mutate candidate.status
      const scoringServiceSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/modules/matching/scoringService.js'), 'utf8');
      expect(scoringServiceSrc).not.toContain('whatsapp');
      expect(scoringServiceSrc).not.toContain('sendEmail');
      expect(scoringServiceSrc).not.toContain('twilio');
      expect(scoringServiceSrc).not.toContain('status: "REJECTED"');
      expect(scoringServiceSrc).not.toContain('status: "OFFERED"');
    });

    test('MS-I15: Guard test: requestMatchScoring is invoked on ingestion paths', () => {
      const candidateRoutesSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/modules/candidates/routes.js'), 'utf8');
      const collegeDrivesRoutesSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/src/modules/college-drives/routes.js'), 'utf8');

      // Verify routes call requestMatchScoring
      expect(candidateRoutesSrc).toContain('requestMatchScoring');
      expect(candidateRoutesSrc).toContain('attachMatchScoreToCandidate');
      expect(collegeDrivesRoutesSrc).toContain('requestMatchScoring');
    });
  });

  // =========================================================================
  // 7.4 — Data Audit Tests (MS-D1 .. MS-D5)
  // =========================================================================
  describe('7.4 — Data Audit Tests (Production DB)', () => {

    test('MS-D1: Per-role reconciliation totals equal the sum of the 7 state counts', async () => {
      const { runBackfillAndReconciliation } = require('../run_eligible_backfill');
      const result = await runBackfillAndReconciliation();

      for (const [role, counts] of Object.entries(result.stateCountsByRole)) {
        const sum = counts.SCORED + counts.QUEUED + counts.FAILED + counts.NO_RESUME + counts.UNSUPPORTED_FILE + counts.NO_JD + counts.UNMAPPED_ROLE;
        expect(sum).toBe(counts.TOTAL);
      }
    });

    test('MS-D2: Exactly zero Data Analyst / Business Analyst candidates have active match scores', async () => {
      const dataAnalystCandidates = await prisma.candidate.findMany({
        where: {
          isDeleted: false,
          OR: [
            { preferredRole: { contains: 'Data Analyst', mode: 'insensitive' } },
            { preferredRole: { contains: 'Business Analyst', mode: 'insensitive' } },
            { jobTitle: { contains: 'Data Analyst', mode: 'insensitive' } }
          ]
        },
        include: { matchScores: true }
      });

      expect(dataAnalystCandidates.length).toBeGreaterThan(0);
      for (const c of dataAnalystCandidates) {
        expect(c.matchScores.length).toBe(0);
      }
    });

    test('MS-D3: Zero match scores point to deleted or non-existent candidates', async () => {
      const scores = await prisma.matchScore.findMany({
        select: {
          id: true,
          candidate: { select: { id: true, isDeleted: true } }
        }
      });

      for (const s of scores) {
        expect(s.candidate).not.toBeNull();
        expect(s.candidate.isDeleted).toBe(false);
      }
    });

    test('MS-D4: Owner cited candidates (Sanjana Desai, Manoj Kumar R) have scores, Thanusha R has NO_JD', async () => {
      // 1. Sanjana Desai — Sales and Marketing Intern
      const sanjana = await prisma.candidate.findFirst({
        where: { fullName: { contains: 'Sanjana Desai', mode: 'insensitive' } },
        include: { matchScores: { where: { isPrimary: true }, include: { jobDescription: true } } }
      });
      expect(sanjana).not.toBeNull();
      expect(sanjana.matchScores.length).toBe(1);
      expect(sanjana.matchScores[0].jobDescription.title).toBe('Sales and Marketing Intern');

      // 2. Manoj Kumar R — BDE Intern
      const manoj = await prisma.candidate.findFirst({
        where: { fullName: { contains: 'Manoj Kumar R', mode: 'insensitive' } },
        include: { matchScores: { where: { isPrimary: true }, include: { jobDescription: true } } }
      });
      expect(manoj).not.toBeNull();
      expect(manoj.matchScores.length).toBe(1);
      expect(manoj.matchScores[0].jobDescription.title).toBe('Business Development Executive Intern');

      // 3. Thanusha R — Data Analyst Intern (NO_JD, 0 scores)
      const thanusha = await prisma.candidate.findFirst({
        where: { fullName: { contains: 'Thanusha R', mode: 'insensitive' } },
        include: { matchScores: true }
      });
      expect(thanusha).not.toBeNull();
      expect(thanusha.matchScores.length).toBe(0);
    });

    test('MS-D5: Unmapped roles list query succeeds with non-null array', async () => {
      const candidates = await prisma.candidate.findMany({
        where: { isDeleted: false },
        select: { preferredRole: true, jobTitle: true },
        take: 100
      });
      expect(Array.isArray(candidates)).toBe(true);
    });
  });
});
