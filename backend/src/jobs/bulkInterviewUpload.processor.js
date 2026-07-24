'use strict';

const prisma = require('../config/db');
const { InterviewRound, assertCanScheduleRound } = require('../lib/interviewTemplates');
const { resolveCandidateByNumber } = require('../modules/candidates/routes');
const { normalizePhoneNumber } = require('../lib/phoneNormalization');
const { runStreamingBulkUploadPipeline, getPipelineJobStatus } = require('../lib/streamingBulkUploadPipeline');
const sse = require('../utils/sse');
const cacheInvalidation = require('../utils/cacheInvalidation');

function emitInterviewUploadProgress(organizationId, jobId, { processed, succeeded, duplicates, failed, totalRows }) {
  const data = {
    jobId,
    processed,
    created: succeeded,
    duplicates: duplicates || 0,
    errors: failed,
    warnings: 0, // We do not have warnings in this flow
    totalRows: totalRows || null,
  };
  sse.broadcastToOrg(organizationId || 'defaultOrg', 'interview-schedule:bulk-upload:progress', data);
}

function emitInterviewUploadCompleted(organizationId, jobId, { processed, succeeded, duplicates, failed, errorReportUrl }) {
  const data = {
    jobId,
    processed,
    created: succeeded,
    duplicates: duplicates || 0,
    errors: failed,
    warnings: 0,
    totalRows: processed,
    errorReportUrl: errorReportUrl || null,
  };
  sse.broadcastToOrg(organizationId || 'defaultOrg', 'interview-schedule:bulk-upload:completed', data);
}

/**
 * Normalizes round string from CSV row
 */
function resolveRoundFromRow(rawRound, defaultRound) {
  const str = String(rawRound || defaultRound || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (str === 'ROUND_1' || str === 'ROUND1' || str === '1') return 'ROUND_1';
  if (str === 'ROUND_2' || str === 'ROUND2' || str === '2') return 'ROUND_2';
  if (str === 'FINAL_ROUND' || str === 'FINAL' || str === 'FINALROUND' || str === '3') return 'FINAL_ROUND';
  return null;
}

/**
 * Normalizes meeting mode
 */
function resolveModeFromRow(rawMode, defaultMode) {
  const str = String(rawMode || defaultMode || '').trim().toLowerCase();
  if (['online meeting', 'online', 'virtual'].includes(str)) return 'ONLINE';
  if (['in person', 'inperson'].includes(str)) return 'IN_PERSON';
  if (['phone call', 'phone'].includes(str)) return 'PHONE';
  if (['drive meeting', 'drive'].includes(str)) return 'DRIVE';
  if (['walk-in drive', 'walkin drive', 'walk-in', 'walk_in_drive'].includes(str)) return 'WALK_IN_DRIVE';
  return null;
}

/**
 * Validates a single row for Bulk Interview Scheduling.
 */
async function validateInterviewRow(rawRow, rowNumber, context) {
  const errors = [];
  const normalizeKey = (key) => String(key || '').trim().replace(/\*+$/, '').trim().toLowerCase();
  
  const getValue = (labels) => {
    for (const label of labels) {
      const normLabel = normalizeKey(label);
      for (const rawKey of Object.keys(rawRow)) {
        if (normalizeKey(rawKey) === normLabel) {
          return rawRow[rawKey];
        }
      }
    }
    return undefined;
  };

  // 1. Candidate Name & Phone Number
  const rawName = getValue(['candidateName', 'Name', 'Candidate Name']);
  const rawPhone = getValue(['phone', 'Phone Number', 'phoneNumber', 'Phone']);
  
  if (!rawName) {
    errors.push('Candidate Name is required');
  }
  if (!rawPhone) {
    errors.push('Phone Number is required');
  }

  let candidate = null;
  if (rawPhone) {
    const normalizedPhone = normalizePhoneNumber(rawPhone);
    if (!normalizedPhone) {
      errors.push(`Invalid phone number format "${rawPhone}"`);
    } else {
      candidate = await resolveCandidateByNumber(normalizedPhone, context.organizationId);
      if (!candidate) {
        errors.push(`Candidate not found for phone "${rawPhone}"`);
      }
    }
  }

  // 2. Job Role
  const jobRole = getValue(['jobRole', 'Job Role', 'role', 'Role']);
  if (!jobRole) {
    errors.push('Job Role is required');
  }

  // 3. Round
  const rawRound = getValue(['round', 'Round']);
  const canonicalRound = resolveRoundFromRow(rawRound, context.defaultRound);
  if (!canonicalRound) {
    errors.push(`Invalid or missing interview round "${rawRound || ''}". Must be Round 1, Round 2, or Final Round.`);
  }

  // 4. Meeting Mode
  const rawMode = getValue(['meetingMode', 'Meeting Mode', 'mode', 'Mode']);
  const canonicalMode = resolveModeFromRow(rawMode, context.defaultMode);
  if (!canonicalMode) {
    errors.push(`Invalid or missing meeting mode "${rawMode || ''}". Must be Online Meeting, In Person, Phone Call, Drive Meeting, or Walk-in Drive.`);
  }

  // 5. Start Date & Time
  const rawStart = getValue(['startDateTime', 'Start Date & Time', 'scheduledStart', 'start']);
  let startDateTime = null;
  if (!rawStart) {
    errors.push('Start Date & Time is required');
  } else {
    startDateTime = new Date(rawStart);
    if (isNaN(startDateTime.getTime())) {
      errors.push(`Invalid date-time format "${rawStart}"`);
    }
  }

  // 6. Sequential Gating & Rejection Blocks
  if (candidate && canonicalRound) {
    try {
      await assertCanScheduleRound(prisma, candidate.id, canonicalRound);
    } catch (gateErr) {
      errors.push(gateErr.message);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const rawInterviewers = getValue(['interviewers', 'Interviewers', 'panelists', 'Panelists', 'panelist', 'Panelist', 'interviewer', 'Interviewer']) || '';
  const rawMeetingLink = getValue(['meetingLink', 'Meeting Link', 'link', 'Link']) || '';
  const rawZohoLink = getValue(['zohoLink', 'Zoho Link']) || '';

  return {
    valid: true,
    data: {
      candidate,
      jobRole,
      canonicalRound,
      canonicalMode,
      startDateTime,
      interviewers: rawInterviewers,
      meetingLink: rawMeetingLink,
      zohoLink: rawZohoLink,
    },
  };
}

/**
 * Checks for duplicates in the file and DB
 */
async function duplicateCheckInterview(data, rowNumber, context) {
  const key = `${data.candidate.id}:${data.canonicalRound}`;
  if (!context.seenSchedulesInFileMap) {
    context.seenSchedulesInFileMap = new Map();
  }

  if (context.seenSchedulesInFileMap.has(key)) {
    const origRow = context.seenSchedulesInFileMap.get(key);
    return {
      isDuplicate: true,
      reason: `Duplicate phone: ${data.candidate.phone || 'N/A'} — duplicate of row ${origRow} in the file`,
    };
  }
  context.seenSchedulesInFileMap.set(key, rowNumber);

  // Check Database duplicates
  const roundLabel = data.canonicalRound === 'ROUND_1' ? 'Round 1' : data.canonicalRound === 'ROUND_2' ? 'Round 2' : 'Final Round';
  const existingInterview = await prisma.interview.findFirst({
    where: {
      candidateId: data.candidate.id,
      round: roundLabel,
      status: { not: 'CANCELLED' }
    }
  });

  if (existingInterview) {
    return {
      isDuplicate: true,
      reason: `Duplicate phone: ${data.candidate.phone || 'N/A'} — already exists as candidate "${data.candidate.fullName}"`,
    };
  }

  return { isDuplicate: false };
}

/**
 * Batch inserter for interview schedules
 */
async function batchInsertInterviews(batchItems, context) {
  let succeeded = 0;
  let failed = 0;

  for (const item of batchItems) {
    try {
      // 1. Resolve matching active job
      const job = await prisma.job.findFirst({
        where: {
          title: { equals: item.jobRole, mode: 'insensitive' },
          isActive: true,
        }
      });

      if (!job) {
        throw new Error(`Job role "${item.jobRole}" not found or inactive`);
      }

      // 2. Resolve or create candidate application for this job
      let app = await prisma.application.findFirst({
        where: {
          candidateId: item.candidate.id,
          jobId: job.id
        }
      });

      if (!app) {
        app = await prisma.application.create({
          data: {
            candidateId: item.candidate.id,
            jobId: job.id,
            status: 'APPLIED',
            organizationId: context.organizationId,
          }
        });
      }

      // 3. Resolve interviewer details (skip for Walk-in Drive)
      let interviewerIds = [];
      let interviewerNamesList = [];
      if (item.canonicalMode !== 'WALK_IN_DRIVE' && item.interviewers) {
        const names = item.interviewers.split(',').map(n => n.trim()).filter(Boolean);
        for (const name of names) {
          const matchedUser = await prisma.user.findFirst({
            where: { fullName: { equals: name, mode: 'insensitive' } }
          });
          if (matchedUser) {
            interviewerIds.push(matchedUser.id);
            interviewerNamesList.push(matchedUser.fullName);
          } else {
            interviewerNamesList.push(name);
          }
        }
      }

      // 4. Compute slot number (same date + hour bookings)
      const startOfHour = new Date(item.startDateTime);
      startOfHour.setMinutes(0, 0, 0);
      const endOfHour = new Date(item.startDateTime);
      endOfHour.setMinutes(59, 59, 999);

      const sameSlotInterviewsCount = await prisma.interview.count({
        where: {
          status: { not: 'CANCELLED' },
          scheduledStart: {
            gte: startOfHour,
            lte: endOfHour
          }
        }
      });
      const slotNo = sameSlotInterviewsCount + 1;

      // 5. Create Interview record
      let roundNo = 1;
      let roundLabel = 'Round 1';
      if (item.canonicalRound === 'ROUND_2') {
        roundNo = 2;
        roundLabel = 'Round 2';
      } else if (item.canonicalRound === 'FINAL_ROUND') {
        roundNo = 99;
        roundLabel = 'Final Round';
      }

      await prisma.interview.create({
        data: {
          application: { connect: { id: app.id } },
          candidateId: item.candidate.id,
          candidateName: item.candidate.fullName,
          jobId: job.id,
          jobTitle: job.title,
          roundNo,
          round: roundLabel,
          scheduledStart: item.startDateTime,
          mode: item.canonicalMode,
          meetingLink: item.canonicalMode === 'WALK_IN_DRIVE' ? null : (item.meetingLink || null),
          zohoLink: item.canonicalMode === 'WALK_IN_DRIVE' ? null : (item.zohoLink || null),
          interviewerIds: interviewerIds,
          interviewerNames: interviewerNamesList.join(', ') || null,
          organizationId: context.organizationId,
          createdById: context.uploadedBy || null,
        }
      });

      succeeded++;
    } catch (err) {
      console.error('[BulkInterviewProcessor] Item insert error:', err.message);
      const { appendFailedRow } = require('../lib/bulkUploadErrorReport');
      appendFailedRow(context.jobId, 0, `Row processing failed: ${err.message}`, 'error');
      failed++;
    }
  }

  return { succeeded, failed };
}

/**
 * Enqueues and processes a background Bulk Interview Scheduling Upload job.
 */
async function processBulkInterviewUpload(jobData) {
  const { jobId, filePath, fileType, uploadedBy, organizationId, defaultRound, defaultMode, sourceFilename } = jobData;

  return runStreamingBulkUploadPipeline({
    jobId,
    filePath,
    fileType,
    uploadedBy,
    organizationId,
    sourceFilename,
    context: {
      defaultRound,
      defaultMode,
      seenSchedulesInFileMap: new Map(),
    },
    validateRow: validateInterviewRow,
    duplicateCheck: duplicateCheckInterview,
    batchInsert: batchInsertInterviews,
    onComplete: async (summary) => {
      if (organizationId) {
        await cacheInvalidation.candidateList(organizationId).catch(() => {});
      }
    },
    emitProgress: emitInterviewUploadProgress,
    emitCompleted: emitInterviewUploadCompleted,
  });
}

module.exports = {
  processBulkInterviewUpload,
  getJobStatus: getPipelineJobStatus,
};
