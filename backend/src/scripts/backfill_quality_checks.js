'use strict';

/**
 * scripts/backfill_quality_checks.js
 * 
 * Idempotent script to backfill QualityCheck rows for qualifying candidates
 * (Round 2 / Final Round SELECTED, or OFFER_PROPOSED) from the last N days (default 3).
 * 
 * Usage:
 *   node src/scripts/backfill_quality_checks.js [days=3]
 */

require('dotenv').config();
const prisma = require('../config/db');

async function runBackfill() {
  const daysArg = parseInt(process.argv[2], 10);
  const lookbackDays = !isNaN(daysArg) && daysArg > 0 ? daysArg : 3;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  console.log(`\n[QC Backfill] Starting idempotent backfill with lookback: ${lookbackDays} days (since ${since.toISOString()})...\n`);

  let createdCount = 0;
  let skippedCount = 0;

  // 1. Fetch qualifying feedbacks (SELECTED for ROUND_2 or FINAL_ROUND)
  const feedbacks = await prisma.interviewFeedback.findMany({
    where: {
      selectionStatus: 'SELECTED',
      round: { in: ['ROUND_2', 'FINAL_ROUND'] },
      deletedAt: null,
      createdAt: { gte: since },
    },
    include: {
      candidate: {
        select: { id: true, fullName: true, organizationId: true, isDeleted: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[QC Backfill] Found ${feedbacks.length} qualifying feedbacks in window.`);

  for (const fb of feedbacks) {
    if (!fb.candidateId || !fb.candidate || fb.candidate.isDeleted) continue;

    const orgId = fb.candidate.organizationId || 'defaultOrg';
    const existing = await prisma.qualityCheck.findFirst({
      where: {
        candidateId: fb.candidateId,
        interviewRoundId: fb.id,
      },
    });

    if (existing) {
      skippedCount++;
    } else {
      await prisma.qualityCheck.create({
        data: {
          candidateId: fb.candidateId,
          interviewRoundId: fb.id,
          round: fb.round,
          status: 'PENDING',
          source: 'BACKFILL',
          organizationId: orgId,
          enteredQueueAt: fb.createdAt || new Date(),
        },
      });
      console.log(`  + Created QualityCheck for "${fb.candidate.fullName}" (candidate: ${fb.candidateId}, round: ${fb.round})`);
      createdCount++;
    }
  }

  // 2. Fetch candidates with OFFER_PROPOSED status
  const offerProposed = await prisma.candidate.findMany({
    where: {
      status: 'OFFER_PROPOSED',
      isDeleted: false,
      updatedAt: { gte: since },
    },
    select: { id: true, fullName: true, organizationId: true, updatedAt: true },
  });

  console.log(`[QC Backfill] Found ${offerProposed.length} OFFER_PROPOSED candidates in window.`);

  for (const cand of offerProposed) {
    const orgId = cand.organizationId || 'defaultOrg';
    const existing = await prisma.qualityCheck.findFirst({
      where: { candidateId: cand.id },
    });

    if (existing) {
      skippedCount++;
    } else {
      await prisma.qualityCheck.create({
        data: {
          candidateId: cand.id,
          status: 'PENDING',
          source: 'OFFER_PROPOSED',
          organizationId: orgId,
          enteredQueueAt: cand.updatedAt || new Date(),
        },
      });
      console.log(`  + Created QualityCheck for OFFER_PROPOSED candidate "${cand.fullName}" (${cand.id})`);
      createdCount++;
    }
  }

  console.log(`\n[QC Backfill] Backfill complete!`);
  console.log(`  - Newly Created: ${createdCount}`);
  console.log(`  - Already Present (Skipped): ${skippedCount}\n`);
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[QC Backfill] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
