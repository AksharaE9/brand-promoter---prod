'use strict';
const request = require('supertest');
const { app } = require('../../src/app');
const { prisma } = require('../setup/db');
const bcrypt = require('bcryptjs');

describe('Change Password Integration Tests', () => {
  let userToken;
  let testUser;

  beforeAll(async () => {
    // Create a temporary user
    const passwordHash = await bcrypt.hash('TestPassword123!', 12);
    testUser = await prisma.user.create({
      data: {
        fullName: 'Change Password QA User',
        email: 'change-pw-qa@test.ci',
        passwordHash,
        role: 'RECRUITER',
        status: 'ACTIVE',
        organizationId: 'ci-test-org',
      },
    });

    // Login to get token
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'change-pw-qa@test.ci',
        password: 'TestPassword123!',
      })
      .expect(200);

    userToken = res.body.data.token;
  });

  afterAll(async () => {
    // Cleanup user and sessions
    await prisma.session.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  test('POST /api/users/me/change-password changes password successfully and invalidates other sessions', async () => {
    // 1. Create a dummy session for the user simulating another device
    const anotherSession = await prisma.session.create({
      data: {
        userId: testUser.id,
        device: 'Other Device',
        ipAddress: '127.0.0.1',
      },
    });

    // 2. Change password
    await request(app)
      .post('/api/users/me/change-password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewValidPassword123!',
      })
      .expect(204);

    // 3. Assert other sessions are deleted
    const dummyExists = await prisma.session.findUnique({
      where: { id: anotherSession.id }
    });
    expect(dummyExists).toBeNull();

    // 4. Try logging in with the old password — should fail
    await request(app)
      .post('/api/auth/login')
      .send({
        email: 'change-pw-qa@test.ci',
        password: 'TestPassword123!',
      })
      .expect(401);

    // 5. Try logging in with the new password — should succeed
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'change-pw-qa@test.ci',
        password: 'NewValidPassword123!',
      })
      .expect(200);

    expect(loginRes.body.data.token).toBeDefined();
  });

  test('POST /api/users/me/change-password returns 401 on incorrect current password', async () => {
    await request(app)
      .post('/api/users/me/change-password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        currentPassword: 'WrongPassword123!',
        newPassword: 'NewValidPassword123!',
      })
      .expect(401)
      .then((res) => {
        expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      });
  });

  test('POST /api/users/me/change-password returns 422 on weak password', async () => {
    await request(app)
      .post('/api/users/me/change-password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        currentPassword: 'NewValidPassword123!',
        newPassword: 'weak',
      })
      .expect(422)
      .then((res) => {
        expect(res.body.code).toBe('WEAK_PASSWORD');
        expect(Array.isArray(res.body.details)).toBe(true);
      });
  });

  test('POST /api/users/me/change-password returns 422 on unchanged password', async () => {
    await request(app)
      .post('/api/users/me/change-password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        currentPassword: 'NewValidPassword123!',
        newPassword: 'NewValidPassword123!',
      })
      .expect(422)
      .then((res) => {
        expect(res.body.code).toBe('PASSWORD_UNCHANGED');
      });
  });
});
