const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const sse = require("../../utils/sse");
const inv = require("../../utils/cacheInvalidation");
const { getCached } = require("../../utils/cache");

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
    const cacheKey = `pipeline:stages:${jobId || "global"}`;

    const stages = await getCached(cacheKey, async () => {
      const where = jobId
        ? { OR: [{ jobId }, { jobId: null }] }
        : { jobId: null };

      const s = await prisma.pipelineStage.findMany({
        where,
        orderBy: { sortOrder: "asc" },
      });
      return s;
    }, 120000);

    res.json({ success: true, data: stages });
  }),
);

router.post(
  "/stages",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { jobId = null, name, sortOrder, isTerminal = false } = req.body;
    if (!name || sortOrder === undefined) {
      throw new ApiError(400, "name and sortOrder are required");
    }

    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) throw new ApiError(404, "Job not found");
    }

    const stage = await prisma.pipelineStage.create({
      data: {
        jobId,
        name,
        sortOrder: Number(sortOrder),
      },
    });

    logAudit({
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
    const { toStageId, remark = null } = req.body;

    if (!toStageId) throw new ApiError(400, "toStageId is required");

    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new ApiError(404, "Application not found");

    const toStage = await prisma.pipelineStage.findUnique({ where: { id: toStageId } });
    if (!toStage) throw new ApiError(404, "Target stage not found");

    if (toStage.jobId && toStage.jobId !== application.jobId) {
      throw new ApiError(400, "Target stage does not belong to application job");
    }

    const nextStatus = deriveApplicationStatus(toStage.name);

    await prisma.application.update({
      where: { id: applicationId },
      data: { currentStageId: toStageId, status: nextStatus },
    });

    await prisma.pipelineEvent.create({
      data: {
        applicationId,
        fromStageId: application.currentStageId,
        toStageId,
        remark,
        movedById: req.user.id,
        movedByName: req.user.fullName,
        movedAt: new Date(),
      },
    });

    logAudit({
      actorUserId: req.user.id,
      action: "MOVE_PIPELINE_STAGE",
      entityType: "APPLICATION",
      entityId: applicationId,
      oldData: { currentStageId: application.currentStageId, status: application.status },
      newData: { currentStageId: toStageId, status: nextStatus },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Respond immediately
    res.json({ success: true, data: { id: applicationId, ...application, currentStageId: toStageId, status: nextStatus } });

    // Fire side effects AFTER response
    setImmediate(async () => {
      try {
        const candidate = await prisma.candidate.findUnique({ where: { id: application.candidateId }, select: { fullName: true } });
        const candidateName = candidate?.fullName || "Candidate";
        const orgId = req.user.organizationId || "defaultOrg";

        await Promise.all([
          notifyAdmins({ title: "Pipeline Update", message: `${candidateName} moved to ${toStage.name}`, link: `/candidates/${application.candidateId}` }),
          sendNotification({ userId: req.user.id, title: "Candidate Moved", message: `You moved ${candidateName} to ${toStage.name}`, link: `/candidates/${application.candidateId}` }),
          inv.application(orgId, application.candidateId),
          inv.analytics(orgId),
        ]);

        sse.broadcastToOrg(orgId, "APPLICATION_STAGE_CHANGED", {
          applicationId,
          candidateId: application.candidateId,
          fromStage: application.currentStageId,
          toStage: toStageId,
          changedBy: req.user.id,
          changedByName: req.user.fullName,
        });
      } catch (err) {
        console.error("[Pipeline] Post-move side effects error:", err.message);
      }
    });
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
    });

    res.json({ success: true, data: events });
  }),
);

module.exports = router;
