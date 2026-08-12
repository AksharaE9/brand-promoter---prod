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

/**
 * Validates candidate row using shared candidateRowValidator.
 */
async function validateCandidateRowWrapper(rawRow, rowNumber) {
  const result = validateCandidateRow(rawRow, rowNumber);
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
  const externalId = String(candidateData.candidateId || '').trim();

  const payload = {
    rowNumber,
    fullName: candidateData.name,
    preferredRole: candidateData.role,
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

  if (externalId) {
    payload.customFields = { externalCandidateId: externalId };
  }

  return payload;
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
 * Duplicate *skipping* is intentionally removed — CSV rows always apply.
 */
async function batchInsertCandidates(batch, context) {
  if (batch.length === 0) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
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

      succeeded++;
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

  return { succeeded, failed };
}

/**
 * Enqueues job for background candidate bulk processing.
 */
async function enqueueJob(jobData) {
  const { jobId, filePath, fileType, uploadedBy, organizationId, sourceFilename, driveId } = jobData;

  let validCreatedById = null;
  if (uploadedBy) {
    try {
      const userExists = await prisma.user.findUnique({
        where: { id: uploadedBy },
        select: { id: true },
      });
      if (userExists) validCreatedById = uploadedBy;
    } catch (_) {}
  }

  setImmediate(async () => {
    try {
      await runStreamingBulkUploadPipeline({
        jobId,
        filePath,
        fileType,
        uploadedBy,
        organizationId,
        sourceFilename,
        context: {
          validCreatedById,
          driveId: driveId || null,
        },
        validateRow: validateCandidateRowWrapper,
        // Duplicate skip logic removed — every valid CSV row is imported (create/update).
        duplicateCheck: undefined,
        transformRow: transformCandidateRow,
        batchInsert: batchInsertCandidates,
        onComplete: async (summary) => {
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
    } catch (err) {
      console.error(`[BulkCandidateProcessor] Job ${jobId} failed:`, err.message);
    }
  });

  return { jobId, status: 'active' };
}

module.exports = {
  enqueueJob,
  getJobStatus: getPipelineJobStatus,
};
