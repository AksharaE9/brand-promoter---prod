const express = require("express");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");

const router = express.Router();

router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const jobs = await prisma.job.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        department: true,
        location: true,
        employmentType: true,
        description: true,
      },
    });

    res.json({ success: true, data: jobs });
  }),
);

router.use(auth);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.isActive === "true") where.isActive = true;
    if (req.query.isActive === "false") where.isActive = false;
    if (req.query.search) {
      where.OR = [
        { title: { contains: req.query.search, mode: "insensitive" } },
        { department: { contains: req.query.search, mode: "insensitive" } },
        { location: { contains: req.query.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { applications: true },
          },
        },
      }),
      prisma.job.count({ where }),
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
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const {
      title,
      department = null,
      location = null,
      employmentType = null,
      experienceMin = null,
      experienceMax = null,
      openingsCount = 1,
      description = null,
    } = req.body;

    if (!title) throw new ApiError(400, "title is required");

    const job = await prisma.job.create({
      data: {
        title,
        department,
        location,
        employmentType,
        experienceMin,
        experienceMax,
        openingsCount,
        description,
        createdById: req.user.id,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_JOB",
      entityType: "JOB",
      entityId: job.id,
      newData: job,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await notifyAdmins({
      title: 'New Job Posted',
      message: `${job.title} has been created in ${job.department || 'General'}`,
      link: `/jobs`
    });

    await sendNotification({
      userId: req.user.id,
      title: 'Job Created',
      message: `You successfully posted the ${job.title} position.`,
      link: `/jobs`
    });

    res.status(201).json({ success: true, data: job });
  }),
);

router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      throw new ApiError(400, "isActive must be boolean");
    }

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Job not found");

    const updated = await prisma.job.update({
      where: { id },
      data: { isActive },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_JOB_STATUS",
      entityType: "JOB",
      entityId: id,
      oldData: { isActive: existing.isActive },
      newData: { isActive: updated.isActive },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: updated });
  }),
);

// FEATURE 1: Job Documents
router.get(
  "/:id/documents",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const documents = await prisma.jobDocument.findMany({
      where: { jobId: id },
      include: {
        uploadedBy: { select: { fullName: true } }
      },
      orderBy: { uploadedAt: "desc" }
    });
    res.json({ success: true, data: documents });
  })
);

router.post(
  "/:id/documents",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type, googleDriveLink } = req.body;
    
    if (!type || !googleDriveLink) {
      throw new ApiError(400, "type and googleDriveLink are required");
    }

    const document = await prisma.jobDocument.create({
      data: {
        jobId: id,
        type,
        googleDriveLink,
        uploadedById: req.user.id
      },
      include: {
        uploadedBy: { select: { fullName: true } }
      }
    });

    res.status(201).json({ success: true, data: document });
  })
);

router.put(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { googleDriveLink } = req.body;

    const document = await prisma.jobDocument.update({
      where: { id: docId },
      data: { googleDriveLink },
      include: {
        uploadedBy: { select: { fullName: true } }
      }
    });

    res.json({ success: true, data: document });
  })
);

router.delete(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    await prisma.jobDocument.delete({ where: { id: docId } });
    res.json({ success: true });
  })
);

// FEATURE 1: Job Questions
router.get(
  "/:id/questions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const questions = await prisma.jobQuestion.findMany({
      where: { jobId: id },
      include: {
        addedBy: { select: { fullName: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: questions });
  })
);

router.post(
  "/:id/questions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { question, competency, difficulty } = req.body;

    if (!question) throw new ApiError(400, "question is required");

    const newQuestion = await prisma.jobQuestion.create({
      data: {
        jobId: id,
        question,
        competency,
        difficulty,
        addedById: req.user.id
      },
      include: {
        addedBy: { select: { fullName: true } }
      }
    });

    res.status(201).json({ success: true, data: newQuestion });
  })
);

router.put(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { question, competency, difficulty } = req.body;

    const updated = await prisma.jobQuestion.update({
      where: { id: questionId },
      data: { question, competency, difficulty },
      include: {
        addedBy: { select: { fullName: true } }
      }
    });

    res.json({ success: true, data: updated });
  })
);

router.delete(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    await prisma.jobQuestion.delete({ where: { id: questionId } });
    res.json({ success: true });
  })
);

module.exports = router;
