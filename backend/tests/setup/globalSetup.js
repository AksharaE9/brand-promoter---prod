'use strict';
/**
 * Jest globalSetup — runs once before all test suites.
 * Seeds the Neon CI test branch with deterministic fixtures.
 */
const path = require('path');

// Load env from backend root
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = async function globalSetup() {
  // This triggers the guard check in db.js as a side effect
  const { seed } = require('./seed');
  await seed();
  console.log('[GlobalSetup] CI test database seeded successfully.');
};
