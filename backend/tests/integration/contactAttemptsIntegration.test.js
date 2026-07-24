'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let testCandidate;

beforeAll(async () => {
  const { TEST_DB_URL, prisma } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  ({ app } = require('../../src/app'));

  // Authenticate HR user
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD })
    .expect(200);

  hrToken = loginRes.body.data.token;

  // Create test candidate
  testCandidate = await prisma.candidate.create({
    data: {
      fullName: 'Attempt Test Candidate',
      email: `attempt_${Date.now()}@example.com`,
      phone: '+919876543210',
      organizationId: FIXTURE.ORG_ID,
    },
  });
});

afterAll(async () => {
  const { prisma } = require('../setup/db');
  if (testCandidate?.id) {
    await prisma.candidateContactAttempt.deleteMany({ where: { candidateId: testCandidate.id } });
    await prisma.candidate.delete({ where: { id: testCandidate.id } });
  }
});

describe('Contact Attempt Logging Integration Tests', () => {
  test('POST /api/candidates/:candidateId/contact-attempts logs DIDNT_PICK_UP attempt', async () => {
    const res = await request(app)
      .post(`/api/candidates/${testCandidate.id}/contact-attempts`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        attemptType: 'DIDNT_PICK_UP',
        note: 'Called twice, candidate did not answer.',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.attemptType).toBe('DIDNT_PICK_UP');
    expect(res.body.data.note).toBe('Called twice, candidate did not answer.');
    expect(res.body.data.attemptedAt).toBeDefined();
  });

  test('POST /api/candidates/:candidateId/contact-attempts logs MORNING_FOLLOW_UP with optional proof photo', async () => {
    const res = await request(app)
      .post(`/api/candidates/${testCandidate.id}/contact-attempts`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        attemptType: 'MORNING_FOLLOW_UP',
        photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        note: 'Morning call screenshot proof attached.',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.attemptType).toBe('MORNING_FOLLOW_UP');
    expect(res.body.data.photoUrl).toBeDefined();
  });

  test('GET /api/candidates/:candidateId/contact-attempts returns all attempts newest first', async () => {
    const res = await request(app)
      .get(`/api/candidates/${testCandidate.id}/contact-attempts`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].attemptType).toBe('MORNING_FOLLOW_UP');
  });

  test('POST contact-attempts rejects invalid attemptType with HTTP 400', async () => {
    const res = await request(app)
      .post(`/api/candidates/${testCandidate.id}/contact-attempts`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ attemptType: 'INVALID_TYPE' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});
