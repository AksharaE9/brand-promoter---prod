// backend/scripts/profile_all_endpoints.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('../src/utils/jwt');
const http = require('http');

const prisma = new PrismaClient();
const baseUrl = 'http://localhost:4000/api';

async function request(path, options = {}) {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      let bytes = 0;
      res.on('data', chunk => {
        data += chunk;
        bytes += chunk.length;
      });
      res.on('end', () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          durationMs,
          bytes,
          data,
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function benchmarkEndpoint(name, path, options, token, iterations = 5) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const times = [];
  let lastRes = null;

  for (let i = 0; i < iterations; i++) {
    const res = await request(path, { ...options, headers });
    times.push(res.durationMs);
    lastRes = res;
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)].toFixed(1);
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))].toFixed(1);
  const min = times[0].toFixed(1);
  const max = times[times.length - 1].toFixed(1);
  const kb = (lastRes.bytes / 1024).toFixed(1);

  return {
    name,
    path,
    status: lastRes.statusCode,
    p50: `${p50}ms`,
    p95: `${p95}ms`,
    range: `${min}ms - ${max}ms`,
    size: `${kb} KB`,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🔬 PROFILING ALL MAJOR APPLICATION ENDPOINTS ON LOCALHOST');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const user = await prisma.user.findFirst({
    where: { isActive: true, isDeleted: false, role: 'SUPER_ADMIN' },
  }) || await prisma.user.findFirst({
    where: { isActive: true, isDeleted: false },
  });

  if (!user) {
    console.error('No active user found in database.');
    process.exit(1);
  }

  const token = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  });

  const endpoints = [
    { name: 'Dashboard Summary', path: '/dashboard/summary' },
    { name: 'Candidates (List / Page 1)', path: '/candidates?limit=25' },
    { name: 'Candidates Search (POST)', path: '/candidates/search', method: 'POST', body: { limit: 25 } },
    { name: 'Candidates (OFFER_SENT)', path: '/candidates?status=OFFER_SENT&limit=25' },
    { name: 'Candidates (JOINED)', path: '/candidates?status=JOINED&limit=25' },
    { name: 'Candidates (REJECTED)', path: '/candidates?status=REJECTED&limit=25' },
    { name: 'Jobs List', path: '/jobs?limit=50' },
    { name: 'Interviews List', path: '/interviews?limit=50' },
    { name: 'College Drives List', path: '/college-drives/drives' },
    { name: 'Reports Candidates', path: '/reports/candidates' },
    { name: 'Audit Logs', path: '/audit-logs?limit=50' },
    { name: 'Team Users', path: '/users' },
    { name: 'Scheduling Members', path: '/scheduling/members' },
    { name: 'Notifications', path: '/notifications' },
    { name: 'Bulk Upload History', path: '/bulk-upload/history' },
    { name: 'Pipeline Stages', path: '/pipeline/stages' },
  ];

  const results = [];
  for (const ep of endpoints) {
    try {
      const res = await benchmarkEndpoint(ep.name, ep.path, { method: ep.method || 'GET', body: ep.body }, token, 5);
      results.push(res);
      console.log(`✓ ${ep.name.padEnd(30)} | p50: ${res.p50.padEnd(8)} | p95: ${res.p95.padEnd(8)} | Size: ${res.size.padEnd(8)} | HTTP ${res.status}`);
    } catch (err) {
      console.error(`✗ ${ep.name.padEnd(30)} | Error: ${err.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('📊 RESULTS SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.table(results);

  await prisma.$disconnect();
}

main().catch(console.error);
