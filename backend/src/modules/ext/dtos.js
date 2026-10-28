'use strict';

/**
 * backend/src/modules/ext/dtos.js
 *
 * Explicit Data Transfer Objects (DTOs) with strict allow-lists.
 * Strips internal IDs, password hashes, secrets, and redacts PII unless authorized.
 */

const { generateSignedResumeToken } = require('./apiKeyService');

function cleanString(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === 'NA' || str === 'N/A' || str === 'null') return null;
  return str;
}

function formatDateIso(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Normalize evaluation outcome to standard enum
 */
function normalizeOutcome(val) {
  if (!val) return null;
  const upper = String(val).trim().toUpperCase();
  if (upper === 'SELECTED' || upper === 'PASS') return 'SELECTED';
  if (upper === 'REJECTED' || upper === 'FAIL') return 'REJECTED';
  if (upper === 'ON_HOLD' || upper === 'HOLD') return 'ON_HOLD';
  if (upper === 'NO_SHOW' || upper === 'DIDNT_JOIN') return 'NO_SHOW';
  return upper;
}

/**
 * Cursor Pagination Helpers
 */
function encodeCursor(updatedAt, id) {
  if (!updatedAt || !id) return null;
  const iso = new Date(updatedAt).toISOString();
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const decoded = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    return { updatedAt: date, id };
  } catch {
    return null;
  }
}

/**
 * Candidate DTO
 */
function toCandidateDto(candidate, hasPiiScope = false, baseUrl = '') {
  if (!candidate) return null;

  const dto = {
    id: candidate.id,
    fullName: cleanString(candidate.fullName),
    status: cleanString(candidate.status) || 'ACTIVE',
    currentStage: cleanString(candidate.currentStage),
    preferredRole: cleanString(candidate.preferredRole),
    course: cleanString(candidate.course),
    college: cleanString(candidate.college),
    graduationYear: cleanString(candidate.graduationYear),
    location: cleanString(candidate.location),
    area: cleanString(candidate.area),
    totalExperienceYears: typeof candidate.totalExperienceYears === 'number' ? candidate.totalExperienceYears : null,
    currentCompany: cleanString(candidate.currentCompany),
    company: cleanString(candidate.company),
    source: cleanString(candidate.source),
    createdAt: formatDateIso(candidate.createdAt),
    updatedAt: formatDateIso(candidate.updatedAt),
  };

  // PII Fields — only provided if key has candidates:read:pii
  if (hasPiiScope) {
    dto.phone = cleanString(candidate.phone);
    dto.email = cleanString(candidate.email);

    // If candidate has a resume attached in FileMeta, generate a signed 15-minute download URL
    if (candidate.resumeFileId) {
      const signedToken = generateSignedResumeToken(candidate.resumeFileId, candidate.id, 15);
      dto.resumeDownloadUrl = `${baseUrl}/api/v1/ext/resumes/${signedToken}`;
    } else if (candidate.resumeLinkOriginal || candidate.resumeLinkDownload) {
      dto.resumeDownloadUrl = candidate.resumeLinkDownload || candidate.resumeLinkOriginal;
    } else {
      dto.resumeDownloadUrl = null;
    }
  }

  // Include round summary if available from relation
  if (Array.isArray(candidate.applications) && candidate.applications.length > 0) {
    const rounds = [];
    candidate.applications.forEach(app => {
      if (Array.isArray(app.interviews)) {
        app.interviews.forEach(intv => {
          rounds.push({
            id: intv.id,
            roundNo: intv.roundNo,
            roundTitle: cleanString(intv.round),
            scheduledStart: formatDateIso(intv.scheduledStart),
            status: cleanString(intv.status),
            outcome: normalizeOutcome(intv.outcome || intv.result),
          });
        });
      }
    });
    dto.interviewRounds = rounds;
  }

  return dto;
}

/**
 * Interview / Round DTO
 */
function toInterviewDto(interview) {
  if (!interview) return null;

  // Extract panelist names cleanly
  let panelists = cleanString(interview.interviewerNames);
  if (!panelists && Array.isArray(interview.interviewerIds) && interview.interviewerIds.length > 0) {
    panelists = interview.interviewerIds.join(', ');
  }

  // Extract feedback data if present
  let feedbackSummary = null;
  if (Array.isArray(interview.feedback) && interview.feedback.length > 0) {
    const latestFb = interview.feedback[interview.feedback.length - 1];
    feedbackSummary = {
      overallRating: typeof latestFb.overallRating === 'number' ? latestFb.overallRating : null,
      selectionStatus: normalizeOutcome(latestFb.selectionStatus),
      panelist: cleanString(latestFb.interviewerName),
      comments: cleanString(latestFb.comments),
      submittedAt: formatDateIso(latestFb.createdAt),
    };
  }

  return {
    id: interview.id,
    candidateId: interview.candidateId || null,
    candidateName: cleanString(interview.candidateName),
    jobId: interview.jobId || null,
    jobTitle: cleanString(interview.jobTitle),
    roundNo: interview.roundNo || 1,
    roundTitle: cleanString(interview.round),
    scheduledStart: formatDateIso(interview.scheduledStart),
    durationMinutes: interview.durationMinutes || 45,
    mode: cleanString(interview.mode) || 'VIRTUAL',
    status: cleanString(interview.status) || 'SCHEDULED',
    outcome: normalizeOutcome(interview.outcome || interview.result),
    outcomeSetAt: formatDateIso(interview.outcomeSetAt),
    panelist: panelists,
    notes: cleanString(interview.notes),
    feedback: feedbackSummary,
    createdAt: formatDateIso(interview.createdAt),
    updatedAt: formatDateIso(interview.updatedAt),
  };
}

/**
 * Interview Feedback DTO
 */
function toFeedbackDto(fb) {
  if (!fb) return null;

  const data = typeof fb.feedbackData === 'object' && fb.feedbackData !== null ? fb.feedbackData : {};

  return {
    id: fb.id,
    candidateId: fb.candidateId || null,
    round: cleanString(fb.round),
    selectionStatus: normalizeOutcome(fb.selectionStatus),
    overallRating: typeof fb.overallRating === 'number' ? fb.overallRating : null,
    templateVersion: fb.templateVersion || 1,
    evaluation: {
      comments: cleanString(data.comments || fb.comments),
      doj: cleanString(data.doj),
      duration: cleanString(data.duration),
      skills: cleanString(data.skills),
      languagesKnown: cleanString(data.languagesKnown || data.languages),
      priorExperience: cleanString(data.priorExperience || data.professional_experience),
      timings: cleanString(data.timings),
      area: cleanString(data.area),
      location: cleanString(data.location),
      family: cleanString(data.family),
    },
    createdAt: formatDateIso(fb.createdAt),
    updatedAt: formatDateIso(fb.updatedAt),
  };
}

/**
 * College Drive DTO
 */
function toDriveDto(drive, stats = {}) {
  if (!drive) return null;

  return {
    id: drive.id,
    title: cleanString(drive.title),
    collegeId: drive.collegeId,
    collegeName: cleanString(drive.college?.name),
    location: cleanString(drive.college?.location),
    area: cleanString(drive.college?.area),
    dateFrom: cleanString(drive.dateFrom),
    dateTo: cleanString(drive.dateTo),
    status: cleanString(drive.status) || 'PLANNED',
    description: cleanString(drive.description),
    counts: {
      totalEnrolled: stats.totalEnrolled || 0,
      selected: stats.selected || 0,
      rejected: stats.rejected || 0,
      onHold: stats.onHold || 0,
    },
    createdAt: formatDateIso(drive.createdAt),
    updatedAt: formatDateIso(drive.updatedAt),
  };
}

/**
 * Job / Role DTO
 */
function toJobDto(job) {
  if (!job) return null;

  return {
    id: job.id,
    title: cleanString(job.title),
    department: cleanString(job.department),
    location: cleanString(job.location),
    employmentType: cleanString(job.employmentType),
    experienceMin: typeof job.experienceMin === 'number' ? job.experienceMin : null,
    experienceMax: typeof job.experienceMax === 'number' ? job.experienceMax : null,
    openingsCount: job.openingsCount || 1,
    description: cleanString(job.description),
    isActive: Boolean(job.isActive),
    createdAt: formatDateIso(job.createdAt),
    updatedAt: formatDateIso(job.updatedAt),
  };
}

/**
 * Telecalling / Team Member DTO
 */
function toTeamMemberDto(member) {
  if (!member) return null;

  return {
    id: member.id,
    name: cleanString(member.name),
    active: Boolean(member.active),
    createdAt: formatDateIso(member.createdAt),
    deactivatedAt: formatDateIso(member.deactivatedAt),
  };
}

module.exports = {
  cleanString,
  formatDateIso,
  normalizeOutcome,
  encodeCursor,
  decodeCursor,
  toCandidateDto,
  toInterviewDto,
  toFeedbackDto,
  toDriveDto,
  toJobDto,
  toTeamMemberDto,
};
