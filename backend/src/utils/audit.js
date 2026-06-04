const { db: firestore } = require("../config/firebase");

/**
 * Write an audit log entry — FIRE AND FORGET (non-blocking).
 * The caller does NOT await this. It never blocks a request.
 *
 * actorName and entityName should be passed from the call-site (denormalized).
 * We do NOT make a Firestore read here to resolve names — that would add
 * a hidden N+1 read to every mutation endpoint.
 */
function logAudit({
  actorUserId = null,
  actorName = null,
  action,
  entityType,
  entityId = null,
  entityName = null,
  oldData = null,
  newData = null,
  ipAddress = null,
  userAgent = null,
  orgId = null,
}) {
  const payload = {
    actorUserId,
    actorName: actorName || actorUserId || "System",
    action,
    entityType,
    entityId,
    entityName: entityName || entityId || null,
    oldData,
    newData,
    ipAddress,
    userAgent,
    createdAt: new Date().toISOString(),
  };
  if (orgId) {
    payload.organizationId = orgId;
  }
  
  // Intentionally NOT awaited — fire and forget
  firestore.collection("auditLogs").add(payload)
    .then(async (docRef) => {
      try {
        const targetOrg = orgId || "defaultOrg";
        const inv = require("./cacheInvalidation");
        await inv.audit(targetOrg);

        const sse = require("./sse");
        sse.broadcastToOrg(targetOrg, 'AUDIT_LOG_CREATED', {
          logId: docRef.id,
          action,
          entityType,
          entityId,
          description: `${payload.actorName} performed ${action} on ${entityType}`,
          performedBy: actorUserId,
          performedByName: payload.actorName,
          timestamp: payload.createdAt,
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
