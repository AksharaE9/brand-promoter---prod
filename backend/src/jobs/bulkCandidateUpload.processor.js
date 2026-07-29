'use strict';

const prisma = require('../config/db');
const { validateCandidateRow } = require('../lib/candidateRowValidator');
const { normalizeResumeLink } = require('../lib/resumeLinkNormalizer');
const { normalizePhoneNumber } = require('../lib/phoneNormalization');
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
 * Performs duplicate checking by phone number (primary) and email warnings (secondary).
 */
async function duplicateCheckCandidate(candidateData, rowNumber, context) {
  const phoneNormalized = normalizePhoneNumber(candidateData.phone);
  if (!phoneNormalized) return null;

  if (!context.seenPhonesInFileMap) {
    context.seenPhonesInFileMap = new Map();
  }

  // 1. In-file duplicate check
  if (context.seenPhonesInFileMap.has(phoneNormalized)) {
    const origRow = context.seenPhonesInFileMap.get(phoneNormalized);
    return {
      isDuplicate: true,
      reason: `Duplicate phone: ${phoneNormalized} — duplicate of row ${origRow} in the file`,
    };
  }
  context.seenPhonesInFileMap.set(phoneNormalized, rowNumber);

  // 2. DB duplicate check by normalized phone
  const existingPhoneMatch = await prisma.candidate.findFirst({
    where: {
      phoneNormalized,
      organizationId: context.organizationId,
      isDeleted: false,
    },
    select: { id: true, fullName: true },
  });

  if (existingPhoneMatch) {
    return {
      isDuplicate: true,
      reason: `Duplicate phone: ${phoneNormalized} — already exists as candidate "${existingPhoneMatch.fullName}"`,
    };
  }

  // 3. Secondary warning check by email
  const warnings = [];
  if (candidateData.email && candidateData.email !== 'N/A') {
    const existingEmailMatch = await prisma.candidate.findFirst({
      where: {
        email: { equals: candidateData.email, mode: 'insensitive' },
        organizationId: context.organizationId,
        isDeleted: false,
      },
      select: { id: true, fullName: true, phone: true },
    });

    if (existingEmailMatch) {
      warnings.push(`Candidate email "${candidateData.email}" already matches existing candidate "${existingEmailMatch.fullName}" (phone: ${existingEmailMatch.phone || 'N/A'}) but has a different phone number.`);
    }
  }

  return {
    isDuplicate: false,
    warnings,
  };
}

/**
 * Transforms validated candidate data to candidate DB payload.
 */
async function transformCandidateRow(candidateData, rowNumber, context) {
  const resumeLink = candidateData.resumeLinkRaw
    ? normalizeResumeLink(candidateData.resumeLinkRaw)
    : null;
  const phoneNormalized = normalizePhoneNumber(candidateData.phone);

  return {
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Batch insert handler using Prisma createMany.
 */
async function batchInsertCandidates(batch, context) {
  if (batch.length === 0) return { succeeded: 0, failed: 0 };
  const dbPayload = batch.map(({ rowNumber, ...rest }) => rest);
  try {
    await prisma.candidate.createMany({
      data: dbPayload,
      skipDuplicates: true,
    });

    const phones = dbPayload.map(b => b.phoneNormalized).filter(Boolean);
    const matched = await prisma.candidate.findMany({
      where: {
        phoneNormalized: { in: phones },
        organizationId: context.organizationId,
        isDeleted: false,
      },
      select: { id: true, fullName: true }
    });

    const { logAudit } = require('../utils/audit');
    for (const cand of matched) {
      logAudit({
        actorUserId: context.uploadedBy,
        action: 'candidate_created',
        entityType: 'CANDIDATE',
        entityId: cand.id,
        entityName: cand.fullName,
        subjectType: 'candidate',
        subjectId: cand.id,
        subjectName: cand.fullName,
        newData: { source: 'bulk_upload', job_id: context.jobId },
        organizationId: context.organizationId,
      });
    }

    return { succeeded: batch.length, failed: 0 };
  } catch (err) {
    console.error(`[BulkCandidateProcessor] Batch insert error:`, err.message);
    let succeeded = 0;
    let failed = 0;
    const { logAudit } = require('../utils/audit');
    for (const row of batch) {
      const { rowNumber, ...dbData } = row;
      try {
        const created = await prisma.candidate.create({ data: dbData });
        logAudit({
          actorUserId: context.uploadedBy,
          action: 'candidate_created',
          entityType: 'CANDIDATE',
          entityId: created.id,
          entityName: created.fullName,
          subjectType: 'candidate',
          subjectId: created.id,
          subjectName: created.fullName,
          newData: { source: 'bulk_upload', job_id: context.jobId },
          organizationId: context.organizationId,
        });
        succeeded++;
      } catch (rowErr) {
        failed++;
        const { appendFailedRow } = require('../lib/bulkUploadErrorReport');
        appendFailedRow(context.jobId, rowNumber || 0, `Candidate insert failed: ${rowErr.message}`, 'error');
      }
    }
    return { succeeded, failed };
  }
}

/**
 * Enqueues job for background candidate bulk processing.
 */
async function enqueueJob(jobData) {
  const { jobId, filePath, fileType, uploadedBy, organizationId, sourceFilename } = jobData;

  let validCreatedById = null;
  if (uploadedBy) {
    try {
      const userExists = await prisma.user.findUnique({ where: { id: uploadedBy }, select: { id: true } });
      if (userExists) validCreatedById = uploadedBy;
    } catch (_) {}
  }

  // Execute pipeline asynchronously in background
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
          seenPhonesInFileMap: new Map(),
        },
        validateRow: validateCandidateRowWrapper,
        duplicateCheck: duplicateCheckCandidate,
        transformRow: transformCandidateRow,
        batchInsert: batchInsertCandidates,
        onComplete: async (summary) => {
          if (organizationId) {
            await cacheInvalidation.candidateList(organizationId).catch(() => {});
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
