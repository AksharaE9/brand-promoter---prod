'use strict';
/**
 * scripts/repairs/repair_nmit.js
 *
 * Repairs NMIT College Drive discrepancies:
 * 1. Corrects R2 outcomes for 5 candidates erroneously written as SELECTED by execute_job_b_sync.js
 *    - Ayush madnapotra: REJECTED
 *    - NAG PRATHIK: REJECTED
 *    - Jesto Gigi Kadavi: REJECTED
 *    - Dhruthi SL: ON_HOLD
 *    - Sai Prateesh: ON_HOLD
 * 2. Deduplicates Himanshu Singh (soft-deletes empty duplicate cmv7pq9d50019tb9gjdxola5v)
 *
 * Default is DRY-RUN mode. Pass --execute to apply changes.
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '../../backend/node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

const IS_EXECUTE = process.argv.includes('--execute');

const CORRECTIONS = [
  { candId: 'cmv7pmb28002ptbaksz5s4bg5', name: 'Ayush madnapotra', targetOutcome: 'REJECTED' },
  { candId: 'cmv7pln1t0005tbakbluyo51q', name: 'NAG PRATHIK', targetOutcome: 'REJECTED' },
  { candId: 'cmv7pm48n001vtbakc80ylkgw', name: 'Jesto Gigi Kadavi', targetOutcome: 'REJECTED' },
  { candId: 'cmv7pm9iv002ktbakm0sf2aj7', name: 'Dhruthi SL', targetOutcome: 'ON_HOLD' },
  { candId: 'cmv7pmdqv002ztbak46lrzbya', name: 'Sai Prateesh', targetOutcome: 'ON_HOLD' }
];

async function main() {
  console.log(`=== NMIT REPAIR SCRIPT [Mode: ${IS_EXECUTE ? 'LIVE EXECUTE' : 'DRY RUN'}] ===\n`);

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

  // Deduplicate Himanshu Singh
  console.log(`\n--- Deduplicating Himanshu Singh ---`);
  const dupCand = await prisma.candidate.findUnique({
    where: { id: 'cmv7pq9d50019tb9gjdxola5v' }
  });
  if (dupCand) {
    console.log(`Duplicate Candidate: ${dupCand.fullName} [${dupCand.id}]`);
    console.log(`  Before: isDeleted = ${dupCand.isDeleted}`);
    console.log(`  After:  isDeleted = true, deletedAt = NOW()`);
    if (IS_EXECUTE) {
      await prisma.candidate.update({
        where: { id: dupCand.id },
        data: { isDeleted: true, deletedAt: new Date() }
      });
      await prisma.collegeDriveCandidate.deleteMany({
        where: { candidateId: dupCand.id }
      });
      console.log(`  -> APPLIED soft-delete and unlinked from college_drive_candidates.`);
    } else {
      console.log(`  -> [DRY RUN] Would soft-delete candidate ${dupCand.id}.`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
