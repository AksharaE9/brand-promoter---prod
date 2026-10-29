'use strict';
/**
 * scripts/repairs/repair_jain.js
 *
 * Repairs Jain College Drive discrepancies:
 * 1. Corrects R2 outcomes for 3 candidates erroneously written as SELECTED instead of ON_HOLD:
 *    - Dhruvanth R: ON_HOLD
 *    - Pranav Dhaasaiya: ON_HOLD
 *    - Sanjay E: ON_HOLD
 * 2. Links Harsha Vardhan Reddy (cmvqbkmqn006vtbqoh70ai6v4) to CollegeDriveCandidate for Jain drive
 *
 * Default is DRY-RUN mode. Pass --execute to apply changes.
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '../../backend/node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

const IS_EXECUTE = process.argv.includes('--execute');
const JAIN_DRIVE_ID = 'cmrvvgvnj0007mt29fxu60ik8';

const CORRECTIONS = [
  { candId: 'cmvhn6zjm003ntbqsvdglvc3v', name: 'DHRUVANTH R', targetOutcome: 'ON_HOLD' },
  { candId: 'cmvhn6wx4003dtbqshp7dnuet', name: 'PRANAV DHAASAIYA', targetOutcome: 'ON_HOLD' },
  { candId: 'cmvhn6rmp002ttbqsr0tmntaw', name: 'SANJAY E', targetOutcome: 'ON_HOLD' }
];

async function main() {
  console.log(`=== JAIN REPAIR SCRIPT [Mode: ${IS_EXECUTE ? 'LIVE EXECUTE' : 'DRY RUN'}] ===\n`);

  for (const c of CORRECTIONS) {
    const r2Intv = await prisma.interview.findFirst({
      where: { candidateId: c.candId, roundNo: 2 }
    });
    if (!r2Intv) {
      console.log(`[SKIP] No R2 interview found for ${c.name} (${c.candId})`);
      continue;
    }

    console.log(`Candidate: ${c.name} [${c.candId}]`);
    console.log(`  Interview ID: ${r2Intv.id}`);
    console.log(`  Before: outcome = "${r2Intv.outcome}", result = "${r2Intv.result}"`);
    console.log(`  After:  outcome = "${c.targetOutcome}", result = "${c.targetOutcome}"`);

    if (IS_EXECUTE) {
      await prisma.interview.update({
        where: { id: r2Intv.id },
        data: {
          outcome: c.targetOutcome,
          result: c.targetOutcome,
          outcomeSetAt: new Date()
        }
      });
      console.log(`  -> APPLIED update to DB.`);
    } else {
      console.log(`  -> [DRY RUN] Would update interview ${r2Intv.id}.`);
    }
  }

  // Link Harsha Vardhan Reddy
  console.log(`\n--- Linking Harsha Vardhan Reddy to Jain College Drive ---`);
  const harsha = await prisma.candidate.findUnique({
    where: { id: 'cmvqbkmqn006vtbqoh70ai6v4' }
  });
  if (harsha) {
    const existingCdc = await prisma.collegeDriveCandidate.findFirst({
      where: { driveId: JAIN_DRIVE_ID, candidateId: harsha.id }
    });
    if (existingCdc) {
      console.log(`Harsha Vardhan Reddy is already linked to drive.`);
    } else {
      console.log(`Candidate: ${harsha.fullName} [${harsha.id}]`);
      console.log(`  Action: Create CollegeDriveCandidate record linking to drive ${JAIN_DRIVE_ID}`);
      if (IS_EXECUTE) {
        await prisma.collegeDriveCandidate.create({
          data: {
            driveId: JAIN_DRIVE_ID,
            candidateId: harsha.id,
            fullName: harsha.fullName,
            email: harsha.email,
            phone: harsha.phone || '',
            status: 'ADDED'
          }
        });
        console.log(`  -> APPLIED linkage.`);
      } else {
        console.log(`  -> [DRY RUN] Would link Harsha Vardhan Reddy.`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
