const { db: firestore } = require("../config/firebase");

async function logAudit({
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  oldData = null,
  newData = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    await firestore.collection("auditLogs").add({
      actorUserId,
      action,
      entityType,
      entityId,
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

module.exports = {
  logAudit,
};
