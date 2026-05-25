const express = require("express");
const bcrypt = require("bcryptjs");
const { db: firestore } = require("../../config/firebase");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { signAccessToken } = require("../../utils/jwt");
const { auth } = require("../../middleware/auth");

const router = express.Router();

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

    const snapshot = await firestore.collection("users").where("email", "==", normalizedEmail).limit(1).get();
    if (!snapshot.empty) {
      throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const userData = {
      fullName: builtName,
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : null,
      passwordHash,
      role: normalizedRole,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("users").add(userData);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { id: docRef.id, ...userData },
    });
  }),
);

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
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const snapshot = await firestore.collection("users").where("email", "==", normalizedEmail).limit(1).get();

    if (snapshot.empty) {
      throw new ApiError(401, "Invalid credentials");
    }

    const userDoc = snapshot.docs[0];
    const user = { id: userDoc.id, ...userDoc.data() };

    if (user.status !== "ACTIVE" || user.isDeleted === true) {
      throw new ApiError(403, "User is inactive or deleted");
    }

    const hashToCompare = user.passwordHash || user.password;
    if (!hashToCompare) {
      throw new ApiError(500, "User account is misconfigured (missing password hash)");
    }
    const isValidPassword = await bcrypt.compare(password, hashToCompare);
    if (!isValidPassword) {
      throw new ApiError(401, "Invalid credentials");
    }

    const sessionRef = await firestore.collection("sessions").add({
      userId: user.id,
      device: parseUserAgent(req.headers["user-agent"]),
      ipAddress: req.ip || "127.0.0.1",
      location: "Local Session",
      lastActive: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const token = signAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: sessionRef.id
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

// POST /change-password
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

    const hashToCompare = req.user.passwordHash || req.user.password;
    if (!hashToCompare) {
      throw new ApiError(500, "User account is misconfigured");
    }

    const isValid = await bcrypt.compare(currentPassword, hashToCompare);
    if (!isValid) {
      throw new ApiError(401, "Incorrect current password");
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await firestore.collection("users").doc(req.user.id).update({
      passwordHash: newHash,
      updatedAt: new Date().toISOString()
    });

    await logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      action: "PASSWORD_CHANGED",
      entityType: "USER",
      entityId: req.user.id,
      entityName: req.user.fullName,
      metadata: {
        changedFields: ["passwordHash"],
        entityName: req.user.fullName
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });

    res.json({ success: true, message: "Password updated successfully" });
  })
);

// GET /sessions
router.get(
  "/sessions",
  auth,
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("sessions").where("userId", "==", req.user.id).get();
    const sessions = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        isCurrent: doc.id === req.user.sessionId
      };
    });

    // Sort: current first, then by lastActive desc
    sessions.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return new Date(b.lastActive || 0) - new Date(a.lastActive || 0);
    });

    res.json({ success: true, data: sessions });
  })
);

// DELETE /sessions/:sessionId (revoke single session)
router.delete(
  "/sessions/:sessionId",
  auth,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const sessionDoc = await firestore.collection("sessions").doc(sessionId).get();

    if (!sessionDoc.exists || sessionDoc.data().userId !== req.user.id) {
      throw new ApiError(404, "Session not found");
    }

    await firestore.collection("sessions").doc(sessionId).delete();

    await logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      action: "SESSION_REVOKED",
      entityType: "SESSION",
      entityId: sessionId,
      entityName: sessionDoc.data().device || "Unknown Device",
      metadata: {
        device: sessionDoc.data().device,
        ipAddress: sessionDoc.data().ipAddress
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });

    res.json({ success: true, message: "Session revoked successfully" });
  })
);

// DELETE /sessions (revoke all other sessions)
router.delete(
  "/sessions-other",
  auth,
  asyncHandler(async (req, res) => {
    const currentSessionId = req.user.sessionId;
    const snapshot = await firestore.collection("sessions")
      .where("userId", "==", req.user.id)
      .get();

    const batch = firestore.batch();
    let count = 0;

    snapshot.docs.forEach(doc => {
      if (doc.id !== currentSessionId) {
        batch.delete(doc.ref);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      await logAudit({
        actorUserId: req.user.id,
        actorName: req.user.fullName,
        action: "ALL_OTHER_SESSIONS_REVOKED",
        entityType: "SESSION",
        entityId: req.user.id,
        entityName: req.user.fullName,
        metadata: {
          revokedCount: count
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
    }

    res.json({ success: true, message: `Revoked ${count} other sessions successfully` });
  })
);

module.exports = router;
