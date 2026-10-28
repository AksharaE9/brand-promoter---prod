#!/usr/bin/env node
'use strict';

/**
 * Cross-Platform Smoke Test for HireIQ External API
 * Usage: node scripts/api-keys/smoke-hireiq.js [BASE_URL] [API_KEY] [CANDIDATE_ID]
 */

const http = require('http');
const https = require('https');
const url = require('url');

const BASE_URL = process.argv[2] || 'http://localhost:4000';
const API_KEY = process.argv[3];
const CANDIDATE_ID = process.argv[4] || 'cmvronjma006ftb08cqdxrff9';

if (!API_KEY) {
  console.log('Usage: node scripts/api-keys/smoke-hireiq.js <BASE_URL> <API_KEY> [CANDIDATE_ID]');
  process.exit(1);
}

function request(fullUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(fullUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(fullUrl, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyBuffer.toString('utf8'),
          raw: bodyBuffer
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runSmoke() {
  console.log('========================================================================');
  console.log(`   HIREIQ EXTERNAL API SMOKE TEST: ${BASE_URL}`);
  console.log('========================================================================\n');

  // Test 1: GET /api/v1/ext/me
  console.log('[Test 1] GET /api/v1/ext/me (x-api-key authentication):');
  const res1 = await request(`${BASE_URL}/api/v1/ext/me`, {
    headers: { 'x-api-key': API_KEY }
  });
  console.log(`Status: ${res1.statusCode}`);
  console.log('Body:', res1.body.slice(0, 300));
  console.log(res1.statusCode === 200 ? '✅ PASS' : '❌ FAIL');
  console.log('');

  // Test 2: GET /api/v1/ext/interviews (IST Date filter)
  console.log('[Test 2] GET /api/v1/ext/interviews?from=2026-10-28&to=2026-11-10:');
  const res2 = await request(`${BASE_URL}/api/v1/ext/interviews?from=2026-10-28&to=2026-11-10`, {
    headers: { 'x-api-key': API_KEY }
  });
  console.log(`Status: ${res2.statusCode}`);
  const data2 = JSON.parse(res2.body || '{}');
  console.log(`Interviews returned: ${data2.data ? data2.data.length : 0}`);
  if (data2.data && data2.data.length > 0) {
    console.log('Sample item:', JSON.stringify(data2.data[0], null, 2));
  }
  console.log(res2.statusCode === 200 ? '✅ PASS' : '❌ FAIL');
  console.log('');

  // Test 3: Polling via updatedSince
  console.log('[Test 3] GET /api/v1/ext/interviews?updatedSince=2026-10-27T00:00:00%2B05:30:');
  const res3 = await request(`${BASE_URL}/api/v1/ext/interviews?updatedSince=2026-10-27T00:00:00%2B05:30`, {
    headers: { 'x-api-key': API_KEY }
  });
  console.log(`Status: ${res3.statusCode}`);
  const data3 = JSON.parse(res3.body || '{}');
  console.log(`Polling records returned: ${data3.data ? data3.data.length : 0}`);
  console.log(res3.statusCode === 200 ? '✅ PASS' : '❌ FAIL');
  console.log('');

  // Test 4: Resume Download
  console.log(`[Test 4] GET /api/v1/ext/candidates/${CANDIDATE_ID}/resume:`);
  const res4 = await request(`${BASE_URL}/api/v1/ext/candidates/${CANDIDATE_ID}/resume`, {
    headers: { 'x-api-key': API_KEY }
  });
  console.log(`Status: ${res4.statusCode}`);
  console.log(`Content-Type: ${res4.headers['content-type']}`);
  console.log(`Content-Disposition: ${res4.headers['content-disposition'] || 'none'}`);
  console.log(`Byte size: ${res4.raw.length}`);
  console.log(res4.statusCode === 200 || res4.statusCode === 302 || res4.statusCode === 404 ? '✅ PASS' : '❌ FAIL');
  console.log('');

  // Test 5: Missing Key -> 401
  console.log('[Test 5] Security Check: Request with missing key -> Expected 401:');
  const res5 = await request(`${BASE_URL}/api/v1/ext/me`);
  console.log(`Status: ${res5.statusCode}`);
  console.log(res5.statusCode === 401 ? '✅ PASS (Rejected missing key)' : '❌ FAIL');
  console.log('');

  // Test 6: API key on internal route -> 401
  console.log('[Test 6] Security Check: External key on internal /api/candidates -> Expected 401:');
  const res6 = await request(`${BASE_URL}/api/candidates`, {
    headers: { 'x-api-key': API_KEY }
  });
  console.log(`Status: ${res6.statusCode}`);
  console.log(res6.statusCode === 401 ? '✅ PASS (Internal route rejected API key)' : '❌ FAIL');
  console.log('');

  console.log('========================================================================');
  console.log('   SMOKE TEST COMPLETE');
  console.log('========================================================================\n');
}

runSmoke().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
