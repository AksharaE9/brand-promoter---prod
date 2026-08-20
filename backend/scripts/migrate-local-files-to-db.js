/**
 * migrate-local-files-to-db.js
 *
 * One-shot migration to move all existing files stored as local `/uploads/` paths
 * in the database into the fileData (BYTEA) column in PostgreSQL.
 *
 * Run once from the developer's local machine where the original files still exist.
 * After running, all DB rows will have fileData populated and storageKey = "db://<id>".
 *
 * Usage:
 *   cd backend
 *   node scripts/migrate-local-files-to-db.js
 */

'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function makeStorageKey(id) {
  return `db://${id}`;
}

function isLocal(key) {
  return key && (key.startsWith('/uploads/') || key.startsWith('uploads/'));
}

function resolveLocalPath(storageKey) {
  const rel = storageKey.startsWith('/') ? storageKey.slice(1) : storageKey;
  return path.join(__dirname, '..', rel);
}

async function migrateTable(label, records, idField, urlField, updateFn) {
  let migrated = 0, skipped = 0, missing = 0;
  for (const rec of records) {
    const url = rec[urlField];
    if (!isLocal(url)) { skipped++; continue; }
    const localPath = resolveLocalPath(url);
    if (!fs.existsSync(localPath)) {
      console.warn(`  ⚠️  [${label}] File missing on disk: ${localPath}`);
      missing++;
      continue;
    }
    const buffer = fs.readFileSync(localPath);
    await updateFn(rec[idField], buffer);
    console.log(`  ✅ [${label}] Migrated: ${url}`);
    migrated++;
  }
  return { migrated, skipped, missing };
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Local Files → PostgreSQL DB Migration');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── 1. PostedFiles ──────────────────────────────────────────────────────────
  console.log('[PostedFiles] Loading records with local storage keys...');
  const postedFiles = await prisma.postedFile.findMany({
    where: { storageKey: { startsWith: '/uploads/' } },
    select: { id: true, storageKey: true }
  });
  console.log(`  Found ${postedFiles.length} local-stored records.`);

  const pfResult = await migrateTable('PostedFile', postedFiles, 'id', 'storageKey', async (id, buf) => {
    await prisma.postedFile.update({
      where: { id },
      data: { fileData: buf, storageKey: makeStorageKey(id) }
    });
  });

  // ── 2. SchedulingMemberFiles ─────────────────────────────────────────────────
  console.log('\n[SchedulingMemberFiles] Loading records with local storage keys...');
  const smFiles = await prisma.schedulingMemberFile.findMany({
    where: { fileUrl: { startsWith: '/uploads/' } },
    select: { id: true, fileUrl: true }
  });
  console.log(`  Found ${smFiles.length} local-stored records.`);

  const smResult = await migrateTable('SchedulingMemberFile', smFiles, 'id', 'fileUrl', async (id, buf) => {
    await prisma.schedulingMemberFile.update({
      where: { id },
      data: { fileData: buf, fileUrl: makeStorageKey(id) }
    });
  });

  // ── 3. RecruitmentReports ────────────────────────────────────────────────────
  console.log('\n[RecruitmentReports] Loading records with local storage keys...');
  const reports = await prisma.recruitmentReport.findMany({
    where: { fileUrl: { startsWith: '/uploads/' }, isDeleted: false },
    select: { id: true, fileUrl: true }
  });
  console.log(`  Found ${reports.length} local-stored records.`);

  const rrResult = await migrateTable('RecruitmentReport', reports, 'id', 'fileUrl', async (id, buf) => {
    await prisma.recruitmentReport.update({
      where: { id },
      data: { fileData: buf, fileUrl: makeStorageKey(id) }
    });
  });

  // ── 4. FileMetas (resumes, profile photos, recordings) ───────────────────────
  console.log('\n[FileMeta] Loading records with local storage keys...');
  const fileMetas = await prisma.fileMeta.findMany({
    where: {
      OR: [
        { storageKey: { startsWith: '/uploads/' } },
        { storageKey: { startsWith: 'uploads/' } },
      ]
    },
    select: { id: true, storageKey: true }
  });
  console.log(`  Found ${fileMetas.length} local-stored records.`);

  const fmResult = await migrateTable('FileMeta', fileMetas, 'id', 'storageKey', async (id, buf) => {
    await prisma.fileMeta.update({
      where: { id },
      data: { fileData: buf, storageKey: makeStorageKey(id) }
    });
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const [label, r] of [
    ['PostedFiles', pfResult], ['SchedulingMemberFiles', smResult],
    ['RecruitmentReports', rrResult], ['FileMetas', fmResult]
  ]) {
    console.log(`  ${label}: ✅ Migrated=${r.migrated}  ⏭ Skipped=${r.skipped}  ⚠️  Missing=${r.missing}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
