'use strict';

const prisma = require('../config/db');
const { FEEDBACK_TEMPLATE_BY_ROUND, InterviewRound, validateFeedbackData } = require('../lib/interviewTemplates');
const { resolveCandidateByNumber } = require('../modules/candidates/routes');
const { normalizePhoneNumber } = require('../lib/phoneNormalization');
const { runStreamingBulkUploadPipeline, getPipelineJobStatus } = require('../lib/streamingBulkUploadPipeline');
const { emitBulkUploadProgress, emitBulkUploadCompleted } = require('../sse/bulkUploadEvents');
const cacheInvalidation = require('../utils/cacheInvalidation');

const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');


/**
 * Normalizes round string from CSV row (e.g. "Round 1", "round 2", "FINAL_ROUND")
 * to canonical InterviewRound enum key.
 */
function resolveRoundFromRow(rawRound, defaultRound) {
  const str = String(rawRound || defaultRound || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, '');
  if (['ROUND1', 'ROUND_1', 'R1', '1', 'R_1'].includes(str)) return InterviewRound.ROUND_1;
  if (['ROUND2', 'ROUND_2', 'R2', '2', 'R_2'].includes(str)) return InterviewRound.ROUND_2;
  if (['FINALROUND', 'FINAL_ROUND', 'FINAL', 'R3', '3', 'R_3', 'ROUND3', 'ROUND_3'].includes(str)) return InterviewRound.FINAL_ROUND;
  return null;
}

/**
 * Validates a single row for Bulk Feedback Upload.
 */
async function validateFeedbackRow(rawRow, rowNumber, context) {
  const rawRound = rawRow.Round || rawRow.round || rawRow['Round Number'] || rawRow['roundNumber'];
  const canonicalRound = resolveRoundFromRow(rawRound, context.defaultRound);

  if (!canonicalRound) {
    return {
      valid: false,
      errors: [`Invalid or missing interview round "${rawRound || ''}". Must be Round 1, Round 2, or Final Round.`],
    };
  }

  // Pick matching template schema
  const template = FEEDBACK_TEMPLATE_BY_ROUND[canonicalRound];
  const dataPayload = { roundNumber: canonicalRound };

  const normalizeKey = (key) => String(key || '').trim().replace(/\*+$/, '').trim().toLowerCase();

  // Map rawRow entries (keys and labels) to template field keys
  template.forEach((field) => {
    const fieldKeyNorm = normalizeKey(field.key);
    const fieldLabelNorm = normalizeKey(field.label);

    Object.keys(rawRow).forEach((rawKey) => {
      const rawKeyNorm = normalizeKey(rawKey);
      if (rawKeyNorm === fieldKeyNorm || rawKeyNorm === fieldLabelNorm) {
        const val = rawRow[rawKey];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          dataPayload[field.key] = String(val).trim();
        }
      }
    });
  });

  // Handle phone / number key alias
  let rawNumber = dataPayload.number || dataPayload.phone;
  if (!rawNumber) {
    Object.keys(rawRow).forEach((rawKey) => {
      const norm = normalizeKey(rawKey);
      if (norm === 'number' || norm === 'phone' || norm === 'phone number') {
        rawNumber = rawRow[rawKey];
      }
    });
  }
  if (rawNumber) {
    dataPayload.number = String(rawNumber).trim();
  }

  // Handle status / selectionStatus alias seamlessly across rounds
  let statusVal = dataPayload.status || dataPayload.selectionStatus;
  if (!statusVal) {
    Object.keys(rawRow).forEach((rawKey) => {
      const norm = normalizeKey(rawKey);
      if (norm === 'status' || norm === 'selection status' || norm === 'selectionstatus') {
        statusVal = rawRow[rawKey];
      }
    });
  }
  if (statusVal) {
    dataPayload.status = String(statusVal).trim();
    dataPayload.selectionStatus = String(statusVal).trim();
  }

  const validation = validateFeedbackData(canonicalRound, dataPayload, { isBulkUpload: true });
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
    };
  }

  // Resolve phone number auto-link
  const warnings = [];
  let candidateMatch = null;

  if (rawNumber) {
    candidateMatch = await resolveCandidateByNumber(rawNumber, context.organizationId);
  }

  if (!candidateMatch && dataPayload.name) {
    candidateMatch = await prisma.candidate.findFirst({
      where: {
        fullName: { equals: dataPayload.name.trim(), mode: 'insensitive' },
        isDeleted: false,
        organizationId: context.organizationId,
      }
    });
  }

  if (!candidateMatch) {
    warnings.push(`Phone number "${rawNumber || 'N/A'}" didn't match any existing candidate (stored as pending_link).`);
  }

  if (dataPayload.selectionStatus === 'OFFER_LETTER' || dataPayload.status === 'OFFER_LETTER') {
    warnings.push("Feedback saved with OFFER_LETTER status but offer letter files are missing — attach them via the feedback form.");
  }

  return {
    valid: true,
    data: {
      rowNumber,
      canonicalRound,
      dataPayload,
      candidateMatch,
      rawNumber,
    },
    warnings,
  };
}

/**
 * Performs duplicate checking for feedback upload in-file duplicates.
 */
async function duplicateCheckFeedback(feedbackData, rowNumber, context) {
  const phoneNormalized = normalizePhoneNumber(feedbackData.rawNumber);
  if (!phoneNormalized) return null;

  const round = feedbackData.canonicalRound;
  const key = `${phoneNormalized}:${round}`;

  if (!context.seenRoundFeedbacksInFileMap) {
    context.seenRoundFeedbacksInFileMap = new Map();
  }

  if (context.seenRoundFeedbacksInFileMap.has(key)) {
    const origRow = context.seenRoundFeedbacksInFileMap.get(key);
    return {
      isDuplicate: true,
      reason: `Duplicate phone: ${phoneNormalized} — duplicate of row ${origRow} in the file`,
    };
  }
  context.seenRoundFeedbacksInFileMap.set(key, rowNumber);

  return {
    isDuplicate: false,
  };
}

/**
 * Batch inserter for feedback records.
 * Auto-links to candidate if matched; otherwise sets candidateId = null & pendingLink = true.
 * Resubmitting candidate's feedback updates existing record rather than duplicating it.
 */
async function batchInsertFeedback(batchItems, context) {
  let succeeded = 0;
  let failed = 0;

  for (const item of batchItems) {
    try {
      const { canonicalRound, dataPayload, candidateMatch } = item;
      const candidateId = candidateMatch ? candidateMatch.id : null;
      const selectionStatus = dataPayload.selectionStatus || dataPayload.status || 'HOLD';
      const overallRating = dataPayload.overallRating !== undefined && dataPayload.overallRating !== null
        ? Number(dataPayload.overallRating)
        : null;

      if (candidateId) {
        const docUrl = dataPayload.offerLetterDocument ? (typeof dataPayload.offerLetterDocument === 'string' ? dataPayload.offerLetterDocument : JSON.stringify(dataPayload.offerLetterDocument)) : null;
        const attUrl = dataPayload.offerLetterEmailAttachment ? (typeof dataPayload.offerLetterEmailAttachment === 'string' ? dataPayload.offerLetterEmailAttachment : JSON.stringify(dataPayload.offerLetterEmailAttachment)) : null;

        await prisma.interviewFeedback.upsert({
          where: {
            candidateId_round: {
              candidateId,
              round: canonicalRound,
            },
          },
          create: {
            candidateId,
            round: canonicalRound,
            submittedById: context.uploadedBy || null,
            feedbackData: dataPayload,
            selectionStatus,
            overallRating,
            pendingLink: false,
            offerLetterDocumentUrl: docUrl,
            offerLetterEmailAttachmentUrl: attUrl,
          },
          update: {
            submittedById: context.uploadedBy || null,
            feedbackData: dataPayload,
            selectionStatus,
            overallRating,
            pendingLink: false,
            ...(docUrl && { offerLetterDocumentUrl: docUrl }),
            ...(attUrl && { offerLetterEmailAttachmentUrl: attUrl }),
            updatedAt: new Date(),
            deletedAt: null,
          },
        });

        // Update candidate status if REJECTED
        if (selectionStatus === 'REJECTED') {
          await prisma.candidate.update({
            where: { id: candidateId },
            data: { status: 'REJECTED' },
          }).catch(() => {});
        }
      } else {
        const docUrl = dataPayload.offerLetterDocument ? (typeof dataPayload.offerLetterDocument === 'string' ? dataPayload.offerLetterDocument : JSON.stringify(dataPayload.offerLetterDocument)) : null;
        const attUrl = dataPayload.offerLetterEmailAttachment ? (typeof dataPayload.offerLetterEmailAttachment === 'string' ? dataPayload.offerLetterEmailAttachment : JSON.stringify(dataPayload.offerLetterEmailAttachment)) : null;

        // Unlinked feedback row (stored with candidateId = null & pendingLink = true)
        await prisma.interviewFeedback.create({
          data: {
            candidateId: null,
            round: canonicalRound,
            submittedById: context.uploadedBy || null,
            feedbackData: dataPayload,
            selectionStatus,
            overallRating,
            pendingLink: true,
            offerLetterDocumentUrl: docUrl,
            offerLetterEmailAttachmentUrl: attUrl,
          },
        });
      }

      succeeded++;
    } catch (err) {
      console.error('[BulkFeedbackProcessor] Item insert error:', err.message);
      const { appendFailedRow } = require('../lib/bulkUploadErrorReport');
      appendFailedRow(context.jobId, item.rowNumber || 0, `Row processing failed: ${err.message}`, 'error');
      failed++;
    }
  }

  return { succeeded, failed };
}

/**
 * Enqueues and processes a background Bulk Feedback Upload job.
 */
async function processBulkFeedbackUpload(jobData) {
  const { jobId, filePath, fileType, uploadedBy, userRole, organizationId, defaultRound, sourceFilename } = jobData;

  // Log memory at start for instance health tracking
  const startMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[BulkFeedbackUpload] Job ${jobId} starting. RSS: ${startMemMb}MB`);

  const result = await runStreamingBulkUploadPipeline({
    jobId,
    filePath,
    fileType,
    uploadedBy,
    userRole,
    organizationId,
    sourceFilename,
    batchSize: BULK_UPLOAD_LIMITS.BATCH_SIZE_FEEDBACK,
    context: {
      defaultRound,
      seenRoundFeedbacksInFileMap: new Map(),
      MAX_ROWS_EXCEEDED: false,
    },
    validateRow: async (rawRow, rowNumber, pipelineContext) => {
      // Enforce max-rows limit before invoking per-row validator
      if (rowNumber > BULK_UPLOAD_LIMITS.MAX_ROWS) {
        pipelineContext.MAX_ROWS_EXCEEDED = true;
        return {
          valid: false,
          errors: [`Row ${rowNumber}: Upload exceeds the ${BULK_UPLOAD_LIMITS.MAX_ROWS}-row limit. Please split into smaller files.`],
        };
      }
      return validateFeedbackRow(rawRow, rowNumber, pipelineContext);
    },
    duplicateCheck: duplicateCheckFeedback,
    batchInsert: batchInsertFeedback,
    onComplete: async (summary) => {
      const endMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[BulkFeedbackUpload] Job ${jobId} complete. RSS: ${endMemMb}MB (+${endMemMb - startMemMb}MB). Summary:`, summary);
      if (organizationId) {
        await cacheInvalidation.candidateList(organizationId).catch(() => {});
      }
    },
    emitProgress: emitBulkUploadProgress,
    emitCompleted: emitBulkUploadCompleted,
  });

  return result;
}

module.exports = {
  processBulkFeedbackUpload,
  getJobStatus: getPipelineJobStatus,
};
