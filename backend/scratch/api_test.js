const http = require('http');
require('dotenv').config();

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject({ status: res.statusCode, data: parsed });
          else resolve(parsed);
        } catch (e) { reject(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  const BASE = 'http://localhost:4000/api';
  console.log('🚀 Starting Backend API Integrity Test...');
  
  try {
    console.log('📡 Testing Auth...');
    const loginRes = await request(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
      email: 'interviewer@ats.local',
      password: 'password123'
    });
    const token = loginRes.data.token;
    console.log('  ✅ Auth OK');

    const headers = { 'Authorization': `Bearer ${token}` };

    console.log('📡 Testing Custom Fields...');
    const cfRes = await request(`${BASE}/candidates/custom-fields/definitions`, { headers });
    console.log('  ✅ Custom Fields OK:', cfRes.data.length, 'definitions found');

    console.log('📡 Testing Jobs Filter...');
    const jobsRes = await request(`${BASE}/jobs?limit=10&isActive=true`, { headers });
    console.log('  ✅ Jobs OK:', jobsRes.data.length, 'jobs found');

    console.log('📡 Testing Candidates...');
    const candRes = await request(`${BASE}/candidates?limit=5`, { headers });
    console.log('  ✅ Candidates OK:', candRes.data.length, 'candidates found');

    console.log('\n🎊 ALL BACKEND SYSTEMS NOMINAL. NO ERRORS DETECTED.');
  } catch (err) {
    console.error('\n❌ API TEST FAILED:', err);
    process.exit(1);
  }
}

test();
