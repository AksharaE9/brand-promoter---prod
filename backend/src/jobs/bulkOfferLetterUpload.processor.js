'use strict';

/**
 * bulkOfferLetterUpload.processor.js
 *
 * Adapter for the "Offer Letter Candidates" bulk upload path.
 * Reuses the shared streaming pipeline from runStreamingBulkUploadPipeline.
 *
 * Business rules:
 *   - Matches candidates by phone or email (upserts the candidate record)
 *   - Sets candidate.status = 'OFFER_SENT'
 *   - Sets candidate.offerDecision field if provided
 *   - Upserts Application with status = 'OFFER_SENT' if role is resolved
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
 * Validates an offer letter candidate row.
 * Required: name, phone.
 * Optional: email, offerDate/doj, role, college, location, course, source, company, offerDecision.
 */
async function validateOfferLetterRow(rawRow, rowNumber) {
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
    return { valid: false, errors: [`Row ${rowNumber}: invalid e-mail format "${emailRaw}"`] };
  }

  return {
    valid: true,
    data: {
      name,
      phone: phoneDigits,
      email: isEmailValid ? (emailRaw || null) : null,
      role: String(rawRow.role ?? '').trim() || null,
      offerDate: String(rawRow.offerDate ?? rawRow.doj ?? rawRow.joiningDate ?? '').trim() || null,
      offerDecision: String(rawRow.offerDecision ?? '').trim() || null,
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

async function duplicateCheckOfferLetter(rowData, rowNumber, context) {
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

async function transformOfferLetterRow(rowData, rowNumber, context) {
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
    doj: rowData.offerDate || null,
    offerDecision: rowData.offerDecision || null,
    college: rowData.college || null,
    location: rowData.location || null,
    course: rowData.course || null,
    source: rowData.source || 'Bulk Offer Letter Import',
    company: rowData.company || null,
    resumeLinkOriginal: resumeLink?.originalUrl || null,
    resumeLinkDownload: resumeLink?.downloadUrl || null,
    resumeLinkProvider: resumeLink?.provider || null,
    status: 'OFFER_SENT',
    organizationId: context.organizationId || 'defaultOrg',
    createdById: context.validCreatedById || null,
    updatedAt: new Date(),
  };
}

// ─── Find existing candidate ──────────────────────────────────────────────────

async function findExistingCandidateForOffer(dbData, organizationId) {
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

async function batchInsertOfferLetterCandidates(batch, context) {
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
      const existing = await findExistingCandidateForOffer(dbData, context.organizationId);
      let saved;

      if (existing) {
        const { createdAt, createdById, organizationId, ...updateData } = dbData;
        saved = await prisma.candidate.update({
          where: { id: existing.id },
          data: {
            ...updateData,
            status: 'OFFER_SENT',
            phoneNormalized: dbData.phoneNormalized || null,
            isDeleted: false,
          },
        });
        logAudit({
          actorUserId: context.uploadedBy,
          action: 'candidate_offer_bulk_updated',
          entityType: 'CANDIDATE',
          entityId: saved.id,
          entityName: saved.fullName,
          newData: { source: 'bulk_offer_import', job_id: context.jobId, status: 'OFFER_SENT' },
          organizationId: context.organizationId,
        });
        updated++;
      } else {
        try {
          saved = await prisma.candidate.create({
            data: { ...dbData, status: 'OFFER_SENT', createdAt: new Date() },
          });
          createdEntityIds.push(saved.id);
          logAudit({
            actorUserId: context.uploadedBy,
            action: 'candidate_offer_bulk_created',
            entityType: 'CANDIDATE',
            entityId: saved.id,
            entityName: saved.fullName,
            newData: { source: 'bulk_offer_import', job_id: context.jobId, status: 'OFFER_SENT' },
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
                status: 'OFFER_SENT',
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

      // Upsert Application with OFFER_SENT status if a job role was resolved
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
                data: { status: 'OFFER_SENT', updatedAt: new Date() },
              });
            } else {
              await prisma.application.create({
                data: {
                  candidateId: saved.id,
                  jobId: resolution.job.id,
                  status: 'OFFER_SENT',
                  organizationId: context.organizationId || 'defaultOrg',
                },
              }).catch(() => {}); // Non-fatal if unique constraint race
            }
          }
        } catch (_) {} // Application upsert is best-effort
      }
    } catch (rowErr) {
      failed++;
      appendFailedRow(context.jobId, rowNumber || 0, `Offer letter import failed: ${rowErr.message}`, 'error');
    }
  }

  return { created, updated, duplicates: 0, failed, succeeded: created + updated, createdEntityIds };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

async function processOfferLetterUpload(jobData) {
  const { jobId, filePath, fileType, uploadedBy, userRole, organizationId, sourceFilename } = jobData;

  let validCreatedById = uploadedBy;
  if (uploadedBy) {
    try {
      const userExists = await prisma.user.findUnique({ where: { id: uploadedBy }, select: { id: true } });
      if (!userExists) validCreatedById = null;
    } catch (_) {}
  }

  const startMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[BulkOfferLetterUpload] Job ${jobId} starting. RSS: ${startMemMb}MB`);

  const result = await runStreamingBulkUploadPipeline({
    jobId,
    filePath,
    fileType,
    uploadedBy,
    userRole,
    organizationId,
    sourceFilename,
    flowType: 'offer',
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
      return validateOfferLetterRow(rawRow, rowNumber);
    },
    duplicateCheck: duplicateCheckOfferLetter,
    transformRow: transformOfferLetterRow,
    batchInsert: batchInsertOfferLetterCandidates,
    onComplete: async (summary) => {
      const endMemMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[BulkOfferLetterUpload] Job ${jobId} complete. RSS: ${endMemMb}MB. Summary:`, summary);
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
  processOfferLetterUpload,
  getJobStatus: getPipelineJobStatus,
};
