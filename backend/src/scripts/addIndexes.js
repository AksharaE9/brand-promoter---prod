'use strict';
/**
 * src/scripts/addIndexes.js
 * ─────────────────────────────────────────────────────────────────────────
 * Neon DB (PostgreSQL) index migration for ATS performance optimization.
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
    name: 'idx_candidates_org_created_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_created_v2
          ON candidates ("organizationId", "isDeleted", "createdAt" DESC)`,
  },

  // ── pg_trgm extension + trigram GIN indexes (fast ILIKE search) ───────────
  // Neon PostgreSQL fully supports pg_trgm GIN indexes.
  {
    name: 'pg_trgm_extension',
    sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  },
  {
    name: 'idx_candidates_name_trgm_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_name_trgm_v2
          ON candidates USING GIN ("fullName" gin_trgm_ops)`,
  },
  {
    name: 'idx_candidates_email_trgm_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_email_trgm_v2
          ON candidates USING GIN (email gin_trgm_ops)`,
  },
  {
    name: 'idx_candidates_phone_trgm_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_phone_trgm_v2
          ON candidates USING GIN (phone gin_trgm_ops)`,
  },
];

// Post-index: run ANALYZE so the PostgreSQL query planner picks up new stats
const analyzeStatements = [
  'ANALYZE candidates',
];

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

async function run() {
  console.log('\n[AddIndexes] Starting Neon DB (PostgreSQL) index migration...\n');

  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const { name, sql } of indexes) {
    try {
      // Run with a 4-second timeout to prevent blocking server boot
      await Promise.race([
        prisma.$executeRawUnsafe(sql),
        timeout(4000)
      ]);
      console.log(`  ✅  ${name}`);
      succeeded++;
    } catch (err) {
      if (err.message === 'Timeout') {
        console.warn(`  ⚠️   ${name} — skipped due to database timeout (taking too long to create/queue).`);
        skipped++;
      } else if (err.message.includes('unknown type') || err.message.includes('does not exist') || err.message.includes('not supported')) {
        console.warn(`  ⚠️   ${name} — skipped (unsupported on this PostgreSQL version): ${err.message.slice(0, 120)}`);
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
      await Promise.race([
        prisma.$executeRawUnsafe(stmt),
        timeout(4000)
      ]);
      console.log(`  ✅  ${stmt}`);
    } catch (err) {
      console.warn(`  ⚠️   ${stmt} — skipped/timed out: ${err.message.slice(0, 80)}`);
    }
  }

  console.log(`\n[AddIndexes] Done. ${succeeded} created, ${skipped} skipped, ${failed} failed.\n`);

  if (failed > 0) {
    console.error('[AddIndexes] Some indexes failed to create. Check logs above.');
    process.exit(1);
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('[AddIndexes] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
