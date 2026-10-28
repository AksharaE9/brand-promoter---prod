'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/matchingService.js
 *
 * Strict Candidate & Interview Round matching engine for Recruit AI results:
 * Priority order:
 *  1. externalReference (TalentOS interviewId or candidateId) -> exact match
 *  2. Email (normalised, non-placeholder, exactly 1 matching candidate)
 *  3. Phone (normalised 10 digits, non-placeholder, exactly 1 matching candidate)
 *  4. Otherwise -> Unmatched queue. NEVER match by name.
 */

const prisma = require('../../../config/db');

const PLACEHOLDER_EMAIL_REGEX = /^(dummy|test|temp|noemail|na|none|unknown|angelbeulah|demo)@/i;
const PLACEHOLDER_PHONES = new Set(['1234567890', '0000000000', '9999999999', '1111111111']);

function isPlaceholderEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const clean = email.trim().toLowerCase();
  if (!clean.includes('@') || !clean.includes('.')) return true;
  if (PLACEHOLDER_EMAIL_REGEX.test(clean)) return true;
  if (clean.endsWith('@gmail.com') && (clean.startsWith('dummy') || clean.startsWith('test'))) return true;
  return false;
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (PLACEHOLDER_PHONES.has(last10)) return null;
  return last10;
}

/**
 * Match an incoming result to a Candidate and Interview Round
 */
async function matchAssessment({ externalReference, email, phone, candidateName, completedAt, organizationId = 'defaultOrg' }) {
  let matchedCandidateId = null;
  let matchedInterviewId = null;
  let matchMethod = null;
  let matchConfidence = null;

  // 1. External Reference Matching
  if (externalReference && typeof externalReference === 'string') {
    const extRef = externalReference.trim();

    // Check if extRef is an Interview ID
    const interview = await prisma.interview.findFirst({
      where: { id: extRef, organizationId },
      select: { id: true, candidateId: true }
    });

    if (interview) {
      matchedInterviewId = interview.id;
      matchedCandidateId = interview.candidateId;
      matchMethod = 'external_ref';
      matchConfidence = 'HIGH';
      return { matchedCandidateId, matchedInterviewId, matchMethod, matchConfidence };
    }

    // Check if extRef is a Candidate ID
    const candidate = await prisma.candidate.findFirst({
      where: { id: extRef, organizationId, isDeleted: false },
      select: { id: true }
    });

    if (candidate) {
      matchedCandidateId = candidate.id;
      matchMethod = 'external_ref';
      matchConfidence = 'HIGH';
    }
  }

  // 2. Email Matching (Unique, non-placeholder only)
  if (!matchedCandidateId && email && !isPlaceholderEmail(email)) {
    const cleanEmail = email.trim().toLowerCase();
    const candidates = await prisma.candidate.findMany({
      where: {
        email: { equals: cleanEmail, mode: 'insensitive' },
        organizationId,
        isDeleted: false
      },
      select: { id: true }
    });

    // Exactly one candidate allowed for a safe match
    if (candidates.length === 1) {
      matchedCandidateId = candidates[0].id;
      matchMethod = 'email';
      matchConfidence = 'HIGH';
    }
  }

  // 3. Phone Matching (Unique, non-placeholder only)
  if (!matchedCandidateId && phone) {
    const normPhone = normalizePhone(phone);
    if (normPhone) {
      const candidates = await prisma.candidate.findMany({
        where: {
          OR: [
            { phone: { contains: normPhone } },
            { phoneNormalized: { contains: normPhone } }
          ],
          organizationId,
          isDeleted: false
        },
        select: { id: true }
      });

      if (candidates.length === 1) {
        matchedCandidateId = candidates[0].id;
        matchMethod = 'phone';
        matchConfidence = 'MEDIUM';
      }
    }
  }

  // 4. Resolve Interview Round if Candidate was matched but Interview wasn't
  if (matchedCandidateId && !matchedInterviewId) {
    // Look for scheduled interviews for this candidate
    const interviews = await prisma.interview.findMany({
      where: {
        candidateId: matchedCandidateId,
        organizationId,
        status: { in: ['SCHEDULED', 'RESCHEDULED', 'IN_PROGRESS'] }
      },
      orderBy: { scheduledStart: 'asc' }
    });

    if (interviews.length === 1) {
      matchedInterviewId = interviews[0].id;
    } else if (interviews.length > 1 && completedAt) {
      // Find interview on the same IST date
      const compDate = new Date(completedAt);
      const istOffset = 5.5 * 3600 * 1000;
      const compDateIstStr = new Date(compDate.getTime() + istOffset).toISOString().split('T')[0];

      const sameDayInterviews = interviews.filter(i => {
        if (!i.scheduledStart) return false;
        const iIstStr = new Date(new Date(i.scheduledStart).getTime() + istOffset).toISOString().split('T')[0];
        return iIstStr === compDateIstStr;
      });

      if (sameDayInterviews.length === 1) {
        matchedInterviewId = sameDayInterviews[0].id;
      }
      // If multiple on same day, leave interviewId null (ambiguous) -> human review
    }
  }

  return {
    matchedCandidateId,
    matchedInterviewId,
    matchMethod,
    matchConfidence
  };
}

module.exports = {
  isPlaceholderEmail,
  normalizePhone,
  matchAssessment
};
