const express = require("express");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");

const router = express.Router();

router.use(auth);

function deriveApplicationStatus(stageName) {
  const normalized = (stageName || "").toLowerCase();
  if (normalized === "selected") return "SELECTED";
  if (normalized === "joined") return "JOINED";
  if (normalized === "rejected") return "REJECTED";
  return "IN_PIPELINE";
}

router.get(
  "/stages",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { jobId } = req.query;

    let stages = [];
    if (jobId) {
      stages = await prisma.pipelineStage.findMany({
        where: {
          OR: [
            { jobId },
            { jobId: null }
          ]
        },
        orderBy: { sortOrder: "asc" },
      });
    } else {
      stages = await prisma.pipelineStage.findMany({
        where: { jobId: null },
        orderBy: { sortOrder: "asc" },
      });
    }

    res.json({ success: true, data: stages });
  }),
);

router.post(
  "/stages",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { jobId = null, name, sortOrder, isTerminal = false } = req.body;
    if (!name || !sortOrder) {
      throw new ApiError(400, "name and sortOrder are required");
    }

    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) throw new ApiError(404, "Job not found");
    }

    const stage = await prisma.pipelineStage.create({
      data: {
        jobId,
        name,
        sortOrder,
        isTerminal,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_STAGE",
      entityType: "PIPELINE_STAGE",
      entityId: stage.id,
      newData: stage,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: stage });
  }),
);

router.patch(
  "/applications/:applicationId/move",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const { toStageId, remark = null, feedback = null } = req.body;

    if (!toStageId) throw new ApiError(400, "toStageId is required");

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { currentStage: true },
    });
    if (!application) throw new ApiError(404, "Application not found");

    const toStage = await prisma.pipelineStage.findUnique({ where: { id: toStageId } });
    if (!toStage) throw new ApiError(404, "Target stage not found");
    if (toStage.jobId && toStage.jobId !== application.jobId) {
      throw new ApiError(400, "Target stage does not belong to application job");
    }

    const nextStatus = deriveApplicationStatus(toStage.name);
    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        currentStageId: toStage.id,
        status: nextStatus,
      },
      include: {
        candidate: { select: { id: true, fullName: true } },
        job: { select: { id: true, title: true } },
        currentStage: true,
      },
    });

    await prisma.pipelineEvent.create({
      data: {
        applicationId,
        fromStageId: application.currentStageId,
        toStageId: toStage.id,
        remark,
        feedback,
        movedById: req.user.id,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "MOVE_PIPELINE_STAGE",
      entityType: "APPLICATION",
      entityId: applicationId,
      oldData: {
        currentStageId: application.currentStageId,
        status: application.status,
      },
      newData: {
        currentStageId: toStage.id,
        status: nextStatus,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await notifyAdmins({
      title: 'Pipeline Update',
      message: `${updated.candidate.fullName} moved to ${toStage.name} for ${updated.job.title}`,
      link: `/candidates/${updated.candidate.id}`
    });

    await sendNotification({
      userId: req.user.id,
      title: 'Candidate Moved',
      message: `You moved ${updated.candidate.fullName} to ${toStage.name}`,
      link: `/candidates/${updated.candidate.id}`
    });

    res.json({ success: true, data: updated });
  }),
);

router.get(
  "/applications/:applicationId/history",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new ApiError(404, "Application not found");

    const events = await prisma.pipelineEvent.findMany({
      where: { applicationId },
      orderBy: { movedAt: "desc" },
      include: {
        fromStage: true,
        toStage: true,
        movedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    res.json({ success: true, data: events });
  }),
);

module.exports = router;
