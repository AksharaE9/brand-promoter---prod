'use strict';
/**
 * scripts/repairs/repair_qa004_orphan.js
 *
 * Repairs QA-004: 1 orphan interview (cms67spfk0005ijbg96pjc22w) left behind after
 * test candidate cms67snqw0000ijbg2bj3evle was hard-deleted.
 *
 * Default is DRY-RUN mode. Pass --execute to apply changes.
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '../../backend/node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

const IS_EXECUTE = process.argv.includes('--execute');
const ORPHAN_INTERVIEW_ID = 'cms67spfk0005ijbg96pjc22w';

async function main() {
  console.log(`=== QA-004 REPAIR SCRIPT [Mode: ${IS_EXECUTE ? 'LIVE EXECUTE' : 'DRY RUN'}] ===\n`);

  const orphan = await prisma.interview.findUnique({
    where: { id: ORPHAN_INTERVIEW_ID }
  });

  if (!orphan) {
    console.log(`Orphan interview ${ORPHAN_INTERVIEW_ID} no longer exists in database.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Orphan Interview:`);
  console.log(`  ID: ${orphan.id}`);
  console.log(`  Candidate ID: ${orphan.candidateId}`);
  console.log(`  Candidate Name: ${orphan.candidateName}`);
  console.log(`  Status: ${orphan.status}`);
  console.log(`  Action: Delete orphan interview record`);

  if (IS_EXECUTE) {
    await prisma.interview.delete({
      where: { id: orphan.id }
    });
    console.log(`  -> APPLIED: Deleted orphan interview ${orphan.id}.`);
  } else {
    console.log(`  -> [DRY RUN] Would delete orphan interview ${orphan.id}.`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
