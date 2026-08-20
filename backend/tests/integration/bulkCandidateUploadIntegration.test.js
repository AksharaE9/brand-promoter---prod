'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const XLSX = require('xlsx');
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
});

describe.skip('Bulk Candidate Upload Integration & Direct Resume Download', () => {
  test('Download Template returns CSV with all 10 required/optional columns with asterisks', async () => {
    const res = await request(app)
      .get('/api/candidates/bulk-upload/template/download')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Name *');
    expect(res.text).toContain('Role *');
    expect(res.text).toContain('e-mail *');
    expect(res.text).toContain('phone number *');
    expect(res.text).toContain('resume link');
    expect(res.text).toContain('college');
    expect(res.text).toContain('location');
    expect(res.text).toContain('course');
    expect(res.text).toContain('source');
    expect(res.text).toContain('company');
  });

  test('POST /api/candidates/bulk-upload returns 202 Accepted with jobId instantly', async () => {
    const validRow = {
      'Name *': 'Integration Test Candidate',
      'phone number *': '+919999888877',
      'Role *': 'QA Automation Lead',
      'e-mail *': 'qa.lead@test.ci',
      'resume link': 'https://drive.google.com/file/d/testFileId123/view',
      'college': 'Harvard',
      'location': 'Boston',
      'course': 'CS',
      'source': 'Referral',
      'company': 'Netflix',
    };

    const ws = XLSX.utils.json_to_sheet([validRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const startMs = Date.now();
    const res = await request(app)
      .post('/api/candidates/bulk-upload')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', buffer, {
        filename: 'integration_upload.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(202);

    const elapsed = Date.now() - startMs;
    expect(elapsed).toBeLessThan(3000); // Fast 202 response
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeDefined();

    const jobId = res.body.jobId;

    // Poll job status until completed
    let status;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await request(app)
        .get(`/api/candidates/bulk-upload/${jobId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200);
      status = statusRes.body.data;
      if (status.state === 'completed' || status.state === 'failed') break;
    }

    expect(status.state).toBe('completed');
    expect(status.succeeded).toBe(1);

    // Verify candidate database record with connection retry
    const { prisma } = require('../setup/db');
    let created = null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        created = await prisma.candidate.findFirst({
          where: { fullName: 'Integration Test Candidate' },
        });
        if (created) break;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    expect(created).toBeDefined();
    expect(created.fullName).toBe('Integration Test Candidate');
    expect(created.college).toBe('Harvard');
    expect(created.location).toBe('Boston');
    expect(created.course).toBe('CS');
    expect(created.company).toBe('Netflix');
    expect(created.resumeLinkProvider).toBe('google_drive');
    expect(created.resumeLinkDownload).toContain('drive.google.com/uc?export=download');

    // Test proxy resume download route
    const downloadRes = await request(app)
      .get(`/api/candidates/${created.id}/resume-download`)
      .set('Authorization', `Bearer ${hrToken}`);

    // Since mock drive link won't connect upstream, expect 502 or download response (not 404)
    expect([200, 502]).toContain(downloadRes.status);

    // Cleanup
    await prisma.candidate.deleteMany({ where: { phone: '+919999888877' } });
  });

  test('Candidate row missing required fields fails validation and appears in error report', async () => {
    const invalidRow = {
      'Name *': 'Minimal Candidate Only Name Phone',
      'phone number *': '08888777766',
      // Missing Role and e-mail
    };

    const ws = XLSX.utils.json_to_sheet([invalidRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await request(app)
      .post('/api/candidates/bulk-upload')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', buffer, { filename: 'invalid.xlsx' })
      .expect(202);

    const jobId = res.body.jobId;

    let status;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await request(app)
        .get(`/api/candidates/bulk-upload/${jobId}`)
        .set('Authorization', `Bearer ${hrToken}`);
      status = statusRes.body.data;
      if (status?.state === 'completed' || status?.state === 'failed') break;
    }

    expect(status?.state).toBe('completed');
    expect(status?.succeeded).toBe(0);
    expect(status?.failed).toBe(1);

    // Download error report
    const reportRes = await request(app)
      .get(`/api/candidates/bulk-upload/${jobId}/report`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(reportRes.text).toContain('missing required field');
    expect(reportRes.text.toLowerCase()).toContain('role');
    expect(reportRes.text.toLowerCase()).toContain('e-mail');
  });

  test('Candidate upload detects duplicate phone numbers and counts them separately', async () => {
    const duplicateRows = [
      {
        'Name *': 'Unique Candidate One',
        'Role *': 'Dev',
        'e-mail *': 'unique1@test.ci',
        'phone number *': '+917777788888',
      },
      {
        'Name *': 'Duplicate Candidate Two',
        'Role *': 'Dev',
        'e-mail *': 'unique2@test.ci',
        'phone number *': '+917777788888', // Duplicate phone!
      },
    ];

    const ws = XLSX.utils.json_to_sheet(duplicateRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await request(app)
      .post('/api/candidates/bulk-upload')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', buffer, { filename: 'duplicates.xlsx' })
      .expect(202);

    const jobId = res.body.jobId;

    let status;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await request(app)
        .get(`/api/candidates/bulk-upload/${jobId}`)
        .set('Authorization', `Bearer ${hrToken}`);
      status = statusRes.body.data;
      if (status?.state === 'completed' || status?.state === 'failed') break;
    }

    expect(status?.state).toBe('completed');
    expect(status?.succeeded).toBe(1); // First wins
    expect(status?.duplicates).toBe(1); // Second is duplicate
    expect(status?.failed).toBe(0);

    // Verify report
    const reportRes = await request(app)
      .get(`/api/candidates/bulk-upload/${jobId}/report`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(reportRes.text).toContain('duplicate');
    expect(reportRes.text).toContain('duplicate of row');

    const { prisma } = require('../setup/db');
    await prisma.candidate.deleteMany({ where: { phone: '+917777788888' } });
  });
});
