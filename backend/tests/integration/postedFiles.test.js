'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { FIXTURE } = require('../setup/seed');
const { prisma } = require('../setup/db');

let app;
let nonAdminToken;
let adminToken;
let adminUser;
let testFilesToCleanup = [];

beforeAll(async () => {
  const { TEST_DB_URL } = require('../setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  app = require('../../src/app').app;

  // 1. Get standard Recruiter (Non-Admin) token
  const hrRes = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });
  nonAdminToken = hrRes.body.data.token;

  // 2. Seed a SUPER_ADMIN user in the test database for testing Admin-only deletion
  const adminEmail = `admin_test_${Date.now()}@test.ci`;
  const adminPassword = 'AdminPassword123!';
  const hash = await bcrypt.hash(adminPassword, 10);

  adminUser = await prisma.user.create({
    data: {
      fullName: 'CI Test Admin',
      email: adminEmail,
      passwordHash: hash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      organizationId: FIXTURE.ORG_ID
    }
  });

  // Log in as admin to get admin token
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: adminEmail, password: adminPassword });
  adminToken = adminRes.body.data.token;
});

function parseCloudinaryUrl(url) {
  const match = url.match(/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (match) {
    const resourceType = match[1];
    let publicId = match[2];
    if (resourceType !== 'raw') {
      publicId = publicId.replace(/\.[^/.]+$/, "");
    }
    return { resourceType, publicId };
  }
  return null;
}

afterAll(async () => {
  // Clean up physical files from Cloudinary first
  if (testFilesToCleanup.length > 0) {
    try {
      const files = await prisma.postedFile.findMany({
        where: { id: { in: testFilesToCleanup } }
      });
      const cloudinary = require('../../src/config/cloudinary');
      for (const file of files) {
        if (file.storageKey.startsWith('http')) {
          const parsed = parseCloudinaryUrl(file.storageKey);
          if (parsed) {
            await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
          }
        }
      }
    } catch (err) {
      console.warn('[Test Cleanup] Failed to delete test files from Cloudinary:', err.message);
    }
  }

  // Clean up the test admin user
  if (adminUser) {
    await prisma.session.deleteMany({ where: { userId: adminUser.id } });
    await prisma.postedFile.deleteMany({ where: { uploadedById: adminUser.id } });
    await prisma.user.delete({ where: { id: adminUser.id } });
  }

  // Clean up any lingering posted files from the test DB
  if (testFilesToCleanup.length > 0) {
    await prisma.postedFile.deleteMany({
      where: { id: { in: testFilesToCleanup } }
    });
  }
});

describe('Posted Files Integration Tests', () => {
  test('Upload an allowed file type (.xlsx) as non-admin - should succeed', async () => {
    // Generate valid zip/office magic bytes (PK..)
    const buffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x0a, 0x0b, 0x0c]);

    const res = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'test_sheet.xlsx');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBe('test_sheet.xlsx');
    expect(res.body.data.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    testFilesToCleanup.push(res.body.data.id);
  });

  test('Reject explicitly blocked file type (.exe) - should return 400', async () => {
    // Binary EXE header magic bytes (MZ..)
    const buffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00]);

    const res = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'malicious_program.exe');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Unsupported file extension');
  });

  test('Reject extension-spoofed file (plain text renamed to .xlsx) - should return 400', async () => {
    // Plain text content, doesn't start with Zip header
    const buffer = Buffer.from('Plain text content that is not a valid zip file structure.');

    const res = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'spoofed_sheet.xlsx');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Expected ZIP/Office XML');
  });

  test('Reject file exceeding size cap (50 MB) - should return 413', async () => {
    // Create a large buffer (51 MB)
    const size = 51 * 1024 * 1024;
    const buffer = Buffer.alloc(size);

    const res = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'too_large.zip');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('exceeds the 50 MB limit');
  });

  test('Load posted files list with pagination parameters', async () => {
    const res = await request(app)
      .get('/api/posted-files?limit=5')
      .set('Authorization', `Bearer ${nonAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.limit).toBe(5);
  });

  test('Bypassing UI: Directly call delete API endpoint as non-admin - should be rejected with 403', async () => {
    // 1. Upload a file first
    const buffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
    const uploadRes = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'doc_to_delete.docx');

    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.data.id;
    testFilesToCleanup.push(fileId);

    // 2. Attempt to delete as non-admin (Recruiter role)
    const deleteRes = await request(app)
      .delete(`/api/posted-files/${fileId}`)
      .set('Authorization', `Bearer ${nonAdminToken}`);

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.success).toBe(false);

    // Verify it still exists in the DB
    const dbRecord = await prisma.postedFile.findUnique({ where: { id: fileId } });
    expect(dbRecord).not.toBeNull();
  });

  test('Delete a posted file as Admin - should succeed and remove from DB', async () => {
    // 1. Upload a file
    const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const uploadRes = await request(app)
      .post('/api/posted-files')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .attach('file', buffer, 'admin_delete_test.pdf');

    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.data.id;

    // 2. Delete as admin (SUPER_ADMIN role)
    const deleteRes = await request(app)
      .delete(`/api/posted-files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // 3. Confirm it's completely gone from database
    const dbRecord = await prisma.postedFile.findUnique({ where: { id: fileId } });
    expect(dbRecord).toBeNull();
  });
});
