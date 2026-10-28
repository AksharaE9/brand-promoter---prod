'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/routes.js
 *
 * REST Endpoints for Recruit AI / HireIQ Integration:
 * - Inbound Webhook Receiver
 * - Review Queue (Pending Review, Confirm Outcome, Relink, Dismiss)
 * - Admin Status & Manual Sync
 * - Candidate AI Assessment Cards
 */

const express = require('express');
const router = express.Router();
const prisma = require('../../../config/db');
const { auth, requireRoles } = require('../../../middleware/auth');
const { verifyWebhookSignature, processAssessmentPayload } = require('./inboxService');
const { runReconciliationSync, fetchFromRecruitAi } = require('./pollerService');
const { ApiError, asyncHandler } = require('../../../utils/errors');
const sse = require('../../../utils/sse');

// ── Inbound Webhook Receiver ────────────────────────────────────────────────
// POST /api/v1/integrations/recruit-ai/webhook
// Public endpoint for Recruit AI with HMAC signature verification
router.post('/webhook', express.raw({ type: '*/*', limit: '2mb' }), asyncHandler(async (req, res) => {
  if (process.env.RECRUITAI_SYNC_ENABLED === 'false') {
    return res.status(404).json({ success: false, message: 'Integration disabled' });
  }

  const signature = req.headers['x-recruitai-signature'] || req.headers['x-talentos-signature'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

  if (process.env.RECRUITAI_WEBHOOK_SECRET && !verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ success: false, code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ success: false, code: 'INVALID_JSON', message: 'Invalid JSON payload' });
  }

  const eventId = req.headers['x-event-id'] || payload.eventId || payload.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const eventType = payload.event || payload.type || 'interview.completed';

  // 1. Deduplication via IntegrationInboxEvent
  const existingEvent = await prisma.integrationInboxEvent.findUnique({
    where: { eventId }
  });

  if (existingEvent && existingEvent.status === 'processed') {
    return res.status(200).json({ success: true, duplicate: true, message: 'Event already processed' });
  }

  const inboxEvent = await prisma.integrationInboxEvent.upsert({
    where: { eventId },
    create: {
      provider: 'recruit_ai',
      eventId,
      type: eventType,
      signatureValid: true,
      status: 'queued',
      payload
    },
    update: {
      attempts: { increment: 1 }
    }
  });

  // 2. Process assessment payload immediately
  try {
    const outcome = await processAssessmentPayload(payload, eventId);

    await prisma.integrationInboxEvent.update({
      where: { id: inboxEvent.id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        lastError: null
      }
    });

    return res.status(200).json({
      success: true,
      eventId,
      action: outcome.action,
      resultId: outcome.id,
      matched: outcome.matched
    });
  } catch (procErr) {
    console.error(`[RecruitAI Webhook] Processing failed for event ${eventId}:`, procErr.message);

    await prisma.integrationInboxEvent.update({
      where: { id: inboxEvent.id },
      data: {
        status: 'failed',
        lastError: procErr.message
      }
    });

    return res.status(500).json({
      success: false,
      code: 'PROCESSING_ERROR',
      message: procErr.message,
      eventId
    });
  }
}));

// ── Authenticated ATS Routes ────────────────────────────────────────────────
router.use(auth);

// GET /api/v1/integrations/recruit-ai/review-queue
router.get('/review-queue', asyncHandler(async (req, res) => {
  const orgId = req.user?.organizationId || 'defaultOrg';
  const status = req.query.status || 'pending_review';

  const results = await prisma.externalAssessmentResult.findMany({
    where: {
      organizationId: orgId,
      reviewStatus: status,
    },
    include: {
      candidate: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          preferredRole: true,
          currentStage: true
        }
      },
      interview: {
        select: {
          id: true,
          roundNo: true,
          round: true,
          jobTitle: true,
          scheduledStart: true,
          status: true,
          outcome: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  res.json({
    success: true,
    data: results,
    count: results.length
  });
}));

// POST /api/v1/integrations/recruit-ai/confirm-outcome
// Recruiter confirms the AI recommendation into a real candidate hiring outcome
router.post('/confirm-outcome', asyncHandler(async (req, res) => {
  const { resultId, outcome, notes } = req.body;

  if (!resultId || !outcome) {
    throw new ApiError(400, 'resultId and outcome are required', 'INVALID_PARAMETER');
  }

  const validOutcomes = ['SELECTED', 'REJECTED', 'ON_HOLD'];
  if (!validOutcomes.includes(outcome.toUpperCase())) {
    throw new ApiError(400, `Outcome must be one of: ${validOutcomes.join(', ')}`, 'INVALID_PARAMETER');
  }

  const result = await prisma.externalAssessmentResult.findUnique({
    where: { id: resultId },
    include: { candidate: true, interview: true }
  });

  if (!result) {
    throw new ApiError(404, 'Assessment result not found', 'NOT_FOUND');
  }

  const upperOutcome = outcome.toUpperCase();

  // 1. Mark ExternalAssessmentResult as outcome_confirmed
  const updatedResult = await prisma.externalAssessmentResult.update({
    where: { id: resultId },
    data: {
      reviewStatus: 'outcome_confirmed',
      reviewedById: req.user.id,
      reviewedAt: new Date(),
      decisionOutcome: upperOutcome
    }
  });

  // 2. Update Interview Round outcome through normal workflow
  if (result.interviewRoundId) {
    await prisma.interview.update({
      where: { id: result.interviewRoundId },
      data: {
        outcome: upperOutcome,
        outcomeSetAt: new Date(),
        notes: notes ? `${result.interview?.notes || ''}\n[Recruiter Note]: ${notes}`.trim() : result.interview?.notes
      }
    });
  }

  // 3. Emit SSE update
  try {
    sse.broadcast('ai_result_outcome_confirmed', {
      resultId,
      candidateId: result.candidateId,
      outcome: upperOutcome,
      confirmedBy: req.user.fullName || req.user.email
    });
  } catch (e) {}

  res.json({
    success: true,
    data: updatedResult,
    message: `Outcome ${upperOutcome} confirmed successfully.`
  });
}));

// POST /api/v1/integrations/recruit-ai/relink
// Manually link an unmatched result to a candidate
router.post('/relink', asyncHandler(async (req, res) => {
  const { resultId, candidateId, interviewRoundId } = req.body;

  if (!resultId || !candidateId) {
    throw new ApiError(400, 'resultId and candidateId are required', 'INVALID_PARAMETER');
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId }
  });

  if (!candidate) {
    throw new ApiError(404, 'Candidate not found', 'NOT_FOUND');
  }

  const updated = await prisma.externalAssessmentResult.update({
    where: { id: resultId },
    data: {
      candidateId,
      interviewRoundId: interviewRoundId || null,
      matchMethod: 'manual',
      matchConfidence: 'HIGH'
    }
  });

  res.json({
    success: true,
    data: updated,
    message: 'Assessment result linked successfully.'
  });
}));

// POST /api/v1/integrations/recruit-ai/dismiss
router.post('/dismiss', asyncHandler(async (req, res) => {
  const { resultId } = req.body;

  if (!resultId) {
    throw new ApiError(400, 'resultId is required', 'INVALID_PARAMETER');
  }

  const updated = await prisma.externalAssessmentResult.update({
    where: { id: resultId },
    data: {
      reviewStatus: 'dismissed',
      reviewedById: req.user.id,
      reviewedAt: new Date()
    }
  });

  res.json({
    success: true,
    data: updated,
    message: 'Assessment result dismissed.'
  });
}));

// GET /api/v1/integrations/recruit-ai/candidate/:candidateId
// Returns all AI assessments for a candidate profile
router.get('/candidate/:candidateId', asyncHandler(async (req, res) => {
  const assessments = await prisma.externalAssessmentResult.findMany({
    where: {
      candidateId: req.params.candidateId
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    success: true,
    data: assessments
  });
}));

// GET /api/v1/integrations/recruit-ai/status (Admin Only)
router.get('/status', requireRoles('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req, res) => {
  const provider = await prisma.integrationProvider.findUnique({
    where: { key: 'recruit_ai' }
  });

  const syncState = await prisma.integrationSyncState.findUnique({
    where: { provider: 'recruit_ai' }
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [receivedToday, received7d, pendingReviewCount, unmatchedCount, failedEvents] = await Promise.all([
    prisma.externalAssessmentResult.count({
      where: { provider: 'recruit_ai', createdAt: { gte: todayStart } }
    }),
    prisma.externalAssessmentResult.count({
      where: { provider: 'recruit_ai', createdAt: { gte: sevenDaysAgo } }
    }),
    prisma.externalAssessmentResult.count({
      where: { provider: 'recruit_ai', reviewStatus: 'pending_review' }
    }),
    prisma.externalAssessmentResult.count({
      where: { provider: 'recruit_ai', candidateId: null }
    }),
    prisma.integrationInboxEvent.findMany({
      where: { provider: 'recruit_ai', status: 'failed' },
      take: 10,
      orderBy: { receivedAt: 'desc' }
    })
  ]);

  const configuredKey = process.env.RECRUITAI_API_KEY ? `...${process.env.RECRUITAI_API_KEY.slice(-4)}` : null;

  res.json({
    success: true,
    data: {
      enabled: process.env.RECRUITAI_SYNC_ENABLED !== 'false' && Boolean(provider?.enabled),
      apiKeyConfigured: Boolean(process.env.RECRUITAI_API_KEY),
      apiKeyLast4: configuredKey,
      baseUrl: process.env.RECRUITAI_BASE_URL || 'https://187.127.137.103',
      scheduleWebhookUrl: process.env.RECRUITAI_SCHEDULE_WEBHOOK_URL,
      lastSyncAt: syncState?.lastSyncAt,
      lastError: syncState?.lastError,
      counts: {
        receivedToday,
        received7d,
        pendingReviewCount,
        unmatchedCount
      },
      failedEvents
    }
  });
}));

// POST /api/v1/integrations/recruit-ai/sync (Admin Manual Trigger)
router.post('/sync', requireRoles('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await runReconciliationSync(req.user?.organizationId || 'defaultOrg');
  res.json({
    success: result.success !== false,
    data: result
  });
}));

module.exports = router;
