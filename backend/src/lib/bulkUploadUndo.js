'use strict';

/**
 * bulkUploadUndo.js — Admin Undo Engine with Conflict Guardrails.
 * Safely removes records created by a specific bulk upload job while preventing data corruption
 * if child references (interviews, feedbacks) were subsequently added.
 */

const prisma = require('../config/db');
const { getJobById, markJobStatus } = require('./importJobRepository');
const { logAudit } = require('../utils/audit');

/**
 * Undoes an import job by deleting only records created by that specific job.
 *
 * @param {string} jobId
 * @param {object} options
 * @param {string} options.actorUserId
 * @param {string} options.organizationId
 * @param {boolean} [options.force=false]
 * @returns {Promise<object>}
 */
async function undoImport(jobId, options = {}) {
  const { actorUserId, organizationId = 'defaultOrg', force = false } = options;

  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      status: 404,
      message: `Import job "${jobId}" not found.`,
    };
  }

  if (job.status === 'UNDONE') {
    return {
      success: false,
      status: 400,
      message: `Import job "${jobId}" has already been undone.`,
    };
  }

  // Parse list of created entity IDs
  let createdIds = [];
  try {
    createdIds = Array.isArray(job.created_entity_ids)
      ? job.created_entity_ids
      : (typeof job.created_entity_ids === 'string' ? JSON.parse(job.created_entity_ids) : []);
  } catch (_) {
    createdIds = [];
  }

  // Also query Candidates with matching source or job_id metadata if empty
  if (createdIds.length === 0) {
    const matchingCands = await prisma.candidate.findMany({
      where: {
        OR: [
          { source: `Bulk Import ${jobId}` },
          { id: { startsWith: `cand_${jobId}` } },
        ],
      },
      select: { id: true },
    });
    createdIds = matchingCands.map(c => c.id);
  }

  if (createdIds.length === 0 && (job.created_count === 0 || !job.created_count)) {
    await markJobStatus(jobId, 'UNDONE');
    return {
      success: true,
      jobId,
      message: `Job ${jobId} created 0 records. Marked as undone.`,
      deletedCounts: { candidates: 0, applications: 0, interviews: 0, feedbacks: 0 },
    };
  }

  // ── Conflict Guardrails ──────────────────────────────────────────────────
  const conflicts = [];

  if (createdIds.length > 0) {
    // Check if any candidate has scheduled interviews created AFTER import
    const scheduledInterviews = await prisma.interview.findMany({
      where: {
        candidateId: { in: createdIds },
        status: { in: ['SCHEDULED', 'COMPLETED', 'RESCHEDULED'] },
      },
      select: { id: true, candidateName: true, candidateId: true, roundNo: true, status: true },
    });

    if (scheduledInterviews.length > 0) {
      for (const iv of scheduledInterviews) {
        conflicts.push({
          type: 'INTERVIEW_SCHEDULED',
          candidateId: iv.candidateId,
          candidateName: iv.candidateName,
          interviewId: iv.id,
          round: iv.roundNo,
          status: iv.status,
          reason: `Candidate has an active/completed interview (Round ${iv.roundNo}, status: ${iv.status}).`,
        });
      }
    }

    // Check if any feedback exists for these candidates
    const existingFeedback = await prisma.interviewFeedback.findMany({
      where: {
        candidateId: { in: createdIds },
        deletedAt: null,
      },
      select: { id: true, candidateId: true, round: true, selectionStatus: true },
    });

    if (existingFeedback.length > 0) {
      for (const fb of existingFeedback) {
        conflicts.push({
          type: 'FEEDBACK_RECORDED',
          candidateId: fb.candidateId,
          feedbackId: fb.id,
          round: fb.round,
          selectionStatus: fb.selectionStatus,
          reason: `Candidate has interview feedback recorded for ${fb.round} (Status: ${fb.selectionStatus}).`,
        });
      }
    }
  }

  if (conflicts.length > 0 && !force) {
    return {
      success: false,
      status: 409,
      conflict: true,
      message: `Cannot undo import "${jobId}": ${conflicts.length} dependent record(s) have subsequent activity. Review conflicts before proceeding or provide explicit force flag.`,
      conflicts,
    };
  }

  // ── Cascaded Deletion Execution in Transaction ───────────────────────────
  let deletedInterviews = 0;
  let deletedFeedbacks = 0;
  let deletedDriveCands = 0;
  let deletedApps = 0;
  let deletedCands = 0;

  await prisma.$transaction(async (tx) => {
    // 1. Delete Feedbacks
    if (createdIds.length > 0) {
      const fbRes = await tx.interviewFeedback.deleteMany({
        where: { candidateId: { in: createdIds } },
      });
      deletedFeedbacks = fbRes.count;
    }

    // 2. Delete Interviews
    if (createdIds.length > 0) {
      const ivRes = await tx.interview.deleteMany({
        where: { candidateId: { in: createdIds } },
      });
      deletedInterviews = ivRes.count;
    }

    // 3. Delete College Drive links
    if (createdIds.length > 0) {
      const driveRes = await tx.collegeDriveCandidate.deleteMany({
        where: { candidateId: { in: createdIds } },
      });
      deletedDriveCands = driveRes.count;
    }

    // 4. Delete Applications
    if (createdIds.length > 0) {
      const appRes = await tx.application.deleteMany({
        where: { candidateId: { in: createdIds } },
      });
      deletedApps = appRes.count;
    }

    // 5. Delete Candidates
    if (createdIds.length > 0) {
      const candRes = await tx.candidate.deleteMany({
        where: { id: { in: createdIds } },
      });
      deletedCands = candRes.count;
    }
  });

  // Mark job status as UNDONE in PostgreSQL
  await markJobStatus(jobId, 'UNDONE', {
    metrics: {
      undoneAt: new Date().toISOString(),
      undoneBy: actorUserId,
      deletedCounts: {
        candidates: deletedCands,
        applications: deletedApps,
        interviews: deletedInterviews,
        feedbacks: deletedFeedbacks,
        collegeDriveCandidates: deletedDriveCands,
      },
    },
  });

  // Log in Audit Trail
  logAudit({
    actorUserId,
    action: 'bulk_import_undone',
    entityType: 'IMPORT_JOB',
    entityId: jobId,
    entityName: `Bulk Import ${jobId}`,
    subjectType: 'import_job',
    subjectId: jobId,
    subjectName: job.source_filename || jobId,
    newData: {
      deletedCandidates: deletedCands,
      deletedApplications: deletedApps,
      deletedInterviews: deletedInterviews,
    },
    organizationId,
  });

  console.log(`[BulkUploadUndo] Successfully undone import job ${jobId}: ${deletedCands} candidates, ${deletedApps} applications, ${deletedInterviews} interviews removed.`);

  return {
    success: true,
    jobId,
    message: `Import ${jobId} successfully undone. All ${deletedCands} created record(s) removed cleanly.`,
    deletedCounts: {
      candidates: deletedCands,
      applications: deletedApps,
      interviews: deletedInterviews,
      feedbacks: deletedFeedbacks,
      collegeDriveCandidates: deletedDriveCands,
    },
  };
}

module.exports = {
  undoImport,
};
