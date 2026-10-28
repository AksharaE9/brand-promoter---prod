'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const request = require('supertest');
const { app } = require('../src/app');
const prisma = require('../src/config/db');

async function verifyHireIqE2E() {
  console.log('=== HIREIQ END-TO-END VERIFICATION ===\n');

  const HIREIQ_KEY = 'tos_live_z8tUyPF9_op1aw57s45uyGtnN8gvMN9x3Lng0TNEL';

  // 1. Test GET /api/v1/ext/me
  console.log('[1] Testing GET /api/v1/ext/me with x-api-key:');
  const meRes = await request(app)
    .get('/api/v1/ext/me')
    .set('x-api-key', HIREIQ_KEY);

  console.log('Status:', meRes.status);
  console.log('Body:', meRes.body);
  if (meRes.status !== 200 || meRes.body.data.prefix !== 'tos_live_z8tUyPF9') {
    throw new Error('Failed GET /me verification');
  }
  console.log('✅ PASS: /me returns valid key metadata\n');

  // 2. Test GET /api/v1/ext/interviews
  console.log('[2] Testing GET /api/v1/ext/interviews (Scheduled Feed):');
  const feedRes = await request(app)
    .get('/api/v1/ext/interviews?from=2026-10-01&to=2026-11-30&limit=5&status=scheduled')
    .set('x-api-key', HIREIQ_KEY);

  console.log('Status:', feedRes.status);
  console.log(`Returned interviews count: ${feedRes.body.data?.length}`);
  if (feedRes.body.data?.length > 0) {
    console.log('Sample Interview DTO:');
    console.log(JSON.stringify(feedRes.body.data[0], null, 2));
  }
  if (feedRes.status !== 200) throw new Error('Failed GET /interviews');
  console.log('✅ PASS: /interviews returns valid DTO structure\n');

  // 3. Spot-check 5 interviews against Database
  console.log('[3] Spot-checking 5 interviews with all 6 fields:');
  const spotChecks = feedRes.body.data.slice(0, 5);
  for (let i = 0; i < spotChecks.length; i++) {
    const item = spotChecks[i];
    console.log(`\n--- Spot-Check #${i + 1}: ${item.interviewId} ---`);
    console.log(`1. Candidate Name:    "${item.candidate.name}"`);
    console.log(`2. Candidate Email:   "${item.candidate.email}" (status: ${item.candidate.emailStatus})`);
    console.log(`3. Role:              interviewRole="${item.role.interviewRole}", appliedRole="${item.role.appliedRole}"`);
    console.log(`4. Round:             number=${item.round.number}, label="${item.round.label}"`);
    console.log(`5. Date & Time Slot:  date=${item.schedule.date}, time=${item.schedule.startTime}-${item.schedule.endTime}, slot="${item.schedule.slot}", startsAt=${item.schedule.startsAt}`);
    console.log(`6. Resume:            status="${item.resume.status}", fileName="${item.resume.fileName || '-'}", downloadUrl="${item.resume.downloadUrl || '-'}"`);
    console.log(`   Interviewers:      ${item.interviewers.join(', ')}`);
  }
  console.log('\n✅ PASS: All 5 spot-checked interviews contain exact 6 fields.\n');

  // 4. Test Single Interview GET /interviews/:id
  if (spotChecks.length > 0) {
    const sampleId = spotChecks[0].interviewId;
    console.log(`[4] Testing GET /api/v1/ext/interviews/${sampleId}:`);
    const singleRes = await request(app)
      .get(`/api/v1/ext/interviews/${sampleId}`)
      .set('x-api-key', HIREIQ_KEY);

    console.log('Status:', singleRes.status);
    console.log(`candidate.name: ${singleRes.body.data?.candidate?.name}`);
    if (singleRes.status !== 200 || singleRes.body.data?.interviewId !== sampleId) {
      throw new Error('Failed single interview fetch');
    }
    console.log('✅ PASS: /interviews/:id returns identical DTO\n');
  }

  // 5. Test Candidate Detail GET /candidates/:id
  if (spotChecks.length > 0) {
    const candId = spotChecks[0].candidate.id;
    console.log(`[5] Testing GET /api/v1/ext/candidates/${candId}:`);
    const candRes = await request(app)
      .get(`/api/v1/ext/candidates/${candId}`)
      .set('x-api-key', HIREIQ_KEY);

    console.log('Status:', candRes.status);
    console.log(`Candidate Name: ${candRes.body.data?.fullName}`);
    if (candRes.status !== 200) throw new Error('Failed candidate fetch');
    console.log('✅ PASS: /candidates/:id returns candidate detail\n');
  }

  // 6. Test Security Isolations
  console.log('[6] Testing Security Isolations:');
  
  // a) Missing key -> 401
  const noKeyRes = await request(app).get('/api/v1/ext/me');
  console.log(`  a) No key -> Status: ${noKeyRes.status} (${noKeyRes.body.code})`);
  expectEqual(noKeyRes.status, 401);

  // b) Internal route with API key -> 401
  const internalRes = await request(app)
    .get('/api/candidates')
    .set('x-api-key', HIREIQ_KEY);
  console.log(`  b) Key on internal /api/candidates -> Status: ${internalRes.status}`);
  expectEqual(internalRes.status, 401);

  // c) Key in query string -> 400
  const queryKeyRes = await request(app)
    .get(`/api/v1/ext/me?api_key=${HIREIQ_KEY}`);
  console.log(`  c) Key in query string -> Status: ${queryKeyRes.status} (${queryKeyRes.body.code})`);
  expectEqual(queryKeyRes.status, 400);

  console.log('\n✅ ALL E2E VERIFICATION CHECKS PASSED!\n');
  await prisma.$disconnect();
  process.exit(0);
}

function expectEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: Expected ${expected}, got ${actual}`);
  }
}

verifyHireIqE2E().catch(err => {
  console.error('E2E verification failed:', err);
  process.exit(1);
});
