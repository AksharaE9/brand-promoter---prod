const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const { auth, requireRoles, invalidateUserCache } = require("../../middleware/auth");
const { upload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { getCached } = require("../../utils/cache");
const { validatePasswordStrength } = require("../../lib/passwordValidation");

const router = express.Router();
router.use(auth);

const allowedRoles = ["SUPER_ADMIN", "ADMIN", "RECRUITER", "INTERVIEWER", "USER"];

// GET /api/users — list all users in org
router.get(
  "/",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || "defaultOrg";
    const users = await getCached(`users:list:${orgId}:all`, async () => {
      return prisma.user.findMany({
        where: { isDeleted: false, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, fullName: true, email: true, phone: true,
          role: true, status: true, organizationId: true,
          userType: true, department: true, designation: true,
          profilePhotoUrl: true, createdAt: true, updatedAt: true,
        },
      });
    }, 60000);
    res.json({ success: true, data: users });
  }),
);

// POST /api/users — create user (admin)
router.post(
  "/",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { fullName, email, password, role, phone = "" } = req.body;

    if (!fullName || !email || !password || !role) {
      throw new ApiError(400, "Full Name, Email, Password, and Role are required");
    }
    if (!allowedRoles.includes(role)) throw new ApiError(400, "Invalid role");

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new ApiError(409, "User with this email already exists");

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        passwordHash,
        role,
        phone,
        status: "ACTIVE",
        organizationId: req.user.organizationId || "defaultOrg",
      },
    });

    const { passwordHash: _ph, ...safeUser } = user;
    res.status(201).json({ success: true, data: safeUser });

    setImmediate(async () => {
      try {
        logAudit({
          actorUserId: req.user.id,
          action: "CREATE_USER",
          entityType: "USER",
          entityId: user.id,
          newData: { fullName, email: user.email, role },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        const orgId = req.user.organizationId || "defaultOrg";
        const inv = require("../../utils/cacheInvalidation");
        await inv.user(orgId, user.id);

        const sse = require("../../utils/sse");
        sse.broadcastToOrg(orgId, "TEAM_MEMBER_INVITED", {
          email: user.email,
          role: user.role,
          invitedBy: req.user.id,
          invitedByName: req.user.fullName || req.user.email,
        });
      } catch (err) {
        console.error("[CreateUser] Async side-effects failed:", err.message);
      }
    });
  }),
);

// GET /api/users/interviewers — list recruiters/admins/interviewers
router.get(
  "/interviewers",
  asyncHandler(async (req, res) => {
    const users = await getCached("users_interviewers", async () => {
      return prisma.user.findMany({
        where: { role: { in: ["SUPER_ADMIN", "ADMIN", "RECRUITER", "INTERVIEWER"] }, isDeleted: false },
        select: { id: true, fullName: true, role: true, status: true },
      });
    }, 60000);
    res.json({ success: true, data: users });
  }),
);

// PATCH /api/users/:id — update user
router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, email, phone, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "User not found");

    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (normalizedEmail && normalizedEmail !== existing.email) {
      const dup = await prisma.user.findFirst({ where: { email: normalizedEmail, NOT: { id } } });
      if (dup) throw new ApiError(409, "User with this email already exists");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        fullName: String(fullName || "").trim(),
        email: normalizedEmail,
        phone: phone ? String(phone).trim() : null,
        role,
      },
    });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.user(orgId, id);
    await invalidateUserCache(id);

    const { passwordHash: _ph, ...safeUser } = updated;
    res.json({ success: true, data: safeUser });

    setImmediate(async () => {
      try {
        logAudit({
          actorUserId: req.user.id,
          action: "UPDATE_USER",
          entityType: "USER",
          entityId: id,
          oldData: { fullName: existing.fullName, email: existing.email, role: existing.role },
          newData: { fullName: updated.fullName, email: updated.email, role: updated.role },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        const sse = require("../../utils/sse");
        sse.broadcastToOrg(orgId, "TEAM_MEMBER_UPDATED", {
          userId: id,
          changes: { fullName: updated.fullName, email: updated.email, role: updated.role },
          updatedBy: req.user.id,
        });
        sse.sendToUser(id, "PROFILE_UPDATED", { userId: id });
      } catch (err) {
        console.error("[UpdateUser] Async side-effects failed:", err.message);
      }
    });
  }),
);

// PATCH /api/users/:id/status
router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "PENDING"].includes(status)) throw new ApiError(400, "Invalid status");
    if (id === req.user.id && status === "INACTIVE") throw new ApiError(400, "You cannot deactivate your own account");

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "User not found");

    await prisma.user.update({ where: { id }, data: { status, isActive: status === "ACTIVE" } });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.user(orgId, id);
    await invalidateUserCache(id);

    res.json({ success: true, data: { id, status } });

    setImmediate(async () => {
      try {
        logAudit({
          actorUserId: req.user.id,
          action: "UPDATE_USER_STATUS",
          entityType: "USER",
          entityId: id,
          oldData: { status: existing.status },
          newData: { status },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        const sse = require("../../utils/sse");
        if (status === "INACTIVE") {
          sse.broadcastToOrg(orgId, "TEAM_MEMBER_DELETED", { userId: id, deletedBy: req.user.id, deletedByName: req.user.fullName });
          sse.sendToUser(id, "ACCOUNT_DEACTIVATED", { message: "Your account has been deactivated" });
        } else {
          sse.broadcastToOrg(orgId, "TEAM_MEMBER_RESTORED", { userId: id, restoredBy: req.user.id, restoredByName: req.user.fullName });
        }
      } catch (err) {
        console.error("[UpdateUserStatus] Async side-effects failed:", err.message);
      }
    });
  }),
);

// POST /api/users/me/photo — upload profile photo
router.post(
  "/me/photo",
  (req, res, next) => {
    req.uploadFolder = "user-photos";
    next();
  },
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "Photo file is required");

    const cloudinaryUrl = req.file.path;

    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey: cloudinaryUrl,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "image/jpeg",
        sizeBytes: req.file.size || 0,
        uploadedById: req.user.id,
      },
    });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { profilePhotoUrl: cloudinaryUrl },
    });

    logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_USER_PHOTO",
      entityType: "USER",
      entityId: req.user.id,
      newData: { fileId: fileMeta.id, url: cloudinaryUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.user(orgId, req.user.id);
    await invalidateUserCache(req.user.id);

    const sse = require("../../utils/sse");
    sse.sendToUser(req.user.id, "PROFILE_UPDATED", {
      userId: req.user.id,
      changes: { profilePhotoUrl: cloudinaryUrl },
    });

    res.status(201).json({ success: true, data: { fileId: fileMeta.id, url: cloudinaryUrl } });
  }),
);

// POST /api/users/me/change-password — self-service change password
router.post(
  "/me/change-password",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      throw new ApiError(400, "Current password and new password are required");
    }

    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, passwordHash: true }
    });

    if (!user || !user.passwordHash) {
      throw new ApiError(401, "User not found or has no password configured");
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.ok) {
      return res.status(422).json({ code: 'WEAK_PASSWORD', details: strength.issues, message: 'New password is too weak' });
    }

    if (newPassword === currentPassword) {
      return res.status(422).json({ code: 'PASSWORD_UNCHANGED', message: 'New password cannot be the same as your current password' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      }
    });

    const currentSessionId = req.user.sessionId;
    if (currentSessionId) {
      await prisma.session.deleteMany({
        where: {
          userId,
          id: { not: currentSessionId }
        }
      });
    } else {
      await prisma.session.deleteMany({
        where: { userId }
      });
    }

    logAudit({
      actorUserId: userId,
      action: "password_changed",
      entityType: "USER",
      entityId: userId,
      entityName: user.fullName,
      subjectType: "user",
      subjectId: userId,
      subjectName: user.fullName,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.user(orgId, userId);
    await invalidateUserCache(userId);

    res.status(204).end();
  })
);

// POST /api/users/:id/elevate-to-super-admin — elevate user to SUPER_ADMIN
router.post(
  "/:id/elevate-to-super-admin",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true, role: true, organizationId: true }
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    if (targetUser.role === "SUPER_ADMIN") {
      return res.status(200).json({ success: true, message: "User is already a Super Admin", data: targetUser });
    }

    // Write audit event before applying the change
    logAudit({
      actorUserId: req.user.id,
      action: "user_role_elevated_to_super_admin",
      entityType: "USER",
      entityId: id,
      entityName: targetUser.fullName,
      subjectType: "user",
      subjectId: id,
      subjectName: targetUser.fullName,
      newData: { role: "SUPER_ADMIN" },
      oldData: { role: targetUser.role },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      organizationId: req.user.organizationId || "defaultOrg",
    });

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role: "SUPER_ADMIN" },
      select: { id: true, fullName: true, email: true, role: true, organizationId: true }
    });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.user(orgId, id);
    await invalidateUserCache(id);

    // Send email notification (async)
    const { sendEmail } = require("../../services/notificationService");
    setImmediate(async () => {
      try {
        await sendEmail({
          to: targetUser.email,
          subject: "Your Account Role Has Been Elevated to Super Admin",
          html: `<p>Hello ${targetUser.fullName},</p>
                 <p>Your account role in the ATS portal has been elevated to <strong>SUPER_ADMIN</strong> by ${req.user.fullName || req.user.email}.</p>
                 <p>Please log in to your account to access your new privileges.</p>`
        });
      } catch (err) {
        console.error("[ElevateUser] Email notification failed:", err.message);
      }
    });

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, "ROLE_CHANGED", {
      userId: id,
      role: "SUPER_ADMIN",
      changedBy: req.user.id,
      changedByName: req.user.fullName,
    });

    res.json({ success: true, data: updatedUser });
  })
);

module.exports = router;
