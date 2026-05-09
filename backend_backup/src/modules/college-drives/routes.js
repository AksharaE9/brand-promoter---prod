const express = require("express");
const XLSX = require("xlsx");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();
router.use(auth);

const CAN_ACCESS = ["SUPER_ADMIN", "RECRUITER", "INTERVIEWER"];

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function normalizeText(value) {
  return String(value || "").trim();
}

function parseDateInput(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

async function ensureDriveAccess(driveId, userId, role) {
  const drive = await prisma.collegeDrive.findUnique({
    where: { id: driveId },
    include: {
      recruiters: { select: { userId: true } },
    },
  });

  if (!drive) {
    throw new ApiError(404, "College drive not found");
  }

  if (role === "SUPER_ADMIN") return drive;

  const assigned = drive.recruiters.some((item) => item.userId === userId);
  if (drive.ownerId !== userId && !assigned) {
    throw new ApiError(403, "You are not assigned to this college drive");
  }

  return drive;
}

router.get(
  "/colleges",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const colleges = await prisma.college.findMany({
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: {
            drives: true,
            candidates: true,
          },
        },
      },
    });

    res.json({ success: true, data: colleges });
  }),
);

router.post(
  "/colleges",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const name = normalizeText(req.body?.name);
    const location = normalizeText(req.body?.location) || null;

    if (!name) {
      throw new ApiError(400, "College name is required");
    }

    const existing = await prisma.college.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        location,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ApiError(409, "College already exists");
    }

    const created = await prisma.college.create({
      data: {
        name,
        location,
        createdById: req.user.id,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_COLLEGE",
      entityType: "COLLEGE",
      entityId: created.id,
      newData: created,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: created });
  }),
);

router.patch(
  "/colleges/:id",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid college ID");

    const name = normalizeText(req.body?.name);
    const location = normalizeText(req.body?.location) || null;

    const existing = await prisma.college.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "College not found");

    const updated = await prisma.college.update({
      where: { id },
      data: {
        name: name || existing.name,
        location,
      },
    });

    res.json({ success: true, data: updated });
  }),
);

router.get(
  "/drives",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { collegeId } = req.query;
    const where = {};
    if (collegeId && isUUID(collegeId)) where.collegeId = collegeId;

    const drives = await prisma.collegeDrive.findMany({
      where,
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
      include: {
        college: { select: { id: true, name: true, location: true } },
        owner: { select: { id: true, fullName: true, role: true } },
        recruiters: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
          orderBy: { assignedAt: "asc" },
        },
        linkedJobs: {
          include: {
            job: { select: { id: true, title: true, department: true } }
          }
        },
        _count: {
          select: { candidates: true },
        },
      },
    });

    res.json({ success: true, data: drives });
  }),
);

router.post(
  "/drives",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const title = normalizeText(req.body?.title);
    const collegeId = req.body?.collegeId;
    const notes = normalizeText(req.body?.notes) || null;
    const status = normalizeText(req.body?.status) || "PLANNED";
    const dateFrom = parseDateInput(req.body?.dateFrom);
    const dateTo = parseDateInput(req.body?.dateTo);

    if (!title || !collegeId || !isUUID(collegeId) || !dateFrom) {
      throw new ApiError(400, "title, collegeId, and valid dateFrom are required");
    }

    const college = await prisma.college.findUnique({ where: { id: collegeId }, select: { id: true } });
    if (!college) throw new ApiError(404, "College not found");

    const drive = await prisma.collegeDrive.create({
      data: {
        title,
        collegeId,
        dateFrom,
        dateTo,
        status,
        notes,
        ownerId: req.user.id,
        recruiters: {
          create: [{ userId: req.user.id }],
        },
      },
      include: {
        college: true,
        recruiters: {
          include: {
            user: { select: { id: true, fullName: true, role: true, email: true } },
          },
        },
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_COLLEGE_DRIVE",
      entityType: "COLLEGE_DRIVE",
      entityId: drive.id,
      newData: { title, collegeId, dateFrom, dateTo, status },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: drive });
  }),
);

router.patch(
  "/drives/:id",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid drive ID");

    const drive = await ensureDriveAccess(id, req.user.id, req.user.role);
    const title = normalizeText(req.body?.title) || drive.title;
    const notes = normalizeText(req.body?.notes) || null;
    const status = normalizeText(req.body?.status) || drive.status;
    const dateFrom = parseDateInput(req.body?.dateFrom) || drive.dateFrom;
    const dateTo = parseDateInput(req.body?.dateTo);

    const updated = await prisma.collegeDrive.update({
      where: { id },
      data: {
        title,
        notes,
        status,
        dateFrom,
        dateTo,
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// FEATURE 6: Link Jobs to Drive
router.post(
  "/drives/:id/jobs",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");
    
    await ensureDriveAccess(driveId, req.user.id, req.user.role);
    
    const { jobIds } = req.body;
    if (!jobIds || !Array.isArray(jobIds)) {
      throw new ApiError(400, "jobIds array is required");
    }

    const data = jobIds.map(jobId => ({ driveId, jobId }));
    
    await prisma.collegeDriveJob.createMany({
      data,
      skipDuplicates: true
    });

    res.status(201).json({ success: true, message: "Jobs linked successfully" });
  })
);

router.delete(
  "/drives/:id/jobs/:jobId",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { id: driveId, jobId } = req.params;
    if (!isUUID(driveId) || !isUUID(jobId)) throw new ApiError(400, "Invalid IDs");

    await ensureDriveAccess(driveId, req.user.id, req.user.role);

    await prisma.collegeDriveJob.delete({
      where: {
        driveId_jobId: { driveId, jobId }
      }
    });

    res.json({ success: true, message: "Job unlinked successfully" });
  })
);

router.post(
  "/drives/:id/recruiters",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");

    await ensureDriveAccess(driveId, req.user.id, req.user.role);

    const recruiterIds = Array.isArray(req.body?.recruiterIds) ? req.body.recruiterIds.filter((id) => isUUID(id)) : [];

    const validUsers = await prisma.user.findMany({
      where: {
        id: { in: recruiterIds },
        role: { in: ["RECRUITER", "INTERVIEWER", "SUPER_ADMIN"] },
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const validSet = new Set(validUsers.map((item) => item.id));
    if (!validSet.has(req.user.id)) {
      validSet.add(req.user.id);
    }

    await prisma.$transaction(async (tx) => {
      await tx.collegeDriveRecruiter.deleteMany({ where: { driveId } });
      if (validSet.size > 0) {
        await tx.collegeDriveRecruiter.createMany({
          data: Array.from(validSet).map((userId) => ({ driveId, userId })),
          skipDuplicates: true,
        });
      }
    });

    const assigned = await prisma.collegeDriveRecruiter.findMany({
      where: { driveId },
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { assignedAt: "asc" },
    });

    res.json({ success: true, data: assigned });
  }),
);

router.get(
  "/drives/:id/candidates",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");

    await ensureDriveAccess(driveId, req.user.id, req.user.role);

    const list = await prisma.collegeDriveCandidate.findMany({
      where: { driveId },
      orderBy: { createdAt: "desc" },
      include: {
        candidate: {
          include: {
            _count: { select: { applications: true } },
            applications: {
              select: {
                id: true,
                status: true,
                currentStage: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        addedBy: {
          select: { id: true, fullName: true, role: true },
        },
      },
    });

    const summary = list.reduce((acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { total: 0 });

    res.json({ success: true, data: list, summary });
  }),
);

router.post(
  "/drives/:id/candidates",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");

    const drive = await ensureDriveAccess(driveId, req.user.id, req.user.role);

    const fullName = normalizeText(req.body?.fullName);
    const email = normalizeText(req.body?.email) || null;
    const phone = normalizeText(req.body?.phone) || null;
    const currentCompany = normalizeText(req.body?.currentCompany) || null;
    const totalExperienceYears = req.body?.totalExperienceYears ? Number(req.body.totalExperienceYears) : null;

    if (!fullName || (!email && !phone)) {
      throw new ApiError(400, "fullName and at least one of email/phone are required");
    }

    const duplicateConditions = [];
    if (email) duplicateConditions.push({ email: { equals: email, mode: "insensitive" } });
    if (phone) duplicateConditions.push({ phone });

    let candidate = await prisma.candidate.findFirst({
      where: duplicateConditions.length > 0 ? { OR: duplicateConditions } : undefined,
      select: { id: true },
    });

    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: {
          fullName,
          email,
          phone,
          currentCompany,
          totalExperienceYears,
          source: `College Drive - ${drive.title}`,
          category: "College Drive",
          collegeId: drive.collegeId,
          collegeDriveId: driveId,
          createdById: req.user.id,
        },
        select: { id: true },
      });
    } else {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          category: "College Drive",
          collegeId: drive.collegeId,
          collegeDriveId: driveId,
        },
      });
    }

    const link = await prisma.collegeDriveCandidate.upsert({
      where: {
        driveId_candidateId: {
          driveId,
          candidateId: candidate.id,
        },
      },
      update: {
        status: req.body?.status || "ADDED",
        note: normalizeText(req.body?.note) || null,
      },
      create: {
        driveId,
        candidateId: candidate.id,
        status: req.body?.status || "ADDED",
        note: normalizeText(req.body?.note) || null,
        addedById: req.user.id,
      },
      include: {
        candidate: true,
      },
    });

    res.status(201).json({ success: true, data: link });
  }),
);

router.patch(
  "/drives/:driveId/candidates/:candidateId/status",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { driveId, candidateId } = req.params;
    if (!isUUID(driveId) || !isUUID(candidateId)) {
      throw new ApiError(400, "Invalid drive or candidate ID");
    }

    await ensureDriveAccess(driveId, req.user.id, req.user.role);

    const status = normalizeText(req.body?.status);
    const note = normalizeText(req.body?.note) || null;

    if (!status) throw new ApiError(400, "status is required");

    const updated = await prisma.collegeDriveCandidate.update({
      where: {
        driveId_candidateId: {
          driveId,
          candidateId,
        },
      },
      data: {
        status,
        note,
      },
      include: {
        candidate: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    res.json({ success: true, data: updated });
  }),
);

router.post(
  "/drives/:id/bulk-upload",
  requireRoles(...CAN_ACCESS),
  memoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");
    const drive = await ensureDriveAccess(driveId, req.user.id, req.user.role);

    if (!req.file) {
      throw new ApiError(400, "Excel file is required (field: file)");
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const fullName = normalizeText(row.fullName || row.name);
      const email = normalizeText(row.email) || null;
      const phone = normalizeText(row.phone) || null;

      if (!fullName || (!email && !phone)) {
        skipped += 1;
        errors.push({ row: i + 2, error: "fullName and email/phone are required" });
        continue;
      }

      const duplicateConditions = [];
      if (email) duplicateConditions.push({ email: { equals: email, mode: "insensitive" } });
      if (phone) duplicateConditions.push({ phone });

      let candidate = await prisma.candidate.findFirst({
        where: duplicateConditions.length > 0 ? { OR: duplicateConditions } : undefined,
        select: { id: true },
      });

      if (!candidate) {
        candidate = await prisma.candidate.create({
          data: {
            fullName,
            email,
            phone,
            currentCompany: normalizeText(row.currentCompany) || null,
            source: normalizeText(row.source) || `College Drive - ${drive.title}`,
            category: "College Drive",
            collegeId: drive.collegeId,
            collegeDriveId: driveId,
            createdById: req.user.id,
          },
          select: { id: true },
        });
      }

      const existingLink = await prisma.collegeDriveCandidate.findUnique({
        where: {
          driveId_candidateId: {
            driveId,
            candidateId: candidate.id,
          },
        },
        select: { id: true },
      });

      if (existingLink) {
        skipped += 1;
        continue;
      }

      await prisma.collegeDriveCandidate.create({
        data: {
          driveId,
          candidateId: candidate.id,
          status: "ADDED",
          note: normalizeText(row.note) || null,
          addedById: req.user.id,
        },
      });

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          category: "College Drive",
          collegeId: drive.collegeId,
          collegeDriveId: driveId,
        },
      });

      inserted += 1;
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "BULK_UPLOAD_COLLEGE_DRIVE_CANDIDATES",
      entityType: "COLLEGE_DRIVE",
      entityId: driveId,
      newData: { inserted, skipped, totalRows: rows.length },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: {
        totalRows: rows.length,
        inserted,
        skipped,
        errors,
      },
    });
  }),
);

router.get(
  "/drives/:id/timeline",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!isUUID(driveId)) throw new ApiError(400, "Invalid drive ID");

    await ensureDriveAccess(driveId, req.user.id, req.user.role);

    const driveCandidates = await prisma.collegeDriveCandidate.findMany({
      where: { driveId },
      include: {
        candidate: {
          select: {
            id: true,
            fullName: true,
            applications: {
              select: {
                id: true,
                status: true,
                currentStage: { select: { id: true, name: true } },
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: "desc" },
            },
          },
        },
        addedBy: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const timeline = [];
    driveCandidates.forEach((item) => {
      timeline.push({
        type: "DRIVE_CANDIDATE_STATUS",
        at: item.updatedAt,
        candidate: { id: item.candidate.id, fullName: item.candidate.fullName },
        status: item.status,
        note: item.note,
        addedBy: item.addedBy,
      });

      item.candidate.applications.forEach((application) => {
        timeline.push({
          type: "APPLICATION_UPDATE",
          at: application.updatedAt,
          candidate: { id: item.candidate.id, fullName: item.candidate.fullName },
          applicationId: application.id,
          applicationStatus: application.status,
          stage: application.currentStage?.name || null,
        });
      });
    });

    timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({ success: true, data: timeline });
  }),
);

module.exports = router;
