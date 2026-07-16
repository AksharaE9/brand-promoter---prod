'use strict';
/**
 * Tests 1-4: Authentication & Authorization
 *
 * Test 1: Valid login with correct credentials returns a valid JWT
 * Test 2: Invalid credentials are rejected with 401, no token issued
 * Test 3: Role-scoped data access — HR sees all interviews, INTERVIEWER sees only assigned
 * Test 4: Expired/invalid token on protected route returns 401
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { FIXTURE } = require('../setup/seed');

// We import the app (not bootstrap) so we don't open a server port
let app;
beforeAll(() => {
  // Ensure DATABASE_URL points to test DB before loading app
  const { TEST_DB_URL } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  process.env.PORT = '0'; // random port — we use supertest
  app = require('../../src/app').app; // loads express app
});

// ── Helper ──────────────────────────────────────────────────────────────────
async function loginAs(email, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect('Content-Type', /json/);
  return res;
}

// ── Test 1 ──────────────────────────────────────────────────────────────────
test('Test 1: Valid login returns 200 with a valid JWT token', async () => {
  const res = await loginAs(FIXTURE.HR_EMAIL, FIXTURE.HR_PASSWORD);

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data).toHaveProperty('token');

  const token = res.body.data.token;
  expect(typeof token).toBe('string');

  // Token must be verifiable with the configured JWT secret
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  expect(decoded).toHaveProperty('userId');
  expect(decoded).toHaveProperty('role', 'RECRUITER');
});

// ── Test 2 ──────────────────────────────────────────────────────────────────
test('Test 2: Invalid credentials are rejected with 401 and no token is issued', async () => {
  const res = await loginAs(FIXTURE.HR_EMAIL, 'WrongPassword999!');

  expect(res.status).toBe(401);
  expect(res.body.success).toBeFalsy();
  // Ensure no token field leaks into the error response
  expect(res.body.data?.token).toBeUndefined();
  expect(res.body.token).toBeUndefined();
});

// ── Test 3 ──────────────────────────────────────────────────────────────────
test('Test 3: RECRUITER sees all org interviews; INTERVIEWER sees only their assigned interviews', async () => {
  // Login as HR
  const hrLogin = await loginAs(FIXTURE.HR_EMAIL, FIXTURE.HR_PASSWORD);
  const hrToken = hrLogin.body.data.token;

  // Login as Interviewer
  const ivLogin = await loginAs(FIXTURE.IV_EMAIL, FIXTURE.IV_PASSWORD);
  const ivToken = ivLogin.body.data.token;

  // HR should see all interviews for the org
  const hrRes = await request(app)
    .get('/api/interviews')
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  expect(hrRes.body.success).toBe(true);
  // HR should see at least the 4 seeded interviews
  expect(hrRes.body.data.length).toBeGreaterThanOrEqual(4);

  // INTERVIEWER GET — the API filters by interviewerId for INTERVIEWER role
  const ivRes = await request(app)
    .get('/api/interviews')
    .set('Authorization', `Bearer ${ivToken}`)
    .expect(200);

  expect(ivRes.body.success).toBe(true);
  // All returned interviews must have the interviewer's ID in interviewerIds
  const { prisma } = require('../setup/db');
  const ivUser = await prisma.user.findUnique({ where: { email: FIXTURE.IV_EMAIL } });
  const ivData = ivRes.body.data;
  ivData.forEach(interview => {
    const ids = Array.isArray(interview.interviewerIds)
      ? interview.interviewerIds
      : JSON.parse(interview.interviewerIds || '[]');
    expect(ids).toContain(ivUser.id);
  });
});

// ── Test 4 ──────────────────────────────────────────────────────────────────
test('Test 4: Expired or invalid token on a protected route returns 401', async () => {
  // Forge a token signed with a wrong secret → should be rejected
  const forgedToken = jwt.sign(
    { userId: 'fake-id', role: 'RECRUITER' },
    'wrong-secret',
    { expiresIn: '1h' }
  );

  const res = await request(app)
    .get('/api/interviews')
    .set('Authorization', `Bearer ${forgedToken}`);

  expect(res.status).toBe(401);
  expect(res.body.success).toBeFalsy();

  // Also test with an explicitly expired token
  const expiredToken = jwt.sign(
    { userId: 'fake-id', role: 'RECRUITER' },
    process.env.JWT_SECRET,
    { expiresIn: '-1s' } // already expired
  );

  const res2 = await request(app)
    .get('/api/interviews')
    .set('Authorization', `Bearer ${expiredToken}`);

  expect(res2.status).toBe(401);
  expect(res2.body.success).toBeFalsy();
  // Must not return a silent empty response — must have an error message
  expect(res2.body.error || res2.body.message).toBeTruthy();
});
