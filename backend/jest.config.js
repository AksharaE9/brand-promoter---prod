/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  globalSetup: './tests/setup/globalSetup.js',
  globalTeardown: './tests/setup/globalTeardown.js',
  testTimeout: 30000,
  verbose: true,
  // Run serially to avoid DB state conflicts
  runInBand: true,
  // Ensure forceExit for Prisma connection cleanup
  forceExit: true,
};

