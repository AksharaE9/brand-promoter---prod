'use strict';

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

  // Log in as HR
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });
  hrToken = res.body.data.token;
});

test('Candidates list pagination returns nextCursor when limit is smaller than total rows', async () => {
  const { prisma } = require('../setup/db');
  const orgId = FIXTURE.ORG_ID;

  // Create 3 temporary candidates
  const candidatesData = [
    { fullName: 'Pag Candidate 1', email: 'pag1@test.ci', phone: '0000000001', organizationId: orgId, category: 'External' },
    { fullName: 'Pag Candidate 2', email: 'pag2@test.ci', phone: '0000000002', organizationId: orgId, category: 'External' },
    { fullName: 'Pag Candidate 3', email: 'pag3@test.ci', phone: '0000000003', organizationId: orgId, category: 'External' },
  ];

  const createdCandidates = [];
  for (const c of candidatesData) {
    const created = await prisma.candidate.create({ data: c });
    createdCandidates.push(created);
  }

  try {
    // Query with limit=2
    const res = await request(app)
      .get('/api/candidates?limit=2')
      .set('Authorization', `Bearer ${hrToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.rows.length).toBe(2);
    expect(res.body.nextCursor).not.toBeNull();
    expect(res.body.hasMore).toBe(true);
  } finally {
    // Clean up
    const ids = createdCandidates.map(c => c.id);
    await prisma.candidate.deleteMany({ where: { id: { in: ids } } });
  }
});

test('Interviews list pagination returns nextCursor when limit is smaller than total rows', async () => {
  const { prisma } = require('../setup/db');
  const orgId = FIXTURE.ORG_ID;

  // Create 3 temporary interviews (and a candidate + application to link to)
  const candidate = await prisma.candidate.create({
    data: { fullName: 'Pag Interview Candidate', email: 'pag-iv@test.ci', phone: '0000000009', organizationId: orgId, category: 'External' }
  });

  const job = await prisma.job.findFirst({ where: { organizationId: orgId } });

  const application = await prisma.application.create({
    data: { candidateId: candidate.id, jobId: job.id, status: 'APPLIED', organizationId: orgId }
  });

  const interviewsData = [
    { scheduledStart: new Date('2024-04-01T09:00:00Z'), roundNo: 1, round: 'R1', mode: 'VIRTUAL', applicationId: application.id, organizationId: orgId, candidateId: candidate.id, candidateName: candidate.fullName },
    { scheduledStart: new Date('2024-04-02T10:00:00Z'), roundNo: 2, round: 'R2', mode: 'VIRTUAL', applicationId: application.id, organizationId: orgId, candidateId: candidate.id, candidateName: candidate.fullName },
    { scheduledStart: new Date('2024-04-03T11:00:00Z'), roundNo: 3, round: 'R3', mode: 'VIRTUAL', applicationId: application.id, organizationId: orgId, candidateId: candidate.id, candidateName: candidate.fullName },
  ];

  const createdInterviews = [];
  for (const iv of interviewsData) {
    const created = await prisma.interview.create({ data: iv });
    createdInterviews.push(created);
  }

  try {
    // Query with limit=2
    const res = await request(app)
      .get('/api/interviews?limit=2')
      .set('Authorization', `Bearer ${hrToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.nextCursor).not.toBeNull();
    expect(res.body.hasMore).toBe(true);
  } finally {
    // Clean up
    const ivIds = createdInterviews.map(i => i.id);
    await prisma.interview.deleteMany({ where: { id: { in: ivIds } } });
    await prisma.application.delete({ where: { id: application.id } });
    await prisma.candidate.delete({ where: { id: candidate.id } });
  }
});

describe('Consolidated Pagination and Count Sync Regression Tests', () => {
  test('interview list pagination retrieves the full dataset matching DB truth and totalCount matches', async () => {
    const { prisma } = require('../setup/db');
    const orgId = FIXTURE.ORG_ID;

    // DB count of active interviews for this organization (matches the query builder logic)
    const dbCount = await prisma.interview.count({
      where: {
        organizationId: orgId,
        candidateId: { not: null },
        application: {
          candidate: {
            isDeleted: false
          }
        }
      }
    });

    let allRows = [];
    let cursor = null;
    let totalCountFromPage1 = null;

    do {
      const url = cursor
        ? `/api/interviews?limit=5&cursor=${cursor}`
        : `/api/interviews?limit=5`;

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200);

      if (cursor === null) {
        totalCountFromPage1 = res.body.totalCount;
      }

      allRows = allRows.concat(res.body.data);
      cursor = res.body.hasMore ? res.body.nextCursor : null;
    } while (cursor);

    // Verify all traversed rows match DB total count
    expect(allRows.length).toBe(dbCount);
    // Verify first page returned the correct totalCount
    expect(totalCountFromPage1).toBe(dbCount);
  });

  test('candidate list pagination retrieves the full dataset matching DB truth and total matches', async () => {
    const { prisma } = require('../setup/db');
    const orgId = FIXTURE.ORG_ID;

    const dbCount = await prisma.candidate.count({
      where: { organizationId: orgId, isDeleted: false }
    });

    let allRows = [];
    let cursor = null;
    let totalFromPage1 = null;

    do {
      const url = cursor
        ? `/api/candidates?limit=5&cursor=${cursor}`
        : `/api/candidates?limit=5`;

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200);

      if (cursor === null) {
        totalFromPage1 = res.body.pagination?.total;
      }

      allRows = allRows.concat(res.body.rows || res.body.data);
      cursor = res.body.hasMore ? res.body.nextCursor : null;
    } while (cursor);

    expect(allRows.length).toBe(dbCount);
    expect(totalFromPage1).toBe(dbCount);
  });

  test('scheduling members list matches DB truth', async () => {
    const { prisma } = require('../setup/db');

    const dbCount = await prisma.schedulingMember.count();

    const res = await request(app)
      .get('/api/scheduling/members')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(dbCount);
  });
});

