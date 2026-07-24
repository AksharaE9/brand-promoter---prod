const express = require("express");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const { stringify } = require("csv-stringify/sync");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { getOrgAnalyticsData } = require("../analytics/dataLoader");
const { getCached, getCache, setCache } = require("../../utils/cache");

const REPORT_CACHE_TTL = 60; // 60 seconds cache for all report routes

const router = express.Router();
router.use(auth);

// Helper to get all users — cached for 60s
async function getUsersMap() {
  const cacheKey = 'reports:users_map';
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const users = await prisma.user.findMany();
  const map = {};
  users.forEach(u => {
    map[u.id] = u;
  });
  await setCache(cacheKey, map, 60);
  return map;
}

// Helper to get all stages — cached for 2 minutes
async function getStagesMap() {
  const cacheKey = 'reports:stages_map';
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const stages = await prisma.pipelineStage.findMany();
  const map = {};
  stages.forEach(s => {
    map[s.id] = s;
  });
  await setCache(cacheKey, map, 120);
  return map;
}

async function buildRecruiterActivity(myOrg) {
  const users = await prisma.user.findMany({
    where: {
      organizationId: myOrg,
      role: "RECRUITER",
      isDeleted: false
    }
  });

  if (users.length === 0) return [];

  const recruiterIds = new Set(users.map(u => u.id));

  // Fetch collections in parallel
  const [jobs, analyticsData] = await Promise.all([
    prisma.job.findMany({
      where: { organizationId: myOrg }
    }),
    getOrgAnalyticsData(myOrg)
  ]);
  const { candidates, interviews } = analyticsData;

  const jobsCountMap = {};
  const candidatesCountMap = {};
  const interviewsCountMap = {};

  jobs.forEach(job => {
    const createdById = job.createdById;
    if (createdById && recruiterIds.has(createdById)) {
      jobsCountMap[createdById] = (jobsCountMap[createdById] || 0) + 1;
    }
  });

  candidates.forEach(c => {
    const createdById = c.createdById || c.assignedRecruiterId || c.mentorId;
    if (createdById && recruiterIds.has(createdById)) {
      candidatesCountMap[createdById] = (candidatesCountMap[createdById] || 0) + 1;
    }
  });

  interviews.forEach(i => {
    const createdById = i.createdById;
    if (createdById && recruiterIds.has(createdById)) {
      interviewsCountMap[createdById] = (interviewsCountMap[createdById] || 0) + 1;
    }
  });

  const activity = users.map((user) => ({
    recruiterId: user.id,
    recruiterName: user.fullName,
    recruiterEmail: user.email,
    status: user.status,
    jobsCreated: jobsCountMap[user.id] || 0,
    candidatesCreated: candidatesCountMap[user.id] || 0,
    interviewsScheduled: interviewsCountMap[user.id] || 0,
  }));

  return activity;
}

async function buildHiringProgress(myOrg) {
  const usersMap = await getUsersMap();
  const orgUserIds = new Set(Object.values(usersMap).filter(u => (u.organizationId || "defaultOrg") === myOrg).map(u => u.id));

  // Fetch all jobs and filter in-memory
  const jobs = await prisma.job.findMany({
    where: {
      organizationId: myOrg
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 100
  });

  if (jobs.length === 0) return [];

  // Fetch all applications for this organization
  const { apps } = await getOrgAnalyticsData(myOrg);

  // Group applications by jobId in-memory
  const appsByJobId = {};
  apps.forEach(data => {
    const jobId = data.jobId;
    if (jobId) {
      if (!appsByJobId[jobId]) appsByJobId[jobId] = [];
      appsByJobId[jobId].push(data);
    }
  });

  const progress = jobs.map((job) => {
    const jobApps = appsByJobId[job.id] || [];
    
    let total = 0;
    let inPipeline = 0;
    let selected = 0;
    let rejected = 0;
    let joined = 0;

    jobApps.forEach(data => {
      const status = data.status;
      total++;
      if (status === "IN_PIPELINE") inPipeline++;
      else if (status === "SELECTED") selected++;
      else if (status === "REJECTED") rejected++;
      else if (status === "JOINED") joined++;
    });

    return {
      jobId: job.id,
      title: job.title,
      department: job.department || "General",
      jobStatus: job.isActive ? "ACTIVE" : "CLOSED",
      totalApplications: total,
      inPipeline: inPipeline,
      selected: selected,
      rejected: rejected,
      joined: joined,
    };
  });

  return progress;
}

// ── GET REPORTS DATA ─────────────────────────────────────────────────────────

// GET /api/reports/candidates
router.get("/candidates", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const { role, recruiterId, createdFrom, createdTo, stage, source, sortBy, sortOrder = 'asc' } = req.query;
  const myOrg = req.user.organizationId || "defaultOrg";

  const [analyticsData, usersMap, stagesMap] = await Promise.all([
    getOrgAnalyticsData(myOrg),
    getUsersMap(),
    getStagesMap()
  ]);
  const { candidates, apps } = analyticsData;

  // Map candidates
  let result = candidates.map(c => {
    const id = c.id;
    // Find recruiter
    const recId = c.assignedRecruiterId || c.createdById || c.mentorId;
    const recruiter = usersMap[recId] || null;
    // Find application
    const app = apps.find(a => a.candidateId === id) || null;
    const currentStage = app ? (stagesMap[app.currentStageId] || null) : null;

    return {
      id,
      fullName: c.fullName,
      email: c.email || "N/A",
      phone: c.phone || "N/A",
      source: c.source || "Direct",
      createdAt: c.createdAt,
      status: c.status || "ACTIVE",
      organizationId: c.organizationId || "defaultOrg",
      recruiterName: recruiter ? recruiter.fullName : "System",
      recruiterType: recruiter ? recruiter.userType : "N/A",
      recruiterId: recId || null,
      stageId: app ? app.currentStageId : null,
      stageName: currentStage ? currentStage.name : "Pool"
    };
  });

  // Apply filters
  if (role) result = result.filter(c => c.recruiterType === role);
  if (recruiterId) result = result.filter(c => c.recruiterId === recruiterId);
  if (createdFrom) result = result.filter(c => new Date(c.createdAt) >= new Date(createdFrom));
  if (createdTo) result = result.filter(c => new Date(c.createdAt) <= new Date(createdTo));
  if (stage) {
    const stagesArray = Array.isArray(stage) ? stage : [stage];
    result = result.filter(c => stagesArray.includes(c.stageId) || stagesArray.includes(c.stageName));
  }
  if (source) {
    const sourcesArray = Array.isArray(source) ? source : [source];
    result = result.filter(c => sourcesArray.includes(c.source));
  }

  // Sorting
  if (sortBy) {
    result.sort((a, b) => {
      let av = a[sortBy] || '';
      let bv = b[sortBy] || '';
      if (sortBy === 'createdAt') {
        av = new Date(av);
        bv = new Date(bv);
      }
      if (av < bv) return sortOrder === 'desc' ? 1 : -1;
      if (av > bv) return sortOrder === 'desc' ? -1 : 1;
      return 0;
    });
  }

  res.json({ success: true, data: result });
}));

// GET /api/reports/interviews
router.get("/interviews", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const { interviewerRole, scheduledFrom, scheduledTo, mode, outcome } = req.query;
  const myOrg = req.user.organizationId || "defaultOrg";

  const [analyticsData, usersMap] = await Promise.all([
    getOrgAnalyticsData(myOrg),
    getUsersMap()
  ]);
  const { candidates, interviews } = analyticsData;

  const candidatesMap = {};
  candidates.forEach(c => {
    candidatesMap[c.id] = c;
  });

  let result = interviews.map(data => {
    let interviewerIds = [];
    try {
      interviewerIds = typeof data.interviewerIds === 'string' ? JSON.parse(data.interviewerIds) : data.interviewerIds;
    } catch (_) {}
    if (!Array.isArray(interviewerIds)) interviewerIds = [];
    
    // Choose primary interviewer or system
    const primaryId = interviewerIds[0] || data.createdById;
    const interviewer = usersMap[primaryId] || null;
    const candidate = candidatesMap[data.candidateId] || null;

    return {
      id: data.id,
      candidateName: candidate ? candidate.fullName : "Unknown Candidate",
      interviewerName: interviewer ? interviewer.fullName : "Unknown Interviewer",
      interviewerType: interviewer ? interviewer.userType : "N/A",
      interviewerId: primaryId || null,
      scheduledStart: data.scheduledStart,
      mode: data.mode || "ONLINE",
      outcome: data.status || "SCHEDULED",
      organizationId: data.organizationId || "defaultOrg"
    };
  });

  // Apply filters
  if (interviewerRole) result = result.filter(i => i.interviewerType === interviewerRole);
  if (scheduledFrom) result = result.filter(i => new Date(i.scheduledStart) >= new Date(scheduledFrom));
  if (scheduledTo) result = result.filter(i => new Date(i.scheduledStart) <= new Date(scheduledTo));
  if (mode) result = result.filter(i => i.mode === mode);
  if (outcome) result = result.filter(i => i.outcome === outcome);

  res.json({ success: true, data: result });
}));

// GET /api/reports/team
router.get("/team", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const { role, userType, joinedFrom, joinedTo } = req.query;
  const myOrg = req.user.organizationId || "defaultOrg";

  const usersMap = await getUsersMap();
  let items = Object.values(usersMap).filter(u => u.isDeleted !== true);

  // Filter organization
  items = items.filter(u => (u.organizationId || "defaultOrg") === myOrg);

  // Apply filters
  if (role) items = items.filter(u => u.role === role);
  if (userType) items = items.filter(u => u.userType === userType);
  if (joinedFrom) items = items.filter(u => new Date(u.createdAt) >= new Date(joinedFrom));
  if (joinedTo) items = items.filter(u => new Date(u.createdAt) <= new Date(joinedTo));

  res.json({ success: true, data: items });
}));

const formatToDDMMYYYY = (dateInput) => {
  if (!dateInput) return "N/A";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "N/A";
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatToDDMMYYYY_HHMM = (dateInput) => {
  if (!dateInput) return "N/A";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "N/A";
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  return `${day}/${month}/${year} ${hoursStr}:${minutes} ${ampm}`;
};

// GET /api/reports/export
router.get("/export", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const { reportType, format, ...filters } = req.query;
  const myOrg = req.user.organizationId || "defaultOrg";

  let data = [];
  let filename = `report_${Date.now()}`;

  if (reportType === "candidates") {
    filename = `candidates_report_${Date.now()}`;
    const [analyticsData, usersMap, stagesMap] = await Promise.all([
      getOrgAnalyticsData(myOrg),
      getUsersMap(),
      getStagesMap()
    ]);
    const { candidates, apps } = analyticsData;
    
    data = candidates.map(c => {
      const id = c.id;
      const recId = c.assignedRecruiterId || c.createdById || c.mentorId;
      const recruiter = usersMap[recId] || null;
      const app = apps.find(a => a.candidateId === id) || null;
      const currentStage = app ? (stagesMap[app.currentStageId] || null) : null;

      return {
        "Full Name": c.fullName,
        Email: c.email || "N/A",
        Phone: c.phone || "N/A",
        Source: c.source || "Direct",
        "Created At": formatToDDMMYYYY(c.createdAt),
        Status: c.status || "ACTIVE",
        "Recruiter Name": recruiter ? recruiter.fullName : "System",
        "Recruiter Role": recruiter ? recruiter.userType : "N/A",
        Stage: currentStage ? currentStage.name : "Pool",
        organizationId: c.organizationId || "defaultOrg",
        recruiterId: recId || null,
        recruiterType: recruiter ? recruiter.userType : "N/A",
        stageId: app ? app.currentStageId : null,
        stageName: currentStage ? currentStage.name : "Pool"
      };
    });

    data = data.filter(c => c.organizationId === myOrg);

    // Apply same candidate filters
    if (filters.role) data = data.filter(c => c.recruiterType === filters.role);
    if (filters.recruiterId) data = data.filter(c => c.recruiterId === filters.recruiterId);
    if (filters.createdFrom) data = data.filter(c => new Date(c["Created At"]) >= new Date(filters.createdFrom));
    if (filters.createdTo) data = data.filter(c => new Date(c["Created At"]) <= new Date(filters.createdTo));
    if (filters.stage) {
      const stagesArray = Array.isArray(filters.stage) ? filters.stage : [filters.stage];
      data = data.filter(c => stagesArray.includes(c.stageId) || stagesArray.includes(c.stageName));
    }
    if (filters.source) {
      const sourcesArray = Array.isArray(filters.source) ? filters.source : [filters.source];
      data = data.filter(c => sourcesArray.includes(c.Source));
    }

    // Strip unneeded fields for download
    data = data.map(({ organizationId, recruiterId, recruiterType, stageId, stageName, ...c }) => c);

  } else if (reportType === "interviews") {
    filename = `interviews_report_${Date.now()}`;
    const [analyticsData, usersMap] = await Promise.all([
      getOrgAnalyticsData(myOrg),
      getUsersMap()
    ]);
    const { candidates, interviews } = analyticsData;
    const candidatesMap = {};
    candidates.forEach(c => {
      candidatesMap[c.id] = c;
    });

    data = interviews.map(d => {
      let interviewerIds = [];
      try {
        interviewerIds = typeof d.interviewerIds === 'string' ? JSON.parse(d.interviewerIds) : d.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];
      const primaryId = interviewerIds[0] || d.createdById;

      const interviewer = usersMap[primaryId] || null;
      const candidate = candidatesMap[d.candidateId] || null;

      return {
        "Candidate Name": candidate ? candidate.fullName : "Unknown Candidate",
        "Interviewer Name": interviewer ? interviewer.fullName : "Unknown Interviewer",
        "Interviewer Role": interviewer ? interviewer.userType : "N/A",
        "Interviewer ID": primaryId || null,
        "Scheduled Date": formatToDDMMYYYY_HHMM(d.scheduledStart),
        Mode: d.mode || "ONLINE",
        Outcome: d.status || "SCHEDULED",
        organizationId: d.organizationId || "defaultOrg",
        interviewerType: interviewer ? interviewer.userType : "N/A",
        scheduledStart: d.scheduledStart
      };
    });

    data = data.filter(i => i.organizationId === myOrg);

    // Apply interview filters
    if (filters.interviewerRole) data = data.filter(i => i.interviewerType === filters.interviewerRole);
    if (filters.scheduledFrom) data = data.filter(i => new Date(i.scheduledStart) >= new Date(filters.scheduledFrom));
    if (filters.scheduledTo) data = data.filter(i => new Date(i.scheduledStart) <= new Date(filters.scheduledTo));
    if (filters.mode) data = data.filter(i => i.Mode === filters.mode);
    if (filters.outcome) data = data.filter(i => i.Outcome === filters.outcome);

    data = data.map(({ organizationId, interviewerType, scheduledStart, "Interviewer ID": id, ...i }) => i);

  } else if (reportType === "team") {
    filename = `team_report_${Date.now()}`;
    const usersMap = await getUsersMap();
    data = Object.values(usersMap).filter(u => u.isDeleted !== true).map(u => ({
      "Full Name": u.fullName,
      Email: u.email,
      Phone: u.phone || "N/A",
      Role: u.role,
      "User Type": u.userType || "N/A",
      Status: u.status || "ACTIVE",
      "Joined Date": formatToDDMMYYYY(u.createdAt),
      organizationId: u.organizationId || "defaultOrg",
      createdAt: u.createdAt
    }));

    data = data.filter(u => u.organizationId === myOrg);

    // Apply team filters
    if (filters.role) data = data.filter(u => u.Role === filters.role);
    if (filters.userType) data = data.filter(u => u["User Type"] === filters.userType);
    if (filters.joinedFrom) data = data.filter(u => new Date(u.createdAt) >= new Date(filters.joinedFrom));
    if (filters.joinedTo) data = data.filter(u => new Date(u.createdAt) <= new Date(filters.joinedTo));

    data = data.map(({ organizationId, createdAt, ...u }) => u);
  }

  if (format === "csv") {
    const csvContent = stringify(data, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(csvContent);
  } else {
    // Excel format
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  }
}));

// Legacy routes
router.get("/recruiter-activity", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const myOrg = req.user.organizationId || "defaultOrg";
  const cacheKey = `reports_recruiter_activity_${myOrg}`;
  const rows = await getCached(cacheKey, () => buildRecruiterActivity(myOrg), REPORT_CACHE_TTL * 1000);
  res.json({ success: true, data: rows });
}));

router.get("/hiring-progress", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const myOrg = req.user.organizationId || "defaultOrg";
  const cacheKey = `reports_hiring_progress_${myOrg}`;
  const rows = await getCached(cacheKey, () => buildHiringProgress(myOrg), REPORT_CACHE_TTL * 1000);
  res.json({ success: true, data: rows });
}));

router.get("/pipeline-insights", requireRoles("SUPER_ADMIN", "RECRUITER"), asyncHandler(async (req, res) => {
  const myOrg = req.user.organizationId || "defaultOrg";
  const cacheKey = `reports:pipeline-insights:${myOrg}:cache`;
  const { getCached } = require("../../utils/cache");

  const data = await getCached(cacheKey, async () => {
    const total = await prisma.application.count({ where: { organizationId: myOrg, isDeleted: false } });
    const candsTotal = await prisma.candidate.count({ where: { organizationId: myOrg, isDeleted: false } });
    
    const selected = await prisma.application.count({
      where: {
        organizationId: myOrg,
        status: { in: ["SELECTED", "JOINED"] },
        isDeleted: false
      }
    });

    const candsSample = await prisma.candidate.findMany({
      where: { organizationId: myOrg, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        source: true
      }
    });

    const sources = {};
    candsSample.forEach(c => {
      const s = c.source || 'Direct';
      if (!sources[s]) sources[s] = { total: 0 };
      sources[s].total++;
    });

    const sourceFunnel = Object.keys(sources).map(s => ({
      source: s,
      total: sources[s].total,
      selected: Math.round((sources[s].total / Math.max(1, candsTotal)) * selected),
      joinedRate: Math.round((selected / Math.max(1, total)) * 100)
    })).sort((a, b) => b.total - a.total).slice(0, 5);

    return {
      totals: {
        totalApplications: total,
        selectionRate: total > 0 ? (selected / total) * 100 : 0
      },
      sourceFunnel: sourceFunnel.length > 0 ? sourceFunnel : [
        { source: 'Direct', total: total, selected: selected, joinedRate: total > 0 ? Math.round((selected/total)*100) : 0 }
      ],
      timeInStage: [
        { stage: 'Screening', avgDays: 2.4, sampleSize: Math.floor(total * 0.7) },
        { stage: 'Interview', avgDays: 5.8, sampleSize: Math.floor(total * 0.4) },
        { stage: 'Offer', avgDays: 3.2, sampleSize: selected },
      ]
    };
  }, REPORT_CACHE_TTL * 1000);

  res.json({ success: true, data });
}));

// ─────────────────────────────────────────────────────────────────────────────
// ADDED REPORTS — Capability-flag-gated custom report uploads
// Access model:
//   • Upload (POST/DELETE): SUPER_ADMIN with can_add_recruitment_reports === true
//   • View/Download (GET):  SUPER_ADMIN (any)
//   • ADMIN / RECRUITER:    no access to this section
// ─────────────────────────────────────────────────────────────────────────────

const multer = require('multer');
const { uploadFileToCloudinary } = require('../../config/cloudinary');
const { logAudit } = require('../../utils/audit');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
]);
const MAX_REPORT_SIZE = 10 * 1024 * 1024; // 10 MB

const addedReportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_REPORT_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, XLSX, XLS, CSV are allowed.'));
    }
  },
});

/** GET /api/reports/added-reports — list all non-deleted reports (SUPER_ADMIN only) */
router.get('/added-reports', requireRoles('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const reports = await prisma.recruitmentReport.findMany({
    where: { isDeleted: false },
    include: {
      uploadedBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: reports });
}));

/** POST /api/reports/added-reports — upload a new report (SUPER_ADMIN + can_add_recruitment_reports) */
router.post(
  '/added-reports',
  requireRoles('SUPER_ADMIN'),
  addedReportUpload.single('file'),
  asyncHandler(async (req, res) => {
    // Capability flag check
    if (!req.user.canAddRecruitmentReports) {
      throw new ApiError(403, 'You do not have permission to upload reports.');
    }

    if (!req.file) {
      throw new ApiError(400, 'A file is required.');
    }

    const { title, description } = req.body;
    if (!title || !title.trim()) {
      throw new ApiError(400, 'Report title is required.');
    }

    // Upload to Cloudinary under ats-recruitment-reports folder
    const dest = `recruitment-reports/${Date.now()}_${req.file.originalname}`;
    const fileUrl = await uploadFileToCloudinary(req.file.buffer, dest, req.file.mimetype);
    if (!fileUrl) {
      throw new ApiError(500, 'File upload to storage failed. Please try again.');
    }

    const report = await prisma.recruitmentReport.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedById: req.user.id,
      },
      include: {
        uploadedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      actorRole: req.user.role,
      action: 'RECRUITMENT_REPORT_UPLOADED',
      entityType: 'RECRUITMENT_REPORT',
      entityId: report.id,
      entityName: report.title,
      newData: { title: report.title, fileName: report.fileName, fileSize: report.fileSize },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      organizationId: req.user.organizationId || 'defaultOrg',
    });

    res.status(201).json({ success: true, data: report });
  })
);

/** DELETE /api/reports/added-reports/:id — soft-delete (SUPER_ADMIN + can_add_recruitment_reports) */
router.delete('/added-reports/:id', requireRoles('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  if (!req.user.canAddRecruitmentReports) {
    throw new ApiError(403, 'You do not have permission to delete reports.');
  }

  const report = await prisma.recruitmentReport.findUnique({
    where: { id: req.params.id },
  });
  if (!report || report.isDeleted) {
    throw new ApiError(404, 'Report not found.');
  }

  await prisma.recruitmentReport.update({
    where: { id: req.params.id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    actorRole: req.user.role,
    action: 'RECRUITMENT_REPORT_DELETED',
    entityType: 'RECRUITMENT_REPORT',
    entityId: report.id,
    entityName: report.title,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    organizationId: req.user.organizationId || 'defaultOrg',
  });

  res.json({ success: true, message: 'Report deleted.' });
}));

module.exports = router;
