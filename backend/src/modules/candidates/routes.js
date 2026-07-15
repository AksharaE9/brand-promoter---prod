const express = require("express");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const prisma = require("../../config/db");
const { uploadFileToCloudinary } = require("../../config/cloudinary");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const sse = require("../../utils/sse");
const { getCached } = require("../../utils/cache");
const inv = require("../../utils/cacheInvalidation");
const { upsertCompanyForOrg } = require("../companies/routes");

// Default company — used when none is supplied for backward-compat clients
const DEFAULT_COMPANY = 'Akshara Enterprises';

const isSafeKey = (key) => key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const router = express.Router();

router.use(auth);

// GET Custom field definitions
router.get(
  "/custom-fields/definitions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const definitions = await prisma.customFieldDefinition.findMany();
    res.json({ success: true, data: definitions });
  })
);

// Normalize fields for import
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

function getFieldVal(raw, possibleNames) {
  if (!raw || typeof raw !== 'object') return undefined;
  const keys = Object.keys(raw);
  const normalizedNames = possibleNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const foundKey = keys.find(k => {
    const normalizedK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedNames.includes(normalizedK);
  });
  return foundKey ? raw[foundKey] : undefined;
}

// POST Bulk candidate upload (from XLSX)
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

    let allRows = [];
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    for (const sheetName of workbook.SheetNames) {
      if (!isSafeKey(sheetName)) continue;
      const sheet = workbook.Sheets[sheetName];
      const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      sheetRows.forEach((row, idx) => {
        allRows.push({
          ...row,
          _sheetName: sheetName,
          _rowIndex: idx + 2
        });
      });
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];
    
    const existingPhones = new Set();
    const bulkData = [];
    const orgId = req.user.organizationId || "defaultOrg";

    for (let i = 0; i < allRows.length; i += 1) {
      const raw = allRows[Number(i)];
      const rawFullName = getFieldVal(raw, ['fullName', 'full name', 'name']);
      const fullName = rawFullName ? String(rawFullName).trim() : "";
      const rawEmail = getFieldVal(raw, ['email', 'email address', 'emailid']);
      const email = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
      const rawPhone = getFieldVal(raw, ['phone', 'phone number', 'contact', 'mobile']);
      const phone = rawPhone ? String(rawPhone).trim() : null;
      const sheetInfo = `[Sheet: ${raw._sheetName}, Row ${raw._rowIndex}]`;

      if (!fullName || !phone) {
        skipped += 1;
        errors.push(`${sheetInfo}: fullName and phone are required`);
        continue;
      }

      if (existingPhones.has(phone)) {
        skipped += 1;
        continue;
      }

      // Check DB for existing phone number
      const existingDb = await prisma.candidate.findFirst({
        where: { phone, organizationId: orgId, isDeleted: false }
      });
      if (existingDb) {
        skipped += 1;
        errors.push(`${sheetInfo}: candidate with phone ${phone} already exists`);
        continue;
      }

      const rawCompany = getFieldVal(raw, ['currentCompany', 'current company', 'company']);
      const currentCompany = rawCompany ? String(rawCompany).trim() : null;

      const rawExp = getFieldVal(raw, ['totalExperienceYears', 'experienceYears', 'experience years', 'experience', 'total experience']);
      const totalExperienceYears = rawExp ? parseFloat(rawExp) : null;

      const rawSource = getFieldVal(raw, ['source', 'candidateSource', 'candidate source', 'candidate_source']);
      const source = rawSource ? String(rawSource).trim() : null;

      bulkData.push({
        fullName,
        email: email || "N/A",
        phone,
        currentCompany,
        totalExperienceYears,
        source,
        createdById: req.user.id,
        status: "ACTIVE",
        organizationId: orgId,
        isDeleted: false
      });
      
      if (phone) existingPhones.add(phone);
      inserted++;
    }

    if (bulkData.length > 0) {
      await prisma.candidate.createMany({
        data: bulkData
      });
      await inv.candidateList(orgId);
      sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', { count: inserted });
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "BULK_UPLOAD_CANDIDATES",
      entityType: "CANDIDATE",
      newData: { totalRows: allRows.length, inserted, skipped },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: { totalRows: allRows.length, inserted, skipped, errors },
    });
  }),
);

const importJobs = new Map();

// POST Bulk Import Wizard (candidates + applications creation)
router.post(
  "/bulk-import",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { rows, jobId } = req.body;
    if (!rows || !Array.isArray(rows) || !jobId) {
      throw new ApiError(400, "rows (array) and jobId are required");
    }

    const importJobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    importJobs.set(importJobId, { status: 'processing', progress: 0, total: rows.length, inserted: 0, skipped: 0 });

    const orgId = req.user.organizationId || "defaultOrg";
    const userId = req.user.id;

    // Run background task
    setTimeout(async () => {
      let inserted = 0;
      let skipped = 0;
      
      try {
        for (let i = 0; i < rows.length; i++) {
          const raw = rows[Number(i)];
          const rawFullName = getFieldVal(raw, ['fullName', 'full name', 'name']);
          const fullName = rawFullName ? String(rawFullName).trim() : "";
          const rawEmail = getFieldVal(raw, ['email', 'email address', 'emailid']);
          const email = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
          const rawPhone = getFieldVal(raw, ['phone', 'phone number', 'contact', 'mobile']);
          const phone = rawPhone ? String(rawPhone).trim() : null;

          if (!fullName || !phone) {
            skipped++;
            continue;
          }

          // Check for existing phone number
          const existing = await prisma.candidate.findFirst({
            where: { phone, organizationId: orgId, isDeleted: false }
          });
          if (existing) {
            skipped++;
            continue;
          }

          const rawLocation = getFieldVal(raw, ['location', 'place', 'city']);
          const location = rawLocation ? String(rawLocation).trim() : null;

          const rawArea = getFieldVal(raw, ['area', 'region']);
          const area = rawArea ? String(rawArea).trim() : null;

          const rawCourse = getFieldVal(raw, ['course', 'graduation course', 'degree']);
          const course = rawCourse ? String(rawCourse).trim() : null;

          const rawGradYear = getFieldVal(raw, ['graduationYear', 'graduation year', 'grad year']);
          const graduationYear = rawGradYear ? String(rawGradYear).trim() : null;

          const rawPreferredRole = getFieldVal(raw, ['preferredRole', 'preferred role', 'role']);
          const preferredRole = rawPreferredRole ? String(rawPreferredRole).trim() : null;

          const rawSource = getFieldVal(raw, ['source', 'candidateSource', 'candidate source', 'candidate_source']);
          const source = rawSource ? String(rawSource).trim() : "Bulk Import Wizard";

          const candidate = await prisma.candidate.create({
            data: {
              fullName,
              email: email || "N/A",
              phone,
              location,
              area,
              course,
              graduationYear,
              preferredRole,
              source,
              createdById: userId,
              status: "ACTIVE",
              organizationId: orgId,
              isDeleted: false
            }
          });

          await prisma.application.create({
            data: {
              candidateId: candidate.id,
              jobId: jobId,
              status: "IN_PIPELINE",
              organizationId: orgId,
              isDeleted: false
            }
          });

          inserted++;
          importJobs.set(importJobId, { status: 'processing', progress: Math.floor(((i + 1) / rows.length) * 100), total: rows.length, inserted, skipped });
        }

        importJobs.set(importJobId, { status: 'completed', progress: 100, total: rows.length, inserted, skipped });
        
        await inv.candidateList(orgId);
        sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', { count: inserted });

        await prisma.notification.create({
          data: {
            userId: userId,
            title: "Bulk Import Complete",
            message: `Imported ${inserted} candidates.`,
            type: "INFO",
          }
        });

      } catch (err) {
        importJobs.set(importJobId, { status: 'failed', error: err.message });
      }
    }, 0);

    res.status(202).json({ success: true, importJobId });
  })
);

router.get(
  "/import-jobs/:importJobId/status",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const job = importJobs.get(req.params.importJobId);
    if (!job) throw new ApiError(404, "Import job not found");
    res.json({ success: true, data: job });
  })
);

// POST Create single candidate
router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const data = req.body;
    if (!data.fullName) throw new ApiError(400, "fullName is required");
    if (!data.phone) throw new ApiError(400, "Phone number is required");

    const orgId = req.user.organizationId || "defaultOrg";

    // Deduplication by phone
    const existingPhone = await prisma.candidate.findFirst({
      where: { phone: data.phone.trim(), organizationId: orgId, isDeleted: false }
    });
    if (existingPhone) throw new ApiError(409, "A candidate with this phone number already exists.");

    // Resolve company — default to org primary if not provided
    const resolvedCompany = (data.company || '').trim() || DEFAULT_COMPANY;

    const candidateData = {
      fullName: data.fullName,
      email: data.email || "N/A",
      phone: data.phone,
      currentCompany: data.currentCompany || null,
      totalExperienceYears: data.totalExperienceYears ? parseFloat(data.totalExperienceYears) : null,
      location: data.location || null,
      area: data.area || null,
      course: data.course || null,
      graduationYear: data.graduationYear ? String(data.graduationYear) : null,
      preferredRole: data.preferredRole || null,
      source: data.source || null,
      jobTitle: data.jobTitle || null,
      category: data.category || "External",
      customFields: data.customFields || null,
      company: resolvedCompany,           // ── NEW field ──
      createdById: req.user.id,
      status: "ACTIVE",
      organizationId: orgId,
      isDeleted: false
    };

    const candidate = await prisma.candidate.create({
      data: candidateData
    });

    // Invalidate cache before returning response to avoid race conditions
    await inv.candidate(orgId, candidate.id);

    // ── Respond IMMEDIATELY — client never waits for side effects ──
    res.status(201).json({ success: true, data: candidate });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(async () => {
      // Ensure company name exists in lookup table (non-blocking)
      upsertCompanyForOrg(orgId, resolvedCompany).catch(err =>
        console.error('[Candidates:Create] company upsert failed:', err.message)
      );
      try {
        await logAudit({
          actorUserId: req.user.id,
          action: "CREATE_CANDIDATE",
          entityType: "CANDIDATE",
          entityId: candidate.id,
          newData: candidate,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      } catch (auditErr) {
        console.error('[Candidates:Create] Audit log failed (non-fatal):', auditErr.message);
      }
      sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', {
        candidateId: candidate.id,
        candidate,
        createdBy: req.user.id,
        createdByName: req.user.fullName || req.user.email,
      });
    });
  }),
);

// POST Create single candidate with resume upload
router.post(
  "/with-resume-upload",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "candidate-resumes";
    next();
  },
  upload.single("resume"),
  asyncHandler(async (req, res) => {
    const { fullName, email, phone, category } = req.body;

    if (!fullName) throw new ApiError(400, "fullName is required");
    if (!phone) throw new ApiError(400, "Phone number is required");

    const orgId = req.user.organizationId || "defaultOrg";

    const existingPhone = await prisma.candidate.findFirst({
      where: { phone: phone.trim(), organizationId: orgId, isDeleted: false }
    });
    if (existingPhone) throw new ApiError(409, "A candidate with this phone number already exists.");

    let resumeFileId = null;
    if (req.file) {
      const dest = `resumes/${Date.now()}_${req.file.originalname}`;
      const storageKey = await uploadFileToCloudinary(req.file.buffer, dest, req.file.mimetype);
      
      if (!storageKey) {
        throw new ApiError(500, "Failed to upload resume to storage");
      }

      const fileMeta = await prisma.fileMeta.create({
        data: {
          storageKey,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          uploadedById: req.user.id,
        }
      });
      resumeFileId = fileMeta.id;
    }

    const resolvedCompanyResume = (req.body.company || '').trim() || DEFAULT_COMPANY;

    const candidateData = {
      fullName,
      email: email || "N/A",
      phone,
      resumeFileId,
      currentCompany: req.body.currentCompany || null,
      totalExperienceYears: req.body.totalExperienceYears ? parseFloat(req.body.totalExperienceYears) : null,
      location: req.body.location || null,
      area: req.body.area || null,
      course: req.body.course || null,
      graduationYear: req.body.graduationYear ? String(req.body.graduationYear) : null,
      preferredRole: req.body.preferredRole || null,
      source: req.body.source || null,
      jobTitle: req.body.jobTitle || null,
      category: category || "External",
      customFields: req.body.customFields ? JSON.parse(req.body.customFields) : null,
      company: resolvedCompanyResume,     // ── NEW field ──
      createdById: req.user.id,
      status: "ACTIVE",
      organizationId: orgId,
      isDeleted: false
    };

    const candidate = await prisma.candidate.create({
      data: candidateData,
      include: {
        resumeFile: true
      }
    });

    // Invalidate cache before returning response to avoid race conditions
    await inv.candidate(orgId, candidate.id);

    // ── Respond IMMEDIATELY — client never waits for side effects ──
    res.status(201).json({ 
      success: true, 
      data: candidate 
    });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(async () => {
      // Ensure company exists in lookup (non-blocking)
      upsertCompanyForOrg(orgId, resolvedCompanyResume).catch(err =>
        console.error('[Candidates:CreateResume] company upsert failed:', err.message)
      );
      try {
        await logAudit({
          actorUserId: req.user.id,
          action: "CREATE_CANDIDATE_WITH_RESUME",
          entityType: "CANDIDATE",
          entityId: candidate.id,
          newData: candidate,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      } catch (auditErr) {
        console.error('[Candidates:CreateResume] Audit log failed (non-fatal):', auditErr.message);
      }
      sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', {
        candidateId: candidate.id,
        candidate,
        createdBy: req.user.id,
        createdByName: req.user.fullName || req.user.email,
      });
    });
  })
);

// GET List candidates (with filter, search, cursor pagination)
router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
    const cursor = req.query.cursor?.trim(); 
    const search = req.query.search?.trim();
    const category = req.query.category?.trim();
    const status = req.query.status?.trim();
    const company = req.query.company?.trim();  // ── NEW filter ──
    const assignedToMe = req.query.assignedToMe === 'true';
    const orgId = req.user.organizationId || "defaultOrg";

    const cacheKeyStr = `candidates:list:${orgId}:${cursor || 'start'}:${limit}:${search || ''}:${category || ''}:${status || ''}:${assignedToMe}:${company || ''}`;

    const data = await getCached(cacheKeyStr, async () => {
      const where = {
        organizationId: orgId,
        isDeleted: false
      };

      if (status) where.status = status;
      if (category) where.category = category;
      if (company) where.company = company;   // ── NEW: filter by hiring org ──
      if (assignedToMe) where.mentorId = req.user.id;

      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } }
        ];
      }

      const queryOptions = {
        where,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          preferredRole: true,
          location: true,
          area: true,
          source: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          offerDecision: true,
          doj: true,
          company: true,   // ── NEW field ──
          resumeFile: {
            select: {
              storageKey: true
            }
          },
          profilePhotoFile: {
            select: {
              storageKey: true
            }
          },
          applications: {
            where: { isDeleted: false },
            select: {
              id: true,
              status: true,
              joiningDate: true,
              job: {
                select: {
                  id: true,
                  title: true
                }
              }
            }
          }
        }
      };

      if (cursor) {
        queryOptions.cursor = { id: cursor };
        queryOptions.skip = 1;
      }

      // Fetch count and items in parallel to optimize latency by a full roundtrip
      const [total, items] = await Promise.all([
        prisma.candidate.count({ where }),
        prisma.candidate.findMany(queryOptions)
      ]);

      const hasMore = items.length > limit;
      if (hasMore) {
        items.pop();
      }

      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return { items, nextCursor, hasMore, total };
    }, 20000); // 20s cache

    const pagination = {
      total: data.total || 0,
      limit,
      hasMore: data.hasMore
    };

    if (data.items && data.items.length > 30) {
      const { streamPaginatedJson } = require("../../utils/streamResponse");
      return streamPaginatedJson(res, data.items, { nextCursor: data.nextCursor, hasMore: data.hasMore, pagination });
    }

    res.json({
      success: true,
      data: data.items,
      nextCursor: data.nextCursor,
      hasMore: data.hasMore,
      pagination
    });
  })
);

// GET Candidate timeline history
router.get(
  "/:id/history",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const cacheKey = `candidates:history:${id}`;

    const data = await getCached(cacheKey, async () => {
      const candidate = await prisma.candidate.findUnique({
        where: { id },
        include: {
          applications: {
            where: { isDeleted: false },
            include: {
              pipelineEvents: {
                include: {
                  fromStage: true,
                  toStage: true
                }
              },
              interviews: true
            }
          }
        }
      });

      if (!candidate) throw new ApiError(404, "Candidate not found");

      const timeline = [];
      
      candidate.applications.forEach(app => {
        timeline.push({
          id: `app_create_${app.id}`,
          type: "APPLICATION_CREATED",
          at: app.createdAt,
          applicationId: app.id,
        });

        app.pipelineEvents.forEach(evt => {
          timeline.push({
            id: evt.id,
            type: "PIPELINE_MOVED",
            at: evt.movedAt,
            ...evt
          });
        });

        app.interviews.forEach(intv => {
          timeline.push({
            id: intv.id,
            type: "INTERVIEW_SCHEDULED",
            at: intv.scheduledStart || intv.createdAt,
            ...intv
          });
        });
      });

      timeline.sort((a, b) => new Date(b.at) - new Date(a.at));

      return { candidate, applications: candidate.applications, timeline };
    }, 30000); // 30s cache

    res.json({ success: true, data });
  }),
);

// PATCH Update candidate
router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    const orgId = req.user.organizationId || "defaultOrg";

    const candidate = await prisma.candidate.findUnique({
      where: { id }
    });
    if (!candidate) throw new ApiError(404, "Candidate not found");

    if (data.phone) {
      const currentPhoneClean = (candidate.phone || "").replace(/\D/g, "");
      const newPhoneClean = data.phone.replace(/\D/g, "");
      if (currentPhoneClean !== newPhoneClean) {
        const existingPhone = await prisma.candidate.findFirst({
          where: { phone: data.phone.trim(), organizationId: orgId, isDeleted: false }
        });
        if (existingPhone && existingPhone.id !== id) {
          throw new ApiError(409, "A candidate with this phone number already exists.");
        }
      }
    }

    if (data.email === "" || data.email === null) {
      data.email = "N/A";
    }

    // Prepare fields for Prisma update
    const updateData = {};
    const allowedFields = [
      "fullName", "email", "phone", "currentCompany", "totalExperienceYears",
      "location", "area", "course", "graduationYear", "preferredRole",
      "source", "jobTitle", "category", "status", "currentStage", "mentorId",
      "assignedRecruiterId", "assignedRecruiterName", "customFields", "offerDecision", "doj",
      "company"  // ── NEW: client-specified hiring organization ──
    ];

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        if (field === "totalExperienceYears") {
          updateData[field] = data[field] ? parseFloat(data[field]) : null;
        } else {
          updateData[field] = data[field];
        }
      }
    });

    const updatedCandidate = await prisma.candidate.update({
      where: { id },
      data: updateData
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      newData: data,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Invalidate cache before returning response to avoid race conditions
    await inv.candidate(orgId, id);

    res.json({ success: true, data: updatedCandidate });

    setImmediate(async () => {
      // If company was changed, ensure it exists in lookup (non-blocking)
      if (data.company) {
        upsertCompanyForOrg(orgId, data.company.trim()).catch(err =>
          console.error('[Candidates:Update] company upsert failed:', err.message)
        );
      }
      sse.broadcastToOrg(orgId, 'CANDIDATE_UPDATED', {
        candidateId: id,
        changes: data,
        updatedBy: req.user.id,
        updatedByName: req.user.fullName || req.user.email,
      });
    });
  }),
);

// GET All candidate distinct categories
router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || "defaultOrg";
    const categories = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
        category: { not: null }
      },
      select: {
        category: true
      },
      distinct: ['category']
    });
    
    const list = categories.map(c => c.category).filter(Boolean);
    res.json({ success: true, data: list });
  }),
);

// GET Candidate by ID
router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        resumeFile: true,
        profilePhotoFile: true
      }
    });
    
    if (!candidate) throw new ApiError(404, "Candidate not found");
    res.json({ success: true, data: candidate });
  }),
);

// GET Download candidate resume
router.get(
  "/:id/resume/download",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        resumeFile: true
      }
    });

    if (!candidate) {
      throw new ApiError(404, "Candidate not found");
    }

    if (!candidate.resumeFile || !candidate.resumeFile.storageKey) {
      throw new ApiError(404, "Resume file not found for this candidate");
    }

    const { storageKey, originalName, mimeType } = candidate.resumeFile;

    try {
      let downloadUrl = storageKey;

      // Check if it's a Cloudinary URL and generate a signed private download URL if so
      if (storageKey.includes("res.cloudinary.com")) {
        const cloudinary = require("../../config/cloudinary");
        const decoded = decodeURIComponent(storageKey);
        const match = decoded.match(/res\.cloudinary\.com\/[^/]+\/([^/]+)\/([^/]+)\/(?:v\d+\/)?(.+)$/);
        if (match) {
          const resourceType = match[1]; // 'image' or 'raw'
          const type = match[2]; // 'upload', 'private', 'authenticated'
          const remaining = match[3];
          
          const extMatch = remaining.match(/\.([a-zA-Z0-9]+)$/);
          const format = extMatch ? extMatch[1] : null;
          const publicId = format ? remaining.slice(0, -(format.length + 1)) : remaining;

          downloadUrl = cloudinary.utils.private_download_url(publicId, format || 'pdf', {
            resource_type: resourceType,
            type: type,
            expires_at: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes
            attachment: true
          });
        }
      }

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file from storage: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(originalName || 'resume.pdf')}"`);
      res.setHeader("Content-Type", mimeType || "application/octet-stream");
      res.send(buffer);
    } catch (err) {
      console.error("Error downloading resume from storage:", err);
      // Fallback: redirect user directly to the storage key URL
      res.redirect(storageKey);
    }
  }),
);


// POST Upload candidate resume after creation
router.post(
  "/:id/resume",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  upload.single("resume"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) throw new ApiError(400, "No resume file uploaded");

    const candidate = await prisma.candidate.findUnique({
      where: { id }
    });
    if (!candidate) throw new ApiError(404, "Candidate not found");

    const dest = `resumes/${Date.now()}_${req.file.originalname}`;
    const storageKey = await uploadFileToCloudinary(req.file.buffer, dest, req.file.mimetype);
    
    if (!storageKey) {
      throw new ApiError(500, "Failed to upload resume to storage");
    }

    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.user.id
      }
    });
    
    await prisma.candidate.update({
      where: { id },
      data: {
        resumeFileId: fileMeta.id
      }
    });

    const orgId = req.user.organizationId || "defaultOrg";
    await inv.candidate(orgId, id);

    res.json({ success: true, data: { resumeFileId: fileMeta.id, storageKey } });
  }),
);

// DELETE Soft delete candidate
router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.organizationId || "defaultOrg";

    const candidate = await prisma.candidate.findUnique({
      where: { id }
    });
    if (!candidate) throw new ApiError(404, "Candidate not found");
    
    await prisma.candidate.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date()
      }
    });

    // Invalidate cache before returning response to avoid race conditions
    await inv.candidate(orgId, id);

    // ── Respond IMMEDIATELY — client never waits for side effects ──
    res.json({ success: true, data: { id }, message: "Candidate deleted successfully" });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(async () => {
      try {
        await logAudit({
          actorUserId: req.user.id,
          action: "DELETE_CANDIDATE",
          entityType: "CANDIDATE",
          entityId: id,
          oldData: candidate,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      } catch (auditErr) {
        console.error('[Candidates:Delete] Audit log failed (non-fatal):', auditErr.message);
      }
      sse.broadcastToOrg(orgId, 'CANDIDATE_DELETED', {
        candidateId: id,
        deletedBy: req.user.id,
        deletedByName: req.user.fullName || req.user.email,
      });
    });
  }),
);

// DELETE all candidates (SUPER_ADMIN only)
router.delete(
  "/all",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const count = await prisma.candidate.count();
    
    await prisma.candidate.deleteMany();

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_ALL_CANDIDATES",
      entityType: "CANDIDATE",
      oldData: { count },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Invalidate all cache
    const { invalidateAll } = require("../../utils/cache");
    invalidateAll();

    res.json({ success: true, message: `Deleted ${count} candidates` });
  }),
);

// GET Export joining candidates as CSV
router.get(
  "/reports/joining",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    
    const candidates = await prisma.candidate.findMany({
      where: {
        isDeleted: false,
        doj: { not: null }
      },
      orderBy: { doj: 'asc' }
    });

    let items = candidates;

    if (from) items = items.filter(c => new Date(c.doj) >= new Date(from));
    if (to) items = items.filter(c => new Date(c.doj) <= new Date(to));

    items.sort((a, b) => new Date(a.doj) - new Date(b.doj));

    const csvRows = [["Full Name", "Email", "Phone", "DOJ"].join(",")];
    items.forEach(c => {
      csvRows.push([`"${c.fullName}"`, `"${c.email || ""}"`, `"${c.phone || ""}"`, `"${c.doj}"`].join(","));
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="joining_candidates.csv"');
    res.send(csvRows.join("\n"));
  })
);

// POST Transfer candidate to another job (creates application)
router.post(
  "/:id/transfer",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { toJobId } = req.body;
    if (!toJobId) throw new ApiError(400, "toJobId is required");

    const orgId = req.user.organizationId || "defaultOrg";

    const existingApp = await prisma.application.findFirst({
      where: { candidateId: id, jobId: toJobId, isDeleted: false }
    });
    if (existingApp) throw new ApiError(400, "Candidate is already applied to this job.");

    const application = await prisma.application.create({
      data: {
        candidateId: id,
        jobId: toJobId,
        status: "IN_PIPELINE",
        organizationId: orgId,
        isDeleted: false
      }
    });

    await inv.application(orgId, id);

    // Fetch job details
    const job = await prisma.job.findUnique({
      where: { id: toJobId }
    });
    const toJobTitle = job ? job.title : "New Job";

    sse.broadcastToOrg(orgId, 'APPLICATION_TRANSFERRED', {
      applicationId: application.id,
      candidateId: id,
      toJobId,
      toJobTitle,
      transferredBy: req.user.id,
      transferredByName: req.user.fullName || req.user.email,
    });

    res.json({ success: true, data: application });
  })
);

module.exports = router;
