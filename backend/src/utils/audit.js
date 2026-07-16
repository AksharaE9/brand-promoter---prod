const prisma = require("../config/db");

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

    // 1. Resolve User (Actor) details if they are not passed
    if (actorUserId && (!resolvedActorName || !resolvedActorEmail || !resolvedActorRole || !resolvedOrgId)) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: actorUserId },
          select: { fullName: true, email: true, role: true, organizationId: true }
        });
        if (user) {
          resolvedActorName = resolvedActorName || user.fullName;
          resolvedActorEmail = resolvedActorEmail || user.email;
          resolvedActorRole = resolvedActorRole || user.role;
          resolvedOrgId = resolvedOrgId || user.organizationId;
        }
      } catch (err) {
        console.error('[AuditResolve] Actor user lookup failed:', err.message);
      }
    }

    const targetOrg = resolvedOrgId || "defaultOrg";

    // 2. Resolve Entity Name if missing or if it's just the ID (UUID/CUID/tempId)
    const isGenericId = !resolvedEntityName || 
      resolvedEntityName === entityId || 
      (typeof resolvedEntityName === 'string' && (
        resolvedEntityName.startsWith('temp_') || 
        resolvedEntityName.length === 25 || // CUID length
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedEntityName) // UUID
      ));

    if (entityId && isGenericId && entityType) {
      try {
        if (entityType === 'INTERVIEW') {
          const iv = await prisma.interview.findUnique({
            where: { id: entityId },
            select: { candidateName: true, round: true, roundNo: true }
          });
          if (iv) {
            resolvedEntityName = `${iv.candidateName || 'Candidate'} - ${iv.round || ('Round ' + iv.roundNo)}`;
          }
        } else if (entityType === 'INTERVIEW_FEEDBACK') {
          // Check if newData has the roundId
          const possibleRoundId = newData?.roundId || newData?.interviewId;
          if (possibleRoundId) {
            const iv = await prisma.interview.findUnique({
              where: { id: possibleRoundId },
              select: { candidateName: true, round: true, roundNo: true }
            });
            if (iv) {
              resolvedEntityName = `Feedback for ${iv.candidateName || 'Candidate'} - ${iv.round || ('Round ' + iv.roundNo)}`;
            }
          } else {
            // Try to find the interview containing this feedback tempId
            const iv = await prisma.interview.findFirst({
              where: {
                feedback: {
                  path: '$[*].id',
                  array_contains: entityId
                }
              },
              select: { candidateName: true, round: true, roundNo: true }
            });
            if (iv) {
              resolvedEntityName = `Feedback for ${iv.candidateName || 'Candidate'} - ${iv.round || ('Round ' + iv.roundNo)}`;
            }
          }
        } else if (entityType === 'APPLICATION') {
          const app = await prisma.application.findUnique({
            where: { id: entityId },
            include: { candidate: true, job: true }
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
      const inv = require("./cacheInvalidation");
      await inv.audit(targetOrg);

      const sse = require("./sse");
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
