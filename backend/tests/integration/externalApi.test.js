'use strict';

/**
 * backend/tests/integration/externalApi.test.js
 *
 * Full integration test suite for TalentOS External API (v1).
 */

const request = require('supertest');
const { app } = require('../../src/app');
const prisma = require('../../src/config/db');
const {
  generateApiKey,
  revokeApiKey,
  verifyApiKey,
  hashApiKey,
  keyCache,
} = require('../../src/modules/ext/apiKeyService');

describe('TalentOS External API (v1) - Complete Test Suite', () => {
  let adminUser = null;
  let testKeyWithPii = null;
  let testKeyNoPii = null;
  let testKeyRestrictedScope = null;
  let testKeyExpired = null;
  let testCandidate = null;

  beforeAll(async () => {
    process.env.EXTERNAL_API_ENABLED = 'true';

    // Find or create admin user for test key generation
    adminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
    });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }

    // Create test candidate in DB
    testCandidate = await prisma.candidate.create({
      data: {
        fullName: 'ExtApi Test Candidate',
        email: 'extapi.test@example.com',
        phone: '+919988776655',
        phoneNormalized: '+919988776655',
        status: 'INTERVIEWING',
        preferredRole: 'Data Analyst Intern',
        organizationId: 'defaultOrg',
        customFields: { internalRecruiterNotes: 'TOP_SECRET_DO_NOT_LEAK' },
      }
    });

    // 1. Generate full test key with PII
    testKeyWithPii = await generateApiKey({
      name: 'Test Key With PII',
      scopes: ['candidates:read', 'candidates:read:pii', 'interviews:read', 'drives:read', 'jobs:read', 'team:read', 'stats:read'],
      environment: 'test',
      expiresInDays: 30,
      rateLimitPerMinute: 60,
      createdById: adminUser.id,
      orgId: 'defaultOrg',
    });

    // 2. Generate test key WITHOUT PII scope
    testKeyNoPii = await generateApiKey({
      name: 'Test Key No PII',
      scopes: ['candidates:read', 'interviews:read', 'drives:read', 'jobs:read'],
      environment: 'test',
      expiresInDays: 30,
      rateLimitPerMinute: 60,
      createdById: adminUser.id,
      orgId: 'defaultOrg',
    });

    // 3. Generate restricted key (only drives:read)
    testKeyRestrictedScope = await generateApiKey({
      name: 'Test Key Restricted',
      scopes: ['drives:read'],
      environment: 'test',
      expiresInDays: 30,
      rateLimitPerMinute: 60,
      createdById: adminUser.id,
      orgId: 'defaultOrg',
    });

    // 4. Generate expired key
    testKeyExpired = await generateApiKey({
      name: 'Test Key Expired',
      scopes: ['candidates:read'],
      environment: 'test',
      expiresInDays: -1, // Expired yesterday
      rateLimitPerMinute: 60,
      createdById: adminUser.id,
      orgId: 'defaultOrg',
    });
  });

  afterAll(async () => {
    // Cleanup generated keys and test candidate
    const keysToDelete = [
      testKeyWithPii?.apiKey?.id,
      testKeyNoPii?.apiKey?.id,
      testKeyRestrictedScope?.apiKey?.id,
      testKeyExpired?.apiKey?.id,
    ].filter(Boolean);

    if (keysToDelete.length > 0) {
      await prisma.apiKey.deleteMany({ where: { id: { in: keysToDelete } } }).catch(() => {});
    }

    if (testCandidate?.id) {
      await prisma.candidate.delete({ where: { id: testCandidate.id } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('Part 3 & 4: Security, Authentication & Key Lifecycle', () => {
    it('1. Public health check returns 200 without authentication', async () => {
      const res = await request(app).get('/api/v1/ext/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('2. Missing API key returns 401 API_KEY_MISSING', async () => {
      const res = await request(app).get('/api/v1/ext/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_MISSING');
      expect(res.body.error?.requestId).toBeDefined();
    });

    it('3. Garbage API key returns 401 API_KEY_INVALID', async () => {
      const res = await request(app)
        .get('/api/v1/ext/me')
        .set('Authorization', 'Bearer tos_test_badprefix_invalidrandombytes12345678');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_INVALID');
    });

    it('4. Expired API key returns 401 API_KEY_EXPIRED', async () => {
      const res = await request(app)
        .get('/api/v1/ext/me')
        .set('Authorization', `Bearer ${testKeyExpired.fullKey}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_EXPIRED');
    });

    it('5. Revoked API key returns 401 API_KEY_REVOKED immediately', async () => {
      // Create temporary key and revoke it
      const tempKey = await generateApiKey({
        name: 'Temp Revoke Test Key',
        scopes: ['candidates:read'],
        environment: 'test',
        createdById: adminUser.id,
      });

      // Call before revoke -> should pass
      const beforeRes = await request(app)
        .get('/api/v1/ext/me')
        .set('Authorization', `Bearer ${tempKey.fullKey}`);
      expect(beforeRes.status).toBe(200);

      // Revoke key
      await revokeApiKey(tempKey.apiKey.id, adminUser.id, 'Test revocation reason');

      // Call after revoke -> should fail with 401 API_KEY_REVOKED
      const afterRes = await request(app)
        .get('/api/v1/ext/me')
        .set('Authorization', `Bearer ${tempKey.fullKey}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.code).toBe('API_KEY_REVOKED');

      // Cleanup
      await prisma.apiKey.delete({ where: { id: tempKey.apiKey.id } }).catch(() => {});
    });

    it('6. Key in query parameter is strictly rejected with 400 INVALID_PARAMETER', async () => {
      const res = await request(app)
        .get(`/api/v1/ext/candidates?api_key=${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARAMETER');
    });

    it('7. Browser preflight OPTIONS is rejected with 403 CORS_NOT_ALLOWED', async () => {
      const res = await request(app)
        .options('/api/v1/ext/candidates')
        .set('Origin', 'https://malicious-browser-site.com')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CORS_NOT_ALLOWED');
    });

    it('8. Valid key introspection /me returns metadata and rate limit headers', async () => {
      const res = await request(app)
        .get('/api/v1/ext/me')
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Test Key With PII');
      expect(res.body.data.prefix).toBe(testKeyWithPii.apiKey.prefix);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });

  describe('Part 4 & 5: Scopes & PII Segregation', () => {
    it('9. Endpoint with missing scope returns 403 API_KEY_INSUFFICIENT_SCOPE', async () => {
      // testKeyRestrictedScope only has drives:read, requesting candidates -> 403
      const res = await request(app)
        .get('/api/v1/ext/candidates')
        .set('Authorization', `Bearer ${testKeyRestrictedScope.fullKey}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_KEY_INSUFFICIENT_SCOPE');
      expect(res.body.error?.requiredScope).toBe('candidates:read');
    });

    it('10. Key WITHOUT candidates:read:pii omits phone, email and resume link', async () => {
      const res = await request(app)
        .get(`/api/v1/ext/candidates/${testCandidate.id}`)
        .set('Authorization', `Bearer ${testKeyNoPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testCandidate.id);
      expect(res.body.data.phone).toBeUndefined();
      expect(res.body.data.email).toBeUndefined();
      expect(res.body.data.resumeDownloadUrl).toBeUndefined();
    });

    it('11. Key WITH candidates:read:pii includes phone and email', async () => {
      const res = await request(app)
        .get(`/api/v1/ext/candidates/${testCandidate.id}`)
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testCandidate.id);
      expect(res.body.data.phone).toBe('+919988776655');
      expect(res.body.data.email).toBe('extapi.test@example.com');
    });

    it('12. DTO Strictness: Internal customFields and password hashes never leak', async () => {
      const res = await request(app)
        .get(`/api/v1/ext/candidates/${testCandidate.id}`)
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      const rawText = JSON.stringify(res.body);
      expect(rawText).not.toContain('TOP_SECRET_DO_NOT_LEAK');
      expect(rawText).not.toContain('password');
      expect(rawText).not.toContain('phoneNormalized');
    });
  });

  describe('Part 5: Keyset Pagination & Endpoints', () => {
    it('13. Candidates list respects limit and produces opaque nextCursor', async () => {
      const res = await request(app)
        .get('/api/v1/ext/candidates?limit=2')
        .set('Authorization', `Bearer ${testKeyNoPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.page.limit).toBe(2);
    });

    it('14. Drives list returns drives with aggregate counts', async () => {
      const res = await request(app)
        .get('/api/v1/ext/drives')
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0].counts).toBeDefined();
        expect(typeof res.body.data[0].counts.totalEnrolled).toBe('number');
      }
    });

    it('15. Jobs list returns active jobs', async () => {
      const res = await request(app)
        .get('/api/v1/ext/jobs')
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('16. Incremental changes feed returns change list since timestamp', async () => {
      const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .get(`/api/v1/ext/changes?since=${sinceDate}`)
        .set('Authorization', `Bearer ${testKeyWithPii.fullKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.changes)).toBe(true);
    });
  });

  describe('Part 6: Feature Flag Isolation', () => {
    it('17. When EXTERNAL_API_ENABLED=false, /api/v1/ext/* returns 404', async () => {
      process.env.EXTERNAL_API_ENABLED = 'false';
      const res = await request(app).get('/api/v1/ext/health');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
      process.env.EXTERNAL_API_ENABLED = 'true';
    });
  });
});
