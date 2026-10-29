'use strict';
/**
 * scripts/repairs/repair_qa003_ratings.js
 *
 * Repairs QA-003: 33 interview_feedbacks records where overallRating was erroneously saved as 0
 * due to Number('') conversion on empty form strings.
 * Updates overallRating to NULL where rating was not deliberately entered (scale is 1-10).
 *
 * Default is DRY-RUN mode. Pass --execute to apply changes.
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '../../backend/node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

const IS_EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(`=== QA-003 REPAIR SCRIPT [Mode: ${IS_EXECUTE ? 'LIVE EXECUTE' : 'DRY RUN'}] ===\n`);

  const zeroFbs = await prisma.interviewFeedback.findMany({
    where: { overallRating: 0 },
    select: {
      id: true,
      candidateId: true,
      round: true,
      selectionStatus: true,
      overallRating: true,
      feedbackData: true,
      createdAt: true
    }
  });

  console.log(`Found ${zeroFbs.length} record(s) with overallRating === 0.\n`);

  for (const fb of zeroFbs) {
    console.log(`Feedback [${fb.id}] Candidate: ${fb.candidateId} | Round: ${fb.round} | Status: ${fb.selectionStatus}`);
    console.log(`  Before: overallRating = 0`);
    console.log(`  After:  overallRating = null`);

    if (IS_EXECUTE) {
      await prisma.interviewFeedback.update({
        where: { id: fb.id },
        data: { overallRating: null }
      });
      console.log(`  -> APPLIED update to DB.`);
    } else {
      console.log(`  -> [DRY RUN] Would update feedback ${fb.id}.`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
