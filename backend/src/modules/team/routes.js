const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const sse = require("../../utils/sse");
const inv = require("../../utils/cacheInvalidation");

const router = express.Router();
router.use(auth);

// Helper to get active candidates count for a user (recruiter/creator/mentor)
async function getActiveCandidatesCount(userId, myOrg) {
  const getActiveCountForField = async (field) => {
    try {
      const snap = await firestore.collection("candidates")
        .where("organizationId", "==", myOrg)
        .where(field, "==", userId)
        .where("status", "not-in", ["REJECTED", "JOINED", "OFFER_DECLINED"])
        .count()
        .get();
      return snap.data().count || 0;
    } catch (e) {
      // Fallback if not-in query fails or needs index
      const snap = await firestore.collection("candidates")
        .where("organizationId", "==", myOrg)
        .where(field, "==", userId)
        .get();
      return snap.docs.filter(doc => {
        const c = doc.data();
        return !['REJECTED', 'JOINED', 'OFFER_DECLINED'].includes(c.status) && c.isDeleted !== true;
      }).length;
    }
  };

  const [c1, c2, c3] = await Promise.all([
    getActiveCountForField("assignedRecruiterId"),
    getActiveCountForField("createdById"),
    getActiveCountForField("mentorId")
  ]);
  return c1 + c2 + c3;
}

// GET /api/team/members/:userId/active-candidates-count
router.get("/members/:userId/active-candidates-count", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const myOrg = req.user.organizationId || "defaultOrg";
  const count = await getActiveCandidatesCount(userId, myOrg);
  res.json({ success: true, count });
}));

// RECRUITERS
router.get("/recruiters/:id", asyncHandler(async (req, res) => {
  const doc = await firestore.collection("users").doc(req.params.id).get();
  if (!doc.exists) throw new ApiError(404, "Recruiter not found");
  res.json({ success: true, data: { id: doc.id, ...doc.data() } });
}));

router.put("/recruiters/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) {
    throw new ApiError(403, "You can only edit your own profile");
  }

  const payload = { ...req.body, updatedAt: new Date().toISOString() };
  
  if (!isSuperAdmin) {
    // Strip protected fields
    delete payload.role;
    delete payload.userType;
    delete payload.maxActiveCandidates;
    delete payload.department;
    delete payload.designation;
    delete payload.employeeId;
    delete payload.reportingTo;
    delete payload.isActive;
    delete payload.status;
  }

  await firestore.collection("users").doc(id).update(payload);
  
  const doc = await firestore.collection("users").doc(id).get();
  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, id);

  sse.broadcastToOrg(orgId, 'TEAM_MEMBER_UPDATED', {
    userId: id,
    changes: payload,
    updatedBy: req.user.id,
  });
  sse.sendToUser(id, 'PROFILE_UPDATED', {
    userId: id,
    changes: payload,
  });

  res.json({ success: true, data: { id, ...doc.data() } });
}));

router.patch("/recruiters/:id/status", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { status } = req.body;
  await firestore.collection("users").doc(req.params.id).update({ 
    status, isActive: status === "ACTIVE", updatedAt: new Date().toISOString() 
  });
  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, req.params.id);

  if (status === 'INACTIVE') {
    sse.broadcastToOrg(orgId, 'TEAM_MEMBER_DELETED', {
      userId: req.params.id,
      deletedBy: req.user.id,
      deletedByName: req.user.fullName || req.user.email,
    });
    sse.sendToUser(req.params.id, 'ACCOUNT_DEACTIVATED', {
      message: 'Your account has been deactivated',
    });
  } else {
    sse.broadcastToOrg(orgId, 'TEAM_MEMBER_RESTORED', {
      userId: req.params.id,
      restoredBy: req.user.id,
      restoredByName: req.user.fullName || req.user.email,
    });
  }
  res.json({ success: true, data: { status } });
}));

// INTERVIEWERS
router.get("/interviewers/:id", asyncHandler(async (req, res) => {
  const doc = await firestore.collection("users").doc(req.params.id).get();
  if (!doc.exists) throw new ApiError(404, "Interviewer not found");
  res.json({ success: true, data: { id: doc.id, ...doc.data() } });
}));

router.put("/interviewers/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) {
    throw new ApiError(403, "You can only edit your own profile");
  }

  const payload = { ...req.body, updatedAt: new Date().toISOString() };
  
  if (!isSuperAdmin) {
    delete payload.role;
    delete payload.userType;
    delete payload.department;
    delete payload.designation;
    delete payload.employeeId;
    delete payload.reportingTo;
    delete payload.isActive;
    delete payload.status;
  }

  await firestore.collection("users").doc(id).update(payload);
  
  const doc = await firestore.collection("users").doc(id).get();
  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, id);

  sse.broadcastToOrg(orgId, 'TEAM_MEMBER_UPDATED', {
    userId: id,
    changes: payload,
    updatedBy: req.user.id,
  });
  sse.sendToUser(id, 'PROFILE_UPDATED', {
    userId: id,
    changes: payload,
  });

  res.json({ success: true, data: { id, ...doc.data() } });
}));

router.patch("/interviewers/:id/status", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { status } = req.body;
  await firestore.collection("users").doc(req.params.id).update({ 
    status, isActive: status === "ACTIVE", updatedAt: new Date().toISOString() 
  });
  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, req.params.id);

  if (status === 'INACTIVE') {
    sse.broadcastToOrg(orgId, 'TEAM_MEMBER_DELETED', {
      userId: req.params.id,
      deletedBy: req.user.id,
      deletedByName: req.user.fullName || req.user.email,
    });
    sse.sendToUser(req.params.id, 'ACCOUNT_DEACTIVATED', {
      message: 'Your account has been deactivated',
    });
  } else {
    sse.broadcastToOrg(orgId, 'TEAM_MEMBER_RESTORED', {
      userId: req.params.id,
      restoredBy: req.user.id,
      restoredByName: req.user.fullName || req.user.email,
    });
  }
  res.json({ success: true, data: { status } });
}));

// GET deleted team members
router.get("/members/deleted", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const myOrg = req.user.organizationId || "defaultOrg";
  const { role, userType, search, page = 1, limit = 10 } = req.query;

  const snapshot = await firestore.collection("users").where("isDeleted", "==", true).get();
  let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Filter by organization
  items = items.filter(u => (u.organizationId || "defaultOrg") === myOrg);

  // Apply filters
  if (role) items = items.filter(u => u.role === role);
  if (userType) items = items.filter(u => u.userType === userType);
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(u => 
      (u.fullName && u.fullName.toLowerCase().includes(s)) || 
      (u.email && u.email.toLowerCase().includes(s))
    );
  }

  // Populate deletedBy admin name
  const adminIds = [...new Set(items.map(u => u.deletedBy).filter(Boolean))];
  const adminMap = {};
  if (adminIds.length > 0) {
    const adminRefs = adminIds.map(id => firestore.collection("users").doc(id));
    const adminSnaps = await firestore.getAll(...adminRefs);
    adminSnaps.forEach(snap => {
      if (snap.exists) adminMap[snap.id] = snap.data().fullName;
    });
  }

  items = items.map(u => ({
    ...u,
    deletedByName: adminMap[u.deletedBy] || "System"
  }));

  // Sort by deletedAt desc
  items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));

  const total = items.length;
  const start = (parseInt(page) - 1) * parseInt(limit);
  const paginated = items.slice(start, start + parseInt(limit));

  res.json({
    success: true,
    data: paginated,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// DELETE team member (soft-delete)
router.delete("/members/:userId", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const myOrg = req.user.organizationId || "defaultOrg";

  const targetUserDoc = await firestore.collection("users").doc(userId).get();
  if (!targetUserDoc.exists) throw new ApiError(404, "User not found");
  
  const targetUser = { id: targetUserDoc.id, ...targetUserDoc.data() };
  const targetOrg = targetUser.organizationId || "defaultOrg";
  if (myOrg !== targetOrg) throw new ApiError(404, "User not found");

  // Check 2: Cannot delete yourself
  if (req.user.id === userId) {
    throw new ApiError(400, "You cannot delete your own account");
  }

  // Check 3: Cannot delete the only SUPER_ADMIN
  if (targetUser.role === "SUPER_ADMIN") {
    const adminsSnapshot = await firestore.collection("users").where("role", "==", "SUPER_ADMIN").get();
    const activeAdmins = adminsSnapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.isDeleted !== true && (u.organizationId || "defaultOrg") === myOrg);
    if (activeAdmins.length <= 1) {
      throw new ApiError(400, "Cannot delete the only Super Admin. Assign another Super Admin first");
    }
  }

  // Check 4: Check if recruiter has active candidates
  const activeCount = await getActiveCandidatesCount(userId, myOrg);
  if (activeCount > 0) {
    throw new ApiError(400, `This recruiter has ${activeCount} active candidates. Reassign them before deleting`, { count: activeCount });
  }

  // Execute updates
  const sessionsSnap = await firestore.collection("sessions").where("userId", "==", userId).get();
  const tokenSnap = await firestore.collection("refreshTokens").where("userId", "==", userId).get();

  const batch = firestore.batch();
  const userRef = firestore.collection("users").doc(userId);
  batch.update(userRef, {
    isDeleted: true,
    isActive: false,
    deletedAt: new Date().toISOString(),
    deletedBy: req.user.id,
    updatedAt: new Date().toISOString()
  });

  sessionsSnap.docs.forEach(doc => batch.delete(doc.ref));
  tokenSnap.docs.forEach(doc => batch.delete(doc.ref));

  // Activity Log
  const auditRef = firestore.collection("auditLogs").doc();
  const metadata = {
    before: { isDeleted: targetUser.isDeleted || false, status: targetUser.status || "ACTIVE", role: targetUser.role },
    after: { isDeleted: true, status: "INACTIVE", role: targetUser.role },
    changedFields: ["isDeleted", "status"],
    entityName: targetUser.fullName
  };
  batch.set(auditRef, {
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "TEAM_MEMBER_DELETED",
    entityType: "USER",
    entityId: userId,
    entityName: targetUser.fullName,
    metadata,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    createdAt: new Date().toISOString()
  });

  // Notification for admin
  const notifRef = firestore.collection("notifications").doc();
  batch.set(notifRef, {
    userId: req.user.id,
    title: "Team Member Deleted",
    message: `You successfully deleted team member ${targetUser.fullName}.`,
    type: "TEAM_MEMBER_DELETED",
    isRead: false,
    createdAt: new Date().toISOString()
  });

  await batch.commit();

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, userId);

  sse.broadcastToOrg(orgId, 'TEAM_MEMBER_DELETED', {
    userId,
    deletedBy: req.user.id,
    deletedByName: req.user.fullName || req.user.email,
  });
  sse.sendToUser(userId, 'ACCOUNT_DEACTIVATED', {
    message: 'Your account has been deactivated',
  });

  res.json({ success: true, message: `${targetUser.fullName} has been removed from the team` });
}));

// PATCH restore team member
router.patch("/members/:userId/restore", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const myOrg = req.user.organizationId || "defaultOrg";

  const targetUserDoc = await firestore.collection("users").doc(userId).get();
  if (!targetUserDoc.exists) throw new ApiError(404, "User not found");
  
  const targetUser = { id: targetUserDoc.id, ...targetUserDoc.data() };
  const targetOrg = targetUser.organizationId || "defaultOrg";
  if (myOrg !== targetOrg) throw new ApiError(404, "User not found");

  const batch = firestore.batch();
  const userRef = firestore.collection("users").doc(userId);
  batch.update(userRef, {
    isDeleted: false,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
    updatedAt: new Date().toISOString()
  });

  const auditRef = firestore.collection("auditLogs").doc();
  batch.set(auditRef, {
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "TEAM_MEMBER_RESTORED",
    entityType: "USER",
    entityId: userId,
    entityName: targetUser.fullName,
    metadata: {
      before: { isDeleted: true, status: "INACTIVE" },
      after: { isDeleted: false, status: "ACTIVE" },
      changedFields: ["isDeleted", "status"],
      entityName: targetUser.fullName
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    createdAt: new Date().toISOString()
  });

  await batch.commit();

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, userId);

  sse.broadcastToOrg(orgId, 'TEAM_MEMBER_RESTORED', {
    userId,
    restoredBy: req.user.id,
    restoredByName: req.user.fullName || req.user.email,
  });

  res.json({ success: true, message: `${targetUser.fullName} has been restored successfully` });
}));

// PATCH update user role (upgrade/downgrade)
router.patch("/members/:userId/role", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  const myOrg = req.user.organizationId || "defaultOrg";

  if (!["SUPER_ADMIN", "RECRUITER", "USER"].includes(role)) {
    throw new ApiError(400, "Invalid role parameter");
  }

  const targetRole = (role === "USER" || role === "RECRUITER") ? "RECRUITER" : "SUPER_ADMIN";

  const targetUserDoc = await firestore.collection("users").doc(userId).get();
  if (!targetUserDoc.exists) throw new ApiError(404, "User not found");
  
  const targetUser = { id: targetUserDoc.id, ...targetUserDoc.data() };
  const targetOrg = targetUser.organizationId || "defaultOrg";
  if (myOrg !== targetOrg) throw new ApiError(404, "User not found");

  if (req.user.id === userId) {
    throw new ApiError(400, "You cannot change your own role");
  }

  if (targetRole === "RECRUITER" && targetUser.role === "SUPER_ADMIN") {
    const adminsSnapshot = await firestore.collection("users").where("role", "==", "SUPER_ADMIN").get();
    const activeAdmins = adminsSnapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.isDeleted !== true && (u.organizationId || "defaultOrg") === myOrg);
    if (activeAdmins.length <= 1) {
      throw new ApiError(400, "Cannot downgrade. This is the only Super Admin in the organization");
    }
  }

  const batch = firestore.batch();
  const userRef = firestore.collection("users").doc(userId);
  batch.update(userRef, {
    role: targetRole,
    updatedAt: new Date().toISOString()
  });

  const auditRef = firestore.collection("auditLogs").doc();
  batch.set(auditRef, {
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "ROLE_CHANGED",
    entityType: "USER",
    entityId: userId,
    entityName: targetUser.fullName,
    metadata: {
      before: { role: targetUser.role },
      after: { role: targetRole },
      changedFields: ["role"],
      entityName: targetUser.fullName
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    createdAt: new Date().toISOString()
  });

  const notifRef = firestore.collection("notifications").doc();
  batch.set(notifRef, {
    userId,
    title: "Role Updated",
    message: `Your role has been updated from ${targetUser.role} to ${targetRole}.`,
    type: "ROLE_CHANGED",
    isRead: false,
    createdAt: new Date().toISOString()
  });

  await batch.commit();

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, userId);

  sse.broadcastToOrg(orgId, 'TEAM_ROLE_CHANGED', {
    userId,
    previousRole: targetUser.role,
    newRole: targetRole,
    changedBy: req.user.id,
    changedByName: req.user.fullName || req.user.email,
  });
  sse.sendToUser(userId, 'YOUR_ROLE_CHANGED', {
    previousRole: targetUser.role,
    newRole: targetRole,
  });

  res.json({ success: true, message: `${targetUser.fullName}'s role has been updated to ${targetRole}` });
}));

// PATCH update general team member details (like userType inline)
router.patch("/members/:userId", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const updateFields = req.body;
  const myOrg = req.user.organizationId || "defaultOrg";

  const targetUserDoc = await firestore.collection("users").doc(userId).get();
  if (!targetUserDoc.exists) throw new ApiError(404, "User not found");
  
  const targetUser = { id: targetUserDoc.id, ...targetUserDoc.data() };
  const targetOrg = targetUser.organizationId || "defaultOrg";
  if (myOrg !== targetOrg) throw new ApiError(404, "User not found");

  const allowedUpdates = ["userType", "fullName", "phone", "isActive", "status"];
  const finalUpdates = {};
  const changedFields = [];
  const before = {};
  const after = {};

  Object.keys(updateFields).forEach(k => {
    if (allowedUpdates.includes(k) && updateFields[k] !== targetUser[k]) {
      finalUpdates[k] = updateFields[k];
      changedFields.push(k);
      before[k] = targetUser[k] || null;
      after[k] = updateFields[k];
    }
  });

  if (changedFields.length === 0) {
    return res.json({ success: true, data: targetUser });
  }

  finalUpdates.updatedAt = new Date().toISOString();

  const batch = firestore.batch();
  const userRef = firestore.collection("users").doc(userId);
  batch.update(userRef, finalUpdates);

  // If deactivating, revoke all sessions immediately
  if (finalUpdates.status === "INACTIVE" || finalUpdates.isActive === false) {
    const sessionsSnap = await firestore.collection("sessions").where("userId", "==", userId).get();
    sessionsSnap.docs.forEach(doc => batch.delete(doc.ref));
  }

  const auditRef = firestore.collection("auditLogs").doc();
  batch.set(auditRef, {
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "TEAM_MEMBER_UPDATED",
    entityType: "USER",
    entityId: userId,
    entityName: targetUser.fullName,
    metadata: {
      before,
      after,
      changedFields,
      entityName: targetUser.fullName
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    createdAt: new Date().toISOString()
  });

  await batch.commit();

  const orgId = req.user.organizationId || "defaultOrg";
  await inv.user(orgId, userId);

  sse.broadcastToOrg(orgId, 'TEAM_MEMBER_UPDATED', {
    userId,
    changes: finalUpdates,
    updatedBy: req.user.id,
  });

  if (finalUpdates.role) {
    sse.broadcastToOrg(orgId, 'TEAM_ROLE_CHANGED', {
      userId,
      previousRole: targetUser.role,
      newRole: finalUpdates.role,
      changedBy: req.user.id,
    });
    sse.sendToUser(userId, 'YOUR_ROLE_CHANGED', {
      previousRole: targetUser.role,
      newRole: finalUpdates.role,
    });
  }

  if (finalUpdates.status === "INACTIVE" || finalUpdates.isActive === false) {
    sse.sendToUser(userId, 'ACCOUNT_DEACTIVATED', {
      message: 'Your account has been deactivated',
    });
  }

  res.json({ success: true, data: { ...targetUser, ...finalUpdates } });
}));

module.exports = router;
