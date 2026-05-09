const express = require("express");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const { broadcast } = require("../../utils/sse");

const router = express.Router();

router.use(auth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function normalizeFieldKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeFieldValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return "";
  }
}

async function upsertCandidateCustomFields(candidateId, customFields = {}) {
  const entries = Object.entries(customFields || {})
    .map(([fieldKey, rawValue]) => ({
      fieldKey: normalizeFieldKey(fieldKey),
      valueText: normalizeFieldValue(rawValue),
    }))
    .filter((item) => item.fieldKey);

  if (entries.length === 0) return;

  const definitions = await prisma.customFieldDefinition.findMany({
    where: {
      entityType: "CANDIDATE",
      fieldKey: { in: entries.map((item) => item.fieldKey) },
    },
    select: { id: true, fieldKey: true },
  });
  const defsByKey = new Map(definitions.map((item) => [item.fieldKey, item]));

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const def = defsByKey.get(entry.fieldKey);
      if (!def) continue;

      await tx.customFieldValue.deleteMany({
        where: { candidateId, fieldDefinitionId: def.id },
      });

      if (entry.valueText) {
        await tx.customFieldValue.create({
          data: {
            candidateId,
            fieldDefinitionId: def.id,
            valueText: entry.valueText,
          },
        });
      }
    }
  });
}

const candidateDetailInclude = {
  skills: true,
  education: true,
  resumeFile: {
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      createdAt: true,
    },
  },
  profilePhotoFile: {
    select: {
      id: true,
      storageKey: true,
      originalName: true,
    },
  },
  applications: {
    include: {
      currentStage: {
        select: { id: true, name: true, sortOrder: true },
      },
      job: {
        select: { id: true, title: true, department: true, location: true, isActive: true },
      },
    },
    orderBy: { createdAt: "desc" },
  },
  customFieldValues: {
    include: {
      fieldDefinition: {
        select: {
          id: true,
          fieldKey: true,
          fieldLabel: true,
          fieldType: true,
          isRequired: true,
          optionsJson: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  college: {
    select: {
      id: true,
      name: true,
      location: true,
    },
  },
  collegeDrive: {
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
      status: true,
      college: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  mentor: { select: { id: true, fullName: true } },
  coordinator: { select: { id: true, fullName: true } },
};

const CANDIDATE_LIST_SELECT_V2 = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  totalExperienceYears: true,
  currentCompany: true,
  source: true,
  category: true,
  collegeId: true,
  collegeDriveId: true,
  mentorId: true,
  coordinatorId: true,
  location: true,
  area: true,
  graduationYear: true,
  preferredRole: true,
  course: true,
  doj: true,
  createdAt: true,
  college: {
    select: {
      id: true,
      name: true,
      location: true,
    },
  },
  collegeDrive: {
    select: {
      id: true,
      title: true,
      status: true,
      dateFrom: true,
    },
  },
  profilePhotoFile: {
    select: {
      id: true,
      storageKey: true,
    },
  },
  mentor: {
    select: { id: true, fullName: true }
  },
  coordinator: {
    select: { id: true, fullName: true }
  },
  applications: {
    select: {
      id: true,
      status: true,
      shortlisted: true,
      offerStatus: true,
      joiningStatus: true,
      doj: true,
      currentStage: {
        select: { id: true, name: true },
      },
    },
  },
  _count: {
    select: { applications: true },
  },
};

const CANDIDATE_LIST_SELECT_LEGACY = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  totalExperienceYears: true,
  currentCompany: true,
  source: true,
  category: true,
  createdAt: true,
  profilePhotoFile: {
    select: {
      id: true,
      storageKey: true,
    },
  },
  applications: {
    select: {
      id: true,
      status: true,
      shortlisted: true,
      currentStage: {
        select: { id: true, name: true },
      },
    },
  },
  _count: {
    select: { applications: true },
  },
};

router.post(
  "/bulk-upload",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "candidate-bulk";
    next();
  },
  memoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ApiError(400, "Excel file is required (field: file)");
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    let inserted = 0;
    let skipped = 0;
    const errors = [];
    
    // Batch fetch all existing emails and phones to avoid N+1 lookups
    const emails = rows.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean);
    const phones = rows.map(r => String(r.phone || "").trim()).filter(Boolean);

    const existingCandidates = await prisma.candidate.findMany({
      where: {
        OR: [
          { email: { in: emails, mode: 'insensitive' } },
          { phone: { in: phones } }
        ]
      },
      select: { email: true, phone: true }
    });

    const existingEmails = new Set(existingCandidates.map(c => c.email?.toLowerCase()));
    const existingPhones = new Set(existingCandidates.map(c => c.phone));
    
    const candidatesToCreate = [];

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i];
      const fullName = String(raw.fullName || raw.name || "").trim();
      const email = String(raw.email || "").trim().toLowerCase() || null;
      const phone = String(raw.phone || "").trim() || null;

      if (!fullName || (!email && !phone)) {
        skipped += 1;
        errors.push(`Row ${i + 2}: fullName and (email or phone) are required`);
        continue;
      }

      if ((email && existingEmails.has(email)) || (phone && existingPhones.has(phone))) {
        skipped += 1;
        continue;
      }

      candidatesToCreate.push({
        fullName,
        email,
        phone,
        currentCompany: String(raw.currentCompany || "").trim() || null,
        totalExperienceYears: raw.totalExperienceYears || raw.experienceYears ? parseFloat(raw.totalExperienceYears || raw.experienceYears) : null,
        source: String(raw.source || "Excel Upload").trim(),
        createdById: req.user.id,
      });
      
      // Track new ones in-memory for this loop to avoid cross-row duplicates in the same file
      if (email) existingEmails.add(email);
      if (phone) existingPhones.add(phone);
    }

    if (candidatesToCreate.length > 0) {
      const result = await prisma.candidate.createMany({
        data: candidatesToCreate,
        skipDuplicates: true
      });
      inserted = result.count;
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "BULK_UPLOAD_CANDIDATES",
      entityType: "CANDIDATE",
      newData: {
        totalRows: rows.length,
        inserted,
        skipped,
      },
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


// In-memory store for import jobs (Simplification of BullMQ)
const importJobs = new Map();

router.post(
  "/bulk-import",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { rows, jobId } = req.body;
    if (!rows || !Array.isArray(rows) || !jobId) {
      throw new ApiError(400, "rows (array) and jobId are required");
    }

    const importJobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    importJobs.set(importJobId, { status: 'processing', progress: 0, total: rows.length, inserted: 0, skipped: 0 });

    // Process asynchronously
    setTimeout(async () => {
      let inserted = 0;
      let skipped = 0;
      
      try {
        const emails = rows.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean);
        const phones = rows.map(r => String(r.phone || "").trim()).filter(Boolean);

        const existingCandidates = await prisma.candidate.findMany({
          where: {
            OR: [
              { email: { in: emails, mode: 'insensitive' } },
              { phone: { in: phones } }
            ]
          },
          select: { email: true, phone: true }
        });

        const existingEmails = new Set(existingCandidates.map(c => c.email?.toLowerCase()));
        const existingPhones = new Set(existingCandidates.map(c => c.phone));

        const candidatesToCreate = [];
        const applicationsToCreate = [];

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i];
          const fullName = String(raw.fullName || raw.name || "").trim();
          const email = String(raw.email || "").trim().toLowerCase() || null;
          const phone = String(raw.phone || "").trim() || null;

          if (!fullName || (!email && !phone)) {
            skipped++;
            continue;
          }

          if ((email && existingEmails.has(email)) || (phone && existingPhones.has(phone))) {
            skipped++;
            continue;
          }

          // Note: In a real robust system, we would insert candidates and then applications.
          // Since we might not have the candidate IDs until after bulk insert, we'll insert them one by one
          // or use a transaction. For simplicity and reliability of getting IDs back:
          const cand = await prisma.candidate.create({
            data: {
              fullName,
              email,
              phone,
              location: raw.location || null,
              area: raw.area || null,
              course: raw.course || null,
              graduationYear: raw.graduationYear ? String(raw.graduationYear) : null,
              preferredRole: raw.preferredRole || null,
              source: "Bulk Import Wizard",
              createdById: req.user.id,
              applications: {
                create: {
                  jobId: jobId,
                  status: "IN_PIPELINE"
                }
              }
            }
          });

          if (email) existingEmails.add(email);
          if (phone) existingPhones.add(phone);
          inserted++;
          
          importJobs.set(importJobId, { status: 'processing', progress: Math.floor(((i + 1) / rows.length) * 100), total: rows.length, inserted, skipped });
        }

        await logAudit({
          actorUserId: req.user.id,
          action: "BULK_IMPORT_CANDIDATES_JSON",
          entityType: "CANDIDATE",
          newData: { totalRows: rows.length, inserted, skipped },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });

        importJobs.set(importJobId, { status: 'completed', progress: 100, total: rows.length, inserted, skipped });
        
        // Notify user via DB notification
        await prisma.notification.create({
          data: {
            userId: req.user.id,
            title: "Bulk Import Complete",
            message: `Imported ${inserted} candidates. Skipped ${skipped}.`,
            type: "INFO",
            link: "/candidates"
          }
        });

      } catch (err) {
        console.error("Bulk import failed:", err);
        importJobs.set(importJobId, { status: 'failed', error: err.message });
      }
    }, 0);

    res.status(202).json({ success: true, importJobId });
  })
);

router.get(
  "/import-jobs/:importJobId/status",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const job = importJobs.get(req.params.importJobId);
    if (!job) {
      throw new ApiError(404, "Import job not found");
    }
    res.json({ success: true, data: job });
  })
);

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const {
      fullName,
      email,
      phone,
      totalExperienceYears,
      currentCompany,
      source,
      category,
      collegeId = null,
      collegeDriveId = null,
      location,
      area,
      graduationYear,
      preferredRole,
      course,
      skills = [],
      education = [],
      customFields = {},
    } = req.body;

    if (!fullName) {
      throw new ApiError(400, "fullName is required");
    }

    if (!email && !phone) {
      throw new ApiError(400, "Either email or phone is required");
    }

    const duplicateConditions = [];
    if (email) {
      duplicateConditions.push({ email: { equals: email, mode: "insensitive" } });
    }
    if (phone) {
      duplicateConditions.push({ phone });
    }

    const existing = await prisma.candidate.findFirst({
      where: {
        OR: duplicateConditions,
      },
      select: { id: true, fullName: true, email: true, phone: true },
    });

    if (existing) {
      throw new ApiError(
        409,
        `Duplicate candidate exists (id: ${existing.id}, email: ${existing.email || "-"}, phone: ${existing.phone || "-"})`,
      );
    }

    const candidate = await prisma.candidate.create({
      data: {
        fullName,
        email,
        phone,
        totalExperienceYears,
        currentCompany,
        source,
        category: category || "Company",
        collegeId,
        collegeDriveId,
        location,
        area,
        graduationYear,
        preferredRole,
        course,
        createdById: req.user.id,
        skills: {
          create: skills.map((item) => ({
            skillName: item.skillName,
            proficiency: item.proficiency,
            years: item.years,
          })),
        },
        education: {
          create: education.map((item) => ({
            degree: item.degree,
            institution: item.institution,
            specialization: item.specialization,
            startYear: item.startYear,
            endYear: item.endYear,
            score: item.score,
          })),
        },
      },
    });

    await upsertCandidateCustomFields(candidate.id, customFields);

    const createdCandidate = await prisma.candidate.findUnique({
      where: { id: candidate.id },
      include: candidateDetailInclude,
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: candidate.id,
      newData: { fullName: candidate.fullName, email: candidate.email, phone: candidate.phone, customFields },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await notifyAdmins({
      title: 'New Candidate Profile',
      message: `${candidate.fullName} has been added to the database.`,
      link: `/candidates/${candidate.id}`
    });

    await sendNotification({
      userId: req.user.id,
      title: 'Candidate Created',
      message: `You successfully created a profile for ${candidate.fullName}.`,
      link: `/candidates/${candidate.id}`
    });

    res.status(201).json({ success: true, data: createdCandidate || candidate });
  }),
);

router.post(
  "/:id/resume",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "candidate-resumes";
    next();
  },
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");
    
    if (!req.file) {
      throw new ApiError(400, "Resume file is required (field: file)");
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: { resumeFile: true },
    });
    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    const cloudinaryUrl = req.file.path; // CloudinaryStorage puts the URL here
    const cloudinaryPublicId = req.file.filename;

    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey: cloudinaryPublicId,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "application/octet-stream",
        sizeBytes: BigInt(req.file.size || 0),
        uploadedById: req.user.id,
        // We'll use the storageKey to store the public_id, and we can 
        // reconstruct the URL or store the absolute URL in storageKey.
        // For simplicity, let's store the absolute URL in storageKey if it starts with http
        storageKey: cloudinaryUrl, 
      },
    });

    await prisma.candidate.update({
      where: { id },
      data: { resumeFileId: fileMeta.id },
    });

    // NOTE: Manual file cleanup (fs.unlink) is no longer needed for Cloudinary.
    // In a full implementation, you'd call cloudinary.uploader.destroy(oldPublicId).

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_RESUME",
      entityType: "CANDIDATE",
      entityId: id,
      newData: {
        fileId: fileMeta.id,
        fileName: fileMeta.originalName,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: {
        fileId: fileMeta.id,
        originalName: fileMeta.originalName,
        url: fileMeta.storageKey, // Returns the absolute Cloudinary URL
      },
    });
  }),
);

router.post(
  "/:id/photo",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "candidate-photos";
    next();
  },
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");
    
    if (!req.file) {
      throw new ApiError(400, "Photo file is required (field: file)");
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id },
    });
    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
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

    await prisma.candidate.update({
      where: { id },
      data: { profilePhotoFileId: fileMeta.id },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_CANDIDATE_PHOTO",
      entityType: "CANDIDATE",
      entityId: id,
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

router.get(
  "/custom-fields/definitions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const definitions = await prisma.customFieldDefinition.findMany({
      where: { entityType: "CANDIDATE" },
      orderBy: [{ isRequired: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        entityType: true,
        fieldKey: true,
        fieldLabel: true,
        fieldType: true,
        isRequired: true,
        optionsJson: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: definitions });
  }),
);

router.post(
  "/custom-fields/definitions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { fieldKey, fieldLabel, fieldType = "text", isRequired = false, optionsJson = null } = req.body || {};

    const normalizedFieldKey = normalizeFieldKey(fieldKey);
    if (!normalizedFieldKey) {
      throw new ApiError(400, "fieldKey is required");
    }
    if (!fieldLabel || !String(fieldLabel).trim()) {
      throw new ApiError(400, "fieldLabel is required");
    }

    const definition = await prisma.customFieldDefinition.create({
      data: {
        entityType: "CANDIDATE",
        fieldKey: normalizedFieldKey,
        fieldLabel: String(fieldLabel).trim(),
        fieldType: String(fieldType || "text").trim().toLowerCase(),
        isRequired: Boolean(isRequired),
        optionsJson: optionsJson || null,
      },
      select: {
        id: true,
        entityType: true,
        fieldKey: true,
        fieldLabel: true,
        fieldType: true,
        isRequired: true,
        optionsJson: true,
        createdAt: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_CANDIDATE_CUSTOM_FIELD_DEFINITION",
      entityType: "CUSTOM_FIELD_DEFINITION",
      entityId: definition.id,
      newData: definition,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: definition });
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const search = req.query.search?.trim();
    const category = req.query.category?.trim();
    const skip = (page - 1) * limit;

    const where = {};
    if (category && category !== 'All') {
      where.category = category;
    }
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }
    if (req.query.mentorId) {
      where.mentorId = req.query.mentorId;
    }
    if (req.query.coordinatorId) {
      where.coordinatorId = req.query.coordinatorId;
    }
    if (req.query.assignedToMe && req.query.assignedToMe === 'true') {
      where.OR = [
        ...(where.OR || []),
        { mentorId: req.user.id },
        { coordinatorId: req.user.id }
      ];
    }
    if (req.query.doj === 'true') {
      where.doj = { not: null };
      if (req.query.from || req.query.to) {
        where.doj = { ...where.doj };
        if (req.query.from) where.doj.gte = new Date(req.query.from);
        if (req.query.to) where.doj.lte = new Date(req.query.to);
      }
    }

    let items;
    const totalPromise = prisma.candidate.count({ where });

    try {
      items = await prisma.candidate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: CANDIDATE_LIST_SELECT_V2,
      });
    } catch (error) {
      if (error?.code !== "P2022") {
        throw error;
      }
      // Some environments still have older candidate tables without college columns.
      items = await prisma.candidate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: CANDIDATE_LIST_SELECT_LEGACY,
      });
    }

    const total = await totalPromise;

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

router.get(
  "/:id/history",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");

    const candidate = await prisma.candidate.findUnique({
      where: { id },
      select: { id: true, fullName: true },
    });
    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    const applications = await prisma.application.findMany({
      where: { candidateId: id },
      include: {
        job: { select: { id: true, title: true } },
        currentStage: { select: { id: true, name: true } },
        pipelineEvents: {
          include: {
            fromStage: { select: { id: true, name: true } },
            toStage: { select: { id: true, name: true } },
            movedBy: { select: { id: true, fullName: true, role: true } },
          },
          orderBy: { movedAt: "desc" },
        },
        interviews: {
          include: {
            interviewers: { select: { id: true, fullName: true, role: true } },
            feedbacks: {
              select: {
                recommendation: true,
                submittedAt: true,
                submittedBy: { select: { id: true, fullName: true, role: true } },
              },
            },
          },
          orderBy: { scheduledStart: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const timeline = [];
    applications.forEach((application) => {
      timeline.push({
        type: "APPLICATION_CREATED",
        at: application.createdAt,
        applicationId: application.id,
        job: application.job,
        stage: application.currentStage,
        status: application.status,
      });

      application.pipelineEvents.forEach((event) => {
        timeline.push({
          type: "PIPELINE_MOVED",
          at: event.movedAt,
          applicationId: application.id,
          fromStage: event.fromStage,
          toStage: event.toStage,
          movedBy: event.movedBy,
          remark: event.remark,
          feedback: event.feedback,
        });
      });

      application.interviews.forEach((interview) => {
        timeline.push({
          type: "INTERVIEW_SCHEDULED",
          at: interview.createdAt,
          applicationId: application.id,
          interviewId: interview.id,
          roundNo: interview.roundNo,
          mode: interview.mode,
          scheduledStart: interview.scheduledStart,
          interviewers: interview.interviewers,
          result: interview.result,
        });

        interview.feedbacks?.forEach((fb) => {
          timeline.push({
            type: "INTERVIEW_FEEDBACK_SUBMITTED",
            at: fb.submittedAt,
            applicationId: application.id,
            interviewId: interview.id,
            recommendation: fb.recommendation,
            submittedBy: fb.submittedBy,
          });
        });
      });
    });

    timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({
      success: true,
      data: {
        candidate,
        applications,
        timeline,
      },
    });
  }),
);


router.patch(
  "/:id/custom-fields",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");
    
    const { customFields = {} } = req.body || {};

    const candidate = await prisma.candidate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    await upsertCandidateCustomFields(id, customFields);

    const refreshed = await prisma.candidate.findUnique({
      where: { id },
      include: candidateDetailInclude,
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_CANDIDATE_CUSTOM_FIELDS",
      entityType: "CANDIDATE",
      entityId: id,
      newData: customFields,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: refreshed });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");
    
    const data = req.body || {};

    const existing = await prisma.candidate.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, "Candidate not found");
    }

    const duplicateConditions = [];
    if (data.email) {
      duplicateConditions.push({ email: { equals: data.email, mode: "insensitive" } });
    }
    if (data.phone) {
      duplicateConditions.push({ phone: data.phone });
    }

    if (duplicateConditions.length > 0) {
      const duplicate = await prisma.candidate.findFirst({
        where: {
          AND: [{ id: { not: id } }, { OR: duplicateConditions }],
        },
      });

      if (duplicate) {
        throw new ApiError(409, "Another candidate with same email or phone already exists");
      }
    }

    const updated = await prisma.candidate.update({
      where: { id },
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        totalExperienceYears: data.totalExperienceYears,
        currentCompany: data.currentCompany,
        source: data.source,
        category: data.category,
        collegeId: data.collegeId,
        collegeDriveId: data.collegeDriveId,
        location: data.location,
        area: data.area,
        graduationYear: data.graduationYear,
        preferredRole: data.preferredRole,
        course: data.course,
        mentorId: data.mentorId,
        coordinatorId: data.coordinatorId,
        doj: data.doj ? new Date(data.doj) : null,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      oldData: {
        fullName: existing.fullName,
        email: existing.email,
        phone: existing.phone,
      },
      newData: {
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: 'CANDIDATE_UPDATED', candidateId: id, fullName: updated.fullName });

    res.json({ success: true, data: updated });
  }),
);

router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const categories = await prisma.candidate.findMany({
      select: { category: true },
      distinct: ["category"],
    });
    const list = categories.map(c => c.category).filter(Boolean);
    // Ensure defaults are always present in the list for suggestions
    if (!list.includes("Company")) list.push("Company");
    if (!list.includes("College Drive")) list.push("College Drive");
    
    res.json({ success: true, data: [...new Set(list)] });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");
    
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: candidateDetailInclude,
    });

    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    res.json({ success: true, data: candidate });
  }),
);

router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid candidate ID format");

    const candidate = await prisma.candidate.findUnique({
      where: { id },
      select: { id: true, fullName: true },
    });

    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    await prisma.candidate.delete({
      where: { id },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      oldData: candidate,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Candidate deleted successfully" });
  }),
);

router.get(
  "/reports/joining",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const where = {
      doj: { not: null }
    };
    if (from || to) {
      where.doj = { ...where.doj };
      if (from) where.doj.gte = new Date(from);
      if (to) where.doj.lte = new Date(to);
    }

    const items = await prisma.candidate.findMany({
      where,
      include: {
        applications: {
          include: { job: true }
        },
        mentor: true,
        coordinator: true
      },
      orderBy: { doj: "asc" }
    });

    const csvRows = [
      ["Full Name", "Email", "Phone", "DOJ", "Role", "Mentor", "Coordinator"].join(",")
    ];

    items.forEach(c => {
      const role = c.applications[0]?.job?.title || "N/A";
      const mentor = c.mentor?.fullName || "N/A";
      const coordinator = c.coordinator?.fullName || "N/A";
      const dojStr = c.doj ? new Date(c.doj).toLocaleDateString() : "N/A";
      csvRows.push([
        `"${c.fullName}"`,
        `"${c.email || ""}"`,
        `"${c.phone || ""}"`,
        `"${dojStr}"`,
        `"${role}"`,
        `"${mentor}"`,
        `"${coordinator}"`
      ].join(","));
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="joining_candidates.csv"');
    res.send(csvRows.join("\n"));
  })
);

// FEATURE 3: Transfer Panel Button
router.post(
  "/:id/transfer",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fromJobId, toJobId } = req.body;

    if (!fromJobId || !toJobId) {
      throw new ApiError(400, "fromJobId and toJobId are required");
    }

    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new ApiError(404, "Candidate not found");

    const toJob = await prisma.job.findUnique({ where: { id: toJobId } });
    if (!toJob) throw new ApiError(404, "Target job not found");

    const existingTargetApp = await prisma.application.findUnique({
      where: { candidateId_jobId: { candidateId: id, jobId: toJobId } }
    });

    if (existingTargetApp) {
      throw new ApiError(400, "Candidate is already applied to the target job");
    }

    // Create the new application
    const newApp = await prisma.application.create({
      data: {
        candidateId: id,
        jobId: toJobId,
        status: "IN_PIPELINE"
      }
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "TRANSFER_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      newData: { fromJobId, toJobId, newApplicationId: newApp.id },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: 'PIPELINE_MOVED', candidateId: id, toJobId });

    res.json({ success: true, data: newApp });
  })
);

module.exports = router;
