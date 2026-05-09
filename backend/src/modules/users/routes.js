const express = require("express");
const bcrypt = require("bcryptjs");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();

router.use(auth);

const allowedRoles = ["SUPER_ADMIN", "RECRUITER", "INTERVIEWER"];

router.get(
  "/",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("users").orderBy("createdAt", "desc").get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: users });
  }),
);

router.post(
  "/",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { fullName, email, password, role, phone = "" } = req.body;

    if (!fullName || !email || !password || !role) {
      throw new ApiError(400, "Full Name, Email, Password, and Role are required");
    }

    if (!allowedRoles.includes(role)) {
      throw new ApiError(400, "Invalid role");
    }

    // Check email uniqueness
    const dupSnapshot = await firestore.collection("users")
      .where("email", "==", email.toLowerCase())
      .limit(1)
      .get();
    
    if (!dupSnapshot.empty) {
      throw new ApiError(409, "User with this email already exists");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userData = {
      fullName,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      phone,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("users").add(userData);
    const newUser = { id: docRef.id, ...userData };
    delete newUser.password;

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_USER",
      entityType: "USER",
      entityId: docRef.id,
      newData: newUser,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: newUser });
  }),
);

router.get(
  "/interviewers",
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("users")
      .where("role", "in", ["SUPER_ADMIN", "RECRUITER", "INTERVIEWER"])
      .get();
    const users = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      fullName: doc.data().fullName,
      role: doc.data().role 
    }));
    res.json({ success: true, data: users });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, email, phone, role } = req.body;

    const userRef = firestore.collection("users").doc(id);
    const doc = await userRef.get();
    if (!doc.exists) {
      throw new ApiError(404, "User not found");
    }

    const existing = doc.data();

    // Check email uniqueness
    const dupSnapshot = await firestore.collection("users")
      .where("email", "==", email)
      .get();
    
    const duplicates = dupSnapshot.docs.filter(d => d.id !== id);
    if (duplicates.length > 0) {
      throw new ApiError(409, "User with this email already exists");
    }

    const updateData = {
      fullName,
      email,
      phone,
      role,
      updatedAt: new Date().toISOString()
    };

    await userRef.update(updateData);

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_USER",
      entityType: "USER",
      entityId: id,
      oldData: existing,
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { id, ...existing, ...updateData } });
  }),
);

router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "PENDING"].includes(status)) {
      throw new ApiError(400, "Invalid status");
    }
    if (id === req.user.id && status === "INACTIVE") {
      throw new ApiError(400, "You cannot deactivate your own account");
    }

    const userRef = firestore.collection("users").doc(id);
    const doc = await userRef.get();
    if (!doc.exists) {
      throw new ApiError(404, "User not found");
    }

    const oldStatus = doc.data().status;
    await userRef.update({ status, updatedAt: new Date().toISOString() });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_USER_STATUS",
      entityType: "USER",
      entityId: id,
      oldData: { status: oldStatus },
      newData: { status },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { id, status } });
  }),
);

router.post(
  "/me/photo",
  (req, res, next) => {
    req.uploadFolder = "user-photos";
    next();
  },
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ApiError(400, "Photo file is required");
    }

    const cloudinaryUrl = req.file.path;

    const fileMeta = {
      storageKey: cloudinaryUrl,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype || "image/jpeg",
      sizeBytes: req.file.size || 0,
      uploadedById: req.user.id,
      createdAt: new Date().toISOString()
    };

    const fileRef = await firestore.collection("fileMetas").add(fileMeta);

    await firestore.collection("users").doc(req.user.id).update({
      profilePhotoFileId: fileRef.id,
      updatedAt: new Date().toISOString()
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_USER_PHOTO",
      entityType: "USER",
      entityId: req.user.id,
      newData: { fileId: fileRef.id, url: cloudinaryUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: {
        fileId: fileRef.id,
        url: cloudinaryUrl,
      },
    });
  }),
);


module.exports = router;
