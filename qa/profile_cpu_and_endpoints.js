// qa/profile_cpu_and_endpoints.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const inspector = require('inspector');

// Load environment from backend/.env
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../backend/.env')
});

const { app } = require(path.resolve(__dirname, '../backend/src/app'));
const jwt = require(path.resolve(__dirname, '../backend/node_modules/jsonwebtoken'));

async function main() {
  console.log('=== STARTING CPU PROFILING & PER-ENDPOINT BENCHMARK ===');

  // Start local server on ephemeral port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Diagnostic server listening on port ${port}`);

  // Generate test JWT for valid admin user
  const testToken = jwt.sign(
    {
      id: 'cmrwbuuum0000ije02hmmy7s7',
      userId: 'cmrwbuuum0000ije02hmmy7s7',
      email: 'superadmin@gmail.com',
      role: 'SUPER_ADMIN',
      organizationId: 'defaultOrg'
    },
    process.env.JWT_SECRET || 'thuyghtssvngtfgukhju,guy655443sgsbfdbgggnfhfnhmrgv',
    { expiresIn: '1h' }
  );

  const endpoints = [
    { name: 'Health Check', path: '/api/health', method: 'GET', auth: false },
    { name: 'Dashboard Summary', path: '/api/dashboard/summary', method: 'GET', auth: true },
    { name: 'Candidate List (Page 1)', path: '/api/candidates?page=1&limit=25', method: 'GET', auth: true },
    { name: 'Candidate Search', path: '/api/candidates?page=1&limit=25&search=Kumar', method: 'GET', auth: true },
    { name: 'College Drives List', path: '/api/college-drives/drives', method: 'GET', auth: true },
    { name: 'Interviews List', path: '/api/interviews?roundNo=1&limit=25', method: 'GET', auth: true },
    { name: 'Telecalling Members', path: '/api/scheduling/members', method: 'GET', auth: true },
    { name: 'Reports Hiring Progress', path: '/api/reports/hiring-progress', method: 'GET', auth: true },
  ];

  // Start V8 CPU Profiler session via inspector
  const session = new inspector.Session();
  session.connect();
  await new Promise(res => session.post('Profiler.enable', res));
  await new Promise(res => session.post('Profiler.start', res));
  console.log('V8 CPU Profiler active.');

  const results = [];

  for (const ep of endpoints) {
    const latencies = [];
    let status = 0;
    let size = 0;

    // Run 5 warm/measured requests per endpoint
    for (let i = 0; i < 5; i++) {
      const headers = { 'X-Request-Source': 'diagnostic' };
      if (ep.auth) headers['Authorization'] = `Bearer ${testToken}`;

      await new Promise(resolve => {
        const start = process.hrtime.bigint();
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: ep.path,
            method: ep.method,
            headers
          },
          res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
              const dur = Number(process.hrtime.bigint() - start) / 1e6;
              latencies.push(dur);
              status = res.statusCode;
              size = Buffer.concat(chunks).length;
              resolve();
            });
          }
        );
        req.on('error', () => resolve());
        req.end();
      });
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(1);
    const p95 = latencies[latencies.length - 1].toFixed(1);

    results.push({
      Endpoint: ep.name,
      Path: ep.path,
      Status: status,
      'p50 (ms)': p50,
      'p95 (ms)': p95,
      'Bytes': size,
    });
  }

  // Stop CPU Profiler and get profile data
  const profileResult = await new Promise(resolve => {
    session.post('Profiler.stop', (err, { profile }) => resolve(profile));
  });
  session.disconnect();

  console.log('\n--- PER-ENDPOINT LOCAL BASELINE (WITHOUT TRANSCONTINENTAL RTT) ---');
  console.table(results);

  // Analyze CPU profile top functions
  const nodeMap = new Map();
  for (const node of profileResult.nodes) {
    nodeMap.set(node.id, {
      id: node.id,
      callFrame: node.callFrame,
      hitCount: node.hitCount,
      selfTime: node.hitCount, // In sample ticks
      children: node.children || []
    });
  }

  // Calculate self-time
  const totalSamples = profileResult.samples.length;
  const sampleCounts = new Map();
  for (const id of profileResult.samples) {
    sampleCounts.set(id, (sampleCounts.get(id) || 0) + 1);
  }

  const sortedFunctions = [];
  for (const [id, count] of sampleCounts.entries()) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const fnName = node.callFrame.functionName || '(anonymous)';
    const url = node.callFrame.url ? path.basename(node.callFrame.url) : '(native)';
    const line = node.callFrame.lineNumber;
    const pct = ((count / totalSamples) * 100).toFixed(2);
    sortedFunctions.push({
      Function: fnName,
      Location: `${url}:${line}`,
      Samples: count,
      'Self-Time %': `${pct}%`
    });
  }

  sortedFunctions.sort((a, b) => b.Samples - a.Samples);
  console.log('\n--- TOP 10 CPU FUNCTIONS BY SELF-TIME ---');
  console.table(sortedFunctions.slice(0, 10));

  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Profiling error:', err);
  process.exit(1);
});
