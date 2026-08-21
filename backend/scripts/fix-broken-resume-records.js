'use strict';
/**
 * fix-broken-resume-records.js
 *
 * One-time remediation script for the persistent storage migration.
 *
 * Context:
 *   Commit 6fcfce2 (Aug 20 2026) migrated resume uploads from local disk to
 *   PostgreSQL BYTEA. However, existing FileMeta records created BEFORE that
 *   commit have storageKey = "/uploads/resumes/<filename>" and fileData = NULL.
 *   The files were wiped from Render's ephemeral disk during that same deploy.
 *
 * This script:
 *   1. Finds all FileMeta records with local-disk storage keys and no fileData
 *   2. Finds all Candidate records pointing to those FileMeta records
 *   3. NULLs out candidate.resumeFileId (removes the broken reference)
 *   4. Deletes the orphaned FileMeta records (they contain no data)
 *   5. Prints a full report
 *
 * Usage:
 *   node scripts/fix-broken-resume-records.js --dry-run   # preview only
 *   node scripts/fix-broken-resume-records.js              # apply changes
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('='.repeat(60));
  console.log('fix-broken-resume-records.js');
  console.log(DRY_RUN ? '  MODE: DRY RUN (no changes will be made)' : '  MODE: APPLY (changes WILL be made to the DB)');
  console.log('='.repeat(60));

  // Step 1: Find all FileMeta records with local-disk paths and no fileData
  const brokenFileMetas = await prisma.fileMeta.findMany({
    where: {
      OR: [
        { storageKey: { startsWith: '/uploads/' } },
        { storageKey: { startsWith: 'uploads/' } },
      ],
      fileData: null,
    },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      sizeBytes: true,
      createdAt: true,
    }
  });

  console.log(`\nStep 1: Found ${brokenFileMetas.length} broken FileMeta records (local-disk path, no fileData)`);
  brokenFileMetas.forEach((fm, i) => {
    console.log(`  [${i + 1}] id=${fm.id}  name=${fm.originalName}  path=${fm.storageKey}`);
  });

  if (brokenFileMetas.length === 0) {
    console.log('\nNothing to fix. All FileMeta records are either DB-stored or already cleaned up.');
    return;
  }

  const brokenFileMetaIds = brokenFileMetas.map(fm => fm.id);

  // Step 2: Find all candidates pointing to these broken FileMeta records
  const affectedCandidates = await prisma.candidate.findMany({
    where: {
      resumeFileId: { in: brokenFileMetaIds }
    },
    select: {
      id: true,
      fullName: true,
      resumeFileId: true,
      status: true,
      organizationId: true,
    }
  });

  console.log(`\nStep 2: Found ${affectedCandidates.length} candidates with broken resumeFileId references`);
  affectedCandidates.forEach((c, i) => {
    console.log(`  [${i + 1}] id=${c.id}  name="${c.fullName}"  resumeFileId=${c.resumeFileId}`);
  });

  // Also check for profilePhotoFileId pointing to broken records (shouldn't happen, but be safe)
  const affectedPhotoCandidates = await prisma.candidate.findMany({
    where: {
      profilePhotoFileId: { in: brokenFileMetaIds }
    },
    select: { id: true, fullName: true, profilePhotoFileId: true }
  });
  if (affectedPhotoCandidates.length > 0) {
    console.log(`\n  Also found ${affectedPhotoCandidates.length} candidates with broken profilePhotoFileId:`);
    affectedPhotoCandidates.forEach(c => console.log(`    id=${c.id}  name="${c.fullName}"`));
  }

  if (DRY_RUN) {
    console.log('\n' + '='.repeat(60));
    console.log('DRY RUN COMPLETE — no changes made.');
    console.log(`Would NULL out resumeFileId on ${affectedCandidates.length} candidates.`);
    if (affectedPhotoCandidates.length > 0) {
      console.log(`Would NULL out profilePhotoFileId on ${affectedPhotoCandidates.length} candidates.`);
    }
    console.log(`Would delete ${brokenFileMetas.length} orphaned FileMeta records.`);
    console.log('\nRun WITHOUT --dry-run to apply.');
    console.log('='.repeat(60));
    return;
  }

  // Step 3: NULL out resumeFileId on affected candidates
  console.log('\nStep 3: Clearing broken resumeFileId references...');
  const candidateIds = affectedCandidates.map(c => c.id);
  if (candidateIds.length > 0) {
    const { count: resumeCount } = await prisma.candidate.updateMany({
      where: { id: { in: candidateIds } },
      data: { resumeFileId: null }
    });
    console.log(`  Updated ${resumeCount} candidates (resumeFileId set to NULL).`);
  }

  // Step 3b: NULL out profilePhotoFileId if any were affected
  if (affectedPhotoCandidates.length > 0) {
    const photoIds = affectedPhotoCandidates.map(c => c.id);
    const { count: photoCount } = await prisma.candidate.updateMany({
      where: { id: { in: photoIds } },
      data: { profilePhotoFileId: null }
    });
    console.log(`  Updated ${photoCount} candidates (profilePhotoFileId set to NULL).`);
  }

  // Step 4: Delete the orphaned FileMeta records
  console.log('\nStep 4: Deleting orphaned FileMeta records...');
  const { count: deletedCount } = await prisma.fileMeta.deleteMany({
    where: { id: { in: brokenFileMetaIds } }
  });
  console.log(`  Deleted ${deletedCount} FileMeta records.`);

  // Step 5: Verification
  console.log('\nStep 5: Verifying...');
  const remainingBroken = await prisma.fileMeta.count({
    where: {
      OR: [
        { storageKey: { startsWith: '/uploads/' } },
        { storageKey: { startsWith: 'uploads/' } },
      ],
      fileData: null,
    }
  });
  console.log(`  Remaining broken FileMeta records: ${remainingBroken} (should be 0)`);

  const stillBrokenCandidates = await prisma.candidate.count({
    where: {
      resumeFile: {
        OR: [
          { storageKey: { startsWith: '/uploads/' } },
          { storageKey: { startsWith: 'uploads/' } },
        ],
        fileData: null,
      }
    }
  });
  console.log(`  Candidates still pointing to broken FileMeta: ${stillBrokenCandidates} (should be 0)`);

  // Check Dileep specifically
  const dileep = await prisma.candidate.findFirst({
    where: { fullName: { contains: 'Dileep', mode: 'insensitive' } },
    select: { id: true, fullName: true, resumeFileId: true }
  });
  if (dileep) {
    console.log(`  Dileep Kumar G V: resumeFileId = ${dileep.resumeFileId ?? 'null (cleared ✓)'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('FIX COMPLETE.');
  console.log(`  ${affectedCandidates.length} candidates had broken resume references cleared.`);
  console.log(`  ${deletedCount} orphaned FileMeta records deleted.`);
  console.log('  Affected candidates must re-upload their resumes.');
  console.log('='.repeat(60));

  // Print affected candidate list for handoff
  console.log('\nAffected candidates (need resume re-upload):');
  affectedCandidates.forEach((c, i) => {
    console.log(`  ${i + 1}. "${c.fullName}" (id: ${c.id})`);
  });
}

main()
  .catch(err => {
    console.error('\nFATAL ERROR:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
