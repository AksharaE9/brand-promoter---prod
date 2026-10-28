'use strict';

/**
 * backend/scripts/api-smoke.js
 *
 * End-to-end smoke test script for TalentOS External API.
 * Usage:
 *   node scripts/api-smoke.js <BASE_URL> <API_KEY>
 * Example:
 *   node scripts/api-smoke.js http://localhost:4000 tos_live_...
 */

const https = require('https');
const http = require('http');

const baseUrl = process.argv[2] || process.env.BASE_URL || 'http://localhost:4000';
const apiKey = process.argv[3] || process.env.API_KEY;

function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const client = url.protocol === 'https:' ? https : http;

    const reqHeaders = {
      'User-Agent': 'TalentOS-SmokeTest/1.0',
      'Accept': 'application/json',
      ...headers,
    };

    const start = Date.now();
    const req = client.request(url, { method, headers: reqHeaders }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const latency = Date.now() - start;
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json, latency });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runSmokeTests() {
  console.log('========================================================================');
  console.log('                 TALENTOS EXTERNAL API SMOKE TEST                       ');
  console.log('========================================================================');
  console.log(`Target URL: ${baseUrl}`);
  console.log(`API Key:    ${apiKey ? apiKey.slice(0, 16) + '...' : '(none provided)'}\n`);

  let totalTests = 0;
  let passedTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] ${name} — ${err.message}`);
    }
  }

  // 1. Health check (No auth)
  await test('GET /api/v1/ext/health (No auth required)', async () => {
    const res = await request('GET', '/api/v1/ext/health');
    if (res.status !== 200 || res.body.status !== 'ok') {
      throw new Error(`Expected 200 ok, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // 2. OpenAPI Spec (No auth)
  await test('GET /api/v1/ext/openapi.json (OpenAPI 3.1 Spec)', async () => {
    const res = await request('GET', '/api/v1/ext/openapi.json');
    if (res.status !== 200 || !res.body.openapi || !res.body.paths) {
      throw new Error(`Expected 200 with OpenAPI paths, got ${res.status}`);
    }
  });

  // 3. Missing API Key check
  await test('GET /api/v1/ext/me without key -> 401 API_KEY_MISSING', async () => {
    const res = await request('GET', '/api/v1/ext/me');
    if (res.status !== 401 || res.body.code !== 'API_KEY_MISSING') {
      throw new Error(`Expected 401 API_KEY_MISSING, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // 4. Invalid Garbage Key check
  await test('GET /api/v1/ext/me with invalid key -> 401 API_KEY_INVALID', async () => {
    const res = await request('GET', '/api/v1/ext/me', { 'Authorization': 'Bearer tos_live_invalid12_fakekey1234567890' });
    if (res.status !== 401 || res.body.code !== 'API_KEY_INVALID') {
      throw new Error(`Expected 401 API_KEY_INVALID, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // 5. Query parameter key rejection check
  await test('GET /api/v1/ext/candidates?api_key=... -> 400 INVALID_PARAMETER', async () => {
    const res = await request('GET', '/api/v1/ext/candidates?api_key=tos_live_12345');
    if (res.status !== 400 || res.body.code !== 'INVALID_PARAMETER') {
      throw new Error(`Expected 400 INVALID_PARAMETER, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // Authenticated tests if key provided
  if (apiKey) {
    const authHeaders = { 'Authorization': `Bearer ${apiKey}` };

    // 6. Key Introspection /me
    await test('GET /api/v1/ext/me with valid key', async () => {
      const res = await request('GET', '/api/v1/ext/me', authHeaders);
      if (res.status !== 200 || !res.body.data?.prefix) {
        throw new Error(`Expected 200 with key data, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Key Name: "${res.body.data.name}", Prefix: ${res.body.data.prefix}, Scopes: [${res.body.data.scopes.join(', ')}]`);
    });

    // 7. Candidates List
    await test('GET /api/v1/ext/candidates (limit=5)', async () => {
      const res = await request('GET', '/api/v1/ext/candidates?limit=5', authHeaders);
      if (res.status !== 200 || !Array.isArray(res.body.data)) {
        throw new Error(`Expected 200 with data array, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Retrieved ${res.body.data.length} candidates (hasMore: ${res.body.page?.hasMore})`);
    });

    // 8. Interviews List
    await test('GET /api/v1/ext/interviews (limit=5)', async () => {
      const res = await request('GET', '/api/v1/ext/interviews?limit=5', authHeaders);
      if (res.status !== 200 || !Array.isArray(res.body.data)) {
        throw new Error(`Expected 200 with data array, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Retrieved ${res.body.data.length} interviews`);
    });

    // 9. Drives List
    await test('GET /api/v1/ext/drives', async () => {
      const res = await request('GET', '/api/v1/ext/drives', authHeaders);
      if (res.status !== 200 || !Array.isArray(res.body.data)) {
        throw new Error(`Expected 200 with data array, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Retrieved ${res.body.data.length} campus drives`);
    });

    // 10. Jobs List
    await test('GET /api/v1/ext/jobs', async () => {
      const res = await request('GET', '/api/v1/ext/jobs', authHeaders);
      if (res.status !== 200 || !Array.isArray(res.body.data)) {
        throw new Error(`Expected 200 with data array, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Retrieved ${res.body.data.length} active jobs`);
    });

    // 11. Incremental Sync Changes
    await test('GET /api/v1/ext/changes?since=2026-10-01T00:00:00Z', async () => {
      const res = await request('GET', '/api/v1/ext/changes?since=2026-10-01T00:00:00Z', authHeaders);
      if (res.status !== 200 || !Array.isArray(res.body.data?.changes)) {
        throw new Error(`Expected 200 with changes array, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`       Retrieved ${res.body.data.changes.length} change records`);
    });

    // 12. Rate Limit Headers Verification
    await test('Verify Rate Limit Headers (X-RateLimit-*)', async () => {
      const res = await request('GET', '/api/v1/ext/me', authHeaders);
      if (!res.headers['x-ratelimit-limit'] || !res.headers['x-ratelimit-remaining']) {
        throw new Error(`Rate limit headers missing from response: ${JSON.stringify(res.headers)}`);
      }
      console.log(`       Limit: ${res.headers['x-ratelimit-limit']}, Remaining: ${res.headers['x-ratelimit-remaining']}, Reset: ${res.headers['x-ratelimit-reset']}s`);
    });
  } else {
    console.log('\n[INFO] Skipping authenticated endpoint tests (no API_KEY supplied). Pass API_KEY as argument to run authenticated tests.');
  }

  console.log('\n========================================================================');
  console.log(`SMOKE TEST RESULT: ${passedTests} / ${totalTests} PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('========================================================================');

  if (passedTests < totalTests) process.exit(1);
}

runSmokeTests().catch(err => {
  console.error('Smoke test execution failed:', err);
  process.exit(1);
});
