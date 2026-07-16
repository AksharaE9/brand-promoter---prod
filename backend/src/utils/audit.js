const prisma = require("../config/db");
const inv = require("./cacheInvalidation");
const sse = require("./sse");

/**
 * Write an audit log entry — FIRE AND FORGET (non-blocking).
 * The caller does NOT await this. It never blocks a request.
 */
function logAudit({
  actorUserId = null,
  actorName = null,
  actorEmail = null,
  actorRole = null,
  action,
  entityType,
  entityId = null,
  entityName = null,
  oldData = null,
  newData = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
  orgId = null,
  organizationId = null,
}) {
  // Execute asynchronously inside an immediately invoked function expression to avoid blocking
  (async () => {
    let resolvedActorName = actorName;
    let resolvedActorEmail = actorEmail;
    let resolvedActorRole = actorRole;
    let resolvedOrgId = orgId || organizationId;
    let resolvedEntityName = entityName;

    // 1. Always resolve User (Actor) details from the database if actorUserId is present
    if (actorUserId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: actorUserId },
          select: { fullName: true, email: true, role: true, organizationId: true }
        });
        if (user) {
          resolvedActorName = user.fullName;
          resolvedActorEmail = user.email;
          resolvedActorRole = user.role;
          resolvedOrgId = resolvedOrgId || user.organizationId;
        }
      } catch (err) {
        console.error('[AuditResolve] Actor user lookup failed:', err.message);
      }
    }

    const targetOrg = resolvedOrgId || "defaultOrg";

    // 2. Always resolve Entity Name if entityId and entityType are present
    if (entityId && entityType) {
      try {
        if (entityType === 'INTERVIEW') {
          const iv = await prisma.interview.findUnique({
            where: { id: entityId },
            include: {
              application: {
                include: {
                  candidate: { select: { fullName: true } },
                  job: { select: { title: true } }
                }
              }
            }
          });
          if (iv) {
            const candidateName = iv.application?.candidate?.fullName || iv.candidateName || 'Candidate';
            const jobTitle = iv.application?.job?.title || iv.jobTitle || 'Job';
            const roundName = iv.round || `Round ${iv.roundNo}`;
            resolvedEntityName = `${candidateName} - ${roundName} (${jobTitle})`;
          }
        } else if (entityType === 'INTERVIEW_FEEDBACK') {
          // Check if newData has the roundId
          const possibleRoundId = newData?.roundId || newData?.interviewId || entityId;
          const iv = await prisma.interview.findUnique({
            where: { id: possibleRoundId },
            include: {
              application: {
                include: {
                  candidate: { select: { fullName: true } },
                  job: { select: { title: true } }
                }
              }
            }
          });
          if (iv) {
            const candidateName = iv.application?.candidate?.fullName || iv.candidateName || 'Candidate';
            const roundName = iv.round || `Round ${iv.roundNo}`;
            resolvedEntityName = `Feedback for ${candidateName} - ${roundName}`;
          }
        } else if (entityType === 'APPLICATION') {
          const app = await prisma.application.findUnique({
            where: { id: entityId },
            include: {
              candidate: { select: { fullName: true } },
              job: { select: { title: true } }
            }
          });
          if (app) {
            resolvedEntityName = `${app.candidate?.fullName || 'Candidate'} - ${app.job?.title || 'Job'}`;
          }
        } else if (entityType === 'CANDIDATE') {
          const cand = await prisma.candidate.findUnique({
            where: { id: entityId },
            select: { fullName: true }
          });
          if (cand) {
            resolvedEntityName = cand.fullName;
          }
        } else if (entityType === 'JOB') {
          const job = await prisma.job.findUnique({
            where: { id: entityId },
            select: { title: true }
          });
          if (job) {
            resolvedEntityName = job.title;
          }
        } else if (entityType === 'USER') {
          const user = await prisma.user.findUnique({
            where: { id: entityId },
            select: { fullName: true }
          });
          if (user) {
            resolvedEntityName = user.fullName;
          }
        }
      } catch (err) {
        console.warn('[AuditResolve] Entity lookup failed:', err.message);
      }
    }

    const description = `${resolvedActorName || "System"} performed ${action.replace(/_/g, ' ')} on ${entityType}${resolvedEntityName ? ` (${resolvedEntityName})` : ''}`;

    // Create the DB record
    const log = await prisma.auditLog.create({
      data: {
        actorUserId,
        actorName:  resolvedActorName  || actorUserId || "System",
        actorEmail: resolvedActorEmail || "",
        actorRole:  resolvedActorRole  || "SYSTEM",
        action,
        entityType,
        entityId,
        entityName: resolvedEntityName || entityId || null,
        oldData,
        newData,
        metadata,
        ipAddress,
        userAgent,
        organizationId: targetOrg,
        isDeleted: false,
      },
    });

    // Invalidate caches and broadcast SSE
    try {
      await inv.audit(targetOrg);

      sse.broadcastToOrg(targetOrg, 'AUDIT_LOG_CREATED', {
        logId: log.id,
        action,
        entityType,
        entityId,
        actorName: resolvedActorName || actorUserId || "System",
        description,
        performedBy: actorUserId,
        performedByName: resolvedActorName || "System",
        timestamp: log.createdAt,
      });
    } catch (sseErr) {
      console.error("[Audit] SSE/Cache error:", sseErr.message);
    }
  })().catch(err => {
    // Never crash a request because audit logging failed
    console.error("[Audit] Async processing failed:", err.message);
  });
}

module.exports = { logAudit };
