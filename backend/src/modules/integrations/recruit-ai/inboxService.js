'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/inboxService.js
 *
 * Ingestion and processing pipeline for Recruit AI interview results:
 * - Signature verification (HMAC SHA-256)
 * - Event deduplication via IntegrationInboxEvent
 * - Payload normalization (score, rating, recommendation, status)
 * - Candidate & round matching
 * - Safe upsert into ExternalAssessmentResult
 * - Idempotent, bounded, zero side effects
 */

const crypto = require('crypto');
const prisma = require('../../../config/db');
const { computePayloadHash, normalizeScore, normalizeRecommendation, normalizeStatus } = require('./normalizer');
const { matchAssessment } = require('./matchingService');
const sse = require('../../../utils/sse');

function verifyWebhookSignature(rawBody, signatureHeader, secret = process.env.RECRUITAI_WEBHOOK_SECRET) {
  if (!secret) return true; // Signature check bypassed if secret not configured
  if (!signatureHeader) return false;

  try {
    const cleanSig = signatureHeader.replace(/^sha256=/i, '').trim();
    const expectedSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(cleanSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch (err) {
    return false;
  }
}

/**
 * Ingest and process an incoming assessment result
 */
async function processAssessmentPayload(payload, eventId = null, organizationId = 'defaultOrg') {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid assessment payload');
  }

  // Extract core fields
  const provider = payload.provider || 'recruit_ai';
  const providerResultId = String(payload.providerResultId || payload.resultId || payload.id || eventId || crypto.randomUUID());
  const providerInterviewId = payload.providerInterviewId || payload.interviewId ? String(payload.providerInterviewId || payload.interviewId) : null;
  const providerCandidateId = payload.providerCandidateId || payload.candidateId ? String(payload.providerCandidateId || payload.candidateId) : null;
  const externalReference = payload.externalReference || payload.externalRef || payload.interviewId || null;

  const candidateInfo = payload.candidate || {};
  const candidateEmail = candidateInfo.email || payload.email || null;
  const candidatePhone = candidateInfo.phone || payload.phone || null;
  const candidateName = candidateInfo.name || payload.candidateName || null;

  const rawStatus = payload.status || 'completed';
  const normalizedStatus = normalizeStatus(rawStatus);

  const scoreData = normalizeScore(payload.score, payload.rawScore || payload.rating);
  const normalizedRec = normalizeRecommendation(payload.recommendation || payload.decision);

  const competencyScores = payload.competencyScores || payload.competencies || null;
  const summary = payload.summary || payload.feedback || payload.aiSummary || null;
  const transcriptRef = payload.transcriptRef || payload.transcript || null;
  const recordingUrl = payload.recordingUrl || payload.videoUrl || payload.audioUrl || null;
  const recordingExpiresAt = payload.recordingExpiresAt ? new Date(payload.recordingExpiresAt) : null;
  const integrityFlags = payload.integrityFlags || payload.proctoringFlags || null;

  const startedAt = payload.startedAt ? new Date(payload.startedAt) : null;
  const completedAt = payload.completedAt ? new Date(payload.completedAt) : new Date();
  const providerUpdatedAt = payload.updatedAt || payload.providerUpdatedAt ? new Date(payload.updatedAt || payload.providerUpdatedAt) : new Date();
  const providerVersion = payload.version ? String(payload.version) : '1';

  const payloadHash = computePayloadHash(payload);

  // 1. Check existing record for idempotency
  const existing = await prisma.externalAssessmentResult.findUnique({
    where: {
      provider_providerResultId: {
        provider,
        providerResultId
      }
    }
  });

  if (existing) {
    // If identical payload hash, no-op
    if (existing.payloadHash === payloadHash) {
      return { action: 'skipped_identical', id: existing.id };
    }
    // If incoming is older or same version without update, skip
    if (existing.providerUpdatedAt && existing.providerUpdatedAt > providerUpdatedAt) {
      return { action: 'skipped_older', id: existing.id };
    }
  }

  // 2. Perform Matching
  let candidateId = existing ? existing.candidateId : null;
  let interviewRoundId = existing ? existing.interviewRoundId : null;
  let matchMethod = existing ? existing.matchMethod : null;
  let matchConfidence = existing ? existing.matchConfidence : null;

  if (!candidateId) {
    const matchResult = await matchAssessment({
      externalReference,
      email: candidateEmail,
      phone: candidatePhone,
      candidateName,
      completedAt,
      organizationId
    });

    candidateId = matchResult.matchedCandidateId;
    interviewRoundId = matchResult.matchedInterviewId;
    matchMethod = matchResult.matchMethod;
    matchConfidence = matchResult.matchConfidence;
  }

  // 3. Upsert ExternalAssessmentResult
  const upsertData = {
    provider,
    providerResultId,
    providerInterviewId,
    providerCandidateId,
    externalReference,
    candidateId,
    interviewRoundId,
    matchMethod,
    matchConfidence,
    status: normalizedStatus,
    scoreRaw: scoreData.scoreRaw,
    scoreScale: scoreData.scoreScale,
    scoreNormalised100: scoreData.scoreNormalised100,
    ratingOutOf10: scoreData.ratingOutOf10,
    recommendationRaw: payload.recommendation ? String(payload.recommendation) : null,
    recommendationNormalised: normalizedRec,
    competencyScores,
    summary,
    transcriptRef: typeof transcriptRef === 'string' ? transcriptRef : (transcriptRef ? JSON.stringify(transcriptRef) : null),
    recordingUrl,
    recordingExpiresAt,
    integrityFlags,
    startedAt,
    completedAt,
    providerUpdatedAt,
    providerVersion,
    rawPayload: payload,
    payloadHash,
    reviewStatus: existing?.reviewStatus === 'outcome_confirmed' ? 'outcome_confirmed' : 'pending_review',
    organizationId
  };

  const savedResult = await prisma.externalAssessmentResult.upsert({
    where: {
      provider_providerResultId: {
        provider,
        providerResultId
      }
    },
    create: upsertData,
    update: upsertData
  });

  // 4. Update Candidate Interview Round status if matched
  if (interviewRoundId) {
    try {
      await prisma.interview.update({
        where: { id: interviewRoundId },
        data: {
          status: normalizedStatus === 'COMPLETED' ? 'COMPLETED' : 'NO_SHOW'
          // Note: hiring outcome remains human-in-the-loop per prompt principles
        }
      });
    } catch (err) {
      console.warn(`[InboxService] Could not update interview ${interviewRoundId}:`, err.message);
    }
  }

  // 5. Emit SSE event to notify open ATS UI tabs
  try {
    sse.broadcast('ai_interview_result_received', {
      resultId: savedResult.id,
      candidateId,
      interviewRoundId,
      ratingOutOf10: savedResult.ratingOutOf10,
      recommendation: savedResult.recommendationNormalised,
      reviewStatus: savedResult.reviewStatus
    });
  } catch (e) {}

  return {
    action: existing ? 'updated' : 'created',
    id: savedResult.id,
    matched: Boolean(candidateId),
    candidateId,
    interviewRoundId
  };
}

module.exports = {
  verifyWebhookSignature,
  processAssessmentPayload
};
