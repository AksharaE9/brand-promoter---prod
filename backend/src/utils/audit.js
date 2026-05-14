const { db: firestore } = require("../config/firebase");

/**
 * Write an audit log entry.
 * Pass actorName + entityName at call-site to avoid extra Firestore reads
 * when displaying audit logs (denormalization pattern).
 */
async function logAudit({
  actorUserId = null,
  actorName = null,       // Denormalized — pass at write time
  action,
  entityType,
  entityId = null,
  entityName = null,      // Denormalized — pass at write time
  oldData = null,
  newData = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    // Auto-resolve actorName if not provided
    let resolvedActorName = actorName;
    if (!resolvedActorName && actorUserId) {
      try {
        const userDoc = await firestore.collection("users").doc(actorUserId).get();
        if (userDoc.exists) {
          const u = userDoc.data();
          resolvedActorName = u.fullName || u.name || actorUserId;
        }
      } catch (_) {
        resolvedActorName = actorUserId;
      }
    }

    await firestore.collection("auditLogs").add({
      actorUserId,
      actorName: resolvedActorName || 'System',
      action,
      entityType,
      entityId,
      entityName: entityName || entityId,
      oldData,
      newData,
      ipAddress,
      userAgent,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}

module.exports = { logAudit };
