'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const request = require('supertest');
const { FIXTURE } = require('../setup/seed');

let app;
let hrToken;
let memberUser;
let memberToken;

beforeAll(async () => {
  const { TEST_DB_URL, prisma } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  ({ app } = require('../../src/app'));

  // HR Admin login
  const hrLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD })
    .expect(200);

  hrToken = hrLoginRes.body.data.token;

  // Create or fetch member user (INTERVIEWER role)
  memberUser = await prisma.user.findFirst({
    where: { email: FIXTURE.IV_EMAIL },
  });

  const ivLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.IV_EMAIL, password: FIXTURE.IV_PASSWORD })
    .expect(200);

  memberToken = ivLoginRes.body.data.token;
});

describe('Scheduling Section Integration Tests', () => {
  let createdMember;
  const testDate = '2026-07-22';

  test('GET /api/scheduling/members automatically seeds initial 4 members', async () => {
    const res = await request(app)
      .get('/api/scheduling/members')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const names = res.body.data.map((m) => m.name);
    expect(names).toContain('Madumathi');
    expect(names).toContain('Vinay');
    expect(names).toContain('Swanand');
    expect(names).toContain('Rishika');
  });

  test('POST /api/scheduling/members creates new member and links user', async () => {
    const res = await request(app)
      .post('/api/scheduling/members')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Test Telecaller',
        userId: memberUser.id,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Telecaller');
    expect(res.body.data.userId).toBe(memberUser.id);
    createdMember = res.body.data;
  });

  test('PATCH /api/scheduling/members/:id updates member status', async () => {
    const res = await request(app)
      .patch(`/api/scheduling/members/${createdMember.id}`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: 'Test Telecaller Updated' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Telecaller Updated');
  });

  test('POST /api/scheduling/members/:id/lead-list imports CSV lead sheet', async () => {
    const csvContent = 'Name,Phone Number,City\nAlice Smith,09876543210,Delhi\nBob Jones,+919876543211,Mumbai\n';

    const res = await request(app)
      .post(`/api/scheduling/members/${createdMember.id}/lead-list`)
      .set('Authorization', `Bearer ${hrToken}`)
      .field('listDate', testDate)
      .attach('file', Buffer.from(csvContent), 'leads.csv')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalLeads).toBe(2);
  });

  test('POST lead-list is idempotent — re-importing same date replaces list without duplication', async () => {
    const csvContentReimport = 'Name,Phone Number,City\nAlice Smith,09876543210,Delhi\nCharlie Brown,09123456789,Chennai\nDavid Lee,09876543299,Kolkata\n';

    const res = await request(app)
      .post(`/api/scheduling/members/${createdMember.id}/lead-list`)
      .set('Authorization', `Bearer ${hrToken}`)
      .field('listDate', testDate)
      .attach('file', Buffer.from(csvContentReimport), 'leads_v2.csv')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalLeads).toBe(3);
  });

  test('GET /api/scheduling/members/:id/lead-list/export downloads CSV lead sheet', async () => {
    const res = await request(app)
      .get(`/api/scheduling/members/${createdMember.id}/lead-list/export?date=${testDate}`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Alice Smith');
    expect(res.text).toContain('Charlie Brown');
  });

  test('GET /api/scheduling/my-list returns assigned lead list for member', async () => {
    const res = await request(app)
      .get(`/api/scheduling/my-list?date=${testDate}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.leads.length).toBe(3);
    expect(res.body.data.leads[0].leadData.phone).toBe('09876543210');
  });

  test('POST /api/scheduling/my-report submits work-done report with soft warning check', async () => {
    const res = await request(app)
      .post('/api/scheduling/my-report')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        callsDone: 3,
        callsDidntPick: 1,
        callsPicked: 2,
        scheduledEntries: 1,
        updatedInAts: 2,
        updatedInMail: 1,
        date: testDate,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.callsDone).toBe(3);
    expect(res.body.warning).toBeNull();
  });

  test('POST /api/scheduling/my-report includes soft warning when callsPicked + callsDidntPick != callsDone', async () => {
    const res = await request(app)
      .post('/api/scheduling/my-report')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        callsDone: 10,
        callsDidntPick: 2,
        callsPicked: 3, // 2 + 3 = 5 != 10
        scheduledEntries: 0,
        updatedInAts: 0,
        updatedInMail: 0,
        date: testDate,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.warning).toContain('Soft warning');
  });

  test('GET /api/scheduling/admin/overview returns today-status for all active members', async () => {
    const res = await request(app)
      .get(`/api/scheduling/admin/overview?date=${testDate}`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const targetMemberOverview = res.body.data.find((m) => m.memberId === createdMember.id);
    expect(targetMemberOverview).toBeDefined();
    expect(targetMemberOverview.listUploaded).toBe(true);
    expect(targetMemberOverview.totalLeads).toBe(3);
    expect(targetMemberOverview.reportSubmitted).toBe(true);
    expect(targetMemberOverview.callsDone).toBe(10);
  });
});
