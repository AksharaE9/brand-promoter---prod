'use strict';

/**
 * qa/data-audit/audit_drives_and_integrity.js
 *
 * Direct read-only SQL Data Integrity Audit of all campus drives and interview rounds.
 */

const path = require('path');
require('../../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

async function runAudit() {
  console.log('=== PART 5: DATA INTEGRITY AUDIT ===\n');

  // 1. Audit College Drives & Candidate Counts
  const drives = await prisma.$queryRawUnsafe(`
    SELECT cd.id, cd.title, cd."dateFrom", COUNT(cdc."candidateId") as "candidateCount"
    FROM "college_drives" cd
    LEFT JOIN "college_drive_candidates" cdc ON cd.id = cdc."driveId"
    GROUP BY cd.id, cd.title, cd."dateFrom"
    ORDER BY cd.title ASC
  `);

  console.log('--- 1. College Drives & Candidate Counts ---');
  console.table(drives.map(d => ({
    id: d.id,
    college: d.title,
    dateFrom: d.dateFrom ? new Date(d.dateFrom).toISOString().split('T')[0] : 'N/A',
    candidateCount: Number(d.candidateCount)
  })));

  // 2. Cambridge Defect Check (COMPLETED with no outcome)
  const completedNoOutcome = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count 
    FROM "interviews" 
    WHERE "status" = 'COMPLETED' AND "outcome" IS NULL
  `);
  console.log(`\n--- 2. Cambridge Defect Check ---`);
  console.log(`Interviews with status COMPLETED and outcome NULL: ${completedNoOutcome[0]?.count || 0}`);
  if (Number(completedNoOutcome[0]?.count) === 0) {
    console.log('✅ PASS: Zero rounds have COMPLETED status with missing outcome.');
  } else {
    console.warn(`⚠️ FAIL: ${completedNoOutcome[0]?.count} rounds have status COMPLETED but outcome is NULL!`);
  }

  // 3. Ratings: blanks NULL vs 0 Check
  const zeroRatings = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count 
    FROM "interview_feedbacks" 
    WHERE "overallRating" = 0
  `);
  console.log(`\n--- 3. Feedback Rating Check ---`);
  console.log(`Feedbacks with overallRating = 0: ${zeroRatings[0]?.count || 0}`);

  // 4. Orphan Rows Audit
  const [roundsWithoutCandidate, feedbackWithoutCandidate, filesWithoutOwner] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count 
      FROM "interviews" i 
      LEFT JOIN "candidates" c ON i."candidateId" = c."id" 
      WHERE c."id" IS NULL AND i."candidateId" IS NOT NULL
    `),
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count 
      FROM "interview_feedbacks" f 
      LEFT JOIN "candidates" c ON f."candidateId" = c."id" 
      WHERE c."id" IS NULL AND f."candidateId" IS NOT NULL
    `),
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count 
      FROM "file_metas" f 
      LEFT JOIN "candidates" c ON f."id" = c."resumeFileId" OR f."id" = c."profilePhotoFileId"
      WHERE c."id" IS NULL
    `)
  ]);

  console.log('\n--- 4. Orphan Rows Audit ---');
  console.log('Rounds without candidate:', Number(roundsWithoutCandidate[0]?.count || 0));
  console.log('Feedback without candidate:', Number(feedbackWithoutCandidate[0]?.count || 0));
  console.log('Unlinked file metas:', Number(filesWithoutOwner[0]?.count || 0));

  // 5. Duplicate Phone / Email Check (Excluding known placeholders)
  const duplicateEmails = await prisma.$queryRawUnsafe(`
    SELECT email, COUNT(*) as count 
    FROM "candidates" 
    WHERE "isDeleted" = false 
      AND email NOT IN ('N/A', '', 'dummy@gmail.com', 'test@example.com', 'dummy@gmail.c')
      AND email NOT LIKE 'dummy%'
      AND email NOT LIKE 'test%'
    GROUP BY email 
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 10
  `);

  console.log('\n--- 5. Duplicate Emails (Excluding Placeholders) ---');
  if (duplicateEmails.length === 0) {
    console.log('✅ Zero duplicate emails found across genuine candidate records.');
  } else {
    console.table(duplicateEmails);
  }

  // 6. Drive Outcome Breakdown
  console.log('\n--- 6. Drive Outcome Breakdown ---');
  const driveOutcomes = await prisma.$queryRawUnsafe(`
    SELECT 
      cd."title",
      i."outcome",
      COUNT(*) as count
    FROM "interviews" i
    JOIN "candidates" c ON i."candidateId" = c."id"
    JOIN "college_drive_candidates" cdc ON cdc."candidateId" = c."id"
    JOIN "college_drives" cd ON cdc."driveId" = cd."id"
    WHERE c."isDeleted" = false
    GROUP BY cd."title", i."outcome"
    ORDER BY cd."title", count DESC
  `);
  console.table(driveOutcomes);

  await prisma.$disconnect();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
