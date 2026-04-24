const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/prisma");
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
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        profilePhotoFile: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    res.json({ success: true, data: users });
  }),
);

router.get(
  "/interviewers",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        role: { in: ["INTERVIEWER", "RECRUITER"] },
      },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        profilePhotoFile: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    res.json({ success: true, data: users });
  }),
);

router.get(
  "/audit-logs",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.entityType) where.entityType = String(req.query.entityType).trim();
    if (req.query.action) {
      where.action = { contains: String(req.query.action).trim(), mode: "insensitive" };
    }
    if (req.query.actorUserId) where.actorUserId = String(req.query.actorUserId).trim();

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

router.post(
  "/",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { fullName, email, phone, password, role } = req.body;

    if (!fullName || !email || !password || !role) {
      throw new ApiError(400, "fullName, email, password, and role are required");
    }
    if (!allowedRoles.includes(role)) {
      throw new ApiError(400, "Invalid role");
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (existing) {
      throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        passwordHash,
        role,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_USER",
      entityType: "USER",
      entityId: user.id,
      newData: user,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: user });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, email, phone = null, role } = req.body;

    if (!fullName || !email || !role) {
      throw new ApiError(400, "fullName, email, and role are required");
    }
    if (!allowedRoles.includes(role)) {
      throw new ApiError(400, "Invalid role");
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    });
    if (!existing) {
      throw new ApiError(404, "User not found");
    }

    const duplicate = await prisma.user.findFirst({
      where: {
        id: { not: id },
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "User with this email already exists");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        fullName,
        email,
        phone,
        role,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_USER",
      entityType: "USER",
      entityId: id,
      oldData: {
        fullName: existing.fullName,
        email: existing.email,
        phone: existing.phone,
        role: existing.role,
      },
      newData: {
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: updated });
  }),
);

router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "PENDING"].includes(status)) {
      throw new ApiError(400, "status must be ACTIVE, INACTIVE or PENDING");
    }
    if (id === req.user.id && status === "INACTIVE") {
      throw new ApiError(400, "You cannot deactivate your own account");
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, "User not found");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_USER_STATUS",
      entityType: "USER",
      entityId: id,
      oldData: { status: existing.status },
      newData: { status: updated.status },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: updated });
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
      throw new ApiError(400, "Photo file is required (field: file)");
    }

    const cloudinaryUrl = req.file.path;

    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey: cloudinaryUrl,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "image/jpeg",
        sizeBytes: BigInt(req.file.size || 0),
        uploadedById: req.user.id,
      },
    });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { profilePhotoFileId: fileMeta.id },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_USER_PHOTO",
      entityType: "USER",
      entityId: req.user.id,
      newData: { fileId: fileMeta.id, url: cloudinaryUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: {
        fileId: fileMeta.id,
        url: cloudinaryUrl,
      },
    });
  }),
);

router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (id === req.user.id) {
      throw new ApiError(400, "You cannot delete your own account");
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (!existing) {
      throw new ApiError(404, "User not found");
    }

    try {
      await prisma.user.delete({ where: { id } });

      await logAudit({
        actorUserId: req.user.id,
        action: "DELETE_USER",
        entityType: "USER",
        entityId: id,
        oldData: existing,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
      // P2003 is Prisma's error code for Foreign Key constraint failed
      if (err.code === "P2003") {
        throw new ApiError(
          400,
          "Cannot delete user: this account is linked to existing records (jobs, candidates, or audits). Deactivate the account instead.",
        );
      }
      throw err;
    }
  }),
);

module.exports = router;
