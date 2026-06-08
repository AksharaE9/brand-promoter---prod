const { db: firestore } = require("../config/firebase");

/**
 * Write an audit log entry — FIRE AND FORGET (non-blocking).
 * The caller does NOT await this. It never blocks a request.
 *
 * actorName, actorEmail, actorRole and orgId should be passed from the call-site.
 * We do NOT make a Firestore read here — that would add a hidden N+1 read to every mutation.
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
  ipAddress = null,
  userAgent = null,
  orgId = null,
  organizationId = null, // alias — accept either key
}) {
  const targetOrg = orgId || organizationId || "defaultOrg";
  const payload = {
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
    ipAddress,
    userAgent,
    createdAt: new Date().toISOString(),
    organizationId: targetOrg,
    isDeleted: false
  };

  // Intentionally NOT awaited — fire and forget
  firestore.collection("auditLogs").add(payload)
    .then(async (docRef) => {
      try {
        const inv = require("./cacheInvalidation");
        await inv.audit(targetOrg);

        const sse = require("./sse");
        sse.broadcastToOrg(targetOrg, 'AUDIT_LOG_CREATED', {
          logId: docRef.id,
          action,
          entityType,
          entityId,
          actorName: payload.actorName,
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
