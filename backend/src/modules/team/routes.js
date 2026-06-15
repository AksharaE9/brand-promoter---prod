const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const sse = require("../../utils/sse");
const inv = require("../../utils/cacheInvalidation");

const router = express.Router();
router.use(auth);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: count active candidates for a user
// ─────────────────────────────────────────────────────────────────────────────
async function getActiveCandidatesCount(userId, myOrg) {
  const INACTIVE_STATUSES = ["REJECTED", "JOINED", "OFFER_DECLINED"];

  const [c1, c2, c3] = await Promise.all([
    prisma.candidate.count({
      where: {
        organizationId: myOrg,
        assignedRecruiterId: userId,
        status: { notIn: INACTIVE_STATUSES },
        isDeleted: false,
      },
    }),
    prisma.candidate.count({
      where: {
        organizationId: myOrg,
        createdById: userId,
        status: { notIn: INACTIVE_STATUSES },
        isDeleted: false,
      },
    }),
    prisma.candidate.count({
      where: {
        organizationId: myOrg,
        mentorId: userId,
        status: { notIn: INACTIVE_STATUSES },
        isDeleted: false,
      },
    }),
  ]);

  return c1 + c2 + c3;
}

// GET active-candidates-count for a user
router.get(
  "/members/:userId/active-candidates-count",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const myOrg = req.user.organizationId || "defaultOrg";
    const count = await getActiveCandidatesCount(req.params.userId, myOrg);
    res.json({ success: true, count });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// RECRUITERS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/recruiters/:id", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, fullName: true, email: true, phone: true, role: true,
      status: true, userType: true, department: true, designation: true,
      employeeId: true, reportingTo: true, profilePhotoUrl: true,
      organizationId: true, createdAt: true,
    },
  });
  if (!user) throw new ApiError(404, "Recruiter not found");
  res.json({ success: true, data: user });
}));

router.put("/recruiters/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) throw new ApiError(403, "You can only edit your own profile");

  const payload = { ...req.body };
  if (!isSuperAdmin) {
    const PROTECTED = ["role", "userType", "maxActiveCandidates", "department", "designation", "employeeId", "reportingTo", "isActive", "status"];
    PROTECTED.forEach(k => delete payload[k]);
  }

  const updated = await prisma.user.update({ where: { id }, data: payload });

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, id);
  sse.broadcastToOrg(orgId, "TEAM_MEMBER_UPDATED", { userId: id, changes: payload, updatedBy: req.user.id });
  sse.sendToUser(id, "PROFILE_UPDATED", { userId: id, changes: payload });

  const { passwordHash: _ph, ...safeUser } = updated;
  res.json({ success: true, data: safeUser });
}));

router.patch(
  "/recruiters/:id/status",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    await prisma.user.update({
      where: { id: req.params.id },
      data: { status, isActive: status === "ACTIVE" },
    });
    const orgId = req.user.organizationId || "defaultOrg";
    await inv.user(orgId, req.params.id);

    if (status === "INACTIVE") {
      sse.broadcastToOrg(orgId, "TEAM_MEMBER_DELETED", { userId: req.params.id, deletedBy: req.user.id, deletedByName: req.user.fullName });
      sse.sendToUser(req.params.id, "ACCOUNT_DEACTIVATED", { message: "Your account has been deactivated" });
    } else {
      sse.broadcastToOrg(orgId, "TEAM_MEMBER_RESTORED", { userId: req.params.id, restoredBy: req.user.id, restoredByName: req.user.fullName });
    }
    res.json({ success: true, data: { status } });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// INTERVIEWERS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/interviewers/:id", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, fullName: true, email: true, phone: true, role: true, status: true, organizationId: true },
  });
  if (!user) throw new ApiError(404, "Interviewer not found");
  res.json({ success: true, data: user });
}));

router.put("/interviewers/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) throw new ApiError(403, "You can only edit your own profile");

  const payload = { ...req.body };
  if (!isSuperAdmin) {
    ["role", "userType", "department", "designation", "employeeId", "reportingTo", "isActive", "status"].forEach(k => delete payload[k]);
  }

  const updated = await prisma.user.update({ where: { id }, data: payload });

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, id);
  sse.broadcastToOrg(orgId, "TEAM_MEMBER_UPDATED", { userId: id, changes: payload, updatedBy: req.user.id });
  sse.sendToUser(id, "PROFILE_UPDATED", { userId: id, changes: payload });

  const { passwordHash: _ph, ...safeUser } = updated;
  res.json({ success: true, data: safeUser });
}));

router.patch(
  "/interviewers/:id/status",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    await prisma.user.update({ where: { id: req.params.id }, data: { status, isActive: status === "ACTIVE" } });
    const orgId = req.user.organizationId || "defaultOrg";
    await inv.user(orgId, req.params.id);
    if (status === "INACTIVE") {
      sse.broadcastToOrg(orgId, "TEAM_MEMBER_DELETED", { userId: req.params.id });
      sse.sendToUser(req.params.id, "ACCOUNT_DEACTIVATED", { message: "Your account has been deactivated" });
    } else {
      sse.broadcastToOrg(orgId, "TEAM_MEMBER_RESTORED", { userId: req.params.id });
    }
    res.json({ success: true, data: { status } });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// TEAM MEMBERS (soft delete, restore, role, patch)
// ─────────────────────────────────────────────────────────────────────────────

// GET deleted members
router.get(
  "/members/deleted",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const myOrg = req.user.organizationId || "defaultOrg";
    const { role, userType, search, page = 1, limit = 10 } = req.query;

    const where = { isDeleted: true, organizationId: myOrg };
    if (role) where.role = role;
    if (userType) where.userType = userType;

    let items = await prisma.user.findMany({ where, orderBy: { deletedAt: "desc" } });

    if (search) {
      const s = search.toLowerCase();
      items = items.filter(u => (u.fullName || "").toLowerCase().includes(s) || (u.email || "").toLowerCase().includes(s));
    }

    // Populate deletedBy name
    const adminIds = [...new Set(items.map(u => u.deletedBy).filter(Boolean))];
    let adminMap = {};
    if (adminIds.length > 0) {
      const admins = await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true } });
      admins.forEach(a => { adminMap[a.id] = a.fullName; });
    }

    items = items.map(u => ({ ...u, deletedByName: adminMap[u.deletedBy] || "System" }));

    const total = items.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paginated = items.slice(start, start + parseInt(limit));

    res.json({
      success: true,
      data: paginated,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

// DELETE /members/:userId (soft-delete)
router.delete(
  "/members/:userId",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const myOrg = req.user.organizationId || "defaultOrg";

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || (targetUser.organizationId || "defaultOrg") !== myOrg)
      throw new ApiError(404, "User not found");
    if (req.user.id === userId) throw new ApiError(400, "You cannot delete your own account");

    if (targetUser.role === "SUPER_ADMIN") {
      const activeAdmins = await prisma.user.count({
        where: { role: "SUPER_ADMIN", isDeleted: false, organizationId: myOrg },
      });
      if (activeAdmins <= 1) throw new ApiError(400, "Cannot delete the only Super Admin");
    }

    const activeCount = await getActiveCandidatesCount(userId, myOrg);
    if (activeCount > 0)
      throw new ApiError(400, `This recruiter has ${activeCount} active candidates. Reassign them first`, { count: activeCount });

    // Soft delete + revoke sessions
    await Promise.all([
      prisma.user.update({
        where: { id: userId },
        data: { isDeleted: true, isActive: false, deletedAt: new Date(), deletedBy: req.user.id, status: "INACTIVE" },
      }),
      prisma.session.deleteMany({ where: { userId } }),
    ]);

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      action: "TEAM_MEMBER_DELETED",
      entityType: "USER",
      entityId: userId,
      entityName: targetUser.fullName,
      oldData: { isDeleted: false, status: targetUser.status },
      newData: { isDeleted: true, status: "INACTIVE" },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await inv.user(myOrg, userId);
    sse.broadcastToOrg(myOrg, "TEAM_MEMBER_DELETED", { userId, deletedBy: req.user.id, deletedByName: req.user.fullName });
    sse.sendToUser(userId, "ACCOUNT_DEACTIVATED", { message: "Your account has been deactivated" });

    res.json({ success: true, message: `${targetUser.fullName} has been removed from the team` });
  }),
);

// PATCH /members/:userId/restore
router.patch(
  "/members/:userId/restore",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const myOrg = req.user.organizationId || "defaultOrg";

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || (targetUser.organizationId || "defaultOrg") !== myOrg)
      throw new ApiError(404, "User not found");

    await prisma.user.update({
      where: { id: userId },
      data: { isDeleted: false, isActive: true, deletedAt: null, deletedBy: null, status: "ACTIVE" },
    });

    logAudit({
      actorUserId: req.user.id,
      action: "TEAM_MEMBER_RESTORED",
      entityType: "USER",
      entityId: userId,
      entityName: targetUser.fullName,
      oldData: { isDeleted: true, status: "INACTIVE" },
      newData: { isDeleted: false, status: "ACTIVE" },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await inv.user(myOrg, userId);
    sse.broadcastToOrg(myOrg, "TEAM_MEMBER_RESTORED", { userId, restoredBy: req.user.id, restoredByName: req.user.fullName });

    res.json({ success: true, message: `${targetUser.fullName} has been restored successfully` });
  }),
);

// PATCH /members/:userId/role
router.patch(
  "/members/:userId/role",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;
    const myOrg = req.user.organizationId || "defaultOrg";

    if (!["SUPER_ADMIN", "RECRUITER", "USER"].includes(role)) throw new ApiError(400, "Invalid role");

    const targetRole = role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "RECRUITER";
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || (targetUser.organizationId || "defaultOrg") !== myOrg) throw new ApiError(404, "User not found");
    if (req.user.id === userId) throw new ApiError(400, "You cannot change your own role");

    if (targetRole === "RECRUITER" && targetUser.role === "SUPER_ADMIN") {
      const activeAdmins = await prisma.user.count({ where: { role: "SUPER_ADMIN", isDeleted: false, organizationId: myOrg } });
      if (activeAdmins <= 1) throw new ApiError(400, "Cannot downgrade the only Super Admin");
    }

    await prisma.user.update({ where: { id: userId }, data: { role: targetRole } });

    logAudit({
      actorUserId: req.user.id,
      action: "ROLE_CHANGED",
      entityType: "USER",
      entityId: userId,
      entityName: targetUser.fullName,
      oldData: { role: targetUser.role },
      newData: { role: targetRole },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await inv.user(myOrg, userId);
    sse.broadcastToOrg(myOrg, "TEAM_ROLE_CHANGED", { userId, previousRole: targetUser.role, newRole: targetRole, changedBy: req.user.id });
    sse.sendToUser(userId, "YOUR_ROLE_CHANGED", { previousRole: targetUser.role, newRole: targetRole });

    res.json({ success: true, message: `${targetUser.fullName}'s role has been updated to ${targetRole}` });
  }),
);

// PATCH /members/:userId — general update (userType, status, etc.)
router.patch(
  "/members/:userId",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const updateFields = req.body;
    const myOrg = req.user.organizationId || "defaultOrg";

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || (targetUser.organizationId || "defaultOrg") !== myOrg) throw new ApiError(404, "User not found");

    const allowedUpdates = ["userType", "fullName", "phone", "isActive", "status"];
    const finalUpdates = {};
    const changedFields = [];

    Object.keys(updateFields).forEach(k => {
      if (allowedUpdates.includes(k) && updateFields[k] !== targetUser[k]) {
        finalUpdates[k] = updateFields[k];
        changedFields.push(k);
      }
    });

    if (changedFields.length === 0) return res.json({ success: true, data: targetUser });

    if (finalUpdates.status === "INACTIVE" || finalUpdates.isActive === false) {
      await prisma.session.deleteMany({ where: { userId } });
    }

    await prisma.user.update({ where: { id: userId }, data: finalUpdates });

    logAudit({
      actorUserId: req.user.id,
      action: "TEAM_MEMBER_UPDATED",
      entityType: "USER",
      entityId: userId,
      entityName: targetUser.fullName,
      oldData: Object.fromEntries(changedFields.map(k => [k, targetUser[k]])),
      newData: finalUpdates,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await inv.user(myOrg, userId);
    sse.broadcastToOrg(myOrg, "TEAM_MEMBER_UPDATED", { userId, changes: finalUpdates, updatedBy: req.user.id });

    if (finalUpdates.status === "INACTIVE" || finalUpdates.isActive === false) {
      sse.sendToUser(userId, "ACCOUNT_DEACTIVATED", { message: "Your account has been deactivated" });
    }

    res.json({ success: true, data: { ...targetUser, ...finalUpdates } });
  }),
);

module.exports = router;
