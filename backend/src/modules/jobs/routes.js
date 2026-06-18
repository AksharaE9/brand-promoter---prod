const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins } = require("../../utils/notifications");

const router = express.Router();

router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const jobs = await prisma.job.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: jobs });
  }),
);

router.use(auth);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const cursor = req.query.cursor?.trim();
    const orgId = req.user.organizationId || "defaultOrg";
    const { getCached } = require("../../utils/cache");
    const cacheKeyStr = `jobs:list:${orgId}:${cursor || "start"}:${limit}:${req.query.isActive || ""}:${req.query.search || ""}`;

    const result = await getCached(cacheKeyStr, async () => {
      const where = {
        organizationId: orgId
      };
      if (req.query.isActive === "true") where.isActive = true;
      if (req.query.isActive === "false") where.isActive = false;

      if (req.query.search) {
        const search = req.query.search.trim();
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { department: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } }
        ];
      }

      const queryOptions = {
        where,
        take: limit + 1,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          department: true,
          location: true,
          employmentType: true,
          experienceMin: true,
          experienceMax: true,
          openingsCount: true,
          isActive: true,
          createdAt: true
        }
      };

      if (cursor) {
        queryOptions.cursor = { id: cursor };
        queryOptions.skip = 1;
      }

      const items = await prisma.job.findMany(queryOptions);
      const hasMore = items.length > limit;
      if (hasMore) {
        items.pop();
      }

      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      return { data: items, nextCursor, hasMore };
    }, 120000);

    res.json({ success: true, ...result });
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
        experienceMin: experienceMin ? parseFloat(experienceMin) : null,
        experienceMax: experienceMax ? parseFloat(experienceMax) : null,
        openingsCount: Number(openingsCount),
        description,
        isActive: true,
        createdById: req.user.id,
        organizationId: req.user.organizationId || "defaultOrg",
      },
    });

    res.status(201).json({ success: true, data: job });

    setImmediate(async () => {
      try {
        const orgId = req.user.organizationId || "defaultOrg";
        const inv = require("../../utils/cacheInvalidation");
        await inv.job(orgId, job.id);

        await notifyAdmins({
          title: "New Job Posted",
          message: `A new job "${title}" has been posted by ${req.user.fullName}`,
          type: "JOB_POSTED",
          link: `/jobs/${job.id}`,
        });

        const sse = require("../../utils/sse");
        sse.broadcastToOrg(orgId, "JOB_CREATED", {
          jobId: job.id,
          title,
          status: "ACTIVE",
          createdBy: req.user.id,
          createdByName: req.user.fullName,
        });
      } catch (err) {
        console.error("[CreateJob] Async side-effects failed:", err.message);
      }
    });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) throw new ApiError(404, "Job not found");
    res.json({ success: true, data: job });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { id: _id, ...updateData } = req.body;

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Job not found");

    await prisma.job.update({ where: { id }, data: updateData });

    res.json({ success: true, message: "Job updated successfully" });

    setImmediate(async () => {
      try {
        const orgId = req.user.organizationId || "defaultOrg";
        const inv = require("../../utils/cacheInvalidation");
        await inv.job(orgId, id);

        const sse = require("../../utils/sse");
        sse.broadcastToOrg(orgId, "JOB_UPDATED", {
          jobId: id,
          changes: updateData,
          updatedBy: req.user.id,
        });
      } catch (err) {
        console.error("[UpdateJob] Async side-effects failed:", err.message);
      }
    });
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

    res.json({ success: true, data: updated });

    setImmediate(async () => {
      try {
        const orgId = req.user.organizationId || "defaultOrg";
        const inv = require("../../utils/cacheInvalidation");
        await inv.job(orgId, id);

        logAudit({
          actorUserId: req.user.id,
          action: "UPDATE_JOB_STATUS",
          entityType: "JOB",
          entityId: id,
          oldData: { isActive: existing.isActive },
          newData: { isActive },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        const sse = require("../../utils/sse");
        sse.broadcastToOrg(orgId, "JOB_STATUS_CHANGED", {
          jobId: id,
          status: isActive ? "ACTIVE" : "INACTIVE",
          changedBy: req.user.id,
          changedByName: req.user.fullName,
        });
      } catch (err) {
        console.error("[UpdateJobStatus] Async side-effects failed:", err.message);
      }
    });
  }),
);

// ── Job Documents ──────────────────────────────────────────────────────────────

router.get(
  "/:id/documents",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const documents = await prisma.jobDocument.findMany({
      where: { jobId: req.params.id },
      orderBy: { uploadedAt: "desc" },
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
    const doc = await prisma.jobDocument.create({
      data: {
        jobId: id,
        type,
        googleDriveLink,
        uploadedById: req.user.id,
        uploadedByName: req.user.fullName,
      },
    });
    res.status(201).json({ success: true, data: doc });
  })
);

router.put(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { googleDriveLink } = req.body;
    const doc = await prisma.jobDocument.update({
      where: { id: docId },
      data: { googleDriveLink },
    });
    res.json({ success: true, data: doc });
  })
);

router.delete(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    await prisma.jobDocument.delete({ where: { id: req.params.docId } });
    res.json({ success: true });
  })
);

// ── Job Questions ──────────────────────────────────────────────────────────────

router.get(
  "/:id/questions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const questions = await prisma.jobQuestion.findMany({
      where: { jobId: req.params.id },
      orderBy: { createdAt: "desc" },
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
    const q = await prisma.jobQuestion.create({
      data: {
        jobId: id,
        question,
        competency: competency || null,
        difficulty: difficulty || null,
        addedById: req.user.id,
        addedByName: req.user.fullName,
      },
    });
    res.status(201).json({ success: true, data: q });
  })
);

router.put(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { question, competency, difficulty } = req.body;
    const q = await prisma.jobQuestion.update({
      where: { id: questionId },
      data: { question, competency, difficulty },
    });
    res.json({ success: true, data: q });
  })
);

router.delete(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    await prisma.jobQuestion.delete({ where: { id: req.params.questionId } });
    res.json({ success: true });
  })
);

module.exports = router;
