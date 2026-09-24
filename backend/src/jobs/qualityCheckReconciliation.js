'use strict';

const prisma = require('../config/db');

// Explicit cutoff timestamp for last 2 days (Sept 22, 2026 onwards)
const CUTOFF_DATE = new Date(process.env.QUALITY_CHECK_CUTOFF_DATE || '2026-09-22T00:00:00.000Z');

/**
 * Reconcile candidates who cleared Round 2/Final Round or were marked for Offer Letter
 * from Sept 22, 2026 onwards.
 */
async function runQualityCheckReconciliation() {
  console.log(`[QC Reconciliation] Starting check for qualifying candidates from ${CUTOFF_DATE.toISOString()} onwards...`);

  let enqueuedCount = 0;
  let skippedCount = 0;

  try {
    // 1. First, remove any pending records older than the 2-day cutoff (Sept 22)
    const deletedOld = await prisma.qualityCheck.deleteMany({
      where: {
        status: 'PENDING',
        enteredQueueAt: {
          lt: CUTOFF_DATE,
        },
      },
    });
    if (deletedOld.count > 0) {
      console.log(`[QC Reconciliation] Cleaned ${deletedOld.count} older pending QC records created prior to ${CUTOFF_DATE.toISOString()}`);
    }

    // 2. Find qualifying interview feedbacks (SELECTED for ROUND_2 or FINAL_ROUND) since Sept 22
    const qualifyingFeedbacks = await prisma.interviewFeedback.findMany({
      where: {
        selectionStatus: 'SELECTED',
        round: { in: ['ROUND_2', 'FINAL_ROUND'] },
        deletedAt: null,
        createdAt: { gte: CUTOFF_DATE },
      },
      orderBy: { createdAt: 'desc' },
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
        },
      });

      if (!existing) {
        await prisma.qualityCheck.create({
          data: {
            candidateId: fb.candidateId,
            interviewRoundId: fb.id,
            round: fb.round,
            status: 'PENDING',
            source: fb.round === 'FINAL_ROUND' ? 'FINAL_ROUND_SELECTED' : 'ROUND_2_SELECTED',
            organizationId: orgId,
            enteredQueueAt: fb.createdAt || new Date(),
          },
        });
        console.log(`[QC Reconciliation] Enqueued candidate ${fb.candidateId} (round: ${fb.round})`);
        enqueuedCount++;
      } else {
        skippedCount++;
      }
    }

    // 3. Find candidates with offer status since Sept 22
    const offerCandidates = await prisma.candidate.findMany({
      where: {
        isDeleted: false,
        OR: [
          { status: 'OFFER_PROPOSED' },
          { status: 'OFFER_SENT' },
          { currentStage: { contains: 'offer', mode: 'insensitive' } },
        ],
        updatedAt: { gte: CUTOFF_DATE },
      },
      select: {
        id: true,
        organizationId: true,
        updatedAt: true,
      },
    });

    for (const cand of offerCandidates) {
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
            round: 'ROUND_2',
            status: 'PENDING',
            source: 'OFFER_PROPOSED',
            organizationId: orgId,
            enteredQueueAt: cand.updatedAt || new Date(),
          },
        });
        console.log(`[QC Reconciliation] Enqueued offer candidate ${cand.id}`);
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

let reconciliationInterval = null;

function startQualityCheckReconciliation(intervalMs = 300000) {
  // Run on startup
  runQualityCheckReconciliation().catch(err => console.warn('[QC Reconciliation] Startup run warning:', err.message));
  
  if (reconciliationInterval) clearInterval(reconciliationInterval);
  reconciliationInterval = setInterval(() => {
    runQualityCheckReconciliation().catch(err => console.warn('[QC Reconciliation] Periodic run warning:', err.message));
  }, intervalMs);

  if (reconciliationInterval.unref) {
    reconciliationInterval.unref();
  }
  console.log(`[QC Reconciliation] Periodic job started (interval: ${intervalMs / 1000}s, cutoff: ${CUTOFF_DATE.toISOString()})`);
}

module.exports = {
  runQualityCheckReconciliation,
  startQualityCheckReconciliation,
};
