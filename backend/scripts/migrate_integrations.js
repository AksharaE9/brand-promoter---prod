'use strict';
const prisma = require('../src/config/db');

async function run() {
  console.log('[Migration] Creating integration tables additively...');

  const statements = [
    `CREATE TABLE IF NOT EXISTS "integration_providers" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS "external_assessment_results" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL DEFAULT 'recruit_ai',
      "provider_result_id" TEXT NOT NULL,
      "provider_interview_id" TEXT,
      "provider_candidate_id" TEXT,
      "external_reference" TEXT,
      "candidate_id" TEXT,
      "interview_round_id" TEXT,
      "match_method" TEXT,
      "match_confidence" TEXT,
      "status" TEXT NOT NULL DEFAULT 'COMPLETED',
      "score_raw" DOUBLE PRECISION,
      "score_scale" DOUBLE PRECISION DEFAULT 100,
      "score_normalised_100" DOUBLE PRECISION,
      "rating_out_of_10" DOUBLE PRECISION,
      "recommendation_raw" TEXT,
      "recommendation_normalised" TEXT,
      "competency_scores" JSONB,
      "summary" TEXT,
      "transcript_ref" TEXT,
      "recording_url" TEXT,
      "recording_expires_at" TIMESTAMP(3),
      "integrity_flags" JSONB,
      "started_at" TIMESTAMP(3),
      "completed_at" TIMESTAMP(3),
      "provider_updated_at" TIMESTAMP(3),
      "provider_version" TEXT,
      "raw_payload" JSONB,
      "payload_hash" TEXT,
      "review_status" TEXT NOT NULL DEFAULT 'pending_review',
      "reviewed_by_id" TEXT,
      "reviewed_at" TIMESTAMP(3),
      "decision_outcome" TEXT,
      "organization_id" TEXT NOT NULL DEFAULT 'defaultOrg',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "fk_assessment_candidate" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL,
      CONSTRAINT "fk_assessment_interview" FOREIGN KEY ("interview_round_id") REFERENCES "interviews"("id") ON DELETE SET NULL
    )`,

    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_ext_assess_provider_res_id" ON "external_assessment_results"("provider", "provider_result_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_ext_assess_candidate_id" ON "external_assessment_results"("candidate_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_ext_assess_interview_round_id" ON "external_assessment_results"("interview_round_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_ext_assess_ext_ref" ON "external_assessment_results"("external_reference")`,
    `CREATE INDEX IF NOT EXISTS "idx_ext_assess_review_status" ON "external_assessment_results"("review_status")`,
    `CREATE INDEX IF NOT EXISTS "idx_ext_assess_org_id" ON "external_assessment_results"("organization_id")`,

    `CREATE TABLE IF NOT EXISTS "integration_inbox_events" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL DEFAULT 'recruit_ai',
      "event_id" TEXT NOT NULL UNIQUE,
      "type" TEXT NOT NULL,
      "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "signature_valid" BOOLEAN NOT NULL DEFAULT true,
      "processed_at" TIMESTAMP(3),
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "last_error" TEXT,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "payload" JSONB NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS "idx_inbox_provider_status" ON "integration_inbox_events"("provider", "status")`,
    `CREATE INDEX IF NOT EXISTS "idx_inbox_received_at" ON "integration_inbox_events"("received_at")`,

    `CREATE TABLE IF NOT EXISTS "integration_sync_states" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL UNIQUE,
      "last_successful_cursor" TEXT,
      "last_sync_at" TIMESTAMP(3),
      "last_error" TEXT,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    `INSERT INTO "integration_providers" ("id", "key", "name", "enabled", "config", "created_at", "updated_at")
     VALUES ('prov_recruit_ai', 'recruit_ai', 'Recruit AI / HireIQ Voice Interviewer', true, '{"baseUrl":"https://187.127.137.103"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO NOTHING`
  ];

  for (let i = 0; i < statements.length; i++) {
    try {
      await prisma.$executeRawUnsafe(statements[i]);
      console.log(`✅ Statement ${i + 1}/${statements.length} applied successfully`);
    } catch (e) {
      console.error(`❌ Statement ${i + 1} failed:`, e.message);
      throw e;
    }
  }

  console.log('[Migration] All integration tables verified and ready!');
  await prisma.$disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
