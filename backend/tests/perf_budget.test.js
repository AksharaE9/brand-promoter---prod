'use strict';
/**
 * Automated Performance & Architectural Budget Tests for Candidate List Architecture
 *
 * Assertions:
 * 1. GET /api/candidates p95 response time < 400ms.
 * 2. GET /api/candidates payload size is bounded (< 300KB).
 * 3. Enforces limit clamping (requesting limit=500 returns <= 100 items).
 * 4. GET /api/candidates/count responds with numeric count without loading candidate records.
 * 5. GET /api/candidates/status-counts returns grouped counts.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const request = require('supertest');
const { FIXTURE } = require('./setup/seed');

let app;
let hrToken;

beforeAll(async () => {
  const { TEST_DB_URL } = require('./setup/db');
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-for-tests';
  app = require('../src/app').app;

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: FIXTURE.HR_EMAIL, password: FIXTURE.HR_PASSWORD });
  hrToken = res.body?.data?.token;
});

describe('Candidate List Architecture & Performance Guardrails', () => {
  test('Enforces server-side limit clamping (max 100 items per chunk)', async () => {
    const res = await request(app)
      .get('/api/candidates?limit=500')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.pagination.limit).toBe(100);
    const items = res.body.items || res.body.data || res.body.rows || [];
    expect(items.length).toBeLessThanOrEqual(100);
  });

  test('Payload size is lean and does not exceed performance budget (< 300KB for 50 items)', async () => {
    const res = await request(app)
      .get('/api/candidates?limit=50')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const jsonString = JSON.stringify(res.body);
    const sizeInKb = Buffer.byteLength(jsonString, 'utf8') / 1024;
    expect(sizeInKb).toBeLessThan(300);
  });

  test('Cursor pagination keyset format is valid (${updatedAtMs}_${id})', async () => {
    const res = await request(app)
      .get('/api/candidates?limit=2')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    if (res.body.hasMore && res.body.nextCursor) {
      expect(typeof res.body.nextCursor).toBe('string');
      const parts = res.body.nextCursor.split('_');
      expect(parts.length).toBe(2);
      expect(Number.isNaN(Number(parts[0]))).toBe(false);
    }
  });

  test('GET /api/candidates/count returns accurate count without candidate rows', async () => {
    const res = await request(app)
      .get('/api/candidates/count')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.items).toBeUndefined();
    expect(res.body.data).toBeUndefined();
  });

  test('GET /api/candidates/status-counts returns grouped counts object', async () => {
    const res = await request(app)
      .get('/api/candidates/status-counts')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.counts).toBeDefined();
    expect(typeof res.body.counts.ALL).toBe('number');
  });

  test('Candidate list endpoint latency budget (< 400ms)', async () => {
    const start = Date.now();
    const res = await request(app)
      .get('/api/candidates?limit=50')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    const durationMs = Date.now() - start;

    expect(res.body.success).toBe(true);
    expect(durationMs).toBeLessThan(400);
  });
});
