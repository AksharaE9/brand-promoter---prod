'use strict';

const prisma = require('../config/db');
const { validateCandidateRow } = require('../lib/candidateRowValidator');
const { normalizeResumeLink } = require('../lib/resumeLinkNormalizer');
const {
  normalizePhoneNumber,
  normalizePhoneForDedup,
} = require('../lib/phoneNormalization');
const { runStreamingBulkUploadPipeline, getPipelineJobStatus } = require('../lib/streamingBulkUploadPipeline');
const { emitBulkUploadProgress, emitBulkUploadCompleted } = require('../sse/bulkUploadEvents');
const cacheInvalidation = require('../utils/cacheInvalidation');

const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');


/**
 * Validates candidate row using shared candidateRowValidator.
 */
async function validateCandidateRowWrapper(rawRow, rowNumber, context = {}) {
  const isDriveContext = Boolean(context.driveId);
  const result = validateCandidateRow(rawRow, rowNumber, { isDriveContext });
  if (!result.valid) {
    return {
      valid: false,
      errors: result.errors || [result.failureReason || 'Row validation failed'],
    };
  }

  return {
    valid: true,
    data: result.data,
    warnings: result.warnings || [],
  };
}

/**
 * Transforms validated candidate data to candidate DB payload.
 * No duplicate filtering — every valid row is imported (create or update).
 */
async function transformCandidateRow(candidateData, rowNumber, context) {
  const resumeLink = candidateData.resumeLinkRaw
    ? normalizeResumeLink(candidateData.resumeLinkRaw)
    : null;
  const phoneNormalized =
    normalizePhoneForDedup(candidateData.phone) ||
    normalizePhoneNumber(candidateData.phone) ||
    null;
  let preferredRole = candidateData.role || null;
  if (candidateData.role && String(candidateData.role).trim()) {
    if (!context.jobResolver) {
      const { JobResolutionSession } = require('../services/jobResolutionService');
      context.jobResolver = new JobResolutionSession(context.organizationId || 'defaultOrg', context.validCreatedById);
      await context.jobResolver.init();
    }
    const resolution = await context.jobResolver.resolveOrAutoCreate(candidateData.role, candidateData.location);
    if (resolution.job) {
      preferredRole = resolution.job.title;
    }
  }

  const payload = {
    rowNumber,
    fullName: candidateData.name,
    preferredRole: preferredRole || null,
    email: candidateData.email || 'N/A',
    phone: candidateData.phone,
    phoneNormalized,
    resumeLinkOriginal: resumeLink?.originalUrl || null,
    resumeLinkDownload: resumeLink?.downloadUrl || null,
    resumeLinkProvider: resumeLink?.provider || null,
    organizationId: context.organizationId || 'defaultOrg',
    createdById: context.validCreatedById || null,
    source: candidateData.source || 'Bulk Candidate Upload',
    status: 'ACTIVE',
    college: candidateData.college || null,
    location: candidateData.location || null,
    course: candidateData.course || null,
    company: candidateData.company || null,
    updatedAt: new Date(),
  };

  if (candidateData.candidateId) {
    payload.customFields = { externalCandidateId: candidateData.candidateId };
  }

  return payload;
}

/**
 * Checks for in-file duplicate candidates.
 */
async function duplicateCheckCandidate(candidateData, rowNumber, context) {
  if (!context.seenCandidatesInFileMap) {
    context.seenCandidatesInFileMap = new Map();
  }

  const phoneKey = normalizePhoneForDedup(candidateData.phone);
  const emailKey = String(candidateData.email || '').trim().toLowerCase();

  if (phoneKey && phoneKey !== 'n/a') {
    if (context.seenCandidatesInFileMap.has(`phone:${phoneKey}`)) {
      const origRow = context.seenCandidatesInFileMap.get(`phone:${phoneKey}`);
      return {
        isDuplicate: true,
        reason: `Duplicate phone: ${candidateData.phone} — duplicate of row ${origRow} in the file`,
      };
    }
    context.seenCandidatesInFileMap.set(`phone:${phoneKey}`, rowNumber);
  }

  if (emailKey && emailKey !== 'n/a' && emailKey !== '') {
    if (context.seenCandidatesInFileMap.has(`email:${emailKey}`)) {
      const origRow = context.seenCandidatesInFileMap.get(`email:${emailKey}`);
      return {
        isDuplicate: true,
        reason: `Duplicate email: ${candidateData.email} — duplicate of row ${origRow} in the file`,
      };
    }
    context.seenCandidatesInFileMap.set(`email:${emailKey}`, rowNumber);
  }

  return { isDuplicate: false };
}

async function findExistingCandidate(dbData, organizationId) {
  const phoneKey = normalizePhoneForDedup(dbData.phoneNormalized || dbData.phone);
  const email = String(dbData.email || '').trim();
  const orgId = organizationId || dbData.organizationId || 'defaultOrg';

  if (phoneKey) {
    const byPhone = await prisma.candidate.findFirst({
      where: {
        organizationId: orgId,
        isDeleted: false,
        OR: [
          { phoneNormalized: phoneKey },
          { phoneNormalized: `+91${phoneKey}` },
          { phoneNormalized: `91${phoneKey}` },
          { phoneNormalized: { endsWith: phoneKey } },
          { phone: dbData.phone },
        ],
      },
      select: { id: true },
    });
    if (byPhone) return byPhone;
  }

  if (email && email.toLowerCase() !== 'n/a') {
    return prisma.candidate.findFirst({
      where: {
        organizationId: orgId,
        isDeleted: false,
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  return null;
}

/**
 * Import each row: create new candidate, or update if phone/email already exists.
 */
async function batchInsertCandidates(batch, context) {
  if (batch.length === 0) return { created: 0, updated: 0, duplicates: 0, failed: 0, succeeded: 0 };

  let created = 0;
  let updated = 0;
  let failed = 0;
  const { logAudit } = require('../utils/audit');
  const { appendFailedRow } = require('../lib/bulkUploadErrorReport');

  for (const row of batch) {
    const { rowNumber, ...dbData } = row;
    try {
      const existing = await findExistingCandidate(dbData, context.organizationId);
      let saved;

      if (existing) {
        const { createdAt, createdById, organizationId, ...updateData } = dbData;
        saved = await prisma.candidate.update({
          where: { id: existing.id },
          data: {
            ...updateData,
            phoneNormalized: dbData.phoneNormalized || null,
            isDeleted: false,
          },
        });
        logAudit({
          actorUserId: context.uploadedBy,
          action: 'candidate_updated',
          entityType: 'CANDIDATE',
          entityId: saved.id,
          entityName: saved.fullName,
          subjectType: 'candidate',
          subjectId: saved.id,
          subjectName: saved.fullName,
          newData: { source: 'bulk_upload', job_id: context.jobId, mode: 'upsert_update' },
          organizationId: context.organizationId,
        });
        updated++;
      } else {
        saved = await prisma.candidate.create({
          data: {
            ...dbData,
            createdAt: new Date(),
          },
        });
        logAudit({
          actorUserId: context.uploadedBy,
          action: 'candidate_created',
          entityType: 'CANDIDATE',
          entityId: saved.id,
          entityName: saved.fullName,
          subjectType: 'candidate',
          subjectId: saved.id,
          subjectName: saved.fullName,
          newData: { source: 'bulk_upload', job_id: context.jobId, mode: 'upsert_create' },
          organizationId: context.organizationId,
        });
        created++;
      }

      if (context.driveId) {
        const driveDup = await prisma.collegeDriveCandidate.findFirst({
          where: { driveId: context.driveId, candidateId: saved.id },
        });
        if (!driveDup) {
          await prisma.collegeDriveCandidate.create({
            data: {
              driveId: context.driveId,
              candidateId: saved.id,
              fullName: saved.fullName,
              email: saved.email || null,
              phone: saved.phone || '',
              status: 'ADDED',
            },
          });
        }
      }
    } catch (rowErr) {
      failed++;
      appendFailedRow(
        context.jobId,
        rowNumber || 0,
        `Candidate import failed: ${rowErr.message}`,
        'error'
      );
    }
  }

  return { created, updated, duplicates: 0, failed, succeeded: created + updated };
}

async function processCandidateUpload(jobData) {
  const { jobId, filePath, fileType, uploadedBy, userRole, organizationId, driveId, sourceFilename } = jobData;

  let validCreatedById = uploadedBy;
  if (uploadedBy) {
    try {
      const userExists = await prisma.user.findUnique({
        where: { id: uploadedBy },
        select: { id: true }
      });
      if (!userExists) {
        validCreatedById = null;
      }
    } catch (_) {}
  }

  // Log memory at start for instance health tracking
  const startMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[BulkCandidateUpload] Job ${jobId} starting. RSS: ${startMemMb}MB`);

  const result = await runStreamingBulkUploadPipeline({
    jobId,
    filePath,
    fileType,
    uploadedBy,
    userRole,
    organizationId,
    sourceFilename,
    flowType: 'candidates',
    batchSize: BULK_UPLOAD_LIMITS.BATCH_SIZE_CANDIDATE,
    context: {
      validCreatedById,
      driveId: driveId || null,
      MAX_ROWS_EXCEEDED: false,
      seenCandidatesInFileMap: new Map(),
      ...(jobData.context || {}),
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
      return validateCandidateRowWrapper(rawRow, rowNumber, { driveId: pipelineContext?.driveId || driveId });
    },
    duplicateCheck: duplicateCheckCandidate,
    transformRow: transformCandidateRow,
    batchInsert: batchInsertCandidates,
    onComplete: async (summary) => {
      const endMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[BulkCandidateUpload] Job ${jobId} complete. RSS: ${endMemMb}MB (+${endMemMb - startMemMb}MB). Summary:`, summary);
      if (organizationId) {
        await cacheInvalidation.candidateList(organizationId).catch(() => {});
        if (driveId) {
          await cacheInvalidation.drive(organizationId, driveId).catch(() => {});
          try {
            const sse = require('../utils/sse');
            sse.broadcastToOrg(organizationId, 'DRIVE_CANDIDATES_ADDED', {
              driveId,
              count: summary?.succeeded || 0,
              collegeName: 'Bulk Upload',
              addedBy: uploadedBy,
              addedByName: 'Bulk Import',
            });
          } catch (_) {}
        }
      }
    },
    emitProgress: emitBulkUploadProgress,
    emitCompleted: emitBulkUploadCompleted,
  });

  return result;
}

function enqueueJob(jobData) {
  setImmediate(async () => {
    try {
      await processCandidateUpload(jobData);
    } catch (err) {
      console.error(`[BulkCandidateProcessor] Job ${jobData.jobId} failed:`, err.message);
    }
  });

  return { jobId: jobData.jobId, status: 'active' };
}

module.exports = {
  processCandidateUpload,
  enqueueJob,
  getJobStatus: getPipelineJobStatus,
};
