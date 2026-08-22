'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const { FIXTURE } = require('../setup/seed');
const { prisma } = require('../setup/db');

let app;
let adminToken;
let testUser;
let testMember;

beforeAll(async () => {
  const { TEST_DB_URL } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  app = require('../../src/app').app;

  // Log in as admin
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.ADMIN_EMAIL, password: FIXTURE.ADMIN_PASSWORD });
  adminToken = loginRes.body.data.token;
});

beforeEach(async () => {
  // Clean up any existing test user/member to start fresh
  await prisma.schedulingMember.deleteMany({
    where: { name: 'Deactivate Sync Test Member' }
  });
  await prisma.user.deleteMany({
    where: { email: 'deactivatesynctest@ats.local' }
  });

  // Create a User
  testUser = await prisma.user.create({
    data: {
      fullName: 'Deactivate Sync Test User',
      email: 'deactivatesynctest@ats.local',
      role: 'RECRUITER',
      status: 'ACTIVE',
      isActive: true,
      organizationId: FIXTURE.ORG_ID,
    }
  });

  // Create a SchedulingMember linked to the User
  testMember = await prisma.schedulingMember.create({
    data: {
      name: 'Deactivate Sync Test Member',
      userId: testUser.id,
      active: true,
    }
  });
});

afterEach(async () => {
  // Cleanup
  await prisma.schedulingMember.deleteMany({
    where: { id: testMember.id }
  }).catch(() => {});
  await prisma.user.deleteMany({
    where: { id: testUser.id }
  }).catch(() => {});
});

describe('User <-> SchedulingMember Status/Deletion Sync Tests', () => {

  test('Deactivating User on Team Page deactivates linked SchedulingMember', async () => {
    // Call PATCH /api/team/members/:userId
    const res = await request(app)
      .patch(`/api/team/members/${testUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE', isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check user in DB
    const userInDb = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(userInDb.status).toBe('INACTIVE');
    expect(userInDb.isActive).toBe(false);

    // Check scheduling member in DB
    const memberInDb = await prisma.schedulingMember.findUnique({ where: { id: testMember.id } });
    expect(memberInDb.active).toBe(false);
  });

  test('Soft-deleting User on Team Page deactivates linked SchedulingMember', async () => {
    // Call DELETE /api/team/members/:userId
    const res = await request(app)
      .delete(`/api/team/members/${testUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check user in DB
    const userInDb = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(userInDb.isDeleted).toBe(true);
    expect(userInDb.isActive).toBe(false);

    // Check scheduling member in DB
    const memberInDb = await prisma.schedulingMember.findUnique({ where: { id: testMember.id } });
    expect(memberInDb.active).toBe(false);
  });

  test('Restoring User on Team Page reactivates linked SchedulingMember', async () => {
    // Set user to deleted and member to inactive first
    await prisma.user.update({
      where: { id: testUser.id },
      data: { isDeleted: true, isActive: false, status: 'INACTIVE' }
    });
    await prisma.schedulingMember.update({
      where: { id: testMember.id },
      data: { active: false }
    });

    // Call PATCH /api/team/members/:userId/restore
    const res = await request(app)
      .patch(`/api/team/members/${testUser.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check user in DB
    const userInDb = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(userInDb.isDeleted).toBe(false);
    expect(userInDb.status).toBe('ACTIVE');
    expect(userInDb.isActive).toBe(true);

    // Check scheduling member in DB
    const memberInDb = await prisma.schedulingMember.findUnique({ where: { id: testMember.id } });
    expect(memberInDb.active).toBe(true);
  });

  test('Deactivating SchedulingMember in Modal deactivates linked User', async () => {
    // Call PATCH /api/scheduling/members/:memberId
    const res = await request(app)
      .patch(`/api/scheduling/members/${testMember.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check scheduling member in DB
    const memberInDb = await prisma.schedulingMember.findUnique({ where: { id: testMember.id } });
    expect(memberInDb.active).toBe(false);

    // Check user in DB
    const userInDb = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(userInDb.status).toBe('INACTIVE');
    expect(userInDb.isActive).toBe(false);
  });

  test('Deleting SchedulingMember in Modal soft-deletes linked User', async () => {
    // Call DELETE /api/scheduling/members/:memberId
    const res = await request(app)
      .delete(`/api/scheduling/members/${testMember.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check scheduling member is deleted
    const memberInDb = await prisma.schedulingMember.findUnique({ where: { id: testMember.id } });
    expect(memberInDb).toBeNull();

    // Check user is soft-deleted
    const userInDb = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(userInDb.isDeleted).toBe(true);
    expect(userInDb.status).toBe('INACTIVE');
    expect(userInDb.isActive).toBe(false);
  });
});
