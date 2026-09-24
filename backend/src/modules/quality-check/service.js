'use strict';

const prisma = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { logAudit } = require('../../utils/audit');
const sse = require('../../utils/sse');
const inv = require('../../utils/cacheInvalidation');

const l1 = require('../../utils/l1Cache');

// Launch cutoff timestamp for grandfathering:
// Any candidate whose qualifying round was completed or who already reached OFFER_SENT before this timestamp is grandfathered.
const GATE_LAUNCH_CUTOFF = new Date(process.env.QUALITY_CHECK_CUTOFF_DATE || '2026-09-24T00:00:00.000Z');

/**
 * Fetch Quality Check approval queue
 */
async function getQueue(orgId, { status = 'PENDING', page = 1, limit = 50, search = '', dateGroup = '' } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * take;

  const normalizedStatus = (status || 'PENDING').toUpperCase();
  const cacheKey = `qc:queue:${orgId}:${normalizedStatus}:${pageNum}:${take}:${(search || '').trim().toLowerCase()}`;
  const cached = l1.get(cacheKey);
  if (cached) {
    return cached;
  }

  const where = {
    organizationId: orgId,
  };

  if (normalizedStatus === 'APPROVED') {
    where.status = 'APPROVED';
  } else if (normalizedStatus === 'REJECTED') {
    where.status = 'REJECTED';
  } else if (normalizedStatus === 'ON_HOLD' || normalizedStatus === 'HOLD') {
    where.status = 'ON_HOLD';
  } else if (normalizedStatus === 'DECIDED') {
    where.status = { in: ['APPROVED', 'REJECTED'] };
  } else if (normalizedStatus === 'ALL') {
    // No status filter
  } else {
    where.status = 'PENDING';
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.candidate = {
      isDeleted: false,
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { preferredRole: { contains: q, mode: 'insensitive' } },
      ],
    };
  } else {
    where.candidate = {
      isDeleted: false,
    };
  }

  const [items, total] = await Promise.all([
    prisma.qualityCheck.findMany({
      where,
      orderBy: [
        { enteredQueueAt: 'desc' },
        { id: 'desc' },
      ],
      skip,
      take,
      include: {
        candidate: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            preferredRole: true,
            jobTitle: true,
            location: true,
            company: true,
            resumeLinkOriginal: true,
            resumeFileId: true,
            totalExperienceYears: true,
            currentCompany: true,
            status: true,
            interviewFeedbacks: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                round: true,
                selectionStatus: true,
                overallRating: true,
                feedbackData: true,
                createdAt: true,
                submittedBy: {
                  select: { id: true, fullName: true, email: true },
                },
              },
            },
          },
        },
        decidedBy: {
          select: { id: true, fullName: true, email: true },
        },
        decisions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            decidedBy: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
      },
    }),
    prisma.qualityCheck.count({ where }),
  ]);

  const result = {
    items,
    pagination: {
      total,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(total / take) || 1,
    },
  };

  l1.set(cacheKey, result, 10_000); // 10s TTL
  return result;
}

/**
 * Get count summary for badges
 */
async function getCounts(orgId) {
  const cacheKey = `qc:counts:${orgId}`;
  const cached = l1.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [pending, approved, onHold, rejected] = await Promise.all([
    prisma.qualityCheck.count({
      where: {
        organizationId: orgId,
        status: 'PENDING',
        candidate: { isDeleted: false },
      },
    }),
    prisma.qualityCheck.count({
      where: {
        organizationId: orgId,
        status: 'APPROVED',
        candidate: { isDeleted: false },
      },
    }),
    prisma.qualityCheck.count({
      where: {
        organizationId: orgId,
        status: 'ON_HOLD',
        candidate: { isDeleted: false },
      },
    }),
    prisma.qualityCheck.count({
      where: {
        organizationId: orgId,
        status: 'REJECTED',
        candidate: { isDeleted: false },
      },
    }),
  ]);

  const counts = {
    pending,
    approved,
    onHold,
    rejected,
    decided: approved + rejected,
  };

  l1.set(cacheKey, counts, 15_000); // 15s TTL
  return counts;
}

/**
 * Get Quality Check by ID with full candidate history
 */
async function getQualityCheckById(orgId, id) {
  const qc = await prisma.qualityCheck.findFirst({
    where: { id, organizationId: orgId },
    include: {
      candidate: {
        include: {
          interviewFeedbacks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
              submittedBy: {
                select: { id: true, fullName: true, email: true },
              },
            },
          },
          applications: {
            where: { isDeleted: false },
            include: {
              job: { select: { id: true, title: true, department: true } },
            },
          },
        },
      },
      decidedBy: {
        select: { id: true, fullName: true, email: true },
      },
      decisions: {
        orderBy: { createdAt: 'desc' },
        include: {
          decidedBy: {
            select: { id: true, fullName: true, email: true },
          },
        },
      },
    },
  });

  if (!qc) throw new ApiError(404, 'Quality check record not found');
  return qc;
}

/**
 * Record decision (Approve / Reject / Hold)
 */
async function recordDecision(orgId, qcId, { decision, ctcAmount, ctcCurrency = 'INR', comments = '' }, user) {
  const validDecisions = ['APPROVED', 'REJECTED', 'ON_HOLD'];
  if (!validDecisions.includes(decision)) {
    throw new ApiError(400, `Invalid decision '${decision}'. Must be one of: ${validDecisions.join(', ')}`);
  }

  const qc = await prisma.qualityCheck.findFirst({
    where: { id: qcId, organizationId: orgId },
    include: { candidate: true },
  });

  if (!qc) {
    throw new ApiError(404, 'Quality check record not found');
  }

  // Validate decision requirements
  let parsedCtc = null;
  if (decision === 'APPROVED') {
    if (ctcAmount === undefined || ctcAmount === null || ctcAmount === '') {
      throw new ApiError(400, 'CTC amount is required when approving a candidate');
    }
    parsedCtc = parseFloat(ctcAmount);
    if (isNaN(parsedCtc) || parsedCtc <= 0) {
      throw new ApiError(400, 'CTC amount must be a positive number');
    }
    if (!ctcCurrency || typeof ctcCurrency !== 'string') {
      ctcCurrency = 'INR';
    }
  }

  if (decision === 'REJECTED' && (!comments || !comments.trim())) {
    throw new ApiError(400, 'Rejection reason / comments are required when rejecting');
  }

  if (decision === 'ON_HOLD' && (!comments || !comments.trim())) {
    throw new ApiError(400, 'Reason / comments are required when placing candidate on hold');
  }

  const now = new Date();

  // Perform atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create decision history record (append-only)
    const decisionRecord = await tx.qualityCheckDecision.create({
      data: {
        qualityCheckId: qc.id,
        decision,
        decidedById: user.id,
        decidedAt: now,
        ctcAmount: parsedCtc,
        ctcCurrency: decision === 'APPROVED' ? ctcCurrency : null,
        comments: comments ? comments.trim() : null,
      },
    });

    // 2. Update current quality check record
    const updatedQc = await tx.qualityCheck.update({
      where: { id: qc.id },
      data: {
        status: decision,
        decidedById: user.id,
        decidedAt: now,
        ctcAmount: parsedCtc,
        ctcCurrency: decision === 'APPROVED' ? ctcCurrency : null,
        comments: comments ? comments.trim() : null,
        updatedAt: now,
      },
    });

    // 3. Status side-effects on Candidate
    if (decision === 'REJECTED') {
      await tx.candidate.update({
        where: { id: qc.candidateId },
        data: {
          status: 'REJECTED',
          updatedAt: now,
        },
      });

      // Also update any active applications
      await tx.application.updateMany({
        where: { candidateId: qc.candidateId, isDeleted: false },
        data: {
          status: 'REJECTED',
          updatedAt: now,
        },
      });
    }

    return { updatedQc, decisionRecord };
  });

  // Audit logging & cache invalidation
  await logAudit({
    actorUserId: user.id,
    action: `QUALITY_CHECK_${decision}`,
    entityType: 'QUALITY_CHECK',
    entityId: qc.id,
    subjectType: 'CANDIDATE',
    subjectId: qc.candidateId,
    oldData: { status: qc.status },
    newData: { status: decision, ctcAmount: parsedCtc, ctcCurrency, comments },
  });

  // Invalidate L1 cache for quality checks
  l1.deletePattern('qc:*');

  try {
    await inv.candidate(orgId, qc.candidateId);
  } catch (_) {}

  // Broadcast event via SSE
  setImmediate(() => {
    sse.broadcastToOrg(orgId, 'QUALITY_CHECK_DECIDED', {
      qualityCheckId: qc.id,
      candidateId: qc.candidateId,
      decision,
      ctcAmount: parsedCtc,
      ctcCurrency,
      decidedBy: user.id,
      decidedByName: user.fullName || user.email,
    });
  });

  return result;
}

/**
 * Enqueue candidate into QualityCheck (idempotent, safe additive hook)
 */
async function enqueueCandidate({ candidateId, orgId = 'defaultOrg', interviewRoundId = null, round = 'ROUND_2', source = 'ROUND_2_SELECTED' }) {
  if (!candidateId) return null;

  try {
    // Check if candidate already has a QualityCheck entry for this round or candidate
    const existing = await prisma.qualityCheck.findFirst({
      where: {
        candidateId,
        organizationId: orgId,
        ...(interviewRoundId ? { interviewRoundId } : {}),
      },
    });

    if (existing) {
      // If already exists, do not duplicate
      return existing;
    }

    // Create new QualityCheck
    const created = await prisma.qualityCheck.create({
      data: {
        candidateId,
        interviewRoundId: interviewRoundId || null,
        round: round || 'ROUND_2',
        status: 'PENDING',
        source,
        organizationId: orgId,
        enteredQueueAt: new Date(),
      },
    });

    // Invalidate L1 cache for quality checks
    l1.deletePattern('qc:*');

    sse.broadcastToOrg(orgId, 'QUALITY_CHECK_ENQUEUED', {
      qualityCheckId: created.id,
      candidateId,
      round,
    });

    return created;
  } catch (err) {
    console.warn(`[QualityCheck:Enqueue] Non-blocking enqueue warning for candidate ${candidateId}:`, err.message);
    return null;
  }
}

/**
 * Server-side Gate Check for OFFER_SENT
 * Returns { allowed: true } or throws ApiError
 */
async function assertOfferSentAllowed(candidateId, orgId = 'defaultOrg') {
  if (!candidateId) return true;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!candidate) throw new ApiError(404, 'Candidate not found');

  // Grandfather rule 1: Candidate was already in OFFER_SENT or JOINED
  if (candidate.status === 'OFFER_SENT' || candidate.status === 'JOINED') {
    return true;
  }

  // Grandfather rule 2: Candidate created before the gate launch cutoff and has no QualityCheck rows
  const qcCount = await prisma.qualityCheck.count({
    where: { candidateId, organizationId: orgId },
  });

  if (qcCount === 0 && candidate.createdAt < GATE_LAUNCH_CUTOFF) {
    return true;
  }

  // Check for APPROVED QualityCheck with valid CTC
  const approvedQc = await prisma.qualityCheck.findFirst({
    where: {
      candidateId,
      organizationId: orgId,
      status: 'APPROVED',
      ctcAmount: { not: null, gt: 0 },
    },
    orderBy: { decidedAt: 'desc' },
  });

  if (!approvedQc) {
    throw new ApiError(400, 'This candidate is awaiting Second Round Quality Check approval');
  }

  return true;
}

module.exports = {
  GATE_LAUNCH_CUTOFF,
  getQueue,
  getCounts,
  getQualityCheckById,
  recordDecision,
  enqueueCandidate,
  assertOfferSentAllowed,
};
