'use strict';

const prisma = require('../config/db');

/**
 * Reconcile candidates who cleared Round 2/Final Round or were marked OFFER_PROPOSED
 * but do not have a QualityCheck record.
 */
async function runQualityCheckReconciliation(lookbackDays = 7, limit = 100) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  console.log(`[QC Reconciliation] Starting check for qualifying candidates since ${since.toISOString()} (limit ${limit})...`);

  let enqueuedCount = 0;
  let skippedCount = 0;

  try {
    // 1. Find qualifying interview feedbacks (SELECTED for ROUND_2 or FINAL_ROUND)
    const qualifyingFeedbacks = await prisma.interviewFeedback.findMany({
      where: {
        selectionStatus: 'SELECTED',
        round: { in: ['ROUND_2', 'FINAL_ROUND'] },
        deletedAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        candidateId: true,
        round: true,
        createdAt: true,
        candidate: {
          select: {
            id: true,
            organizationId: true,
            isDeleted: true,
          },
        },
      },
    });

    for (const fb of qualifyingFeedbacks) {
      if (!fb.candidateId || !fb.candidate || fb.candidate.isDeleted) continue;

      const orgId = fb.candidate.organizationId || 'defaultOrg';
      const existing = await prisma.qualityCheck.findFirst({
        where: {
          candidateId: fb.candidateId,
          interviewRoundId: fb.id,
        },
      });

      if (!existing) {
        await prisma.qualityCheck.create({
          data: {
            candidateId: fb.candidateId,
            interviewRoundId: fb.id,
            round: fb.round,
            status: 'PENDING',
            source: 'RECONCILIATION',
            organizationId: orgId,
            enteredQueueAt: fb.createdAt || new Date(),
          },
        });
        console.log(`[QC Reconciliation] Created QualityCheck for candidate ${fb.candidateId} (round: ${fb.round})`);
        enqueuedCount++;
      } else {
        skippedCount++;
      }
    }

    // 2. Find candidates with status OFFER_PROPOSED and no QC
    const offerProposedCandidates = await prisma.candidate.findMany({
      where: {
        status: 'OFFER_PROPOSED',
        isDeleted: false,
        updatedAt: { gte: since },
      },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        updatedAt: true,
      },
    });

    for (const cand of offerProposedCandidates) {
      const orgId = cand.organizationId || 'defaultOrg';
      const existing = await prisma.qualityCheck.findFirst({
        where: {
          candidateId: cand.id,
        },
      });

      if (!existing) {
        await prisma.qualityCheck.create({
          data: {
            candidateId: cand.id,
            status: 'PENDING',
            source: 'OFFER_PROPOSED',
            organizationId: orgId,
            enteredQueueAt: cand.updatedAt || new Date(),
          },
        });
        console.log(`[QC Reconciliation] Created QualityCheck for OFFER_PROPOSED candidate ${cand.id}`);
        enqueuedCount++;
      }
    }

    console.log(`[QC Reconciliation] Completed. Enqueued: ${enqueuedCount}, Already present: ${skippedCount}`);
    return { enqueuedCount, skippedCount };
  } catch (err) {
    console.error('[QC Reconciliation] Error during reconciliation job:', err.message);
    return { enqueuedCount, skippedCount, error: err.message };
  }
}

module.exports = {
  runQualityCheckReconciliation,
};
