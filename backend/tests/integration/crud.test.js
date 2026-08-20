'use strict';
/**
 * Tests 5-9: Candidate & Interview CRUD
 *
 * Test 5: Creating a candidate persists all required fields to Postgres
 * Test 6: Creating an interview links correctly to an existing candidate ID
 * Test 7: Updating interview status persists and reflects in list view query
 * Test 8: Cancelling an interview does NOT hard-delete the candidate record
 * Test 9: Duplicate interview (same candidate + same round) is blocked with 409
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let seedData;

beforeAll(async () => {
  const { TEST_DB_URL } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  app = require('../../src/app').app;

  // Log in as HR
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });
  hrToken = res.body.data.token;

  // Load seeded references
  const { prisma } = require('../setup/db');
  const candidate = await prisma.candidate.findFirst({
    where: { email: FIXTURE.CANDIDATE_EMAIL },
  });
  const application = await prisma.application.findFirst({
    where: { candidateId: candidate.id },
  });
  const job = await prisma.job.findFirst({ where: { organizationId: FIXTURE.ORG_ID } });
  const ivUser = await prisma.user.findUnique({ where: { email: FIXTURE.IV_EMAIL } });
  seedData = { candidate, application, job, ivUser };
});

// ── Test 5 ──────────────────────────────────────────────────────────────────
test('Test 5: Creating a new candidate persists all required fields to Postgres', async () => {
  const candidatePayload = {
    fullName:      'CRUD Test Candidate',
    email:         'crud-test@test.ci',
    phone:         '8888888888',
    preferredRole: 'Software Engineer',
    source:        'LinkedIn',
    organizationId: FIXTURE.ORG_ID,
    resumeLinkOriginal: 'https://example.com/resume.pdf',
  };

  const res = await request(app)
    .post('/api/candidates')
    .set('Authorization', `Bearer ${hrToken}`)
    .send(candidatePayload);

  expect([200, 201]).toContain(res.status);
  expect(res.body.success).toBe(true);

  const created = res.body.data;
  expect(created.fullName).toBe('CRUD Test Candidate');
  expect(created.email).toBe('crud-test@test.ci');
  expect(created.phone).toBe('8888888888');
  expect(created.preferredRole).toBe('Software Engineer');
  expect(created.id).toBeTruthy();

  // Verify it's actually in Postgres
  const { prisma } = require('../setup/db');
  const fromDb = await prisma.candidate.findUnique({ where: { id: created.id } });
  expect(fromDb).not.toBeNull();
  expect(fromDb.fullName).toBe('CRUD Test Candidate');
  expect(fromDb.email).toBe('crud-test@test.ci');

  // Cleanup
  await prisma.candidate.delete({ where: { id: created.id } });
});

// ── Test 6 ──────────────────────────────────────────────────────────────────
test('Test 6: Creating an interview links correctly to existing candidate ID (no orphaned records)', async () => {
  const { application, ivUser } = seedData;

  // Create a new round (Round 5) so it doesn't conflict with seed rounds 1-4
  const payload = {
    applicationId:  application.id,
    interviewerIds: [ivUser.id],
    scheduledStart: new Date('2024-04-01T05:30:00.000Z').toISOString(), // 11:00 AM IST
    mode:           'VIRTUAL',
    roundNo:        5,
    round:          'Round 5',
    candidateName:  'CI Test Candidate',
  };

  const res = await request(app)
    .post('/api/interviews')
    .set('Authorization', `Bearer ${hrToken}`)
    .send(payload);

  expect([200, 201]).toContain(res.status);
  expect(res.body.success).toBe(true);

  const interviewId = res.body.data?.id;
  expect(interviewId).toBeTruthy();

  // Verify DB link — interview must reference the correct applicationId
  const { prisma } = require('../setup/db');
  const fromDb = await prisma.interview.findUnique({ where: { id: interviewId } });
  expect(fromDb).not.toBeNull();
  expect(fromDb.applicationId).toBe(application.id);

  // The application's candidate must still exist (no orphan)
  const candidateExists = await prisma.candidate.findFirst({
    where: { id: fromDb.candidateId, isDeleted: false },
  });
  expect(candidateExists).not.toBeNull();

  // Cleanup
  await prisma.interview.delete({ where: { id: interviewId } });
});

// ── Test 7 ──────────────────────────────────────────────────────────────────
test('Test 7: Updating interview status persists and is immediately reflected in list view query', async () => {
  const { prisma } = require('../setup/db');

  // Find the Round 1 interview from seed data
  const iv = await prisma.interview.findFirst({
    where: { organizationId: FIXTURE.ORG_ID, roundNo: 1 },
  });
  expect(iv).not.toBeNull();

  // Update status to COMPLETED via API
  const updateRes = await request(app)
    .patch(`/api/interviews/${iv.id}`)
    .set('Authorization', `Bearer ${hrToken}`)
    .send({ status: 'COMPLETED', result: 'SELECTED' });

  expect([200, 201]).toContain(updateRes.status);

  // Verify the status persisted in DB
  const updated = await prisma.interview.findUnique({ where: { id: iv.id } });
  expect(updated.status).toBe('COMPLETED');

  // Verify it appears in the list view query with the new status
  const listRes = await request(app)
    .get(`/api/interviews?status=COMPLETED`)
    .set('Authorization', `Bearer ${hrToken}`);

  expect(listRes.status).toBe(200);
  const matchingInList = listRes.body.data.find(i => i.id === iv.id);
  expect(matchingInList).toBeDefined();
  expect(matchingInList.status).toBe('COMPLETED');

  // Restore to SCHEDULED for other tests
  await prisma.interview.update({ where: { id: iv.id }, data: { status: 'SCHEDULED', result: null } });
});

// ── Test 8 ──────────────────────────────────────────────────────────────────
test('Test 8: Cancelling an interview does not hard-delete the candidate record', async () => {
  const { prisma } = require('../setup/db');

  // Get round 2 interview from seed
  const iv = await prisma.interview.findFirst({
    where: { organizationId: FIXTURE.ORG_ID, roundNo: 2 },
  });
  const candidateId = iv.candidateId;

  // Cancel the interview
  const cancelRes = await request(app)
    .patch(`/api/interviews/${iv.id}`)
    .set('Authorization', `Bearer ${hrToken}`)
    .send({ status: 'CANCELLED' });

  expect([200, 201]).toContain(cancelRes.status);

  // Candidate must still exist in DB and NOT be deleted
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  expect(candidate).not.toBeNull();
  expect(candidate.isDeleted).toBe(false);

  // Restore interview status
  await prisma.interview.update({ where: { id: iv.id }, data: { status: 'SCHEDULED' } });
});

// ── Test 9 ──────────────────────────────────────────────────────────────────
test('Test 9: Duplicate interview creation (same candidate + same round) is blocked with 409', async () => {
  const { application, ivUser } = seedData;

  // Round 1 already exists in seed data — try to create it again
  const duplicatePayload = {
    applicationId:  application.id,
    interviewerIds: [ivUser.id],
    scheduledStart: new Date('2024-03-15T05:00:00.000Z').toISOString(),
    mode:           'VIRTUAL',
    roundNo:        1, // Round 1 already exists — should be blocked
    round:          'Round 1',
    candidateName:  'CI Test Candidate',
  };

  const res = await request(app)
    .post('/api/interviews')
    .set('Authorization', `Bearer ${hrToken}`)
    .send(duplicatePayload);

  // The API returns 409 Conflict for duplicate rounds (see routes.js L264-267)
  expect(res.status).toBe(409);
  expect(res.body.success).toBeFalsy();
  expect(res.body.error || res.body.message).toMatch(/duplicate|already scheduled/i);
});
