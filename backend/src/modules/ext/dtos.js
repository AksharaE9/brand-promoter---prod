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

/**
 * ── HireIQ Integration DTOs (Part 3.2 Specification) ─────────────────────────
 */

/**
 * Validates candidate email and assigns emailStatus.
 * Returns null email if placeholder or invalid, or if hasPiiScope is false.
 */
function validateCandidateEmail(rawEmail, hasPiiScope = false) {
  if (!rawEmail) return { email: null, emailStatus: 'missing' };
  const trimmed = String(rawEmail).trim().toLowerCase();
  if (!trimmed || trimmed === 'n/a' || trimmed === 'na' || trimmed === '-' || trimmed === 'null' || trimmed === 'none') {
    return { email: null, emailStatus: 'missing' };
  }

  const placeholderPatterns = ['dummy', 'test@', 'example.com', 'none@', 'na@', 'noemail', 'fake', 'placeholder'];
  if (placeholderPatterns.some(p => trimmed.includes(p))) {
    return { email: null, emailStatus: 'placeholder' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { email: null, emailStatus: 'invalid' };
  }

  // Valid email format
  return {
    email: hasPiiScope ? trimmed : null,
    emailStatus: 'valid'
  };
}

/**
 * Formats schedule in IST with +05:30 offset.
 */
function formatIstSchedule(scheduledStart, durationMinutes = 30, slot = 'Slot 1', mode = 'ONLINE', meetingLink = null) {
  if (!scheduledStart) {
    return {
      date: null,
      startTime: null,
      endTime: null,
      durationMinutes: durationMinutes || 30,
      slot: slot || 'Slot 1',
      timezone: 'Asia/Kolkata',
      startsAt: null,
      endsAt: null,
      mode: mode || 'ONLINE',
      meetingLink: meetingLink || null
    };
  }

  const utcDate = new Date(scheduledStart);
  const duration = Number(durationMinutes) || 30;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;

  const startIst = new Date(utcDate.getTime() + istOffsetMs);
  const endUtc = new Date(utcDate.getTime() + (duration * 60 * 1000));
  const endIst = new Date(endUtc.getTime() + istOffsetMs);

  const pad = (n) => String(n).padStart(2, '0');

  const startY = startIst.getUTCFullYear();
  const startM = pad(startIst.getUTCMonth() + 1);
  const startD = pad(startIst.getUTCDate());
  const startH = pad(startIst.getUTCHours());
  const startMin = pad(startIst.getUTCMinutes());
  const startS = pad(startIst.getUTCSeconds());

  const endY = endIst.getUTCFullYear();
  const endM = pad(endIst.getUTCMonth() + 1);
  const endD = pad(endIst.getUTCDate());
  const endH = pad(endIst.getUTCHours());
  const endMin = pad(endIst.getUTCMinutes());
  const endS = pad(endIst.getUTCSeconds());

  const date = `${startY}-${startM}-${startD}`;
  const startTime = `${startH}:${startMin}`;
  const endTime = `${endH}:${endMin}`;
  const startsAt = `${date}T${startTime}:${startS}+05:30`;
  const endsAt = `${endY}-${endM}-${endD}T${endTime}:${endS}+05:30`;

  return {
    date,
    startTime,
    endTime,
    durationMinutes: duration,
    slot: slot || 'Slot 1',
    timezone: 'Asia/Kolkata',
    startsAt,
    endsAt,
    mode: mode || 'ONLINE',
    meetingLink: meetingLink || null
  };
}

/**
 * Resolves resume status and links for HireIQ
 */
function resolveHireIqResume(candidate, hasResumeScope = false, baseUrl = '') {
  if (!candidate) {
    return {
      status: 'none',
      fileName: null,
      mimeType: null,
      downloadUrl: null,
      externalUrl: null,
      isSharedFolder: false
    };
  }

  // 1. Available in DB storage
  if (candidate.resumeFile?.fileData && candidate.resumeFile.fileData.length > 0) {
    const rawName = candidate.resumeFile.originalName || `${(candidate.fullName || 'candidate').replace(/\s+/g, '_')}_resume.pdf`;
    return {
      status: 'available',
      fileName: rawName,
      mimeType: candidate.resumeFile.mimeType || 'application/pdf',
      downloadUrl: hasResumeScope ? `${baseUrl}/api/v1/ext/candidates/${candidate.id}/resume` : null,
      externalUrl: null,
      isSharedFolder: false
    };
  }

  // 2. External Link (e.g. Google Drive)
  const extUrl = candidate.resumeLinkOriginal || candidate.resumeLinkDownload;
  if (extUrl && /^https?:\/\//i.test(extUrl.trim())) {
    const trimmedUrl = extUrl.trim();
    const isSharedFolder = trimmedUrl.includes('/folders/') || trimmedUrl.includes('drive.google.com/drive/u/');
    return {
      status: 'external_link',
      fileName: null,
      mimeType: null,
      downloadUrl: null,
      externalUrl: trimmedUrl,
      isSharedFolder
    };
  }

  // 3. File missing (resumeFileId exists but data was not found)
  if (candidate.resumeFileId) {
    return {
      status: 'file_missing',
      fileName: null,
      mimeType: null,
      downloadUrl: null,
      externalUrl: null,
      isSharedFolder: false
    };
  }

  // 4. None
  return {
    status: 'none',
    fileName: null,
    mimeType: null,
    downloadUrl: null,
    externalUrl: null,
    isSharedFolder: false
  };
}

/**
 * Converts an interview record to HireIQ DTO (Part 3.2)
 * Strictly allow-listed: candidate, role, round, schedule, interviewers, status, resume, updatedAt.
 */
function toHireIqInterviewDto(interview, hasPiiScope = false, hasResumeScope = false, baseUrl = '') {
  if (!interview) return null;

  const candidate = interview.application?.candidate || interview.candidate;
  const candName = cleanString(interview.candidateName || candidate?.fullName);
  const { email, emailStatus } = validateCandidateEmail(candidate?.email, hasPiiScope);

  // Role
  const interviewRole = cleanString(interview.jobTitle || interview.application?.job?.title) || 'General';
  const appliedRole = cleanString(candidate?.preferredRole || candidate?.jobTitle || interviewRole);
  const jobId = interview.jobId || interview.application?.jobId || null;

  // Round
  const roundNumber = interview.roundNo || 1;
  const roundLabel = cleanString(interview.round) || (roundNumber === 1 ? 'Round 1' : (roundNumber === 2 ? 'Round 2' : 'Final Round'));

  // Schedule
  const mode = cleanString(interview.mode) || 'ONLINE';
  const meetingLink = cleanString(interview.meetingLink || interview.zohoLink);
  const schedule = formatIstSchedule(interview.scheduledStart, interview.durationMinutes, 'Slot 1', mode, meetingLink);

  // Interviewers (array of display names only, no internal emails or user IDs)
  let interviewers = [];
  if (interview.interviewerNames) {
    interviewers = interview.interviewerNames.split(',').map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(interview.interviewerIds) && interview.interviewerIds.length > 0) {
    interviewers = interview.interviewerIds.map(s => String(s).trim()).filter(Boolean);
  }
  if (interviewers.length === 0) {
    interviewers = ['Panelist'];
  }

  // Status
  const status = (cleanString(interview.status) || 'scheduled').toLowerCase();

  // Resume
  const resume = resolveHireIqResume(candidate, hasResumeScope, baseUrl);

  // UpdatedAt in IST (+05:30)
  const updatedAtUtc = interview.updatedAt ? new Date(interview.updatedAt) : new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const updIst = new Date(updatedAtUtc.getTime() + istOffsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  const updDate = `${updIst.getUTCFullYear()}-${pad(updIst.getUTCMonth() + 1)}-${pad(updIst.getUTCDate())}`;
  const updTime = `${pad(updIst.getUTCHours())}:${pad(updIst.getUTCMinutes())}:${pad(updIst.getUTCSeconds())}`;
  const updatedAt = `${updDate}T${updTime}+05:30`;

  return {
    interviewId: interview.id,
    candidate: {
      id: candidate?.id || interview.candidateId || null,
      name: candName,
      email,
      emailStatus
    },
    role: {
      interviewRole,
      appliedRole,
      jobId
    },
    round: {
      number: roundNumber,
      label: roundLabel
    },
    schedule,
    interviewers,
    status,
    resume,
    updatedAt
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
  validateCandidateEmail,
  formatIstSchedule,
  resolveHireIqResume,
  toHireIqInterviewDto,
};
