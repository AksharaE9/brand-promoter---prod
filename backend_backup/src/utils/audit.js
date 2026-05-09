const prisma = require("../config/prisma");

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
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType,
        entityId,
        oldData,
        newData,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}

module.exports = {
  logAudit,
};
