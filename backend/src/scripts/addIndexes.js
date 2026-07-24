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
  {
    name: 'idx_candidates_org_deleted_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_deleted_updated
          ON candidates ("organizationId", "isDeleted", "updatedAt" DESC)`,
  },
  {
    name: 'idx_candidates_email_btree',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_email_btree
          ON candidates (email)`,
  },
  {
    name: 'idx_candidates_phone_btree',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_phone_btree
          ON candidates (phone)`,
  },
  {
    name: 'idx_candidates_org_status_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_status_updated
          ON candidates ("organizationId", "isDeleted", status, "updatedAt" DESC)`,
  },
  {
    name: 'idx_candidates_org_company_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_company_updated
          ON candidates ("organizationId", "isDeleted", company, "updatedAt" DESC)`,
  },
  {
    name: 'idx_applications_org_status',

    sql: `CREATE INDEX IF NOT EXISTS idx_applications_org_status
          ON applications ("organizationId", "isDeleted", status)`,
  },
  {
    name: 'idx_applications_org_deleted_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_applications_org_deleted_created
          ON applications ("organizationId", "isDeleted", "createdAt" DESC)`,
  },
  {
    name: 'idx_jobs_org_active',
    sql: `CREATE INDEX IF NOT EXISTS idx_jobs_org_active
          ON jobs ("organizationId", "isActive")`,
  },

  {
    name: 'idx_candidates_stage',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_stage
          ON candidates ("organizationId", "currentStage")`,
  },
  {
    name: 'idx_jobs_status_open',
    sql: `CREATE INDEX IF NOT EXISTS idx_jobs_status_open
          ON jobs ("organizationId", "isActive")`,
  },
  {
    name: 'idx_interviews_scheduled_date',
    sql: `CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_date
          ON interviews ("organizationId", "scheduledStart")`,
  },
  {
    name: 'idx_candidates_updated_at',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_updated_at
          ON candidates ("organizationId", "isDeleted", "updatedAt" DESC)`,
  },
  {
    name: 'idx_contact_attempts_candidate_time',
    sql: `CREATE INDEX IF NOT EXISTS idx_contact_attempts_candidate_time
          ON candidate_contact_attempts ("candidateId", "attemptedAt" DESC)`,
  },
  {
    name: 'idx_interview_feedback_candidate_round',
    sql: `CREATE INDEX IF NOT EXISTS idx_interview_feedback_candidate_round
          ON interview_feedbacks ("candidateId", round)`,
  },
  {
    name: 'col_candidates_phone_normalized',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone_normalized text;`,
  },
  {
    name: 'backfill_candidates_phone_normalized',
    sql: `UPDATE candidates c
          SET phone_normalized = CASE
              WHEN regexp_replace(c.phone, '[^\\d+]', '', 'g') = '' THEN NULL
              WHEN EXISTS (
                  SELECT 1 FROM candidates dup
                  WHERE regexp_replace(dup.phone, '[^\\d+]', '', 'g') = regexp_replace(c.phone, '[^\\d+]', '', 'g')
                    AND dup.id < c.id
                    AND dup."organizationId" = c."organizationId"
                    AND dup."isDeleted" = false
              ) THEN NULL
              WHEN EXISTS (
                  SELECT 1 FROM candidates existing
                  WHERE existing.phone_normalized = regexp_replace(c.phone, '[^\\d+]', '', 'g')
                    AND existing.id <> c.id
                    AND existing."organizationId" = c."organizationId"
                    AND existing."isDeleted" = false
              ) THEN NULL
              ELSE regexp_replace(c.phone, '[^\\d+]', '', 'g')
          END
          WHERE c.phone IS NOT NULL AND (c.phone_normalized IS NULL OR c.phone_normalized = '');`,
  },
  {
    name: 'drop_idx_candidates_phone_normalized',
    sql: `DROP INDEX IF EXISTS idx_candidates_phone_normalized;`,
  },
  {
    name: 'cleanup_candidates_phone_normalized_empty',
    sql: `UPDATE candidates SET phone_normalized = NULL WHERE phone_normalized = '' OR phone_normalized = 'null' OR phone_normalized = 'undefined';`,
  },
  {
    name: 'nullify_duplicate_candidates',
    sql: `UPDATE candidates SET phone_normalized = NULL WHERE id IN (
            SELECT a.id FROM candidates a INNER JOIN candidates b ON a.phone_normalized = b.phone_normalized AND a.id > b.id
          );`,
  },
  {
    name: 'idx_candidates_phone_normalized_unique',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_phone_normalized_unique ON candidates (phone_normalized) WHERE "isDeleted" = false AND phone_normalized IS NOT NULL;`,
  },
  {
    name: 'col_scheduling_leads_phone_normalized',
    sql: `ALTER TABLE scheduling_leads ADD COLUMN IF NOT EXISTS phone_normalized text;`,
  },
  {
    name: 'backfill_scheduling_leads_phone_normalized',
    sql: `UPDATE scheduling_leads SET phone_normalized = regexp_replace("leadData"->>'phone', '[^\\d+]', '', 'g') WHERE "leadData"->>'phone' IS NOT NULL AND (phone_normalized IS NULL OR phone_normalized = '');`,
  },
  {
    name: 'idx_scheduling_leads_phone_normalized_unique',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_leads_phone_normalized_unique ON scheduling_leads ("listId", phone_normalized) WHERE phone_normalized IS NOT NULL;`,
  },
  {
    name: 'tbl_scheduling_member_files',
    sql: `CREATE TABLE IF NOT EXISTS scheduling_member_files (
            id VARCHAR(36) PRIMARY KEY,
            member_id VARCHAR(36) NOT NULL REFERENCES scheduling_members(id) ON DELETE CASCADE,
            for_date DATE NOT NULL,
            file_url TEXT NOT NULL,
            note TEXT,
            uploaded_by VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );`,
  },
  {
    name: 'idx_scheduling_member_files_member',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_member_files_member ON scheduling_member_files (member_id);`,
  },
  {
    name: 'idx_scheduling_member_files_date',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_member_files_date ON scheduling_member_files (for_date);`,
  },
  {
    name: 'col_interview_feedbacks_pending_link',
    sql: `ALTER TABLE interview_feedbacks ADD COLUMN IF NOT EXISTS pending_link boolean DEFAULT false;`,
  },
  {
    name: 'alter_interview_feedbacks_candidate_null',
    sql: `ALTER TABLE interview_feedbacks ALTER COLUMN "candidateId" DROP NOT NULL;`,
  },
  {
    name: 'alter_interview_feedbacks_user_null',
    sql: `ALTER TABLE interview_feedbacks ALTER COLUMN "submittedById" DROP NOT NULL;`,
  },
  {
    name: 'migrate_round_3_feedbacks',
    sql: `UPDATE interview_feedbacks SET round = 'FINAL_ROUND' WHERE round = 'ROUND_3';`,
  },
  {
    name: 'migrate_round_3_interviews',
    sql: `UPDATE interviews SET round = 'Final Round' WHERE round = 'Round 3';`,
  },
  {
    name: 'col_candidates_college',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS college text;`,
  },
  {
    name: 'col_candidates_location',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS location text;`,
  },
  {
    name: 'col_candidates_course',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS course text;`,
  },
  {
    name: 'col_candidates_source',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source text;`,
  },
  {
    name: 'col_candidates_company',
    sql: `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS company text;`,
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
  {
    name: 'idx_jobs_title_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
          ON jobs USING GIN (title gin_trgm_ops)`,
  },
  {
    name: 'idx_interviews_cand_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_interviews_cand_name_trgm
          ON interviews USING GIN ("candidateName" gin_trgm_ops)`,
  },
   {
    name: 'idx_scheduling_leads_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_leads_name_trgm
          ON scheduling_leads USING GIN (("leadData"->>'name') gin_trgm_ops)`,
  },
  {
    name: 'col_audit_logs_subject_type',
    sql: `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS subject_type TEXT;`,
  },
  {
    name: 'col_audit_logs_subject_id',
    sql: `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS subject_id TEXT;`,
  },
  {
    name: 'col_audit_logs_subject_name',
    sql: `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS subject_name TEXT;`,
  },
  {
    name: 'idx_audit_subject_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_subject_name_trgm ON audit_logs USING GIN (subject_name gin_trgm_ops);`,
  },
  {
    name: 'idx_audit_subject_lookup',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_subject_lookup ON audit_logs (subject_type, subject_id, "createdAt" DESC);`,
  },
  {
    name: 'col_users_must_change_password',
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;`,
  },
  {
    name: 'drop_idx_only_one_super_admin',
    sql: `DROP INDEX IF EXISTS only_one_super_admin;`,
  },
  {
    name: 'tbl_report_errors',
    sql: `CREATE TABLE IF NOT EXISTS report_errors (
            id VARCHAR(36) PRIMARY KEY,
            report_type VARCHAR(50) NOT NULL,
            requested_by VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            params TEXT,
            error_message TEXT NOT NULL,
            stack_trace TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );`,
  },
  {
    name: 'idx_scheduling_member_files_member_date_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_member_files_member_date_created ON scheduling_member_files (member_id, for_date DESC, created_at DESC);`,
  },
  {
    name: 'idx_scheduling_lead_lists_member_date',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_lead_lists_member_date ON scheduling_lead_lists ("memberId", "listDate" DESC);`,
  },
  {
    name: 'idx_scheduling_daily_reports_member_date',
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduling_daily_reports_member_date ON scheduling_daily_reports ("memberId", "reportDate" DESC);`,
  },
  {
    name: 'alter_interview_mode_walk_in',
    sql: `ALTER TYPE "InterviewMode" ADD VALUE IF NOT EXISTS 'WALK_IN_DRIVE';`,
  },
  {
    name: 'alter_interview_mode_drive',
    sql: `ALTER TYPE "InterviewMode" ADD VALUE IF NOT EXISTS 'DRIVE';`,
  },
  {
    name: 'migrate_hold_to_on_hold',
    sql: `UPDATE interview_feedbacks SET "selectionStatus" = 'ON_HOLD' WHERE "selectionStatus" = 'HOLD';`,
  },
  {
    name: 'col_interview_feedbacks_offer_letter_document_url',
    sql: `ALTER TABLE interview_feedbacks ADD COLUMN IF NOT EXISTS offer_letter_document_url text;`,
  },
  {
    name: 'col_interview_feedbacks_offer_letter_email_attachment_url',
    sql: `ALTER TABLE interview_feedbacks ADD COLUMN IF NOT EXISTS offer_letter_email_attachment_url text;`,
  },
  {
    name: 'idx_interview_feedbacks_offer_letter_partial',
    sql: `CREATE INDEX IF NOT EXISTS idx_interview_feedbacks_offer_letter_partial ON interview_feedbacks ("selectionStatus") WHERE "selectionStatus" = 'OFFER_LETTER';`,
  },
  // ── Enterprise Audit Logs Performance Overhaul Indexes ───────────────────
  // Primary index for composite filters (date range, entity type, action type)
  {
    name: 'idx_audit_logs_primary_query_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_primary_query_v2 
          ON audit_logs ("organizationId", "isDeleted", "createdAt" DESC, "entityType", "action");`,
  },
  // Keyset (cursor-based) pagination index for O(log n) constant time lookup
  {
    name: 'idx_audit_logs_cursor_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_cursor_v2 
          ON audit_logs ("organizationId", "isDeleted", "createdAt" DESC, id DESC);`,
  },
  // Index for searching by actor user ID
  {
    name: 'idx_audit_logs_actor_id_v2',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id_v2 
          ON audit_logs ("organizationId", "isDeleted", "actorUserId");`,
  },
  // GIN trigram index for fast case-insensitive actor name queries
  {
    name: 'idx_audit_logs_actor_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_name_trgm 
          ON audit_logs USING GIN ("actorName" gin_trgm_ops);`,
  },
  // GIN trigram index for fast case-insensitive entity name queries
  {
    name: 'idx_audit_logs_entity_name_trgm',
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_name_trgm 
          ON audit_logs USING GIN ("entityName" gin_trgm_ops);`,
  },
];

// Post-index: run ANALYZE so the PostgreSQL query planner picks up new stats
const analyzeStatements = [
  'ANALYZE candidates',
  'ANALYZE applications',
  'ANALYZE jobs',
  'ANALYZE interviews',
  'ANALYZE scheduling_leads',
  'ANALYZE scheduling_member_files',
  'ANALYZE audit_logs',
  'ANALYZE report_errors',
];


function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
}

async function run() {
  console.log('\n[AddIndexes] Starting Neon DB (PostgreSQL) index migration...\n');

  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;
  let createdAny = false;

  // 1. Fetch existing indexes, extensions, and types to avoid redundant DDL queries and lock waits
  let indexNames = new Set();
  let extensionNames = new Set();
  let typeNames = new Set();
  try {
    const [existingIndexes, existingExtensions, existingTypes] = await Promise.all([
      prisma.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"),
      prisma.$queryRawUnsafe("SELECT extname FROM pg_extension"),
      prisma.$queryRawUnsafe(
        "SELECT typname FROM pg_type JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_type.typnamespace WHERE nspname = 'public'"
      ),
    ]);
    indexNames = new Set(existingIndexes.map(r => r.indexname));
    extensionNames = new Set(existingExtensions.map(r => r.extname));
    typeNames = new Set(existingTypes.map(r => r.typname));
  } catch (err) {
    console.warn('[AddIndexes] Warning: Failed to query existing metadata, falling back to direct execution.', err.message);
  }

  // Define type dependencies for enum alterations
  const typeDependencies = {
    'alter_interview_mode_walk_in': 'InterviewMode',
    'alter_interview_mode_drive': 'InterviewMode',
  };

  for (const { name, sql } of indexes) {
    // Skip if it already exists to prevent waiting on locks
    if (name === 'pg_trgm_extension' && extensionNames.has('pg_trgm')) {
      console.log(`  ✅  ${name} (already exists)`);
      succeeded++;
      continue;
    }
    if (name !== 'pg_trgm_extension' && indexNames.has(name)) {
      console.log(`  ✅  ${name} (already exists)`);
      succeeded++;
      continue;
    }

    // Skip if type dependency doesn't exist (only if we successfully populated typeNames)
    const depType = typeDependencies[name];
    if (depType && typeNames.size > 0 && !typeNames.has(depType)) {
      console.log(`  ⚠️   ${name} (skipped — type "${depType}" does not exist)`);
      skipped++;
      continue;
    }

    try {
      // Run with a 4-second timeout to prevent blocking server boot
      await Promise.race([
        prisma.$executeRawUnsafe(sql),
        timeout(4000)
      ]);
      console.log(`  ✅  ${name}`);
      succeeded++;
      createdAny = true;
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

  if (createdAny) {
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
  } else {
    console.log('\n[AddIndexes] No new indexes created, skipping ANALYZE.');
  }

  console.log(`\n[AddIndexes] Done. ${succeeded} created/verified, ${skipped} skipped, ${failed} failed.\n`);

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
