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
}) {
  // Intentionally NOT awaited — fire and forget
  firestore.collection("auditLogs").add({
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
  }).catch(err => {
    // Never crash a request because audit logging failed
    console.error("[Audit] Write failed:", err.message);
  });
}

module.exports = { logAudit };
