'use strict';
/**
 * scripts/repairs/repair_gopalan.js
 *
 * Repairs Gopalan Engineering Drive discrepancies:
 * 1. Corrects Brunda B (cmuz6f309003dtby0qc992yin) R2 outcome from SELECTED to REJECTED.
 * 2. Strictly leaves DIVYASHREE RM untouched (legitimate CHANGED_AFTER_IMPORT round).
 *
 * Default is DRY-RUN mode. Pass --execute to apply changes.
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '../../backend/node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
const prisma = require('../../backend/src/config/db');

const IS_EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(`=== GOPALAN REPAIR SCRIPT [Mode: ${IS_EXECUTE ? 'LIVE EXECUTE' : 'DRY RUN'}] ===\n`);

  const brundaCandId = 'cmuz6f309003dtby0qc992yin';
  const r2Intv = await prisma.interview.findFirst({
    where: { candidateId: brundaCandId, roundNo: 2 }
  });

  if (!r2Intv) {
    console.log(`[SKIP] No R2 interview found for Brunda B (${brundaCandId})`);
  } else {
    console.log(`Candidate: B Brunda [${brundaCandId}]`);
    console.log(`  Interview ID: ${r2Intv.id}`);
    console.log(`  Before: outcome = "${r2Intv.outcome}", result = "${r2Intv.result}"`);
    console.log(`  After:  outcome = "REJECTED", result = "REJECTED"`);

    if (IS_EXECUTE) {
      await prisma.interview.update({
        where: { id: r2Intv.id },
        data: {
          outcome: 'REJECTED',
          result: 'REJECTED',
          outcomeSetAt: new Date()
        }
      });
      console.log(`  -> APPLIED update to DB.`);
    } else {
      console.log(`  -> [DRY RUN] Would update interview ${r2Intv.id}.`);
    }
  }

  console.log(`\nCandidate DIVYASHREE RM: Preserved as CHANGED_AFTER_IMPORT (no modification).`);

  await prisma.$disconnect();
}

main().catch(console.error);
