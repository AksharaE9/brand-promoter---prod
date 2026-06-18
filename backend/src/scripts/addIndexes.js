'use strict';
/**
 * src/scripts/addIndexes.js
 * ─────────────────────────────────────────────────────────────────────────
 * CockroachDB index migration for ATS performance optimization.
 *
 * Run once after deploying this PR:
 *   node src/scripts/addIndexes.js
 *
 * Safe to re-run — all statements use IF NOT EXISTS.
 * ─────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const prisma = require('../config/db');

const indexes = [
  // ── Candidates: composite indexes for common list + filter queries ────────
  {
    name: 'idx_candidates_org_deleted',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_deleted
          ON candidates ("organizationId", "isDeleted")`,
  },
  {
    name: 'idx_candidates_org_status',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_status
          ON candidates ("organizationId", "isDeleted", status)`,
  },
  {
    name: 'idx_candidates_org_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_created
          ON candidates ("organizationId", "isDeleted", "createdAt" DESC)`,
  },

  // ── pg_trgm extension + trigram GIN indexes (fast ILIKE search) ───────────
  // CockroachDB v22.1+ supports pg_trgm GIN indexes.
  // If your version is older, these will be skipped gracefully.
  {
    name: 'pg_trgm_extension',
    sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  },
  {
    name: 'idx_candidates_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_name_trgm
          ON candidates USING GIN ("fullName" gin_trgm_ops)`,
  },
  {
    name: 'idx_candidates_email_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_email_trgm
          ON candidates USING GIN (email gin_trgm_ops)`,
  },
  {
    name: 'idx_candidates_phone_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_phone_trgm
          ON candidates USING GIN (phone gin_trgm_ops)`,
  },
];

// Post-index: run ANALYZE so the CockroachDB query planner picks up new stats
const analyzeStatements = [
  'ANALYZE candidates',
];

async function run() {
  console.log('\n[AddIndexes] Starting CockroachDB index migration...\n');

  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const { name, sql } of indexes) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  ✅  ${name}`);
      succeeded++;
    } catch (err) {
      // Some versions of CockroachDB don't support pg_trgm — skip gracefully
      if (err.message.includes('unknown type') || err.message.includes('does not exist') || err.message.includes('not supported')) {
        console.warn(`  ⚠️   ${name} — skipped (unsupported on this CockroachDB version): ${err.message.slice(0, 120)}`);
        skipped++;
      } else {
        console.error(`  ❌  ${name} — FAILED: ${err.message.slice(0, 200)}`);
        failed++;
      }
    }
  }

  console.log('\n[AddIndexes] Running ANALYZE for query planner refresh...');
  for (const stmt of analyzeStatements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  ✅  ${stmt}`);
    } catch (err) {
      console.warn(`  ⚠️   ${stmt} — skipped: ${err.message.slice(0, 80)}`);
    }
  }

  console.log(`\n[AddIndexes] Done. ${succeeded} created, ${skipped} skipped, ${failed} failed.\n`);

  if (failed > 0) {
    console.error('[AddIndexes] Some indexes failed to create. Check logs above.');
    process.exit(1);
  }
}

run()
  .catch(err => {
    console.error('[AddIndexes] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
