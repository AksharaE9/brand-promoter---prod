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
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
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
    name: 'idx_candidates_org_updated_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_updated_id
          ON candidates ("organizationId", "isDeleted", "updatedAt" DESC, id DESC)`,
  },
  {
    name: 'idx_candidates_list_covering',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_list_covering
          ON candidates ("organizationId", "isDeleted", "updatedAt" DESC, id DESC)
          INCLUDE ("fullName", "preferredRole", location, company, phone, "offerDecision", doj, status, "createdAt")`,
  },
  {
    name: 'idx_candidates_list_status_covering',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_list_status_covering
          ON candidates ("organizationId", "isDeleted", status, "updatedAt" DESC, id DESC)
          INCLUDE ("fullName", "preferredRole", location, company, phone, "offerDecision", doj, "createdAt")`,
  },
  {
    name: 'idx_candidates_company_covering',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_company_covering
          ON candidates ("organizationId", "isDeleted", company, "updatedAt" DESC, id DESC)
          INCLUDE ("fullName", "preferredRole", location, phone, "offerDecision", doj, status, "createdAt")`,
  },
  {
    name: 'idx_candidates_org_status_updated_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_candidates_org_status_updated_id
          ON candidates ("organizationId", "isDeleted", status, "updatedAt" DESC, id DESC)`,
  },
  {
    name: 'idx_interviews_org_date_cand',
    sql: `CREATE INDEX IF NOT EXISTS idx_interviews_org_date_cand
          ON interviews ("organizationId", "candidateId", "scheduledStart" ASC)`,
  },
  {
    name: 'idx_import_jobs_status_resume_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_import_jobs_status_resume_created
          ON import_jobs (status, resume_attempts, created_at ASC)`,
  },
  {
    name: 'idx_import_jobs_org_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_import_jobs_org_created
          ON import_jobs (organization_id, created_at DESC)`,
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
  // ── Quality Check (Second Round Quality Approver) Tables & Indexes ────────
  {
    name: 'tbl_quality_checks',
    sql: `CREATE TABLE IF NOT EXISTS quality_checks (
            id VARCHAR(36) PRIMARY KEY,
            candidate_id VARCHAR(36) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            interview_round_id VARCHAR(36),
            round TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            entered_queue_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            decided_by_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ,
            ctc_amount DOUBLE PRECISION,
            ctc_currency VARCHAR(10) DEFAULT 'INR',
            comments TEXT,
            source VARCHAR(50) NOT NULL DEFAULT 'ROUND_2_SELECTED',
            organization_id VARCHAR(50) NOT NULL DEFAULT 'defaultOrg',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );`,
  },
  {
    name: 'uniq_qualitycheck_candidate_round',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uniq_qualitycheck_candidate_round
          ON quality_checks (candidate_id, interview_round_id)
          WHERE interview_round_id IS NOT NULL;`,
  },
  {
    name: 'idx_qualitycheck_queue',
    sql: `CREATE INDEX IF NOT EXISTS idx_qualitycheck_queue
          ON quality_checks (organization_id, status, entered_queue_at DESC, id DESC);`,
  },
  {
    name: 'idx_qualitycheck_candidate',
    sql: `CREATE INDEX IF NOT EXISTS idx_qualitycheck_candidate
          ON quality_checks (candidate_id);`,
  },
  {
    name: 'idx_qualitycheck_entered_queue',
    sql: `CREATE INDEX IF NOT EXISTS idx_qualitycheck_entered_queue
          ON quality_checks (entered_queue_at DESC);`,
  },
  {
    name: 'tbl_quality_check_decisions',
    sql: `CREATE TABLE IF NOT EXISTS quality_check_decisions (
            id VARCHAR(36) PRIMARY KEY,
            quality_check_id VARCHAR(36) NOT NULL REFERENCES quality_checks(id) ON DELETE CASCADE,
            decision VARCHAR(20) NOT NULL,
            decided_by_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            ctc_amount DOUBLE PRECISION,
            ctc_currency VARCHAR(10) DEFAULT 'INR',
            comments TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );`,
  },
  {
    name: 'idx_qc_decision_qc_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_qc_decision_qc_id
          ON quality_check_decisions (quality_check_id);`,
  },
  {
    name: 'idx_qc_decision_decided_by',
    sql: `CREATE INDEX IF NOT EXISTS idx_qc_decision_decided_by
          ON quality_check_decisions (decided_by_id);`,
  },
  // ── External API Keys, Daily Usage & Audit Events ──────────────────────────
  {
    name: 'tbl_api_keys',
    sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id VARCHAR(36) PRIMARY KEY,
      org_id VARCHAR(64) NOT NULL DEFAULT 'defaultOrg',
      name VARCHAR(255) NOT NULL,
      prefix VARCHAR(64) NOT NULL UNIQUE,
      key_hash VARCHAR(128) NOT NULL,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      environment VARCHAR(32) NOT NULL DEFAULT 'live',
      allowed_ips JSONB,
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
      expires_at TIMESTAMPTZ,
      created_by_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      last_used_ip VARCHAR(64),
      revoked_at TIMESTAMPTZ,
      revoked_by_id VARCHAR(36),
      revoke_reason TEXT
    );`,
  },
  {
    name: 'idx_api_keys_hash',
    sql: `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);`,
  },
  {
    name: 'idx_api_keys_org_status',
    sql: `CREATE INDEX IF NOT EXISTS idx_api_keys_org_status ON api_keys (org_id, revoked_at, expires_at);`,
  },
  {
    name: 'tbl_api_key_usage_daily',
    sql: `CREATE TABLE IF NOT EXISTS api_key_usage_daily (
      id VARCHAR(36) PRIMARY KEY,
      api_key_id VARCHAR(36) NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      date VARCHAR(16) NOT NULL,
      route VARCHAR(255) NOT NULL,
      status_class VARCHAR(16) NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      p95_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT uq_api_key_usage_daily UNIQUE (api_key_id, date, route, status_class)
    );`,
  },
  {
    name: 'idx_api_key_usage_daily_lookup',
    sql: `CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_lookup ON api_key_usage_daily (api_key_id, date);`,
  },
  {
    name: 'tbl_api_key_audit_events',
    sql: `CREATE TABLE IF NOT EXISTS api_key_audit_events (
      id VARCHAR(36) PRIMARY KEY,
      api_key_id VARCHAR(36) NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      action VARCHAR(64) NOT NULL,
      actor_id VARCHAR(36) NOT NULL,
      ip VARCHAR(64),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
  },
  {
    name: 'idx_api_key_audit_events_key_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_api_key_audit_events_key_created ON api_key_audit_events (api_key_id, created_at DESC);`,
  },
  {
    name: 'idx_interviews_org_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_interviews_org_updated ON interviews ("organizationId", "updatedAt" DESC);`,
  },
  {
    name: 'idx_college_drives_org_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_college_drives_org_updated ON college_drives ("organizationId", "isDeleted", "updatedAt" DESC);`,
  },
  {
    name: 'idx_jobs_org_updated',
    sql: `CREATE INDEX IF NOT EXISTS idx_jobs_org_updated ON jobs ("organizationId", "updatedAt" DESC);`,
  },

  // ── Resume Parsing & Job Description Matching Tables ──────────────────────
  {
    name: 'tbl_job_descriptions',
    sql: `CREATE TABLE IF NOT EXISTS job_descriptions (
      id VARCHAR(50) PRIMARY KEY,
      job_id VARCHAR(50),
      title VARCHAR(255) NOT NULL,
      company VARCHAR(255),
      location VARCHAR(255),
      mode VARCHAR(100),
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      current_version_id VARCHAR(50),
      organization_id VARCHAR(100) NOT NULL DEFAULT 'defaultOrg',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_job_descriptions_org_status',
    sql: `CREATE INDEX IF NOT EXISTS idx_job_descriptions_org_status ON job_descriptions (organization_id, status);`,
  },
  {
    name: 'idx_job_descriptions_title',
    sql: `CREATE INDEX IF NOT EXISTS idx_job_descriptions_title ON job_descriptions (title);`,
  },
  {
    name: 'tbl_job_description_versions',
    sql: `CREATE TABLE IF NOT EXISTS job_description_versions (
      id VARCHAR(50) PRIMARY KEY,
      jd_id VARCHAR(50) NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      raw_text TEXT NOT NULL,
      structured_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
      weights JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMP WITH TIME ZONE
    );`,
  },
  {
    name: 'idx_jd_versions_jd_version',
    sql: `CREATE INDEX IF NOT EXISTS idx_jd_versions_jd_version ON job_description_versions (jd_id, version);`,
  },
  {
    name: 'tbl_role_aliases',
    sql: `CREATE TABLE IF NOT EXISTS role_aliases (
      id VARCHAR(50) PRIMARY KEY,
      jd_id VARCHAR(50) NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
      alias VARCHAR(255) NOT NULL,
      normalized_alias VARCHAR(255) NOT NULL,
      kind VARCHAR(50) NOT NULL DEFAULT 'include',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_role_aliases_jd_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_role_aliases_jd_id ON role_aliases (jd_id);`,
  },
  {
    name: 'idx_role_aliases_normalized',
    sql: `CREATE INDEX IF NOT EXISTS idx_role_aliases_normalized ON role_aliases (normalized_alias);`,
  },
  {
    name: 'tbl_role_exclusions',
    sql: `CREATE TABLE IF NOT EXISTS role_exclusions (
      id VARCHAR(50) PRIMARY KEY,
      jd_id VARCHAR(50) REFERENCES job_descriptions(id) ON DELETE CASCADE,
      term VARCHAR(255) NOT NULL,
      normalized_term VARCHAR(255) NOT NULL,
      reason VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_role_exclusions_normalized',
    sql: `CREATE INDEX IF NOT EXISTS idx_role_exclusions_normalized ON role_exclusions (normalized_term);`,
  },
  {
    name: 'tbl_parsed_resumes',
    sql: `CREATE TABLE IF NOT EXISTS parsed_resumes (
      id VARCHAR(50) PRIMARY KEY,
      candidate_id VARCHAR(50) NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      file_meta_id VARCHAR(50),
      file_hash VARCHAR(100),
      parser_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
      contact JSONB NOT NULL DEFAULT '{}'::jsonb,
      education JSONB NOT NULL DEFAULT '[]'::jsonb,
      experience JSONB NOT NULL DEFAULT '[]'::jsonb,
      projects JSONB DEFAULT '[]'::jsonb,
      leadership JSONB DEFAULT '[]'::jsonb,
      skills JSONB NOT NULL DEFAULT '{}'::jsonb,
      achievements JSONB DEFAULT '[]'::jsonb,
      certifications JSONB DEFAULT '[]'::jsonb,
      languages JSONB DEFAULT '[]'::jsonb,
      summary TEXT,
      derived JSONB NOT NULL DEFAULT '{}'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_text TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_parsed_resumes_candidate_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_parsed_resumes_candidate_id ON parsed_resumes (candidate_id);`,
  },
  {
    name: 'idx_parsed_resumes_file_hash',
    sql: `CREATE INDEX IF NOT EXISTS idx_parsed_resumes_file_hash ON parsed_resumes (file_hash);`,
  },
  {
    name: 'tbl_match_scores',
    sql: `CREATE TABLE IF NOT EXISTS match_scores (
      id VARCHAR(50) PRIMARY KEY,
      candidate_id VARCHAR(50) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      jd_id VARCHAR(50) NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
      jd_version_id VARCHAR(50) NOT NULL REFERENCES job_description_versions(id) ON DELETE CASCADE,
      parser_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
      scorer_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
      overall DOUBLE PRECISION NOT NULL,
      rating_out_of_10 DOUBLE PRECISION NOT NULL,
      band VARCHAR(50) NOT NULL,
      sub_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      matched_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
      missing_must_haves JSONB NOT NULL DEFAULT '[]'::jsonb,
      flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      explanation TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_match_score_cand_jd_ver UNIQUE (candidate_id, jd_id, jd_version_id)
    );`,
  },
  {
    name: 'idx_match_scores_candidate_primary',
    sql: `CREATE INDEX IF NOT EXISTS idx_match_scores_candidate_primary ON match_scores (candidate_id, is_primary);`,
  },
  {
    name: 'idx_match_scores_jd_overall',
    sql: `CREATE INDEX IF NOT EXISTS idx_match_scores_jd_overall ON match_scores (jd_id, overall DESC);`,
  },
  {
    name: 'idx_match_scores_band',
    sql: `CREATE INDEX IF NOT EXISTS idx_match_scores_band ON match_scores (band);`,
  },
  {
    name: 'tbl_resume_parse_jobs',
    sql: `CREATE TABLE IF NOT EXISTS resume_parse_jobs (
      id VARCHAR(50) PRIMARY KEY,
      candidate_id VARCHAR(50) NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      file_meta_id VARCHAR(50),
      idempotency_key VARCHAR(120) UNIQUE,
      status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT,
      duration_ms INTEGER,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_resume_parse_jobs_status_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_status_created ON resume_parse_jobs (status, created_at);`,
  },
  {
    name: 'idx_resume_parse_jobs_candidate',
    sql: `CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_candidate ON resume_parse_jobs (candidate_id);`,
  },
  {
    name: 'tbl_skills_taxonomies',
    sql: `CREATE TABLE IF NOT EXISTS skills_taxonomies (
      id VARCHAR(50) PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      term VARCHAR(255) NOT NULL,
      normalized_term VARCHAR(255) NOT NULL,
      synonyms JSONB NOT NULL DEFAULT '[]'::jsonb,
      weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );`,
  },
  {
    name: 'idx_skills_taxonomies_category',
    sql: `CREATE INDEX IF NOT EXISTS idx_skills_taxonomies_category ON skills_taxonomies (category);`,
  },
  {
    name: 'idx_skills_taxonomies_normalized',
    sql: `CREATE INDEX IF NOT EXISTS idx_skills_taxonomies_normalized ON skills_taxonomies (normalized_term);`,
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
  'ANALYZE quality_checks',
  'ANALYZE quality_check_decisions',
  'ANALYZE api_keys',
  'ANALYZE api_key_usage_daily',
  'ANALYZE api_key_audit_events',
  'ANALYZE job_descriptions',
  'ANALYZE job_description_versions',
  'ANALYZE role_aliases',
  'ANALYZE role_exclusions',
  'ANALYZE parsed_resumes',
  'ANALYZE match_scores',
  'ANALYZE resume_parse_jobs',
  'ANALYZE skills_taxonomies',
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
