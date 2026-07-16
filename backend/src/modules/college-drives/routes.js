const express = require("express");
const XLSX = require("xlsx");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { broadcast } = require("../../utils/sse");

const router = express.Router();
router.use(auth);

const CAN_ACCESS = ["SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"];

function normalizeText(value) {
  return String(value || "").trim();
}

// --- COLLEGES ---

router.get(
  "/colleges",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const colleges = await prisma.college.findMany({
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data: colleges });
  }),
);

router.post(
  "/colleges",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { name, location, area, year, role, course } = req.body;
    const normalizedName = normalizeText(name);
    if (!normalizedName) throw new ApiError(400, "College name is required");

    const collegeData = {
      name: normalizedName,
      location: normalizeText(location) || null,
      area: normalizeText(area) || null,
      year: normalizeText(year) || null,
      role: normalizeText(role) || null,
      course: normalizeText(course) || null,
      createdById: req.user.id
    };

    const college = await prisma.college.create({
      data: collegeData
    });
    res.status(201).json({ success: true, data: college });
  }),
);

router.patch(
  "/colleges/:id",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.id;
    
    if (updateData.name !== undefined) {
      updateData.name = normalizeText(updateData.name);
    }
    
    await prisma.college.update({
      where: { id },
      data: updateData
    });
    res.json({ success: true });
  }),
);

// --- DRIVES ---

router.get(
  "/drives",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { collegeId } = req.query;
    const where = { isDeleted: false };
    if (collegeId) where.collegeId = collegeId;

    const drives = await prisma.collegeDrive.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: drives });
  }),
);

router.post(
  "/drives",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { title, collegeId, dateFrom, dateTo, status, notes } = req.body;
    if (!title || !collegeId || !dateFrom) throw new ApiError(400, "Missing required drive fields");

    const driveData = {
      title,
      collegeId,
      dateFrom,
      dateTo: dateTo || null,
      status: status || "PLANNED",
      notes: notes || null,
      ownerId: req.user.id,
      organizationId: req.user.organizationId || "defaultOrg"
    };

    const drive = await prisma.collegeDrive.create({
      data: driveData
    });
    
    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.drive(orgId, drive.id);

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'DRIVE_CREATED', {
      driveId: drive.id,
      collegeName: driveData.title,
      driveDate: driveData.dateFrom,
      city: driveData.notes || "",
      createdBy: req.user.id,
      createdByName: req.user.fullName || req.user.email,
    });

    res.status(201).json({ success: true, data: drive });
  }),
);

// --- CANDIDATES & BULK ---

router.get(
  "/drives/:id/candidates",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const candidates = await prisma.collegeDriveCandidate.findMany({
      where: { driveId: req.params.id },
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: candidates });
  }),
);

router.post(
  "/drives/:id/candidates",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    const { fullName, email, phone } = req.body;
    if (!fullName || !phone) throw new ApiError(400, "fullName and phone are required");

    // Check duplicate candidate by phone
    const existingCandidate = await prisma.candidate.findFirst({
      where: { phone, isDeleted: false }
    });
    
    let candidateId;
    if (existingCandidate) {
      candidateId = existingCandidate.id;
    } else {
      const candidate = await prisma.candidate.create({
        data: {
          fullName,
          email: email || "N/A",
          phone,
          source: "College Drive",
          organizationId: req.user.organizationId || "defaultOrg"
        }
      });
      candidateId = candidate.id;
    }

    const driveDup = await prisma.collegeDriveCandidate.findFirst({
      where: { driveId, candidateId }
    });
    if (driveDup) throw new ApiError(409, "Candidate already in this drive");

    await prisma.collegeDriveCandidate.create({
      data: {
        driveId,
        candidateId,
        fullName,
        email: email || null,
        phone,
        status: "ADDED"
      }
    });

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.drive(orgId, driveId);

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'DRIVE_CANDIDATES_ADDED', {
      driveId,
      count: 1,
      collegeName: fullName,
      addedBy: req.user.id,
      addedByName: req.user.fullName || req.user.email,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/drives/:id/bulk-upload",
  requireRoles(...CAN_ACCESS),
  memoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    const driveId = req.params.id;
    if (!req.file) throw new ApiError(400, "Excel file is required");

    let allRows = [];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: false });
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
        
        sheetRows.forEach((row, idx) => {
          allRows.push({
            ...row,
            _sheetName: sheetName,
            _rowIndex: idx + 2
          });
        });
        console.log(`[BulkUpload] Parsed ${sheetRows.length} rows from sheet "${sheetName}"`);
      }
    } catch (err) {
      console.error("[BulkUpload] XLSX Parse Error:", err);
      throw new ApiError(400, "Failed to parse Excel file. Please ensure it is a valid .xlsx or .csv file.");
    }

    const results = { inserted: 0, skipped: 0, errors: [] };
    const orgId = req.user.organizationId || "defaultOrg";

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const sheetInfo = `[Sheet: ${row._sheetName}, Row ${row._rowIndex}]`;

      const getValue = (patterns) => {
        const key = Object.keys(row).find(k => 
          patterns.some(p => k.trim().toLowerCase() === p.toLowerCase())
        );
        return key ? String(row[key] || "").trim() : "";
      };

      const fullName = getValue(["fullName", "name", "Name", "NAME", "Full Name", "Student Name"]);
      const phone = getValue(["phone", "Phone", "PHONE", "contact", "Contact", "CONTACT", "mobile", "Mobile", "phone number", "PhoneNumber"]);
      const email = getValue(["email", "Email", "EMAIL", "mail id", "MailID"]).toLowerCase();

      // Skip completely empty rows
      if (!fullName && !phone && !email) continue;

      if (!fullName || !phone) {
        results.skipped++;
        results.errors.push(`${sheetInfo}: Missing fullName or phone`);
        continue;
      }

      try {
        const existingCandidate = await prisma.candidate.findFirst({
          where: { phone, isDeleted: false }
        });
        
        let candidateId;
        if (existingCandidate) {
          candidateId = existingCandidate.id;
        } else {
          const candidate = await prisma.candidate.create({
            data: {
              fullName,
              email: email || "N/A",
              phone,
              source: "College Drive Bulk",
              organizationId: orgId
            }
          });
          candidateId = candidate.id;
        }

        const driveDup = await prisma.collegeDriveCandidate.findFirst({
          where: { driveId, candidateId }
        });

        if (!driveDup) {
          await prisma.collegeDriveCandidate.create({
            data: {
              driveId,
              candidateId,
              fullName,
              email: email || null,
              phone,
              status: "ADDED"
            }
          });
          results.inserted++;
        } else {
          results.skipped++;
          results.errors.push(`${sheetInfo}: Candidate already in drive`);
        }
      } catch (e) {
        results.skipped++;
        results.errors.push(`${sheetInfo}: Error - ${e.message}`);
      }
    }

    if (results.inserted > 0) {
      const inv = require("../../utils/cacheInvalidation");
      await inv.drive(orgId, driveId);
      await inv.candidateList(orgId);

      const sse = require("../../utils/sse");
      sse.broadcastToOrg(orgId, 'DRIVE_CANDIDATES_ADDED', {
        driveId,
        count: results.inserted,
        collegeName: "Bulk Upload",
        addedBy: req.user.id,
        addedByName: req.user.fullName || req.user.email,
      });
    }
    res.json({ success: true, data: results });
  }),
);

// --- RECRUITERS, JOBS & STATUS ---

router.post("/drives/:id/recruiters", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const { recruiterIds } = req.body;
  const recruiters = recruiterIds.map(uid => ({ userId: uid, assignedAt: new Date().toISOString() }));
  
  await prisma.collegeDrive.update({
    where: { id: req.params.id },
    data: { recruiters }
  });
  res.json({ success: true });
}));

router.post("/drives/:id/jobs", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const { jobIds } = req.body;
  const drive = await prisma.collegeDrive.findUnique({
    where: { id: req.params.id }
  });
  if (!drive) throw new ApiError(404, "Drive not found");
  
  let existing = [];
  try {
    existing = typeof drive.linkedJobs === 'string' ? JSON.parse(drive.linkedJobs) : drive.linkedJobs;
  } catch (_) {}
  if (!Array.isArray(existing)) existing = [];
  
  for (const jid of jobIds) {
    if (!existing.some(l => l.jobId === jid)) {
      const job = await prisma.job.findUnique({
        where: { id: jid }
      });
      if (job) {
        existing.push({ jobId: jid, job, linkedAt: new Date().toISOString() });
      }
    }
  }
  
  await prisma.collegeDrive.update({
    where: { id: req.params.id },
    data: { linkedJobs: existing }
  });
  res.json({ success: true });
}));

router.delete("/drives/:id/jobs/:jobId", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const drive = await prisma.collegeDrive.findUnique({
    where: { id: req.params.id }
  });
  if (!drive) throw new ApiError(404, "Drive not found");
  
  let existing = [];
  try {
    existing = typeof drive.linkedJobs === 'string' ? JSON.parse(drive.linkedJobs) : drive.linkedJobs;
  } catch (_) {}
  if (!Array.isArray(existing)) existing = [];
  
  const filtered = existing.filter(l => l.jobId !== req.params.jobId);
  await prisma.collegeDrive.update({
    where: { id: req.params.id },
    data: { linkedJobs: filtered }
  });
  res.json({ success: true });
}));

router.patch("/drives/:id/candidates/:candidateId/status", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const driveCandidate = await prisma.collegeDriveCandidate.findFirst({
    where: {
      driveId: req.params.id,
      candidateId: req.params.candidateId
    }
  });

  if (driveCandidate) {
    await prisma.collegeDriveCandidate.update({
      where: { id: driveCandidate.id },
      data: { status: req.body.status }
    });
    
    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.drive(orgId, req.params.id);

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'DRIVE_STATUS_CHANGED', {
      driveId: req.params.id,
      status: req.body.status,
      collegeName: driveCandidate.fullName,
      changedBy: req.user.id,
      changedByName: req.user.fullName || req.user.email,
    });
  }
  res.json({ success: true });
}));

router.get("/drives/:id/timeline", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  res.json({ success: true, data: [] });
}));

module.exports = router;
