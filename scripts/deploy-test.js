const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

async function runTest() {
  console.log('📦 [DEPLOY TEST] Starting optimized production verification...');
  
  // 1. Start Backend in background
  const backend = spawn('node', ['src/index.js'], {
    cwd: path.join(__dirname, '../backend'),
    env: { ...process.env, PORT: 4001, NODE_ENV: 'production' },
    shell: true
  });

  backend.stdout.on('data', (data) => {
    if (data.toString().includes('Server running')) {
      console.log('🚀 [DEPLOY TEST] Production server is UP.');
    }
  });

  // 2. Wait for server and run smoke test
  console.log('⏳ [DEPLOY TEST] Waiting for health check...');
  
  const checkHealth = () => {
    return new Promise((resolve) => {
      const req = http.get('http://localhost:4001/api/health', (res) => {
        if (res.statusCode === 200) resolve(true);
        else resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  };

  let retries = 5;
  let success = false;
  while (retries > 0 && !success) {
    await new Promise(r => setTimeout(r, 2000));
    success = await checkHealth();
    retries--;
    if (!success) console.log(`...retrying health check (${retries} left)`);
  }

  if (success) {
    console.log('✅ [DEPLOY TEST] PASSED: Server is responsive and healthy.');
  } else {
    console.error('❌ [DEPLOY TEST] FAILED: Server did not respond within timeout.');
  }

  // Cleanup
  console.log('🧹 [DEPLOY TEST] Cleaning up...');
  backend.kill();
  process.exit(success ? 0 : 1);
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
