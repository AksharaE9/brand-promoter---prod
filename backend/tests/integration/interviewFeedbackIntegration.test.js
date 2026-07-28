'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let testCandidate;
let interviewerId;


beforeAll(async () => {
  const { TEST_DB_URL, prisma } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  app = require('../../src/app').app;

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });

  if (res.status === 200 && res.body?.data?.token) {
    hrToken = res.body.data.token;
  } else {
    const jwt = require('jsonwebtoken');
    hrToken = jwt.sign(
      { id: FIXTURE.HR_USER_ID || 'test-hr-id', role: 'RECRUITER', organizationId: FIXTURE.ORG_ID },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  // Create a clean test candidate for 3-round testing
  testCandidate = await prisma.candidate.create({
    data: {
      fullName: 'Three Round Candidate Test',
      email: 'three.round@test.ci',
      phone: '+919876500001',
      phoneNormalized: '+919876500001',
      organizationId: FIXTURE.ORG_ID,
      status: 'ACTIVE',
    },
  });

  const ivUser = await prisma.user.findFirst({
    where: { email: FIXTURE.IV_EMAIL },
  });
  interviewerId = ivUser ? ivUser.id : 'test-interviewer-id';
});

afterAll(async () => {
  const { prisma } = require('../setup/db');
  if (testCandidate) {
    await prisma.interviewFeedback.deleteMany({ where: { candidateId: testCandidate.id } });
    await prisma.interview.deleteMany({ where: { candidateId: testCandidate.id } });
    await prisma.candidate.deleteMany({ where: { id: testCandidate.id } });
  }
});

describe('3 Fixed Interview Rounds & Feedback API Integration', () => {
  test('Schedule 1st round derives Round 1 without free-text round input', async () => {
    const res = await request(app)
      .post(`/api/interviews/${testCandidate.id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        scheduledStart: new Date().toISOString(),
        mode: 'VIRTUAL',
        interviewerIds: [interviewerId],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.roundLabel).toBe('Round 1');
    expect(res.body.data.derivedRound).toBe('ROUND_1');
  });

  test('POST feedback validates template rules (rejects missing required & invalid rating)', async () => {
    // Missing required fields
    const badRes1 = await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'ROUND_1',
        data: {
          name: 'Three Round Candidate Test',
          // missing number, panelists, role, overallRating, doj, selectionStatus
        },
      })
      .expect(400);

    expect(badRes1.body.success).toBe(false);
    expect(badRes1.body.errors.length).toBeGreaterThan(0);

    // Rating > 10
    const badRes2 = await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'ROUND_1',
        data: {
          name: 'Three Round Candidate Test',
          number: '+919876500001',
          roundNumber: 'Round 1',
          panelists: 'Alex',
          role: 'Developer',
          overallRating: 15,
          doj: '2026-08-01',
          selectionStatus: 'SELECTED',
        },
      })
      .expect(400);

    expect(badRes2.body.errors.some((e) => e.includes('between 0 and 10'))).toBe(true);
  });

  test('Submits valid Round 1 feedback & upserts idempotently', async () => {
    const feedbackData = {
      name: 'Three Round Candidate Test',
      number: '+919876500001',
      roundNumber: 'Round 1',
      panelists: 'Lead Interviewer',
      role: 'Software Engineer',
      overallRating: 8.5,
      doj: '2026-08-01',
      selectionStatus: 'SELECTED',
      comments: 'Strong initial assessment.',
    };

    const res = await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'ROUND_1',
        data: feedbackData,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.round).toBe('ROUND_1');
    expect(res.body.data.selectionStatus).toBe('SELECTED');
    expect(res.body.data.overallRating).toBe(8.5);

    // GET single feedback route
    const getRes = await request(app)
      .get(`/api/interviews/${testCandidate.id}/feedback/ROUND_1`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(getRes.body.data.name).toBe('Three Round Candidate Test');

    // Resubmit / update same round feedback
    const updatedData = { ...feedbackData, overallRating: 9.0, comments: 'Updated score' };
    const updateRes = await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'ROUND_1',
        data: updatedData,
      })
      .expect(200);

    expect(updateRes.body.data.overallRating).toBe(9.0);
  });

  test('Schedules and submits feedback through Round 2 and Final Round', async () => {
    // Round 2
    const sch2 = await request(app)
      .post(`/api/interviews/${testCandidate.id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        scheduledStart: new Date().toISOString(),
        mode: 'VIRTUAL',
        interviewerIds: [interviewerId],
      })
      .expect(201);
    expect(sch2.body.data.roundLabel).toBe('Round 2');

    await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'ROUND_2',
        data: {
          name: 'Three Round Candidate Test',
          number: '+919876500001',
          roundNumber: 'Round 2',
          panelists: 'Panel B',
          overallRating: 8,
          status: 'SELECTED',
        },
      })
      .expect(200);

    // Final Round
    const schFinal = await request(app)
      .post(`/api/interviews/${testCandidate.id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        scheduledStart: new Date().toISOString(),
        mode: 'VIRTUAL',
        interviewerIds: [interviewerId],
      })
      .expect(201);
    expect(schFinal.body.data.roundLabel).toBe('Final Round');

    await request(app)
      .post(`/api/interviews/${testCandidate.id}/feedback`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        round: 'FINAL_ROUND',
        data: {
          name: 'Three Round Candidate Test',
          number: '+919876500001',
          roundNumber: 'Final Round',
          panelists: 'VP Engineering',
          overallRating: 9.5,
          status: 'SELECTED',
        },
      })
      .expect(200);
  });

  test('Attempting to schedule 4th round returns 409 Conflict', async () => {
    const res = await request(app)
      .post(`/api/interviews/${testCandidate.id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        scheduledStart: new Date().toISOString(),
        mode: 'VIRTUAL',
        interviewerIds: [interviewerId],
      })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.message || res.body.error).toContain('All 3 interview rounds are already completed');
  });
});
