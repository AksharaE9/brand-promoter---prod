'use strict';

/**
 * importDbInit.js — Idempotent database schema initializer for import jobs & idempotency keys.
 * Ensures import_jobs and import_processed_keys tables exist in Neon DB (PostgreSQL).
 */

const prisma = require('../config/db');

let isInitialized = false;

async function initImportDb() {
  if (isInitialized) return;

  try {
    // 1. Create import_jobs table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        id VARCHAR(255) PRIMARY KEY,
        flow_type VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        file_path TEXT,
        source_filename TEXT,
        uploaded_by VARCHAR(255),
        organization_id VARCHAR(255) DEFAULT 'defaultOrg',
        total_rows INT DEFAULT 0,
        last_processed_row INT DEFAULT 0,
        last_committed_row INT DEFAULT 0,
        created_count INT DEFAULT 0,
        updated_count INT DEFAULT 0,
        duplicates_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        resume_attempts INT DEFAULT 0,
        created_entity_ids JSONB DEFAULT '[]'::jsonb,
        error_report_url TEXT,
        metrics JSONB DEFAULT '{}'::jsonb,
        checkpoint_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Create import_processed_keys table for row-level idempotency
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS import_processed_keys (
        id VARCHAR(255) PRIMARY KEY,
        job_id VARCHAR(255) NOT NULL,
        row_number INT NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        entity_id VARCHAR(255),
        action VARCHAR(50) NOT NULL DEFAULT 'CREATED',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 3. Create indices for performance
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_import_jobs_org_status ON import_jobs (organization_id, status);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_import_jobs_checkpoint ON import_jobs (status, checkpoint_at);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_import_keys_job_key ON import_processed_keys (job_id, idempotency_key);
    `);

    isInitialized = true;
    console.log('[ImportDbInit] Import persistence tables and indices initialized successfully.');
  } catch (err) {
    console.warn('[ImportDbInit] Database table initialization warning:', err.message);
  }
}

module.exports = {
  initImportDb,
};
