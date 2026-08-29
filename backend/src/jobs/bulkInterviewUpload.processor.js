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
  const str = String(rawRound || defaultRound || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, '');
  if (['ROUND1', 'ROUND_1', 'R1', '1', 'R_1'].includes(str)) return 'ROUND_1';
  if (['ROUND2', 'ROUND_2', 'R2', '2', 'R_2'].includes(str)) return 'ROUND_2';
  if (['FINALROUND', 'FINAL_ROUND', 'FINAL', 'R3', '3', 'R_3', 'ROUND3', 'ROUND_3'].includes(str)) return 'FINAL_ROUND';
  return null;
}

/**
 * Parses a date/time string that may use Indian date formats:
 *   "31-7-2026 & 15:00"   (DD-M-YYYY & HH:MM)
 *   "1-8-2026 & 17:30"    (D-M-YYYY & HH:MM)
 *   "31/7/2026 15:00"     (DD/MM/YYYY HH:MM)
 *   "2026-07-31T15:00"    (ISO)
 *   Any JS-native parseable string
 */
function parseIndianDateTime(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Attempt 1 — strip the "&" separator and try DD-M-YYYY HH:MM → ISO reorder
  // Matches: "31-7-2026 & 15:00" or "1 8 2026 & 17:30" etc.
  const indianAmpMatch = str.match(
    /^(\d{1,2})[\s/-](\d{1,2})[\s/-](\d{4})\s*(?:&)?\s*(\d{1,2}):(\d{2})\s*([APap][Mm])?$/
  );
  if (indianAmpMatch) {
    let [, day, month, year, hour, minute, ampm] = indianAmpMatch;
    let h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && h < 12) h += 12;
      if (upper === 'AM' && h === 12) h = 0;
    }
    // Build ISO string and parse
    const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) return d;
  }

  // Attempt 2 — date only without time: "31-7-2026" or "1/8/2026"
  const dateOnlyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dateOnlyMatch) {
    const [, day, month, year] = dateOnlyMatch;
    const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T09:00:00`;
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) return d;
  }

  // Attempt 3 — native JS parsing (handles ISO, RFC 2822, etc.)
  const native = new Date(str);
  if (!isNaN(native.getTime())) return native;

  return null; // Could not parse
}

/**
 * Normalizes meeting mode
 */
function resolveModeFromRow(rawMode, defaultMode) {
  const str = String(rawMode || defaultMode || '').trim().toLowerCase();
  if (['online meeting', 'online', 'virtual'].includes(str)) return 'ONLINE';
  if (['in person', 'inperson', 'offline'].includes(str)) return 'IN_PERSON';
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
  const extractCellString = (val) => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      const target = val.l?.Target || val.Target || val.v || val.text || val.formatted || '';
      return String(target).trim();
    }
    return String(val).trim();
  };

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
  const rawName = extractCellString(getValue(['candidateName', 'Name', 'Candidate Name']));
  const rawPhone = extractCellString(getValue(['phone', 'Phone Number', 'phoneNumber', 'Phone']));
  
  if (!rawName) {
    errors.push(`Row ${rowNumber}, Column "Name": Candidate Name is required`);
  }
  if (!rawPhone) {
    errors.push(`Row ${rowNumber}, Column "Phone Number": Phone Number is required`);
  }

  let candidate = null;
  if (rawPhone) {
    const normalizedPhone = normalizePhoneNumber(rawPhone);
    if (!normalizedPhone) {
      errors.push(`Row ${rowNumber}, Column "Phone Number": Invalid phone number format "${rawPhone}"`);
    } else {
      candidate = await resolveCandidateByNumber(normalizedPhone, context.organizationId);
      if (!candidate && rawName) {
        candidate = await prisma.candidate.findFirst({
          where: {
            fullName: { equals: rawName.trim(), mode: 'insensitive' },
            isDeleted: false,
            organizationId: context.organizationId,
          }
        });
      }
      if (!candidate) {
        errors.push(`Row ${rowNumber}, Column "Phone Number": Candidate not found for phone "${rawPhone}"`);
      }
    }
  }

  // 2. Job Role
  const jobRole = extractCellString(getValue(['jobRole', 'Job Role', 'role', 'Role']));
  if (!jobRole) {
    errors.push(`Row ${rowNumber}, Column "Job Role": Job Role is required`);
  }

  // 3. Round
  const rawRound = extractCellString(getValue(['round', 'Round']));
  const canonicalRound = resolveRoundFromRow(rawRound, context.defaultRound);
  if (!canonicalRound) {
    errors.push(`Row ${rowNumber}, Column "Round": Invalid or missing interview round "${rawRound || ''}". Must be Round 1, Round 2, or Final Round.`);
  }

  // 4. Meeting Mode
  const rawMode = extractCellString(getValue(['meetingMode', 'Meeting Mode', 'mode', 'Mode']));
  const canonicalMode = resolveModeFromRow(rawMode, context.defaultMode);
  if (!canonicalMode) {
    errors.push(`Row ${rowNumber}, Column "Meeting Mode": Invalid or missing meeting mode "${rawMode || ''}". Must be Online Meeting, In Person, Phone Call, Drive Meeting, or Walk-in Drive.`);
  }

  // 5. Start Date & Time
  const rawStart = extractCellString(getValue(['startDateTime', 'Start Date & Time', 'scheduledStart', 'start']));
  let startDateTime = null;
  if (!rawStart) {
    errors.push(`Row ${rowNumber}, Column "Start Date & Time": Start Date & Time is required`);
  } else {
    startDateTime = parseIndianDateTime(rawStart);
    if (!startDateTime) {
      errors.push(
        `Row ${rowNumber}, Column "Start Date & Time": Invalid date-time format "${rawStart}". Expected formats: "31-7-2026 & 15:00", "31/07/2026 15:00", or "2026-07-31T15:00"`
      );
    }
  }

  // 6. Duration
  const rawDuration = extractCellString(getValue(['duration', 'Duration', 'durationMinutes']));
  let durationMinutes = 60;
  if (rawDuration) {
    const parsedDur = parseInt(rawDuration, 10);
    if (isNaN(parsedDur) || parsedDur < 15 || parsedDur > 480) {
      errors.push(`Row ${rowNumber}, Column "Duration": Duration must be a number between 15 and 480 minutes (got "${rawDuration}")`);
    } else {
      durationMinutes = parsedDur;
    }
  }

  // 7. Links & Interviewers
  let rawMeetingLink = extractCellString(getValue(['meetingLink', 'Meeting Link', 'link', 'Link']));
  let rawZohoLink = extractCellString(getValue(['zohoLink', 'Zoho Link', 'Zoho Meeting Link', 'zoho_link']));

  // Permissive meeting link fallback: if one link is provided, copy to both so virtual requirements pass cleanly
  if (!rawMeetingLink && rawZohoLink) rawMeetingLink = rawZohoLink;
  if (!rawZohoLink && rawMeetingLink) rawZohoLink = rawMeetingLink;

  if ((canonicalMode === 'ONLINE' || canonicalMode === 'VIRTUAL') && !rawMeetingLink && !rawZohoLink) {
    errors.push(`Row ${rowNumber}, Column "Meeting Link / Zoho Link": Meeting link or Zoho link is required for online/virtual interviews`);
  }

  // Blocking checks for prior rejections (REJECTED, DIDNT_JOIN, OFFER_LETTER)
  const gatingWarnings = [];
  if (candidate && canonicalRound) {
    try {
      await assertCanScheduleRound(prisma, candidate.id, canonicalRound);
    } catch (gateErr) {
      gatingWarnings.push(`Row ${rowNumber}, Column "Round": ${gateErr.message}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  if (gatingWarnings.length > 0) {
    return {
      valid: false,
      errors: gatingWarnings,
    };
  }

  const rawInterviewers = extractCellString(getValue(['interviewers', 'Interviewers', 'panelists', 'Panelists', 'panelist', 'Panelist', 'interviewer', 'Interviewer']));

  return {
    valid: true,
    data: {
      rowNumber,
      candidate,
      jobRole,
      canonicalRound,
      canonicalMode,
      startDateTime,
      durationMinutes,
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

  const normalizeForComparison = (str) => {
    let s = String(str || '').toLowerCase().trim();
    s = s.replace(/&/g, 'and');
    s = s.replace(/\bops\b/g, 'operations');
    s = s.replace(/\bdevlopement\b/g, 'development');
    s = s.replace(/\bdev\b/g, 'development');
    if (s.includes('business development') || s.includes('bde')) {
      return 'bde';
    }
    return s.replace(/[^a-z0-9]/g, '');
  };

  let activeJobs = [];
  try {
    activeJobs = await prisma.job.findMany({ where: { isActive: true } });
  } catch (_) {}

  for (const item of batchItems) {
    try {
      const searchNorm = normalizeForComparison(item.jobRole);
      let job = activeJobs.find(j => normalizeForComparison(j.title) === searchNorm);
      if (!job) {
        job = activeJobs.find(j => {
          const titleNorm = normalizeForComparison(j.title);
          return titleNorm.startsWith(searchNorm) || searchNorm.startsWith(titleNorm) || titleNorm.includes(searchNorm) || searchNorm.includes(titleNorm);
        });
      }

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

      // 3. Resolve interviewer details (skip for Walk-in Drive, fallback startsWith / contains for truncated names like "super adm")
      let interviewerIds = [];
      let interviewerNamesList = [];
      if (item.canonicalMode !== 'WALK_IN_DRIVE' && item.interviewers) {
        const names = item.interviewers.split(',').map(n => n.trim()).filter(Boolean);
        for (const name of names) {
          let matchedUser = await prisma.user.findFirst({
            where: { fullName: { equals: name, mode: 'insensitive' } }
          });
          if (!matchedUser) {
            matchedUser = await prisma.user.findFirst({
              where: { fullName: { startsWith: name, mode: 'insensitive' } }
            });
          }
          if (!matchedUser) {
            matchedUser = await prisma.user.findFirst({
              where: { fullName: { contains: name, mode: 'insensitive' } }
            });
          }
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
          durationMinutes: item.durationMinutes || 60,
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
      appendFailedRow(context.jobId, item.rowNumber || 0, `Row processing failed: ${err.message}`, 'error');
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
