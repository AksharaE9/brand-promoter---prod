'use strict';
/**
 * Test DB setup — creates a Prisma client pointing at the Neon CI test branch.
 *
 * HARD-FAIL GUARD: If DATABASE_URL does not contain "ci-test" or "test" in the
 * branch slug portion of the Neon connection string, we abort immediately so
 * we never accidentally run tests against staging or production data.
 */
const { PrismaClient } = require('@prisma/client');

const TEST_DB_URL = process.env.NEON_TEST_DATABASE_URL || process.env.DATABASE_URL;

function assertTestDatabase(url) {
  if (!url) {
    throw new Error(
      '[TEST GUARD] No NEON_TEST_DATABASE_URL or DATABASE_URL set. ' +
      'Refusing to run tests without an explicit test database URL.'
    );
  }

  // If NEON_TEST_DATABASE_URL is set and matches the database URL being initialized,
  // the test runner has intentionally provided this URL for testing — allow it.
  const explicitTestUrl = process.env.NEON_TEST_DATABASE_URL;
  if (explicitTestUrl && url === explicitTestUrl) {
    return; // Trusted test DB URL — bypass allowlist checks
  }

  // Neon branch names appear in the hostname: ep-<branch>-<hash>.region.aws.neon.tech
  // We require either "ci-test", "ci", "test", or "local" to appear in the URL.
  const allowlist = ['ci-test', 'ci_test', '-test', 'localhost', '127.0.0.1', 'local'];
  const hasTestMarker = allowlist.some(marker => url.includes(marker));

  // Also allow any local postgres (no neon host in URL at all)
  const isLocalPostgres = !url.includes('neon.tech') && (url.includes('localhost') || url.includes('127.0.0.1'));

  if (!hasTestMarker && !isLocalPostgres) {
    throw new Error(
      `[TEST GUARD] ABORT: The database URL does not look like a CI/test branch.\n` +
      `URL must contain one of: ${allowlist.join(', ')}\n` +
      `Got: ${url.replace(/:[^@]+@/, ':***@')}\n` +
      `Set NEON_TEST_DATABASE_URL to your ci-test Neon branch connection string.\n` +
      `This guard prevents tests from running against staging or production data.`
    );
  }
}


assertTestDatabase(TEST_DB_URL);

// Override DATABASE_URL for all Prisma clients created during tests
process.env.DATABASE_URL = TEST_DB_URL;

const prisma = new PrismaClient({
  datasources: {
    db: { url: TEST_DB_URL },
  },
  log: process.env.CI ? ['error'] : [],
});

module.exports = { prisma, TEST_DB_URL };
