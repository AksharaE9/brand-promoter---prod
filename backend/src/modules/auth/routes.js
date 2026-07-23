const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { signAccessToken } = require("../../utils/jwt");
const { auth } = require("../../middleware/auth");
const { logAudit } = require("../../utils/audit");

const router = express.Router();

function parseUserAgent(ua) {
  if (!ua) return "Unknown Device";
  if (ua.includes("Mobi") || ua.includes("Android") || ua.includes("iPhone")) {
    const os = ua.includes("iPhone") ? "iPhone" : "Android Mobile";
    const browser = ua.includes("Chrome") ? "Chrome" : ua.includes("Safari") ? "Safari" : "Mobile Browser";
    return `${os} (${browser})`;
  } else {
    const os = ua.includes("Windows") ? "Windows PC" : ua.includes("Macintosh") ? "macOS" : ua.includes("Linux") ? "Linux PC" : "Desktop";
    const browser = ua.includes("Chrome") ? "Chrome" : ua.includes("Firefox") ? "Firefox" : ua.includes("Safari") ? "Safari" : "Web Browser";
    return `${os} (${browser})`;
  }
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { firstName, lastName, fullName, email, phone = null, password, role = "RECRUITER" } = req.body;
    const allowedRoles = ["RECRUITER", "SUPER_ADMIN"];

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "").trim().toUpperCase();
    const builtName = String(fullName || `${firstName || ""} ${lastName || ""}`).trim();

    if (!builtName || !normalizedEmail || !password) {
      throw new ApiError(400, "Name, email, and password are required");
    }
    if (!allowedRoles.includes(normalizedRole)) {
      throw new ApiError(400, "role must be RECRUITER or SUPER_ADMIN");
    }
    if (String(password).length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters");
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        fullName: builtName,
        email: normalizedEmail,
        phone: phone ? String(phone).trim() : null,
        passwordHash,
        role: normalizedRole,
        status: "PENDING",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, status: user.status },
    });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Fallback: try original case
    if (!user && email.trim() !== normalizedEmail) {
      user = await prisma.user.findFirst({ where: { email: email.trim() } });
    }

    // Guard: user not found OR user exists but has no password hash.
    // Both cases return the same 401 to avoid leaking which email exists.
    if (!user || !user.passwordHash) {
      throw new ApiError(401, "Incorrect email or password.");
    }

    if (user.isDeleted === true) {
      throw new ApiError(401, "This account has been deleted.");
    }
    if (user.status !== "ACTIVE") {
      if (user.status === "INACTIVE") {
        throw new ApiError(403, "Your account has been deactivated. Please contact your administrator.");
      }
      if (user.status === "PENDING") {
        throw new ApiError(403, "Your account is pending approval. Please contact your administrator.");
      }
      throw new ApiError(403, "Your account is not active. Please contact your administrator.");
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new ApiError(401, "Incorrect email or password.");
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        device: parseUserAgent(req.headers["user-agent"]),
        ipAddress: req.ip || "127.0.0.1",
        location: "Local Session",
        lastActive: new Date(),
      },
    });

    const token = signAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: session.id,
    });

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          profilePhotoUrl: user.profilePhotoUrl || null,
        },
      },
    });
  }),
);

router.get(
  "/me",
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: req.user,
    });
  }),
);

router.post(
  "/change-password",
  auth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      throw new ApiError(400, "All password fields are required");
    }
    if (newPassword !== confirmNewPassword) {
      throw new ApiError(400, "New password and confirmation do not match");
    }
    if (newPassword.length < 8) {
      throw new ApiError(400, "New password must be at least 8 characters");
    }

    const hashToCompare = req.user.passwordHash;
    if (!hashToCompare) {
      throw new ApiError(500, "User account is misconfigured");
    }

    const isValid = await bcrypt.compare(currentPassword, hashToCompare);
    if (!isValid) {
      throw new ApiError(401, "Incorrect current password");
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: newHash },
    });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      action: "PASSWORD_CHANGED",
      entityType: "USER",
      entityId: req.user.id,
      entityName: req.user.fullName,
      metadata: { changedFields: ["passwordHash"], entityName: req.user.fullName },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Password updated successfully" });
  })
);

router.get(
  "/sessions",
  auth,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user.id },
      orderBy: { lastActive: "desc" },
    });

    const data = sessions.map(s => ({
      ...s,
      isCurrent: s.id === req.user.sessionId,
    }));

    // current first
    data.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return new Date(b.lastActive) - new Date(a.lastActive);
    });

    res.json({ success: true, data });
  })
);

router.delete(
  "/sessions/:sessionId",
  auth,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session || session.userId !== req.user.id) {
      throw new ApiError(404, "Session not found");
    }

    await prisma.session.delete({ where: { id: sessionId } });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      action: "SESSION_REVOKED",
      entityType: "SESSION",
      entityId: sessionId,
      entityName: session.device || "Unknown Device",
      metadata: { device: session.device, ipAddress: session.ipAddress },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Session revoked successfully" });
  })
);

router.delete(
  "/sessions-other",
  auth,
  asyncHandler(async (req, res) => {
    const currentSessionId = req.user.sessionId;

    const result = await prisma.session.deleteMany({
      where: {
        userId: req.user.id,
        NOT: { id: currentSessionId },
      },
    });

    if (result.count > 0) {
      logAudit({
        actorUserId: req.user.id,
        actorName: req.user.fullName,
        action: "ALL_OTHER_SESSIONS_REVOKED",
        entityType: "SESSION",
        entityId: req.user.id,
        entityName: req.user.fullName,
        metadata: { revokedCount: result.count },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }

    res.json({ success: true, message: `Revoked ${result.count} other sessions successfully` });
  })
);

module.exports = router;
