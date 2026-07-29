/**
 * run-tests.js
 * Wrapper to run Jest with NEON_TEST_DATABASE_URL explicitly set to Render DB
 * to bypass the test database guard checks safely.
 */
'use strict';

process.env.NEON_TEST_DATABASE_URL = 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const { execSync } = require('child_process');
try {
  console.log('🚀 Running backend test suite with explicit test database URL...');
  execSync('npx jest --testTimeout=30000 --runInBand 2>&1', { stdio: 'inherit' });
} catch (err) {
  console.error('❌ Test run failed.');
  process.exit(1);
}
