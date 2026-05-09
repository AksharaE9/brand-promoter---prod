const express = require("express");
const XLSX = require("xlsx");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();
router.use(auth);

const CAN_ACCESS = ["SUPER_ADMIN", "RECRUITER", "INTERVIEWER"];

function normalizeText(value) {
  return String(value || "").trim();
}

// --- COLLEGES ---

router.get(
  "/colleges",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("colleges").orderBy("name", "asc").get();
    const colleges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("colleges").add(collegeData);
    res.status(201).json({ success: true, data: { id: docRef.id, ...collegeData } });
  }),
);

router.patch(
  "/colleges/:id",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = { ...req.body, updatedAt: new Date().toISOString() };
    delete updateData.id;
    await firestore.collection("colleges").doc(id).update(updateData);
    res.json({ success: true });
  }),
);

// --- DRIVES ---

router.get(
  "/drives",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const { collegeId } = req.query;
    let query = firestore.collection("collegeDrives");
    if (collegeId) query = query.where("collegeId", "==", collegeId);
    const snapshot = await query.orderBy("createdAt", "desc").get();
    const drives = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      title, collegeId, dateFrom,
      dateTo: dateTo || null,
      status: status || "PLANNED",
      notes: notes || null,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("collegeDrives").add(driveData);
    res.status(201).json({ success: true, data: { id: docRef.id, ...driveData } });
  }),
);

// --- CANDIDATES & BULK ---

router.get(
  "/drives/:id/candidates",
  requireRoles(...CAN_ACCESS),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("collegeDriveCandidates")
      .where("driveId", "==", req.params.id)
      .orderBy("createdAt", "desc").get();
    const candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    const dupSnap = await firestore.collection("candidates").where("phone", "==", phone).limit(1).get();
    let candidateId;
    if (!dupSnap.empty) {
      candidateId = dupSnap.docs[0].id;
    } else {
      const candRef = await firestore.collection("candidates").add({
        fullName, email, phone, source: "College Drive", createdAt: new Date().toISOString()
      });
      candidateId = candRef.id;
    }

    const driveDup = await firestore.collection("collegeDriveCandidates")
      .where("driveId", "==", driveId).where("candidateId", "==", candidateId).limit(1).get();
    if (!driveDup.empty) throw new ApiError(409, "Candidate already in this drive");

    await firestore.collection("collegeDriveCandidates").add({
      driveId, candidateId, fullName, email, phone, status: "ADDED", createdAt: new Date().toISOString()
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

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNo = i + 2;
      const fullName = String(row.fullName || row.name || "").trim();
      const phone = String(row.phone || "").trim();
      const email = String(row.email || "").trim().toLowerCase();

      if (!fullName || !phone) {
        results.skipped++;
        results.errors.push(`Row ${lineNo}: Missing fullName or phone`);
        continue;
      }

      try {
        const dupSnap = await firestore.collection("candidates").where("phone", "==", phone).limit(1).get();
        let candidateId;
        if (!dupSnap.empty) {
          candidateId = dupSnap.docs[0].id;
        } else {
          const candRef = await firestore.collection("candidates").add({
            fullName, email, phone, source: "College Drive Bulk", createdAt: new Date().toISOString()
          });
          candidateId = candRef.id;
        }

        const driveDup = await firestore.collection("collegeDriveCandidates")
          .where("driveId", "==", driveId).where("candidateId", "==", candidateId).limit(1).get();

        if (driveDup.empty) {
          await firestore.collection("collegeDriveCandidates").add({
            driveId, candidateId, fullName, email, phone, status: "ADDED", createdAt: new Date().toISOString()
          });
          results.inserted++;
        } else {
          results.skipped++;
          results.errors.push(`Row ${lineNo}: Candidate already in drive`);
        }
      } catch (e) {
        results.skipped++;
        results.errors.push(`Row ${lineNo}: Error - ${e.message}`);
      }
    }
    res.json({ success: true, data: results });
  }),
);

// --- RECRUITERS, JOBS & STATUS ---

router.post("/drives/:id/recruiters", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const { recruiterIds } = req.body;
  const recruiters = recruiterIds.map(uid => ({ userId: uid, assignedAt: new Date().toISOString() }));
  await firestore.collection("collegeDrives").doc(req.params.id).update({ recruiters });
  res.json({ success: true });
}));

router.post("/drives/:id/jobs", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const { jobIds } = req.body;
  const driveRef = firestore.collection("collegeDrives").doc(req.params.id);
  const drive = (await driveRef.get()).data();
  const existing = drive.linkedJobs || [];
  
  for (const jid of jobIds) {
    if (!existing.some(l => l.jobId === jid)) {
      const jobDoc = await firestore.collection("jobs").doc(jid).get();
      if (jobDoc.exists) {
        existing.push({ jobId: jid, job: { id: jobDoc.id, ...jobDoc.data() }, linkedAt: new Date().toISOString() });
      }
    }
  }
  await driveRef.update({ linkedJobs: existing });
  res.json({ success: true });
}));

router.delete("/drives/:id/jobs/:jobId", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const driveRef = firestore.collection("collegeDrives").doc(req.params.id);
  const drive = (await driveRef.get()).data();
  const filtered = (drive.linkedJobs || []).filter(l => l.jobId !== req.params.jobId);
  await driveRef.update({ linkedJobs: filtered });
  res.json({ success: true });
}));

router.patch("/drives/:id/candidates/:candidateId/status", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  const snap = await firestore.collection("collegeDriveCandidates")
    .where("driveId", "==", req.params.id)
    .where("candidateId", "==", req.params.candidateId)
    .limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({ status: req.body.status, updatedAt: new Date().toISOString() });
  }
  res.json({ success: true });
}));

router.get("/drives/:id/timeline", requireRoles(...CAN_ACCESS), asyncHandler(async (req, res) => {
  // Simple timeline: just return empty for now or fetch pipeline events
  res.json({ success: true, data: [] });
}));

module.exports = router;
