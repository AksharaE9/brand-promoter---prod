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
  const targetOrg = orgId || organizationId || "defaultOrg";

  // Intentionally NOT awaited — fire and forget
  prisma.auditLog.create({
    data: {
      actorUserId,
      actorName:  actorName  || actorUserId || "System",
      actorEmail: actorEmail || "",
      actorRole:  actorRole  || "SYSTEM",
      action,
      entityType,
      entityId,
      entityName: entityName || entityId || null,
      oldData,
      newData,
      metadata,
      ipAddress,
      userAgent,
      organizationId: targetOrg,
      isDeleted: false,
    },
  })
  .then(async (log) => {
    try {
      const inv = require("./cacheInvalidation");
      await inv.audit(targetOrg);

      const sse = require("./sse");
      sse.broadcastToOrg(targetOrg, 'AUDIT_LOG_CREATED', {
        logId: log.id,
        action,
        entityType,
        entityId,
        actorName: actorName || actorUserId || "System",
        description: `${actorName || "System"} performed ${action} on ${entityType}`,
        performedBy: actorUserId,
        performedByName: actorName || "System",
        timestamp: log.createdAt,
      });
    } catch (sseErr) {
      console.error("[Audit] SSE/Cache error:", sseErr.message);
    }
  })
  .catch(err => {
    // Never crash a request because audit logging failed
    console.error("[Audit] Write failed:", err.message);
  });
}

module.exports = { logAudit };

