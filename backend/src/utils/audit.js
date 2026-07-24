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
  subjectType = null,
  subjectId = null,
  subjectName = null,
}) {
  // Execute asynchronously inside an immediately invoked function expression to avoid blocking
  (async () => {
    let resolvedActorName = actorName;
    let resolvedActorEmail = actorEmail;
    let resolvedActorRole = actorRole;
    let resolvedOrgId = orgId || organizationId;
    let resolvedEntityName = entityName;
    let resolvedSubjectName = subjectName;

    // 0. Resolve subjectName if not provided
    if (!resolvedSubjectName && subjectId && subjectType) {
      try {
        const cleanType = String(subjectType).toUpperCase();
        if (cleanType === 'CANDIDATE') {
          const cand = await prisma.candidate.findUnique({
            where: { id: subjectId },
            select: { fullName: true }
          });
          if (cand) resolvedSubjectName = cand.fullName;
        } else if (cleanType === 'USER') {
          const u = await prisma.user.findUnique({
            where: { id: subjectId },
            select: { fullName: true }
          });
          if (u) resolvedSubjectName = u.fullName;
        } else if (cleanType === 'MEMBER' || cleanType === 'SCHEDULING_MEMBER' || cleanType === 'SCHEDULINGMEMBER') {
          const m = await prisma.schedulingMember.findUnique({
            where: { id: subjectId },
            select: { name: true }
          });
          if (m) resolvedSubjectName = m.name;
        }
      } catch (err) {
        console.warn('[AuditResolve] Subject lookup failed:', err.message);
      }
    }

    // 1. Always resolve User (Actor) details from the database if actorUserId is present
    if (actorUserId) {
      try {
        // Primary lookup: by Prisma DB user ID
        let user = await prisma.user.findUnique({
          where: { id: actorUserId },
          select: { fullName: true, email: true, role: true, organizationId: true }
        });

        // Secondary lookup: if actorUserId is a Firebase UID (not found by ID),
        // try to find by email if caller passed one — avoids storing raw UIDs as names
        if (!user && actorEmail) {
          user = await prisma.user.findFirst({
            where: { email: actorEmail },
            select: { fullName: true, email: true, role: true, organizationId: true }
          });
        }

        if (user) {
          resolvedActorName = user.fullName;
          resolvedActorEmail = user.email;
          resolvedActorRole = user.role;
          resolvedOrgId = resolvedOrgId || user.organizationId;
        }
        // If DB lookup fails entirely, keep actorName as passed by caller (req.user.fullName).
        // NEVER fall back to writing the raw userId as the displayed actor name.
      } catch (err) {
        console.error('[AuditResolve] Actor user lookup failed:', err.message);
        // resolvedActorName stays as the caller-provided actorName (real full name)
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
        // IMPORTANT: never store a raw cuid/UUID as the displayed actor name.
        // If resolvedActorName is still null/empty here, write 'System' instead.
        actorName:  resolvedActorName  || "System",
        actorEmail: resolvedActorEmail || "",
        actorRole:  resolvedActorRole  || "SYSTEM",
        action,
        entityType,
        entityId,
        // Only store entityName if it is a real human-readable name (not an ID)
        entityName: resolvedEntityName || null,
        oldData,
        newData,
        metadata,
        ipAddress,
        userAgent,
        organizationId: targetOrg,
        isDeleted: false,
        subjectType,
        subjectId,
        subjectName: resolvedSubjectName || null,
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
        entityName:      resolvedEntityName || null,
        actorName:       resolvedActorName  || "System",
        description,
        performedBy:     actorUserId,
        performedByName: resolvedActorName  || "System",
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
