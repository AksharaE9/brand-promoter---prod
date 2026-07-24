'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let existingCandidate;

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

  // Create clean candidate for auto-linking test
  existingCandidate = await prisma.candidate.create({
    data: {
      fullName: 'Auto Link Feedback Candidate',
      email: 'autolink@test.ci',
      phone: '+919876543299',
      phoneNormalized: '+919876543299',
      organizationId: FIXTURE.ORG_ID,
      status: 'ACTIVE',
    },
  });
});

afterAll(async () => {
  const { prisma } = require('../setup/db');
  if (existingCandidate) {
    await prisma.interviewFeedback.deleteMany({
      where: {
        OR: [
          { candidateId: existingCandidate.id },
          { pendingLink: true },
        ],
      },
    });
    await prisma.candidate.deleteMany({ where: { id: existingCandidate.id } });
  }
});

describe('Bulk Feedback Upload & Candidate Phone Auto-Link Integration', () => {
  test('GET /api/interview-feedback/bulk-upload/template/download returns CSV template', async () => {
    const res = await request(app)
      .get('/api/interview-feedback/bulk-upload/template/download')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.header['content-type']).toContain('text/csv');
    expect(res.text).toContain('Round');
    expect(res.text).toContain('Name');
    expect(res.text).toContain('Number');
  });

  test('POST /api/interview-feedback/bulk-upload accepts file and processes matched and unmatched numbers', async () => {
    const csvContent = [
      'Round,Name,Number,Panelists,Role,Course,Family,College,Languages Known,Prior Experience / About It,Project(s),Location,Area,Overall Rating,DOJ,Timings,Duration,Selection Status,Comments',
      `Round 1,"Auto Link Feedback Candidate","+91 98765 43299","Alex Panel","Dev","B.Tech","","IIT","Eng","5 yrs","Proj A","BLR","Whitefield","8.5","2026-08-01","10 AM","60m","SELECTED","Good"`,
      `Round 2,"Unknown Candidate","+91 11111 22222","Panel B","Dev","","","","","","","BLR","","9.0","","","45m","SELECTED","Unmatched test"`,
    ].join('\n');

    const tempFilePath = path.join(__dirname, 'temp_test_feedback.csv');
    fs.writeFileSync(tempFilePath, csvContent, 'utf8');

    const res = await request(app)
      .post('/api/interview-feedback/bulk-upload')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', tempFilePath)
      .expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeDefined();

    const jobId = res.body.jobId;

    // Wait for background worker processing
    let status;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const statusRes = await request(app)
        .get(`/api/interview-feedback/bulk-upload/${jobId}`)
        .set('Authorization', `Bearer ${hrToken}`);
      if (statusRes.body?.data) {
        status = statusRes.body.data;
        if (status.state === 'completed' || status.state === 'failed') break;
      }
    }

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    expect(status?.state).toBe('completed');
    expect(status?.processed).toBe(2);
    expect(status?.succeeded).toBe(2);

    // Verify candidate auto-link in DB
    const { prisma } = require('../setup/db');
    const linkedFeedback = await prisma.interviewFeedback.findUnique({
      where: {
        candidateId_round: {
          candidateId: existingCandidate.id,
          round: 'ROUND_1',
        },
      },
    });

    expect(linkedFeedback).not.toBeNull();
    expect(linkedFeedback.candidateId).toBe(existingCandidate.id);
    expect(linkedFeedback.pendingLink).toBe(false);

    // Verify unmatched feedback record in DB
    const unlinkedFeedback = await prisma.interviewFeedback.findFirst({
      where: {
        pendingLink: true,
        round: 'ROUND_2',
      },
    });

    expect(unlinkedFeedback).not.toBeNull();
    expect(unlinkedFeedback.candidateId).toBeNull();
  });
});
