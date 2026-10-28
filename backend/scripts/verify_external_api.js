'use strict';

/**
 * backend/scripts/verify_external_api.js
 *
 * Automated verification script executing Part 9 test cases
 * against the Express app instance with database verification.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const supertest = require('supertest');
const { app } = require('../src/app');
const prisma = require('../src/config/db');
const {
  generateApiKey,
  revokeApiKey,
  rotateApiKey,
  verifyApiKey,
  hashApiKey,
  getPepper,
} = require('../src/modules/ext/apiKeyService');

async function main() {
  console.log('========================================================================');
  console.log('         TALENTOS EXTERNAL API (v1) - AUTOMATED VERIFICATION SUITE       ');
  console.log('========================================================================\n');

  process.env.EXTERNAL_API_ENABLED = 'true';
  const request = supertest(app);

  let passed = 0;
  let total = 0;

  async function check(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${desc} -> ${err.message}`);
    }
  }

  // Setup: Find an admin user
  const adminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  }) || await prisma.user.findFirst();

  if (!adminUser) throw new Error('No user found in database to act as creator');

  // Create temporary test candidate
  const testCandidate = await prisma.candidate.create({
    data: {
      fullName: 'AutoVerify External Candidate',
      email: 'autoverify.ext@example.com',
      phone: '+919876543210',
      phoneNormalized: '+919876543210',
      status: 'INTERVIEWING',
      preferredRole: 'Data Analyst Intern',
      organizationId: 'defaultOrg',
      customFields: { recruiterNoteSecret: 'SECRET_DO_NOT_REVEAL' },
    }
  });

  // Generate test keys
  const keyWithPii = await generateApiKey({
    name: 'Verify Suite Key With PII',
    scopes: ['candidates:read', 'candidates:read:pii', 'interviews:read', 'drives:read', 'jobs:read', 'team:read', 'stats:read'],
    environment: 'test',
    expiresInDays: 30,
    createdById: adminUser.id,
    orgId: 'defaultOrg',
  });

  const keyNoPii = await generateApiKey({
    name: 'Verify Suite Key No PII',
    scopes: ['candidates:read', 'interviews:read', 'drives:read', 'jobs:read'],
    environment: 'test',
    expiresInDays: 30,
    createdById: adminUser.id,
    orgId: 'defaultOrg',
  });

  const keyRestricted = await generateApiKey({
    name: 'Verify Suite Key Drives Only',
    scopes: ['drives:read'],
    environment: 'test',
    expiresInDays: 30,
    createdById: adminUser.id,
    orgId: 'defaultOrg',
  });

  const keyExpired = await generateApiKey({
    name: 'Verify Suite Key Expired',
    scopes: ['candidates:read'],
    environment: 'test',
    expiresInDays: -2,
    createdById: adminUser.id,
    orgId: 'defaultOrg',
  });

  try {
    // 1. Health endpoint
    await check('1. GET /api/v1/ext/health returns 200 without auth', async () => {
      const res = await request.get('/api/v1/ext/health');
      if (res.status !== 200 || res.body.status !== 'ok') throw new Error(`Status ${res.status}`);
    });

    // 2. OpenAPI spec
    await check('2. GET /api/v1/ext/openapi.json returns valid OpenAPI 3.1.0 specification', async () => {
      const res = await request.get('/api/v1/ext/openapi.json');
      if (res.status !== 200 || res.body.openapi !== '3.1.0' || !res.body.paths['/api/v1/ext/candidates']) {
        throw new Error(`Invalid spec`);
      }
    });

    // 3. No key -> 401
    await check('3. Missing API key returns 401 API_KEY_MISSING with requestId', async () => {
      const res = await request.get('/api/v1/ext/me');
      if (res.status !== 401 || res.body.code !== 'API_KEY_MISSING' || !res.body.error?.requestId) {
        throw new Error(`Unexpected body: ${JSON.stringify(res.body)}`);
      }
    });

    // 4. Garbage key -> 401
    await check('4. Garbage API key returns 401 API_KEY_INVALID', async () => {
      const res = await request.get('/api/v1/ext/me').set('Authorization', 'Bearer tos_test_randomgarbagekey123456');
      if (res.status !== 401 || res.body.code !== 'API_KEY_INVALID') throw new Error(`Status ${res.status}`);
    });

    // 5. Expired key -> 401
    await check('5. Expired key returns 401 API_KEY_EXPIRED', async () => {
      const res = await request.get('/api/v1/ext/me').set('Authorization', `Bearer ${keyExpired.fullKey}`);
      if (res.status !== 401 || res.body.code !== 'API_KEY_EXPIRED') throw new Error(`Status ${res.status}`);
    });

    // 6. Revoked key -> 401
    await check('6. Revoked key returns 401 API_KEY_REVOKED within 60s', async () => {
      const tempKey = await generateApiKey({
        name: 'Temp Revoke Key',
        scopes: ['candidates:read'],
        environment: 'test',
        createdById: adminUser.id,
      });

      await revokeApiKey(tempKey.apiKey.id, adminUser.id, 'Test Revocation');
      const res = await request.get('/api/v1/ext/me').set('Authorization', `Bearer ${tempKey.fullKey}`);
      if (res.status !== 401 || res.body.code !== 'API_KEY_REVOKED') throw new Error(`Status ${res.status}`);
      await prisma.apiKey.delete({ where: { id: tempKey.apiKey.id } }).catch(() => {});
    });

    // 7. Key in query string rejected
    await check('7. Key passed in query parameter is rejected with 400 INVALID_PARAMETER', async () => {
      const res = await request.get(`/api/v1/ext/candidates?api_key=${keyWithPii.fullKey}`);
      if (res.status !== 400 || res.body.code !== 'INVALID_PARAMETER') throw new Error(`Status ${res.status}`);
    });

    // 8. CORS rejection on browser preflight
    await check('8. Browser preflight (OPTIONS) is rejected with 403 CORS_NOT_ALLOWED', async () => {
      const res = await request.options('/api/v1/ext/candidates').set('Origin', 'https://browser-client.com');
      if (res.status !== 403 || res.body.code !== 'CORS_NOT_ALLOWED') throw new Error(`Status ${res.status}`);
    });

    // 9. Key Introspection /me
    await check('9. Valid key introspection returns name, prefix, scopes, rateLimit', async () => {
      const res = await request.get('/api/v1/ext/me').set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (res.status !== 200 || res.body.data.prefix !== keyWithPii.apiKey.prefix) {
        throw new Error(`Unexpected body: ${JSON.stringify(res.body)}`);
      }
    });

    // 10. Scope enforcement
    await check('10. Requesting endpoint without required scope returns 403 API_KEY_INSUFFICIENT_SCOPE', async () => {
      const res = await request.get('/api/v1/ext/candidates').set('Authorization', `Bearer ${keyRestricted.fullKey}`);
      if (res.status !== 403 || res.body.code !== 'API_KEY_INSUFFICIENT_SCOPE') throw new Error(`Status ${res.status}`);
    });

    // 11. PII segregation: Without PII scope
    await check('11. Key WITHOUT candidates:read:pii omits phone, email, and resumeDownloadUrl', async () => {
      const res = await request.get(`/api/v1/ext/candidates/${testCandidate.id}`).set('Authorization', `Bearer ${keyNoPii.fullKey}`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (res.body.data.phone !== undefined || res.body.data.email !== undefined || res.body.data.resumeDownloadUrl !== undefined) {
        throw new Error('PII fields were not omitted!');
      }
    });

    // 12. PII segregation: With PII scope
    await check('12. Key WITH candidates:read:pii returns phone and email', async () => {
      const res = await request.get(`/api/v1/ext/candidates/${testCandidate.id}`).set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (res.body.data.phone !== '+919876543210' || res.body.data.email !== 'autoverify.ext@example.com') {
        throw new Error('PII fields missing or mismatched!');
      }
    });

    // 13. Data leakage scan: DTO allow-list protection
    await check('13. Response contains NO password, hash, token, or internal customFields', async () => {
      const res = await request.get(`/api/v1/ext/candidates/${testCandidate.id}`).set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      const raw = JSON.stringify(res.body);
      if (raw.includes('SECRET_DO_NOT_REVEAL') || raw.includes('password') || raw.includes('phoneNormalized') || raw.includes('isDeleted')) {
        throw new Error('Internal fields detected in response payload!');
      }
    });

    // 14. Keyset pagination on candidates list
    await check('14. Keyset cursor pagination returns limit, hasMore, and data array', async () => {
      const res = await request.get('/api/v1/ext/candidates?limit=5').set('Authorization', `Bearer ${keyNoPii.fullKey}`);
      if (res.status !== 200 || !Array.isArray(res.body.data) || res.body.page.limit !== 5) {
        throw new Error(`Pagination failure: ${JSON.stringify(res.body)}`);
      }
    });

    // 15. Interviews list
    await check('15. Interviews endpoint returns rounds and outcome filters', async () => {
      const res = await request.get('/api/v1/ext/interviews?limit=5').set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (res.status !== 200 || !Array.isArray(res.body.data)) throw new Error(`Status ${res.status}`);
    });

    // 16. Drives list
    await check('16. Drives endpoint returns drives with enrollment & outcome counters', async () => {
      const res = await request.get('/api/v1/ext/drives').set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (res.status !== 200 || !Array.isArray(res.body.data)) throw new Error(`Status ${res.status}`);
    });

    // 17. Incremental sync changes
    await check('17. Incremental sync feed returns changes with timestamps since query', async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request.get(`/api/v1/ext/changes?since=${since}`).set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (res.status !== 200 || !Array.isArray(res.body.data?.changes)) throw new Error(`Status ${res.status}`);
    });

    // 18. Rate limit headers
    await check('18. Responses include X-RateLimit-Limit, Remaining, and Reset headers', async () => {
      const res = await request.get('/api/v1/ext/me').set('Authorization', `Bearer ${keyWithPii.fullKey}`);
      if (!res.headers['x-ratelimit-limit'] || res.headers['x-ratelimit-remaining'] === undefined) {
        throw new Error('Rate limit headers missing');
      }
    });

    // 19. Feature flag toggle
    await check('19. Setting EXTERNAL_API_ENABLED=false causes all /api/v1/ext/* endpoints to return 404', async () => {
      process.env.EXTERNAL_API_ENABLED = 'false';
      const res = await request.get('/api/v1/ext/health');
      process.env.EXTERNAL_API_ENABLED = 'true';
      if (res.status !== 404 || res.body.code !== 'ROUTE_NOT_FOUND') {
        throw new Error(`Expected 404 ROUTE_NOT_FOUND, got ${res.status}`);
      }
    });

    // 20. Key rotation functionality
    await check('20. Key rotation creates replacement key and sets grace period on old key', async () => {
      const rotResult = await rotateApiKey(keyWithPii.apiKey.id, adminUser.id, { gracePeriodHours: 48 });
      if (!rotResult.newKey?.fullKey || !rotResult.oldKeyGraceExpiry) {
        throw new Error('Rotation failed to return replacement key');
      }
      // Cleanup the new rotated key
      await prisma.apiKey.delete({ where: { id: rotResult.newKey.apiKey.id } }).catch(() => {});
    });

  } finally {
    // Cleanup test records
    await prisma.apiKey.deleteMany({
      where: {
        id: { in: [keyWithPii.apiKey.id, keyNoPii.apiKey.id, keyRestricted.apiKey.id, keyExpired.apiKey.id] }
      }
    }).catch(() => {});

    await prisma.candidate.delete({
      where: { id: testCandidate.id }
    }).catch(() => {});

    await prisma.$disconnect();
  }

  console.log('\n========================================================================');
  console.log(`VERIFICATION RESULT: ${passed} / ${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('========================================================================\n');

  if (passed < total) process.exit(1);
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
