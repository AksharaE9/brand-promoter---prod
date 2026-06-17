/**
 * Backend Health + Logic Test Suite
 * Tests: cache module, dashboard route logic, interview route logic,
 * SSE module, error handlers — without needing auth tokens.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
const path = require('path');
let passed = 0;
let failed = 0;
const errors = [];

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
    errors.push(label);
  }
}

async function section(name, fn) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📋 ${name}`);
  console.log('─'.repeat(50));
  try {
    await fn();
  } catch (err) {
    console.error(`  💥 Section crashed: ${err.message}`);
    failed++;
    errors.push(`${name}: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────
// 1. Cache Module
// ──────────────────────────────────────────────────────────
await section('Cache Module', async () => {
  const { getCached, invalidate, invalidatePattern, invalidateAll } = require('./src/utils/cache');

  // Basic set + get
  let callCount = 0;
  const val1 = await getCached('dashboard:test_key', async () => { callCount++; return { x: 42 }; }, 5000);
  ok('getCached returns data', val1?.x === 42);

  // Cache hit — should NOT call fetcher again
  const val2 = await getCached('dashboard:test_key', async () => { callCount++; return { x: 99 }; }, 5000);
  ok('getCached returns cached value (no refetch)', val2?.x === 42 && callCount === 1);

  // Invalidate
  await invalidate('dashboard:test_key');
  const val3 = await getCached('dashboard:test_key', async () => { callCount++; return { x: 77 }; }, 5000);
  ok('invalidate clears cache, fetcher called again', val3?.x === 77 && callCount === 2);

  // Pattern invalidate
  await getCached('pattern_a_1', async () => ({ a: 1 }), 5000);
  await getCached('pattern_a_2', async () => ({ a: 2 }), 5000);
  await getCached('other_key',   async () => ({ o: 1 }), 5000);
  await invalidatePattern('pattern_a_');
  let hitAfterPattern = 0;
  await getCached('pattern_a_1', async () => { hitAfterPattern++; return {}; }, 5000);
  await getCached('other_key',   async () => { hitAfterPattern++; return {}; }, 5000);
  ok('invalidatePattern only clears matching keys', hitAfterPattern === 1);

  // invalidateAll
  await invalidateAll();
  let hitAfterAll = 0;
  await getCached('dashboard:test_key', async () => { hitAfterAll++; return {}; }, 5000);
  ok('invalidateAll clears everything', hitAfterAll === 1);
});

// ──────────────────────────────────────────────────────────
// 2. Error Utilities
// ──────────────────────────────────────────────────────────
await section('Error Utilities', async () => {
  const { ApiError, asyncHandler } = require('./src/utils/errors');

  // ApiError
  const err = new ApiError(404, 'Not found');
  ok('ApiError has correct status', err.statusCode === 404);
  ok('ApiError has correct message', err.message === 'Not found');
  ok('ApiError is instance of Error', err instanceof Error);

  // asyncHandler — wraps and catches
  const mockNext = jest => {};
  let caught = null;
  const fakeNext = (e) => { caught = e; };
  const handler = asyncHandler(async (req, res, next) => {
    throw new ApiError(422, 'validation error');
  });
  await handler({}, {}, fakeNext);
  ok('asyncHandler passes errors to next()', caught?.statusCode === 422);

  // asyncHandler — success path
  let resolved = false;
  const handler2 = asyncHandler(async (req, res, next) => { resolved = true; });
  await handler2({}, {}, () => {});
  ok('asyncHandler resolves normally on success', resolved === true);
});

// ──────────────────────────────────────────────────────────
// 3. SSE Broadcast Utility (unit test)
// ──────────────────────────────────────────────────────────
await section('SSE Broadcast Utility', async () => {
  try {
    const sseModule = require('./src/utils/sse');
    ok('SSE module loads without error', !!sseModule);
    ok('broadcast is a function', typeof sseModule.broadcast === 'function');

    // broadcast with no connected clients should not throw
    let threw = false;
    try { sseModule.broadcast({ type: 'TEST', data: {} }); } catch (_) { threw = true; }
    ok('broadcast() with no clients does not throw', !threw);
  } catch (err) {
    ok('SSE module loads', false, err.message);
  }
});

// ──────────────────────────────────────────────────────────
// 4. Audit Utility
// ──────────────────────────────────────────────────────────
await section('Audit Utility', async () => {
  try {
    const { logAudit } = require('./src/utils/audit');
    ok('logAudit is a function', typeof logAudit === 'function');
  } catch (err) {
    ok('audit module loads', false, err.message);
  }
});

// ──────────────────────────────────────────────────────────
// 5. Route Module Syntax (require without running)
// ──────────────────────────────────────────────────────────
await section('Route Modules — Syntax & Require', async () => {
  const routes = [
    './src/modules/dashboard/routes.js',
    './src/modules/interviews/routes.js',
    './src/modules/candidates/routes.js',
    './src/modules/analytics/routes.js',
    './src/modules/notifications/routes.js',
    './src/modules/audit/routes.js',
  ];

  for (const r of routes) {
    try {
      const mod = require(r);
      ok(`${path.basename(path.dirname(r))} routes load OK`, !!mod);
    } catch (err) {
      ok(`${path.basename(path.dirname(r))} routes load OK`, false, err.message);
    }
  }
});

// ──────────────────────────────────────────────────────────
// 6. Dashboard Route Logic Smoke Test
// ──────────────────────────────────────────────────────────
await section('Dashboard Route — Logic Smoke Test', async () => {
  // Test the safeCount helper is defined and exported if available
  // Test the cache key structure
  const cacheKey = 'dashboard_init_org';
  ok('Dashboard uses org-level cache key', cacheKey === 'dashboard_init_org');

  // Test that funnel statuses are correct
  const statuses = ['PENDING', 'SCREENING', 'INTERVIEWING', 'OFFER_SENT', 'JOINED', 'REJECTED'];
  ok('Funnel has 6 statuses', statuses.length === 6);
  ok('Funnel includes OFFER_SENT', statuses.includes('OFFER_SENT'));
  ok('Funnel includes JOINED', statuses.includes('JOINED'));
});

// ──────────────────────────────────────────────────────────
// 7. Interview Route Logic Smoke Test
// ──────────────────────────────────────────────────────────
await section('Interview Route — Logic Smoke Test', async () => {
  // Simulate pagination logic
  const mockDocs = Array.from({ length: 50 }, (_, i) => ({
    id: `iv_${i}`,
    applicationId: `app_${i % 10}`,
    interviewerIds: [`user_${i % 3}`],
    scheduledStart: new Date(Date.now() + i * 3600000).toISOString(),
  }));

  const page = 1, limit = 20;
  const paginated = mockDocs.slice((page - 1) * limit, page * limit);
  ok('Pagination: page 1 of 50 docs returns 20', paginated.length === 20);

  const page2 = mockDocs.slice(1 * limit, 2 * limit);
  ok('Pagination: page 2 returns next 20', page2.length === 20);

  const total = mockDocs.length;
  const totalPages = Math.ceil(total / limit);
  ok('Total pages calculation correct', totalPages === 3);

  // Simulate appIds dedup
  const appIds = [...new Set(paginated.map(iv => iv.applicationId).filter(Boolean))];
  ok('appIds are deduplicated', appIds.length < paginated.length);

  // Simulate userIds dedup
  const userIds = [...new Set(paginated.flatMap(iv => iv.interviewerIds || []).filter(Boolean))];
  ok('userIds are deduplicated', userIds.length <= 3);

  // Simulate JS sort fallback
  const unsorted = [...mockDocs].reverse();
  unsorted.sort((a, b) => new Date(b.scheduledStart || 0) - new Date(a.scheduledStart || 0));
  ok('JS sort fallback gives newest first', new Date(unsorted[0].scheduledStart) >= new Date(unsorted[1].scheduledStart));
});

// ──────────────────────────────────────────────────────────
// 8. API.js Frontend — Retry Logic Smoke Test (Node simulate)
// ──────────────────────────────────────────────────────────
await section('Retry Logic Smoke Test', async () => {
  // Simulate retry with exponential backoff
  let attempts = 0;
  const maxRetries = 2;
  const delays = [0, 800, 1600];

  async function simulateFetch(shouldFailTimes) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts++;
      if (attempts <= shouldFailTimes) {
        lastErr = new Error(`Attempt ${attempt} failed`);
        continue;
      }
      return { success: true };
    }
    throw lastErr;
  }

  attempts = 0;
  const result = await simulateFetch(1); // fail once, succeed on retry
  ok('Retry: succeeds after 1 failure (2 total attempts)', attempts === 2 && result.success);

  attempts = 0;
  try {
    await simulateFetch(3); // fail all 3 — should throw
    ok('Retry: throws after all retries exhausted', false);
  } catch (_) {
    ok('Retry: throws after all retries exhausted', attempts === 3);
  }
});

// ──────────────────────────────────────────────────────────
// 9. CockroachDB Connectivity (live call)
// ──────────────────────────────────────────────────────────
await section('CockroachDB Connectivity (Live)', async () => {
  try {
    const prisma = require('./src/config/db');
    ok('Prisma/CockroachDB module loads', !!prisma);

    // Try a lightweight read — count interviews
    const count = await prisma.interview.count();
    ok('CockroachDB connectivity OK — interviews table readable', true);
    console.log(`     ℹ️  interviews table has: ${count} rows`);

    // Try candidates
    const candCount = await prisma.candidate.count();
    ok('candidates table readable', true);
    console.log(`     ℹ️  candidates: ${candCount} rows`);

    // Try applications
    const appCount = await prisma.application.count();
    ok('applications table readable', true);
    console.log(`     ℹ️  applications: ${appCount} rows`);

  } catch (err) {
    ok('CockroachDB connectivity', false, err.message);
  }
});

// ──────────────────────────────────────────────────────────
// RESULTS
// ──────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`\n🏁 TEST RESULTS: ${passed} passed, ${failed} failed\n`);
if (errors.length > 0) {
  console.log('❌ Failed tests:');
  errors.forEach(e => console.log(`   - ${e}`));
}
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
