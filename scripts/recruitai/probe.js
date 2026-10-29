'use strict';

/**
 * scripts/recruitai/probe.js
 *
 * Probe and contract verification script for Recruit AI API:
 * 1. Auth check (200 expected) vs wrong key (401/403 expected).
 * 2. Probe endpoints mentioned in integration contract.
 * 3. Inspect headers for rate limits and server signatures.
 * 4. Logs findings without revealing the secret key.
 */

const path = require('path');
require(path.resolve(__dirname, '../../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../../backend/.env') });
const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE_URL = process.env.RECRUITAI_BASE_URL || 'https://187.127.137.103';
const API_KEY = process.env.RECRUITAI_API_KEY;

if (!API_KEY) {
  console.error('[PROBE_ERROR] Missing RECRUITAI_API_KEY in environment!');
  process.exit(1);
}

function request(path, apiKey, options = {}) {
  const fullUrl = new URL(path, BASE_URL);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
    });
  }

  const isHttps = fullUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    const reqOptions = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method: options.method || 'GET',
      timeout: options.timeout || 10000,
      rejectUnauthorized: false, // IP host may use self-signed cert
      headers: {
        'Accept': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(options.headers || {})
      }
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw: data.slice(0, 500)
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 0,
        error: err.message,
        code: err.code
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        error: 'TIMEOUT'
      });
    });

    req.end();
  });
}

async function runProbe() {
  console.log('====================================================');
  console.log('       RECRUIT AI API CONTRACT LIVE PROBE           ');
  console.log('====================================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key configured: YES (prefix: ${API_KEY.slice(0, 8)}...)\n`);

  const results = {
    authCheck: null,
    wrongKeyCheck: null,
    endpoints: {},
    rateLimitHeaders: {},
    discrepancies: []
  };

  // 1. Auth Check on Results Endpoint
  console.log('[1] Testing Authenticated GET /api/integrations/talentos/results');
  const authRes = await request('/api/integrations/talentos/results', API_KEY);
  console.log(`    Status: ${authRes.status}`);
  if (authRes.error) console.log(`    Network / Connection error: ${authRes.error} (${authRes.code || ''})`);
  if (authRes.data) console.log(`    Response data:`, JSON.stringify(authRes.data).slice(0, 200));
  else if (authRes.raw) console.log(`    Response text:`, authRes.raw.slice(0, 200));
  results.authCheck = { status: authRes.status, headers: authRes.headers, sample: authRes.data || authRes.raw };

  // 2. Auth Check with Deliberately Wrong Key
  console.log('\n[2] Testing Wrong Key GET /api/integrations/talentos/results');
  const wrongKeyRes = await request('/api/integrations/talentos/results', 'invalid_dummy_key_999');
  console.log(`    Status: ${wrongKeyRes.status} (Expected 401 or 403 or network failure)`);
  results.wrongKeyCheck = { status: wrongKeyRes.status };

  // 3. Probe Alternative Endpoints
  const endpointsToProbe = [
    '/api/integrations/talentos/results/test_interview_123',
    '/api/integrations/talentos/schedule',
    '/ping',
    '/health',
    '/api/health',
    '/api/results'
  ];

  console.log('\n[3] Probing contract endpoints:');
  for (const ep of endpointsToProbe) {
    const res = await request(ep, API_KEY);
    console.log(`    ${ep} -> Status: ${res.status}${res.error ? ` (${res.error})` : ''}`);
    results.endpoints[ep] = {
      status: res.status,
      error: res.error,
      sample: res.data || (res.raw ? res.raw.slice(0, 100) : null)
    };
  }

  // 4. Rate Limit Inspection
  const inspectedHeaders = authRes.headers || {};
  results.rateLimitHeaders = {
    'x-ratelimit-limit': inspectedHeaders['x-ratelimit-limit'] || null,
    'x-ratelimit-remaining': inspectedHeaders['x-ratelimit-remaining'] || null,
    'x-ratelimit-reset': inspectedHeaders['x-ratelimit-reset'] || null,
    'retry-after': inspectedHeaders['retry-after'] || null,
  };
  console.log('\n[4] Rate Limit Headers detected:', JSON.stringify(results.rateLimitHeaders, null, 2));

  return results;
}

if (require.main === module) {
  runProbe().then(res => {
    console.log('\nPROBE EXECUTION SUMMARY:');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  });
}

module.exports = { runProbe, request };
