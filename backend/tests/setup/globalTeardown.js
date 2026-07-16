'use strict';
/**
 * Jest globalTeardown — runs once after all test suites complete.
 * Disconnects the Prisma client cleanly.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = async function globalTeardown() {
  const { prisma } = require('./db');
  await prisma.$disconnect();
  console.log('[GlobalTeardown] Prisma disconnected.');
};
