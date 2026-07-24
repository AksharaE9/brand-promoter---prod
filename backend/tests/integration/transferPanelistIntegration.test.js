'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let testCandidate;
let panelistUser;

beforeAll(async () => {
  const { TEST_DB_URL, prisma } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  ({ app } = require('../../src/app'));

  // Login HR user
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD })
    .expect(200);

  hrToken = loginRes.body.data.token;

  // Fetch existing interviewer/recruiter user for panelist transfer
  panelistUser = await prisma.user.findFirst({
    where: { role: { in: ['RECRUITER', 'INTERVIEWER'] } },
  });

  if (!panelistUser) {
    panelistUser = await prisma.user.create({
      data: {
        fullName: 'Panelist Transfer User',
        email: `panelist_${Date.now()}@example.com`,
        role: 'INTERVIEWER',
        organizationId: FIXTURE.ORG_ID,
      },
    });
  }

  // Create test candidate
  testCandidate = await prisma.candidate.create({
    data: {
      fullName: 'Transfer Test Candidate',
      email: `transfer_${Date.now()}@example.com`,
      phone: '+919876543211',
      organizationId: FIXTURE.ORG_ID,
    },
  });
});

afterAll(async () => {
  const { prisma } = require('../setup/db');
  if (testCandidate?.id) {
    await prisma.candidate.delete({ where: { id: testCandidate.id } });
  }
});

describe('Transfer Panelist Idempotency Integration Tests', () => {
  test('POST /api/candidates/:candidateId/transfer-panelist updates assigned recruiter', async () => {
    const res = await request(app)
      .post(`/api/candidates/${testCandidate.id}/transfer-panelist`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ panelistId: panelistUser.id })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.assignedRecruiterId).toBe(panelistUser.id);
  });

  test('POST transfer-panelist is idempotent — second identical call returns 200 without error', async () => {
    const res = await request(app)
      .post(`/api/candidates/${testCandidate.id}/transfer-panelist`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ panelistId: panelistUser.id })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('already assigned');
  });
});
