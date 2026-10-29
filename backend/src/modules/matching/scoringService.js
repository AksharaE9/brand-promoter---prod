'use strict';

const prisma = require('../../config/db');
const { resolveCandidateRole } = require('./roleResolver');
const { enqueueParseJob } = require('./jobQueue');
const inv = require('../../utils/cacheInvalidation');
const sse = require('../../utils/sse');

/**
 * Checks eligibility of a candidate application and returns one of the 7 states:
 * SCORED | QUEUED | FAILED | NO_RESUME | UNSUPPORTED_FILE | NO_JD | UNMAPPED_ROLE
 *
 * @param {object} candidate - Candidate record with resumeFile, applications, matchScores, resumeParseJobs
 * @param {object} [resolution] - Pre-calculated role resolution if available
 * @returns {Promise<{ state: string, resolution: object, primaryScore: object|null, betterFitRole: string|null, latestJob: object|null }>}
 */
async function determineCandidateMatchState(candidate, resolution = null) {
  if (!candidate || candidate.isDeleted) {
    return { state: 'NO_JD', resolution: null, primaryScore: null, betterFitRole: null, latestJob: null };
  }

  const res = resolution || await resolveCandidateRole(candidate, candidate.organizationId || 'defaultOrg');

  // If role is explicitly excluded or skipped (e.g. Data Analyst, Business Analyst, HR, or unconfigured role)
  if (res.status === 'EXCLUDED' || res.status === 'SKIPPED_NO_JD') {
    return { state: 'NO_JD', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob: null };
  }

  // Check existing primary scores first
  const scores = candidate.matchScores || [];
  const primaryScore = scores.find(s => s.isPrimary) || (scores.length > 0 ? scores[0] : null);

  let betterFitRole = null;
  if (primaryScore) {
    const otherScores = scores.filter(s => s !== primaryScore);
    for (const s of otherScores) {
      if (s.ratingOutOf10 >= primaryScore.ratingOutOf10 + 1.0) {
        if (!betterFitRole || s.ratingOutOf10 > (betterFitRole.rating || 0)) {
          betterFitRole = {
            title: s.jobDescription?.title || 'Alternative Role',
            rating: s.ratingOutOf10
          };
        }
      }
    }
  }

  if (primaryScore) {
    return {
      state: 'SCORED',
      resolution: res,
      primaryScore,
      matchScore: primaryScore,
      betterFitRole: betterFitRole?.title || null,
      latestJob: (candidate.resumeParseJobs && candidate.resumeParseJobs[0]) || null
    };
  }

  if (res.status === 'UNMAPPED_ROLE') {
    return { state: 'UNMAPPED_ROLE', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob: null };
  }

  const latestJob = (candidate.resumeParseJobs && candidate.resumeParseJobs[0]) || null;
  if (latestJob) {
    if (latestJob.status === 'RUNNING' || latestJob.status === 'QUEUED') {
      return { state: 'QUEUED', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
    }
    if (latestJob.status === 'FAILED') {
      return { state: 'FAILED', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
    }
    if (latestJob.status === 'UNSUPPORTED_FORMAT') {
      return { state: 'UNSUPPORTED_FILE', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
    }
  }

  // Check if candidate has any resume
  const hasResume = Boolean(
    candidate.resumeFileId ||
    candidate.resumeFile ||
    candidate.resumeLinkOriginal ||
    candidate.resumeLinkDownload
  );

  if (!hasResume) {
    return { state: 'NO_RESUME', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
  }

  // Check for Google Drive folder link or unreadable format
  const resumeLink = (candidate.resumeLinkOriginal || candidate.resumeLinkDownload || '').toLowerCase();
  if (resumeLink.includes('/drive/folders/') || resumeLink.includes('drive.google.com/drive/u/')) {
    return { state: 'UNSUPPORTED_FILE', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
  }

  // Has resume and eligible role, ready to be scored
  return { state: 'QUEUED', resolution: res, primaryScore: null, matchScore: null, betterFitRole: null, latestJob };
}

/**
 * Central domain function: Request JD Match Scoring for a candidate application.
 * Called by EVERY ingestion path (Manual create, Resume replace, Bulk upload, Drive import,
 * Follow-up upload, Role change, JD activation, etc.)
 *
 * @param {string} candidateId - Candidate ID
 * @param {string} reason - Ingestion/change trigger reason
 * @param {object} [options] - { force?: boolean, fileMetaId?: string, isResumeDeleted?: boolean }
 * @returns {Promise<{ state: string, jobId?: string, message?: string }>}
 */
async function requestMatchScoring(candidateId, reason, options = {}) {
  const { force = false, fileMetaId = null, isResumeDeleted = false } = options;

  if (isResumeDeleted) {
    // When resume is deleted: purge or mark scores stale
    await prisma.matchScore.deleteMany({
      where: { candidateId }
    }).catch(() => {});

    await prisma.parsedResume.deleteMany({
      where: { candidateId }
    }).catch(() => {});

    await prisma.candidate.update({
      where: { id: candidateId },
      data: { resumeFileId: null }
    }).catch(() => {});

    return { state: 'NO_RESUME', message: 'Resume deleted; match scores cleared' };
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      applications: { include: { job: true }, where: { isDeleted: false } },
      resumeFile: true,
      matchScores: {
        include: { jobDescription: true }
      },
      resumeParseJobs: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  });

  if (!candidate || candidate.isDeleted) {
    return { state: 'NO_JD', message: 'Candidate not found or deleted' };
  }

  // 1. Resolve role
  const resolution = await resolveCandidateRole(candidate, candidate.organizationId || 'defaultOrg');

  // 2. Determine eligibility state
  const stateResult = await determineCandidateMatchState(candidate, resolution);

  if (stateResult.state === 'NO_JD') {
    return { state: 'NO_JD', message: `Role "${candidate.preferredRole || candidate.jobTitle}" has no active JD` };
  }

  if (stateResult.state === 'UNMAPPED_ROLE') {
    return { state: 'UNMAPPED_ROLE', message: `Role "${candidate.preferredRole || candidate.jobTitle}" is unmapped` };
  }

  if (stateResult.state === 'NO_RESUME') {
    return { state: 'NO_RESUME', message: 'Candidate has no resume attached' };
  }

  if (stateResult.state === 'UNSUPPORTED_FILE') {
    return { state: 'UNSUPPORTED_FILE', message: 'Resume link or format is unsupported (e.g. shared folder)' };
  }

  if (stateResult.state === 'SCORED' && !force) {
    return { state: 'SCORED', message: 'Candidate already has current score' };
  }

  // 3. Enqueue parsing & scoring job
  const job = await enqueueParseJob({
    candidateId,
    fileMetaId: fileMetaId || candidate.resumeFileId,
    force
  });

  return {
    state: 'QUEUED',
    jobId: job?.id || null,
    message: `Job enqueued (${reason})`
  };
}

module.exports = {
  determineCandidateMatchState,
  requestMatchScoring
};
