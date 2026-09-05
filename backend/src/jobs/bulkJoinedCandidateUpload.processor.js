'use strict';

/**
 * bulkJoinedCandidateUpload.processor.js
 *
 * Adapter for the "Joined Candidates" bulk upload path.
 * Reuses the shared streaming pipeline from runStreamingBulkUploadPipeline.
 *
 * Business rules:
 *   - Matches candidates by phone or email (upserts the candidate record)
 *   - Sets candidate.status = 'JOINED'
 *   - Sets candidate.doj = joiningDate (if provided in sheet)
 *   - Upserts the Application with status = 'JOINED' if a jobId/role is supplied
 *   - Appends audit log entries for every create/update
 */

const prisma = require('../config/db');
const { normalizePhoneNumber, normalizePhoneForDedup } = require('../lib/phoneNormalization');
const { normalizeResumeLink } = require('../lib/resumeLinkNormalizer');
const { runStreamingBulkUploadPipeline, getPipelineJobStatus } = require('../lib/streamingBulkUploadPipeline');
const { emitBulkUploadProgress, emitBulkUploadCompleted } = require('../sse/bulkUploadEvents');
const cacheInvalidation = require('../utils/cacheInvalidation');
const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');

// ─── Row Validator ────────────────────────────────────────────────────────────

/**
 * Validates a joined candidate row.
 * Required: name, phone.
 * Optional: email, joiningDate, role, college, location, course, source, company.
 *
 * @param {Record<string, any>} rawRow
 * @param {number} rowNumber
 * @returns {{ valid: boolean, errors?: string[], data?: object, warnings?: string[] }}
 */
async function validateJoinedCandidateRow(rawRow, rowNumber) {
  const errors = [];

  const name = String(rawRow.name ?? '').trim();
  if (!name) errors.push(`Row ${rowNumber}: missing required field "name"`);

  const phoneRaw = String(rawRow.phone ?? '').trim();
  const phoneDigits = phoneRaw.replace(/[^\d+]/g, '');
  const phoneValid = /^\+?\d{7,15}$/.test(phoneDigits);
  if (!phoneRaw) {
    errors.push(`Row ${rowNumber}: missing required field "phone"`);
  } else if (!phoneValid) {
    errors.push(`Row ${rowNumber}: invalid phone "${phoneRaw}" — must be 7-15 digits`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const emailRaw = String(rawRow.email ?? '').trim();
  const isEmailValid = emailRaw ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) : true;
  if (emailRaw && !isEmailValid) {
    errors.push(`Row ${rowNumber}: invalid e-mail format "${emailRaw}"`);
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name,
      phone: phoneDigits,
      email: isEmailValid ? (emailRaw || null) : null,
      role: String(rawRow.role ?? '').trim() || null,
      joiningDate: String(rawRow.joiningDate ?? rawRow.doj ?? '').trim() || null,
      college: String(rawRow.college ?? '').trim() || null,
      location: String(rawRow.location ?? '').trim() || null,
      course: String(rawRow.course ?? '').trim() || null,
      source: String(rawRow.source ?? '').trim() || null,
      company: String(rawRow.company ?? '').trim() || null,
      resumeLink: String(rawRow.resumeLink ?? '').trim() || null,
    },
    warnings: [],
  };
}

// ─── Dedup within file ────────────────────────────────────────────────────────

async function duplicateCheckJoined(rowData, rowNumber, context) {
  if (!context.seenPhonesInFile) context.seenPhonesInFile = new Map();
  const key = normalizePhoneForDedup(rowData.phone);
  if (key && context.seenPhonesInFile.has(key)) {
    const origRow = context.seenPhonesInFile.get(key);
    return { isDuplicate: true, reason: `Duplicate phone ${rowData.phone} — already appears in row ${origRow}` };
  }
  if (key) context.seenPhonesInFile.set(key, rowNumber);
  return { isDuplicate: false };
}

// ─── Transform ────────────────────────────────────────────────────────────────

async function transformJoinedRow(rowData, rowNumber, context) {
  const phoneNormalized = normalizePhoneForDedup(rowData.phone) || normalizePhoneNumber(rowData.phone) || null;
  const resumeLink = rowData.resumeLink ? normalizeResumeLink(rowData.resumeLink) : null;

  let preferredRole = rowData.role || null;
  if (rowData.role && String(rowData.role).trim()) {
    if (!context.jobResolver) {
      const { JobResolutionSession } = require('../services/jobResolutionService');
      context.jobResolver = new JobResolutionSession(context.organizationId || 'defaultOrg', context.validCreatedById);
      await context.jobResolver.init();
    }
    const resolution = await context.jobResolver.resolveOrAutoCreate(rowData.role, rowData.location);
    if (resolution.job) preferredRole = resolution.job.title;
  }

  return {
    rowNumber,
    fullName: rowData.name,
    phone: rowData.phone,
    phoneNormalized,
    email: rowData.email || 'N/A',
    preferredRole,
    doj: rowData.joiningDate || null,
    college: rowData.college || null,
    location: rowData.location || null,
    course: rowData.course || null,
    source: rowData.source || 'Bulk Joined Import',
    company: rowData.company || null,
    resumeLinkOriginal: resumeLink?.originalUrl || null,
    resumeLinkDownload: resumeLink?.downloadUrl || null,
    resumeLinkProvider: resumeLink?.provider || null,
    status: 'JOINED',
    organizationId: context.organizationId || 'defaultOrg',
    createdById: context.validCreatedById || null,
    updatedAt: new Date(),
  };
}

// ─── Find existing candidate ──────────────────────────────────────────────────

async function findExistingCandidateForJoined(dbData, organizationId) {
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
      select: { id: true, fullName: true },
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
      select: { id: true, fullName: true },
    });
  }

  return null;
}

// ─── Batch Insert ─────────────────────────────────────────────────────────────

async function batchInsertJoinedCandidates(batch, context) {
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
      const existing = await findExistingCandidateForJoined(dbData, context.organizationId);
      let saved;

      if (existing) {
        const { createdAt, createdById, organizationId, ...updateData } = dbData;
        saved = await prisma.candidate.update({
          where: { id: existing.id },
          data: {
            ...updateData,
            status: 'JOINED',
            phoneNormalized: dbData.phoneNormalized || null,
            isDeleted: false,
          },
        });
        logAudit({
          actorUserId: context.uploadedBy,
          action: 'candidate_joined_bulk_updated',
          entityType: 'CANDIDATE',
          entityId: saved.id,
          entityName: saved.fullName,
          newData: { source: 'bulk_joined_import', job_id: context.jobId, status: 'JOINED' },
          organizationId: context.organizationId,
        });
        updated++;
      } else {
        try {
          saved = await prisma.candidate.create({
            data: { ...dbData, status: 'JOINED', createdAt: new Date() },
          });
          createdEntityIds.push(saved.id);
          logAudit({
            actorUserId: context.uploadedBy,
            action: 'candidate_joined_bulk_created',
            entityType: 'CANDIDATE',
            entityId: saved.id,
            entityName: saved.fullName,
            newData: { source: 'bulk_joined_import', job_id: context.jobId, status: 'JOINED' },
            organizationId: context.organizationId,
          });
          created++;
        } catch (createErr) {
          const fallback = await prisma.candidate.findFirst({
            where: {
              OR: [
                ...(dbData.phoneNormalized ? [{ phoneNormalized: dbData.phoneNormalized }] : []),
                ...(dbData.phone ? [{ phone: dbData.phone }] : []),
                ...(dbData.email && dbData.email !== 'N/A' ? [{ email: dbData.email }] : []),
              ]
            }
          });
          if (fallback) {
            const { createdAt, createdById, organizationId, ...updateData } = dbData;
            saved = await prisma.candidate.update({
              where: { id: fallback.id },
              data: {
                ...updateData,
                status: 'JOINED',
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

      // Upsert Application with JOINED status if a job role was resolved
      if (saved && context.jobResolver) {
        try {
          const resolution = await context.jobResolver.resolveOrAutoCreate(
            dbData.preferredRole || dbData.role || '',
            dbData.location
          );
          if (resolution?.job?.id) {
            const existingApp = await prisma.application.findFirst({
              where: { candidateId: saved.id, jobId: resolution.job.id },
            });
            if (existingApp) {
              await prisma.application.update({
                where: { id: existingApp.id },
                data: { status: 'JOINED', joiningDate: dbData.doj || null, updatedAt: new Date() },
              });
            } else {
              await prisma.application.create({
                data: {
                  candidateId: saved.id,
                  jobId: resolution.job.id,
                  status: 'JOINED',
                  joiningDate: dbData.doj || null,
                  organizationId: context.organizationId || 'defaultOrg',
                },
              }).catch(() => {}); // Non-fatal if unique constraint race
            }
          }
        } catch (_) {} // Application creation is best-effort
      }
    } catch (rowErr) {
      failed++;
      appendFailedRow(context.jobId, rowNumber || 0, `Joined candidate import failed: ${rowErr.message}`, 'error');
    }
  }

  return { created, updated, duplicates: 0, failed, succeeded: created + updated, createdEntityIds };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

async function processJoinedCandidateUpload(jobData) {
  const { jobId, filePath, fileType, uploadedBy, userRole, organizationId, sourceFilename } = jobData;

  let validCreatedById = uploadedBy;
  if (uploadedBy) {
    try {
      const userExists = await prisma.user.findUnique({ where: { id: uploadedBy }, select: { id: true } });
      if (!userExists) validCreatedById = null;
    } catch (_) {}
  }

  const startMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[BulkJoinedUpload] Job ${jobId} starting. RSS: ${startMemMb}MB`);

  const result = await runStreamingBulkUploadPipeline({
    jobId,
    filePath,
    fileType,
    uploadedBy,
    userRole,
    organizationId,
    sourceFilename,
    flowType: 'joined',
    batchSize: BULK_UPLOAD_LIMITS.BATCH_SIZE_CANDIDATE,
    preview: !!jobData.preview,
    startFromRow: jobData.startFromRow || 0,
    context: {
      validCreatedById,
      seenPhonesInFile: new Map(),
    },
    validateRow: async (rawRow, rowNumber) => {
      if (rowNumber > BULK_UPLOAD_LIMITS.MAX_ROWS) {
        return { valid: false, errors: [`Row ${rowNumber}: Upload exceeds the ${BULK_UPLOAD_LIMITS.MAX_ROWS}-row limit.`] };
      }
      return validateJoinedCandidateRow(rawRow, rowNumber);
    },
    duplicateCheck: duplicateCheckJoined,
    transformRow: transformJoinedRow,
    batchInsert: batchInsertJoinedCandidates,
    onComplete: async (summary) => {
      const endMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[BulkJoinedUpload] Job ${jobId} complete. RSS: ${endMemMb}MB. Summary:`, summary);
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
  processJoinedCandidateUpload,
  getJobStatus: getPipelineJobStatus,
};
