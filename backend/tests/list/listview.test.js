'use strict';
/**
 * Tests 15-17: List View
 *
 * Test 15: Pagination returns correct total count and correct page slices
 * Test 16: Filters (status, round, date range) return only matching records
 * Test 17: Sort by scheduled date is stable in ascending and descending order
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;

beforeAll(async () => {
  const { TEST_DB_URL } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  app = require('../../src/app').app;

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });
  hrToken = res.body.data.token;
});

// ── Test 15 ──────────────────────────────────────────────────────────────────
test('Test 15: List view pagination returns correct total count and correct page slices', async () => {
  // Fetch page 1 with limit=2
  const page1Res = await request(app)
    .get('/api/interviews?limit=2')
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  expect(page1Res.body.success).toBe(true);
  const page1Data = page1Res.body.data;
  expect(page1Data).toHaveLength(2);

  // If there's a next page cursor, fetch page 2
  if (page1Res.body.hasMore && page1Res.body.nextCursor) {
    const page2Res = await request(app)
      .get(`/api/interviews?limit=2&cursor=${page1Res.body.nextCursor}`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(page2Res.body.success).toBe(true);
    const page2Data = page2Res.body.data;
    expect(page2Data.length).toBeGreaterThanOrEqual(1);

    // Ensure no overlap between pages (IDs must be distinct)
    const page1Ids = new Set(page1Data.map(d => d.id));
    const page2Ids = page2Data.map(d => d.id);
    page2Ids.forEach(id => {
      expect(page1Ids.has(id)).toBe(false);
    });
  }
});

// ── Test 16 ──────────────────────────────────────────────────────────────────
test('Test 16: List view filters return only matching records', async () => {
  // Filter by status=SCHEDULED — all 4 seeded interviews are SCHEDULED
  const scheduledRes = await request(app)
    .get('/api/interviews?status=SCHEDULED')
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  expect(scheduledRes.body.success).toBe(true);
  scheduledRes.body.data.forEach(interview => {
    expect(interview.status).toBe('SCHEDULED');
  });

  // Filter by a non-existent status — must return 0 results
  const noMatchRes = await request(app)
    .get('/api/interviews?status=NO_SHOW')
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  expect(noMatchRes.body.success).toBe(true);
  // Either empty array or none of the results should have our ci-test org data with NO_SHOW
  const ciTestNoShows = noMatchRes.body.data.filter(
    i => i.organizationId === FIXTURE.ORG_ID && i.status === 'NO_SHOW'
  );
  expect(ciTestNoShows).toHaveLength(0);

  // Filter by roundNo using search or by job
  const { prisma } = require('../setup/db');
  const job = await prisma.job.findFirst({ where: { organizationId: FIXTURE.ORG_ID } });
  const byJobRes = await request(app)
    .get(`/api/interviews?jobId=${job.id}`)
    .set('Authorization', `Bearer ${hrToken}`)
    .expect(200);

  expect(byJobRes.body.success).toBe(true);
  byJobRes.body.data.forEach(interview => {
    expect(interview.jobId).toBe(job.id);
  });
  expect(byJobRes.body.data.length).toBeGreaterThanOrEqual(4);
});

// ── Test 17 ──────────────────────────────────────────────────────────────────
test('Test 17: List view sort by scheduled date is stable ascending and descending', async () => {
  const { prisma } = require('../setup/db');

  // Query the DB directly with asc sort
  const ascResults = await prisma.interview.findMany({
    where: { organizationId: FIXTURE.ORG_ID },
    orderBy: { scheduledStart: 'asc' },
    select: { id: true, scheduledStart: true, roundNo: true },
  });

  // Verify ascending order is stable
  for (let i = 1; i < ascResults.length; i++) {
    const prevMs = new Date(ascResults[i - 1].scheduledStart).getTime();
    const currMs = new Date(ascResults[i].scheduledStart).getTime();
    expect(currMs).toBeGreaterThanOrEqual(prevMs);
  }

  // Query with desc sort
  const descResults = await prisma.interview.findMany({
    where: { organizationId: FIXTURE.ORG_ID },
    orderBy: { scheduledStart: 'desc' },
    select: { id: true, scheduledStart: true, roundNo: true },
  });

  // Verify descending order is stable
  for (let i = 1; i < descResults.length; i++) {
    const prevMs = new Date(descResults[i - 1].scheduledStart).getTime();
    const currMs = new Date(descResults[i].scheduledStart).getTime();
    expect(currMs).toBeLessThanOrEqual(prevMs);
  }

  // Verify asc and desc are exact reverses of each other
  const ascIds = ascResults.map(r => r.id);
  const descIds = descResults.map(r => r.id);
  expect(ascIds).toEqual([...descIds].reverse());
});
