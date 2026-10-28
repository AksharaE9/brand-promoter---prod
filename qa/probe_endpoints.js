// qa/probe_endpoints.js
const https = require('https');

async function testEndpoint(name, path, headers = {}) {
  const url = new URL(path, 'https://brandpromoter-backend.onrender.com');
  const times = [];
  let size = 0;
  let status = 0;
  
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => {
      const start = Date.now();
      const req = https.get(url, { headers }, (res) => {
        let buf = [];
        res.on('data', d => buf.push(d));
        res.on('end', () => {
          times.push(Date.now() - start);
          size = Buffer.concat(buf).length;
          status = res.statusCode;
          resolve();
        });
      });
      req.on('error', (e) => {
        console.error(e.message);
        resolve();
      });
    });
  }
  times.sort((a,b) => a - b);
  console.log(`${name.padEnd(35)} | Status: ${status} | Min: ${times[0]}ms | Med: ${times[1]}ms | Max: ${times[2]}ms | Size: ${size} B`);
}

async function run() {
  console.log('Testing live endpoints from runner (India -> Render Oregon)...');
  await testEndpoint('Health Check', '/api/health');
  await testEndpoint('Dashboard Stats (Unauth)', '/api/dashboard/stats');
  await testEndpoint('College Drives (Unauth)', '/api/college-drives');
  await testEndpoint('HireIQ External API', '/api/v1/ext/interviews?limit=10', { 'x-api-key': 'tos_live_z8tUyPF9_op1aw57s45uyGtnN8gvMN9x3Lng0TNEL' });
}

run();
