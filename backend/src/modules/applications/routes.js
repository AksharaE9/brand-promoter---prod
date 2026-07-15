const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const sse = require("../../utils/sse");
const inv = require("../../utils/cacheInvalidation");

const router = express.Router();
router.use(auth);

// ── Offer Decision Routes ──────────────────────────────────────────────────────
const { markAsJoined, markAsRejected } = require("./offerDecisionService");
router.post("/:applicationId/join",  requireRoles("SUPER_ADMIN", "RECRUITER"), markAsJoined);
router.post("/:applicationId/reject", requireRoles("SUPER_ADMIN", "RECRUITER"), markAsRejected);

async function resolveDefaultStage(jobId) {
  let stage = await prisma.pipelineStage.findFirst({
    where: { jobId },
    orderBy: { sortOrder: "asc" },
  });
  if (!stage) {
    stage = await prisma.pipelineStage.findFirst({
      where: { jobId: null },
      orderBy: { sortOrder: "asc" },
    });
  }
  return stage;
}

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { candidateId, jobId, currentStageId, shortlisted = false } = req.body;
    if (!candidateId || !jobId) throw new ApiError(400, "candidateId and jobId are required");

    const [candidate, job] = await Promise.all([
      prisma.candidate.findUnique({ where: { id: candidateId } }),
      prisma.job.findUnique({ where: { id: jobId } }),
    ]);

    if (!candidate) throw new ApiError(404, "Candidate not found");
    if (!job) throw new ApiError(404, "Job not found");

    const duplicate = await prisma.application.findFirst({
      where: { candidateId, jobId },
    });
    if (duplicate) {
      return res.status(200).json({ success: true, data: duplicate });
    }

    let stageId = currentStageId;
    if (!stageId) {
      const defaultStage = await resolveDefaultStage(jobId);
      if (!defaultStage) throw new ApiError(400, "No pipeline stages found. Create stages first.");
      stageId = defaultStage.id;
    }

    const orgId = req.user.organizationId || "defaultOrg";

    const application = await prisma.application.create({
      data: {
        candidateId,
        jobId,
        currentStageId: stageId,
        shortlisted,
        status: "IN_PIPELINE",
        organizationId: orgId,
        isDeleted: false,
      },
    });

    await prisma.pipelineEvent.create({
      data: {
        applicationId: application.id,
        fromStageId: null,
        toStageId: stageId,
        remark: "Application created",
        movedById: req.user.id,
        movedByName: req.user.fullName,
        movedAt: new Date(),
      },
    });

    // Invalidate cache before returning response to avoid race conditions
    await inv.application(orgId, candidateId);

    res.status(201).json({ success: true, data: application });

    setImmediate(async () => {
      try {
        sse.broadcastToOrg(orgId, "APPLICATION_CREATED", {
          applicationId: application.id,
          candidateId,
          candidateName: candidate.fullName,
          jobId,
          jobTitle: job.title,
          createdBy: req.user.id,
          createdByName: req.user.fullName,
        });

        logAudit({
          actorUserId: req.user.id,
          action: "CREATE_APPLICATION",
          entityType: "APPLICATION",
          entityId: application.id,
          newData: application,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        await notifyAdmins({
          title: "New Application",
          message: `${candidate.fullName} applied for ${job.title}`,
          link: `/candidates/${candidateId}`,
        });
      } catch (err) {
        console.error("[CreateApplication] Async side-effects failed:", err.message);
      }
    });
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const orgId = req.user.organizationId || "defaultOrg";

    const where = { organizationId: orgId, isDeleted: false };
    if (req.query.jobId) where.jobId = req.query.jobId;
    if (req.query.candidateId) where.candidateId = req.query.candidateId;
    if (req.query.stageId) where.currentStageId = req.query.stageId;

    const cacheKeyStr = `applications:list:${orgId}:${limit}:${req.query.jobId || ''}:${req.query.candidateId || ''}:${req.query.stageId || ''}`;
    const { getCached } = require("../../utils/cache");

    const data = await getCached(cacheKeyStr, async () => {
      return await prisma.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          candidate: { select: { id: true, fullName: true, email: true, phone: true } },
          job: { select: { id: true, title: true, department: true } },
          currentStage: { select: { id: true, name: true, sortOrder: true } },
        },
      });
    }, 30000);

    res.json({ success: true, data, hasMore: data.length === limit });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        candidate: true,
        job: true,
        currentStage: true,
      },
    });
    if (!application) throw new ApiError(404, "Application not found");
    res.json({ success: true, data: application });
  }),
);

router.patch(
  "/:id/shortlist",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { shortlisted } = req.body || {};
    if (typeof shortlisted !== "boolean") throw new ApiError(400, "shortlisted must be boolean");

    const existing = await prisma.application.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Application not found");

    await prisma.application.update({ where: { id }, data: { shortlisted } });

    const orgId = req.user.organizationId || "defaultOrg";
    await inv.application(orgId, existing.candidateId);

    res.json({ success: true, data: { id, ...existing, shortlisted } });

    setImmediate(async () => {
      try {
        sse.broadcastToOrg(orgId, "APPLICATION_UPDATED", {
          applicationId: id,
          candidateId: existing.candidateId,
          changes: { shortlisted },
          updatedBy: req.user.id,
        });

        logAudit({
          actorUserId: req.user.id,
          action: shortlisted ? "SHORTLIST_APPLICATION" : "UNSHORTLIST_APPLICATION",
          entityType: "APPLICATION",
          entityId: id,
          oldData: { shortlisted: existing.shortlisted },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      } catch (err) {
        console.error("[ShortlistApplication] Async side-effects failed:", err.message);
      }
    });
  }),
);

router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, joiningDate } = req.body;
    if (!status) throw new ApiError(400, "status is required");

    const existing = await prisma.application.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Application not found");

    const updateData = { status };
    if (joiningDate) updateData.joiningDate = joiningDate;

    await prisma.application.update({ where: { id }, data: updateData });

    // Sync candidate status for sidebar views
    if (["JOINED", "REJECTED", "OFFER_SENT"].includes(status)) {
      const candUpdate = { status };
      if (status === "JOINED" && joiningDate) candUpdate.doj = joiningDate;
      await prisma.candidate.update({ where: { id: existing.candidateId }, data: candUpdate });
    }

    const orgId = req.user.organizationId || "defaultOrg";
    await inv.application(orgId, existing.candidateId);

    res.json({ success: true, data: { id, status } });

    setImmediate(async () => {
      try {
        logAudit({
          actorUserId: req.user.id,
          action: "UPDATE_APPLICATION_STATUS",
          entityType: "APPLICATION",
          entityId: id,
          oldData: { status: existing.status },
          newData: { status },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        sse.broadcastToOrg(orgId, "APPLICATION_STATUS_CHANGED", {
          applicationId: id,
          candidateId: existing.candidateId,
          status,
          changedBy: req.user.id,
        });
      } catch (err) {
        console.error("[UpdateApplicationStatus] Async side-effects failed:", err.message);
      }
    });
  }),
);

module.exports = router;
