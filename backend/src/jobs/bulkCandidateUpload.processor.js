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


const { normalizeString, isPlaceholderEmail, isPlaceholderPhone } = require('../lib/cellNormalizer');

/**
 * Validates candidate row using shared candidateRowValidator.
 */
async function validateCandidateRowWrapper(rawRow, rowNumber, context = {}) {
  const isDriveContext = Boolean(context.driveId || context.isDriveContext || context.schema === 'drive');
  const result = validateCandidateRow(rawRow, rowNumber, { isDriveContext, driveId: context.driveId });
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
  const isDriveContext = Boolean(context.driveId || context.isDriveContext || context.schema === 'drive');
  const resumeLink = candidateData.resumeLinkRaw
    ? normalizeResumeLink(candidateData.resumeLinkRaw)
    : null;
  const phoneNormalized =
    candidateData.phoneNormalized ||
    normalizePhoneForDedup(candidateData.phone) ||
    normalizePhoneNumber(candidateData.phone) ||
    null;

  let preferredRole = candidateData.role ? normalizeString(candidateData.role) : null;
  if (preferredRole) {
    const normRoleLower = preferredRole.toLowerCase();
    // Confirmed campus drive mappings (preserve verbatim role in customFields.role_as_written)
    const DRIVE_ROLE_MAPPINGS = {
      'data analyst': 'Data Analyst Intern',
      'business analyst': 'Business Analyst Intern',
      'operations': 'Ops Intern',
      'ops': 'Ops Intern',
    };

    if (isDriveContext && DRIVE_ROLE_MAPPINGS[normRoleLower]) {
      preferredRole = DRIVE_ROLE_MAPPINGS[normRoleLower];
    } else {
      if (!context.jobResolver) {
        const { JobResolutionSession } = require('../services/jobResolutionService');
        context.jobResolver = new JobResolutionSession(
          context.organizationId || 'defaultOrg',
          context.validCreatedById,
          { allowAutoCreate: !isDriveContext }
        );
        await context.jobResolver.init();
      }
      const resolution = await context.jobResolver.resolveOrAutoCreate(preferredRole, candidateData.location);
      if (resolution && resolution.job) {
        preferredRole = resolution.job.title;
      }
    }
  }

  const customFields = {};
  if (candidateData.candidateId) {
    customFields.externalCandidateId = candidateData.candidateId;
  }
  if (candidateData.role) {
    customFields.role_as_written = candidateData.role;
  }
  if (candidateData.rawPhone) {
    customFields.rawPhone = candidateData.rawPhone;
  }
  if (candidateData.needsContactDetails) {
    customFields.needs_contact_details = true;
    if (candidateData.rawEmail) {
      customFields.rawEmail = candidateData.rawEmail;
    }
  }
  customFields.sourceRow = rowNumber;

  const payload = {
    rowNumber,
    fullName: normalizeString(candidateData.name),
    preferredRole: preferredRole || null,
    email: candidateData.email || 'N/A',
    phone: candidateData.phone || null,
    phoneNormalized: candidateData.phone ? phoneNormalized : null,
    resumeLinkOriginal: resumeLink?.originalUrl || null,
    resumeLinkDownload: resumeLink?.downloadUrl || null,
    resumeLinkProvider: resumeLink?.provider || null,
    organizationId: context.organizationId || 'defaultOrg',
    createdById: context.validCreatedById || null,
    source: normalizeString(candidateData.source) || 'Bulk Candidate Upload',
    status: 'ACTIVE',
    college: normalizeString(candidateData.college) || null,
    location: normalizeString(candidateData.location) || null,
    course: normalizeString(candidateData.course) || null,
    company: normalizeString(candidateData.company) || null,
    updatedAt: new Date(),
    customFields: Object.keys(customFields).length > 0 ? customFields : null,
  };

  return payload;
}

/**
 * Checks for in-file duplicate candidates.
 * In-file duplicate phones and emails DO NOT drop the candidate.
 * The first row keeps the contact details; subsequent rows import without that contact
 * and receive a row-level exception (needs_contact_details flag set).
 */
async function duplicateCheckCandidate(candidateData, rowNumber, context) {
  if (!context.seenCandidatesInFileMap) {
    context.seenCandidatesInFileMap = new Map();
  }

  const warnings = [];
  const rawPhone = candidateData.rawPhone || candidateData.phone;
  const rawEmail = candidateData.rawEmail || candidateData.email;
  const phoneKey = normalizePhoneForDedup(candidateData.phoneNormalized || candidateData.phone);
  const emailKey = normalizeString(candidateData.email || '').toLowerCase();

  // In-file duplicate phone detection
  if (phoneKey && phoneKey !== 'n/a' && !isPlaceholderPhone(phoneKey)) {
    if (context.seenCandidatesInFileMap.has(`phone:${phoneKey}`)) {
      const origRow = context.seenCandidatesInFileMap.get(`phone:${phoneKey}`);
      candidateData.phone = null;
      candidateData.phoneNormalized = null;
      candidateData.needsContactDetails = true;
      warnings.push(`Row ${rowNumber}: DUPLICATE_PHONE_IN_FILE: phone ${rawPhone} is same as row ${origRow}; imported without phone (needs_contact_details flag set)`);
    } else {
      context.seenCandidatesInFileMap.set(`phone:${phoneKey}`, rowNumber);
    }
  }

  // In-file duplicate email detection
  if (emailKey && emailKey !== 'n/a' && emailKey !== '' && !isPlaceholderEmail(emailKey)) {
    if (context.seenCandidatesInFileMap.has(`email:${emailKey}`)) {
      const origRow = context.seenCandidatesInFileMap.get(`email:${emailKey}`);
      candidateData.email = null;
      candidateData.needsContactDetails = true;
      warnings.push(`Row ${rowNumber}: DUPLICATE_EMAIL_IN_FILE: email ${rawEmail} is same as row ${origRow}; imported without email (needs_contact_details flag set)`);
    } else {
      context.seenCandidatesInFileMap.set(`email:${emailKey}`, rowNumber);
    }
  }

  return { isDuplicate: false, warnings };
}

async function findExistingCandidate(dbData, organizationId, context = {}) {
  const phoneKey = normalizePhoneForDedup(dbData.phoneNormalized || dbData.phone);
  const email = normalizeString(dbData.email || '').toLowerCase();
  const orgId = organizationId || dbData.organizationId || 'defaultOrg';

  // Placeholder phones (e.g. 1234567890, 0000000000) are NOT identities and must never participate in dedup
  if (phoneKey && !isPlaceholderPhone(phoneKey)) {
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

  // Placeholder emails (e.g. dummy@gmail.com, test@, na@) are NOT identities and must never participate in dedup
  if (email && email !== 'n/a' && !isPlaceholderEmail(email)) {
    const byEmail = await prisma.candidate.findFirst({
      where: {
        organizationId: orgId,
        isDeleted: false,
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (byEmail) return byEmail;
  }

  // In college drive context, if candidate has neither valid phone nor valid email (e.g. placeholder row),
  // match against already-enrolled candidate in the same drive by name to avoid duplicate re-creation
  if (context.driveId && dbData.fullName) {
    const driveExisting = await prisma.collegeDriveCandidate.findFirst({
      where: {
        driveId: context.driveId,
        fullName: dbData.fullName,
      },
      select: { candidateId: true },
    });
    if (driveExisting && driveExisting.candidateId) {
      const cand = await prisma.candidate.findUnique({
        where: { id: driveExisting.candidateId },
        select: { id: true, isDeleted: true },
      });
      if (cand && !cand.isDeleted) return cand;
    }
  }

  return null;
}

/**
 * Import each row: create new candidate, or update if phone/email already exists.
 */
async function batchInsertCandidates(batch, context) {
  if (batch.length === 0) return { created: 0, updated: 0, duplicates: 0, failed: 0, succeeded: 0, createdEntityIds: [] };

  let created = 0;
  let updated = 0;
  let failed = 0;
  const createdEntityIds = [];

  const { logAudit } = require('../utils/audit');
  const { appendFailedRow } = require('../lib/bulkUploadErrorReport');

  for (const row of batch) {
    const { rowNumber, ...dbData } = row;
    try {
      const existing = await findExistingCandidate(dbData, context.organizationId, context);
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
        try {
          saved = await prisma.candidate.create({
            data: {
              ...dbData,
              createdAt: new Date(),
            },
          });
          createdEntityIds.push(saved.id);
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
        } catch (createErr) {
          const fallbackConditions = [];
          if (dbData.phoneNormalized && !isPlaceholderPhone(dbData.phoneNormalized)) {
            fallbackConditions.push({ phoneNormalized: dbData.phoneNormalized });
          }
          if (dbData.phone && !isPlaceholderPhone(dbData.phone)) {
            fallbackConditions.push({ phone: dbData.phone });
          }
          if (dbData.email && dbData.email !== 'N/A' && !isPlaceholderEmail(dbData.email)) {
            fallbackConditions.push({ email: dbData.email });
          }

          let fallback = null;
          if (fallbackConditions.length > 0) {
            fallback = await prisma.candidate.findFirst({
              where: {
                organizationId: context.organizationId,
                isDeleted: false,
                OR: fallbackConditions,
              },
            });
          }

          if (!fallback && context.driveId && dbData.fullName) {
            const driveExisting = await prisma.collegeDriveCandidate.findFirst({
              where: {
                driveId: context.driveId,
                fullName: dbData.fullName,
              },
            });
            if (driveExisting && driveExisting.candidateId) {
              const matchedCandidate = await prisma.candidate.findUnique({
                where: { id: driveExisting.candidateId },
              });
              if (matchedCandidate && !matchedCandidate.isDeleted) {
                fallback = matchedCandidate;
              }
            }
          }

          if (fallback) {
            const { createdAt, createdById, organizationId, ...updateData } = dbData;
            saved = await prisma.candidate.update({
              where: { id: fallback.id },
              data: {
                ...updateData,
                phoneNormalized: dbData.phoneNormalized || null,
                isDeleted: false,
              },
            });
            updated++;
          } else {
            throw createErr;
          }
        }
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

  return { created, updated, duplicates: 0, failed, succeeded: created + updated, createdEntityIds };
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
    preview: !!jobData.preview,
    startFromRow: jobData.startFromRow || 0,
    context: {
      validCreatedById,
      driveId: driveId || null,
      isDriveContext: Boolean(jobData.isDriveContext || driveId || jobData.context?.isDriveContext),
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
      return validateCandidateRowWrapper(rawRow, rowNumber, pipelineContext);
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
  transformCandidateRow,
  duplicateCheckCandidate,
};
