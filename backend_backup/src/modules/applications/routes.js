const express = require("express");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");

const router = express.Router();

router.use(auth);

async function resolveDefaultStage(jobId) {
  const jobStage = await prisma.pipelineStage.findFirst({
    where: { jobId },
    orderBy: { sortOrder: "asc" },
  });
  if (jobStage) return jobStage;

  const globalAdded = await prisma.pipelineStage.findFirst({
    where: { jobId: null, name: { equals: "Added", mode: "insensitive" } },
    orderBy: { sortOrder: "asc" },
  });
  if (globalAdded) return globalAdded;

  return prisma.pipelineStage.findFirst({
    where: { jobId: null },
    orderBy: { sortOrder: "asc" },
  });
}

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { candidateId, jobId, currentStageId, shortlisted = false } = req.body;

    if (!candidateId || !jobId) {
      throw new ApiError(400, "candidateId and jobId are required");
    }

    const [candidate, job] = await Promise.all([
      prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } }),
      prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }),
    ]);
    if (!candidate) throw new ApiError(404, "Candidate not found");
    if (!job) throw new ApiError(404, "Job not found");

    const duplicate = await prisma.application.findUnique({
      where: { candidateId_jobId: { candidateId, jobId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "Application already exists for this candidate and job");
    }

    let stageId = currentStageId;
    if (!stageId) {
      const defaultStage = await resolveDefaultStage(jobId);
      if (!defaultStage) {
        throw new ApiError(400, "No pipeline stages found. Create stages first.");
      }
      stageId = defaultStage.id;
    }

    const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new ApiError(404, "Selected stage not found");
    if (stage.jobId && stage.jobId !== jobId) {
      throw new ApiError(400, "Stage does not belong to selected job");
    }

    const application = await prisma.application.create({
      data: {
        candidateId,
        jobId,
        currentStageId: stage.id,
        shortlisted,
      },
      include: {
        candidate: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            profilePhotoFile: {
              select: {
                id: true,
                storageKey: true,
              },
            },
          },
        },
        job: { select: { id: true, title: true } },
        currentStage: true,
      },
    });

    await prisma.pipelineEvent.create({
      data: {
        applicationId: application.id,
        fromStageId: null,
        toStageId: stage.id,
        remark: "Application created",
        movedById: req.user.id,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_APPLICATION",
      entityType: "APPLICATION",
      entityId: application.id,
      newData: { candidateId, jobId, currentStageId: stage.id },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await notifyAdmins({
      title: 'New Application',
      message: `${application.candidate.fullName} applied for ${application.job.title}`,
      link: `/candidates/${candidateId}`
    });

    await sendNotification({
      userId: req.user.id,
      title: 'Application Created',
      message: `You added ${application.candidate.fullName} to ${application.job.title}`,
      link: `/candidates/${candidateId}`
    });

    res.status(201).json({ success: true, data: application });
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.jobId) where.jobId = req.query.jobId;
    if (req.query.candidateId) where.candidateId = req.query.candidateId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.shortlisted === "true") where.shortlisted = true;
    if (req.query.shortlisted === "false") where.shortlisted = false;

    const [items, total] = await Promise.all([
      prisma.application.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          candidate: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              profilePhotoFile: {
                select: {
                  id: true,
                  storageKey: true,
                },
              },
            },
          },
          job: { select: { id: true, title: true } },
          currentStage: {
            select: { id: true, name: true, sortOrder: true },
          },
        },
      }),
      prisma.application.count({ where }),
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

router.patch(
  "/:id/shortlist",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { shortlisted } = req.body || {};

    if (typeof shortlisted !== "boolean") {
      throw new ApiError(400, "shortlisted must be boolean");
    }

    const existing = await prisma.application.findUnique({
      where: { id },
      select: {
        id: true,
        shortlisted: true,
        candidateId: true,
        jobId: true,
      },
    });
    if (!existing) throw new ApiError(404, "Application not found");

    const updated = await prisma.application.update({
      where: { id },
      data: { shortlisted },
      include: {
        candidate: { select: { id: true, fullName: true, email: true, phone: true } },
        job: { select: { id: true, title: true } },
        currentStage: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: shortlisted ? "SHORTLIST_APPLICATION" : "UNSHORTLIST_APPLICATION",
      entityType: "APPLICATION",
      entityId: id,
      oldData: { shortlisted: existing.shortlisted },
      newData: { shortlisted: updated.shortlisted },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    if (shortlisted) {
      await notifyAdmins({
        title: 'Candidate Shortlisted',
        message: `${updated.candidate.fullName} has been shortlisted for ${updated.job.title}`,
        link: `/candidates/${updated.candidateId}`
      });
    }

    res.json({ success: true, data: updated });
  }),
);

module.exports = router;
