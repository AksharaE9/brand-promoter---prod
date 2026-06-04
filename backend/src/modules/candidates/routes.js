const express = require("express");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { db: firestore, uploadFileToFirebase, FieldPath } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, memoryUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const sse = require("../../utils/sse");
const { getCache, setCache, TTL, getCached } = require("../../utils/cache");
const inv = require("../../utils/cacheInvalidation");

const isSafeKey = (key) => key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const router = express.Router();

router.use(auth);

router.get(
  "/custom-fields/definitions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("custom_field_definitions").get();
    const definitions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, data: definitions });
  })
);

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
    
    const batch = firestore.batch();
    const existingEmails = new Set();
    const existingPhones = new Set();

    for (let i = 0; i < allRows.length; i += 1) {
      const raw = allRows[Number(i)];
      const fullName = String(raw.fullName || raw.name || "").trim();
      const email = String(raw.email || "").trim().toLowerCase() || null;
      const phone = String(raw.phone || "").trim() || null;
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

      const orgId = req.user.organizationId || "defaultOrg";
      batch.set(candRef, {
        fullName,
        email: email || "N/A",
        phone,
        currentCompany: String(raw.currentCompany || "").trim() || null,
        totalExperienceYears: raw.totalExperienceYears || raw.experienceYears ? parseFloat(raw.totalExperienceYears || raw.experienceYears) : null,
        source: String(raw.source || "Excel Upload").trim(),
        createdById: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "ACTIVE",
        organizationId: orgId,
        isDeleted: false
      });
      
      if (email) existingEmails.add(email);
      if (phone) existingPhones.add(phone);
      inserted++;
    }

    if (inserted > 0) {
      await batch.commit();
      const orgId = req.user.organizationId || "defaultOrg";
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

    setTimeout(async () => {
      let inserted = 0;
      let skipped = 0;
      
      try {
        for (let i = 0; i < rows.length; i++) {
          const raw = rows[Number(i)];
          const fullName = String(raw.fullName || raw.name || "").trim();
          const email = String(raw.email || "").trim().toLowerCase() || null;
          const phone = String(raw.phone || "").trim() || null;

          if (!fullName || !phone) {
            skipped++;
            continue;
          }

          const orgId = req.user.organizationId || "defaultOrg";
          const candRef = await firestore.collection("candidates").add({
            fullName,
            email: email || "N/A",
            phone,
            location: raw.location || null,
            area: raw.area || null,
            course: raw.course || null,
            graduationYear: raw.graduationYear ? String(raw.graduationYear) : null,
            preferredRole: raw.preferredRole || null,
            source: "Bulk Import Wizard",
            createdById: req.user.id,
            createdAt: new Date().toISOString(),
            status: "ACTIVE",
            organizationId: orgId,
            isDeleted: false
          });

          await firestore.collection("applications").add({
            candidateId: candRef.id,
            jobId: jobId,
            status: "IN_PIPELINE",
            createdAt: new Date().toISOString(),
            organizationId: orgId,
            isDeleted: false
          });

          inserted++;
          importJobs.set(importJobId, { status: 'processing', progress: Math.floor(((i + 1) / rows.length) * 100), total: rows.length, inserted, skipped });
        }

        importJobs.set(importJobId, { status: 'completed', progress: 100, total: rows.length, inserted, skipped });
        
        broadcast({ type: 'CANDIDATE_CREATED', count: inserted });

        await firestore.collection("notifications").add({
          userId: req.user.id,
          title: "Bulk Import Complete",
          message: `Imported ${inserted} candidates.`,
          type: "INFO",
          createdAt: new Date().toISOString()
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

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const data = req.body;
    if (!data.fullName) throw new ApiError(400, "fullName is required");
    if (!data.phone) throw new ApiError(400, "Phone number is required");

    // Deduplication by phone
    const existingPhone = await firestore.collection("candidates").where("phone", "==", data.phone.trim()).limit(1).get();
    if (!existingPhone.empty) throw new ApiError(409, "A candidate with this phone number already exists.");

    const orgId = req.user.organizationId || "defaultOrg";
    const candidateData = {
      ...data,
      email: data.email || "N/A",
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      organizationId: orgId,
      isDeleted: false
    };

    const docRef = await firestore.collection("candidates").add(candidateData);

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: docRef.id,
      newData: candidateData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Invalidate cache to ensure dashboard and lists are updated
    await inv.candidate(orgId, docRef.id);

    // Broadcast to notify frontend to refresh
    sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', {
      candidateId: docRef.id,
      candidate: { id: docRef.id, ...candidateData },
      createdBy: req.user.id,
      createdByName: req.user.fullName || req.user.email,
    });

    res.status(201).json({ success: true, data: { id: docRef.id, ...candidateData } });
  }),
);

router.post(
  "/with-resume-upload",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "candidate-resumes";
    next();
  },
  upload.single("resume"),
  asyncHandler(async (req, res) => {
    console.log("📥 Incoming candidate creation request with resume...");
    const { fullName, email, phone, course, location, preferredRole } = req.body;
    console.log("📝 Data:", { fullName, email, phone });

    if (!fullName) throw new ApiError(400, "fullName is required");
    if (!phone) throw new ApiError(400, "Phone number is required");

    const existingPhone = await firestore.collection("candidates").where("phone", "==", phone.trim()).limit(1).get();
    if (!existingPhone.empty) throw new ApiError(409, "A candidate with this phone number already exists.");

    let resumeFileId = null;
    let storageKey = null;
    if (req.file) {
      console.log("📄 File received:", req.file.originalname);
      const dest = `resumes/${Date.now()}_${req.file.originalname}`;
      storageKey = await uploadFileToFirebase(req.file.buffer, dest, req.file.mimetype);
      
      if (!storageKey) {
        console.error("❌ Storage key is null!");
        throw new ApiError(500, "Failed to upload resume to storage");
      }

      const fileMeta = {
        storageKey,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.user.id,
        createdAt: new Date().toISOString()
      };
      const fileRef = await firestore.collection("fileMetas").add(fileMeta);
      resumeFileId = fileRef.id;
    }

    const orgId = req.user.organizationId || "defaultOrg";
    const candidateData = {
      ...req.body,
      email: email || "N/A",
      resumeFileId,
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      category: req.body.category || "External",
      organizationId: orgId,
      isDeleted: false
    };

    const docRef = await firestore.collection("candidates").add(candidateData);

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_CANDIDATE_WITH_RESUME",
      entityType: "CANDIDATE",
      entityId: docRef.id,
      newData: candidateData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await inv.candidate(orgId, docRef.id);

    sse.broadcastToOrg(orgId, 'CANDIDATE_CREATED', {
      candidateId: docRef.id,
      candidate: { id: docRef.id, ...candidateData },
      createdBy: req.user.id,
      createdByName: req.user.fullName || req.user.email,
    });

    res.status(201).json({ 
      success: true, 
      data: { id: docRef.id, ...candidateData } 
    });
  })
);

async function populateCandidateRelations(paginatedItems) {
  if (paginatedItems.length === 0) return;
  const fileIds = [...new Set(paginatedItems.flatMap(c => [c.resumeFileId, c.profilePhotoFileId]).filter(Boolean))];
  const candidateIds = paginatedItems.map(c => c.id);

  const [fileMap, appMap] = await Promise.all([
    (async () => {
      const map = {};
      if (fileIds.length > 0) {
        try {
          const fileRefs = fileIds.map(id => firestore.collection("fileMetas").doc(id));
          const snaps = await firestore.getAll(...fileRefs);
          snaps.forEach(fs => { if (fs.exists && isSafeKey(fs.id)) map[fs.id] = { id: fs.id, ...fs.data() }; });
        } catch (e) { console.warn("⚠️ File fetch failed:", e.message); }
      }
      return map;
    })(),
    (async () => {
      const map = {};
      try {
        const appChunks = [];
        for (let i = 0; i < candidateIds.length; i += 10) appChunks.push(candidateIds.slice(i, i + 10));
        
        const allApps = [];
        await Promise.all(appChunks.map(async (chunk) => {
          const appSnap = await firestore.collection("applications")
            .where("candidateId", "in", chunk)
            .get();
          appSnap.docs.forEach(doc => {
            allApps.push({ id: doc.id, ...doc.data() });
          });
        }));

        const jobIds = [...new Set(allApps.map(a => a.jobId).filter(Boolean))];
        const jobMap = {};
        if (jobIds.length > 0) {
          try {
            const jobRefs = jobIds.map(id => firestore.collection("jobs").doc(id));
            const jobSnaps = await firestore.getAll(...jobRefs);
            jobSnaps.forEach(js => { if (js.exists && isSafeKey(js.id)) jobMap[js.id] = { id: js.id, ...js.data() }; });
          } catch (je) { console.warn("⚠️ Job fetch failed inside candidates list:", je.message); }
        }

        allApps.forEach(app => {
          app.job = (isSafeKey(app.jobId) && jobMap[app.jobId]) || null;
          if (isSafeKey(app.candidateId)) {
            if (!map[app.candidateId]) map[app.candidateId] = [];
            map[app.candidateId].push(app);
          }
        });
      } catch (e) { console.warn("⚠️ App fetch failed:", e.message); }
      return map;
    })(),
  ]);

  paginatedItems.forEach(c => {
    if (c.resumeFileId && isSafeKey(c.resumeFileId)) c.resumeFile = fileMap[c.resumeFileId] || null;
    if (c.profilePhotoFileId && isSafeKey(c.profilePhotoFileId)) c.profilePhotoFile = fileMap[c.profilePhotoFileId] || null;
    c.applications = (isSafeKey(c.id) && appMap[c.id]) || [];
  });
}

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const cursor = req.query.cursor?.trim();
    const search = req.query.search?.trim()?.toLowerCase();
    const category = req.query.category?.trim();
    const status = req.query.status?.trim();
    const assignedToMe = req.query.assignedToMe === 'true';
    const orgId = req.user.organizationId || "defaultOrg";

    const cacheKeyStr = `candidates:list:${cursor || 'start'}:${limit}:${search || ''}:${category || ''}:${status || ''}:${assignedToMe}:${req.user.id}`;

    const data = await getCached(cacheKeyStr, async () => {
      let query = firestore.collection("candidates")
        .where("organizationId", "==", orgId)
        .where("isDeleted", "==", false);

      let useCursorPagination = true;

      if (status) {
        query = query.where("status", "==", status);
      }
      if (category) {
        query = query.where("category", "==", category);
      }
      if (assignedToMe) {
        query = query.where("mentorId", "==", req.user.id);
      }

      if (search) {
        useCursorPagination = false;
      }

      query = query.orderBy("createdAt", "desc");

      if (useCursorPagination) {
        const { paginateFirestore } = require("../../utils/pagination");
        const result = await paginateFirestore({ query, limit, cursor });
        const paginatedItems = result.data;
        const nextCursor = result.nextCursor;
        const hasMore = result.hasMore;
        
        await populateCandidateRelations(paginatedItems);

        return { items: paginatedItems, nextCursor, hasMore };
      } else {
        const poolSize = 3000;
        const snapshot = await query.limit(poolSize).get();
        let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (search) {
          items = items.filter(c =>
            (c.fullName && c.fullName.toLowerCase().includes(search)) ||
            (c.email && c.email.toLowerCase().includes(search)) ||
            (c.phone && c.phone.includes(search))
          );
        }

        let startIndex = 0;
        if (cursor) {
          const idx = items.findIndex(item => item.id === cursor);
          if (idx !== -1) {
            startIndex = idx + 1;
          }
        }

        const paginatedItems = items.slice(startIndex, startIndex + limit);
        const nextCursor = (startIndex + limit < items.length) ? paginatedItems[paginatedItems.length - 1].id : null;
        const hasMore = startIndex + limit < items.length;

        await populateCandidateRelations(paginatedItems);

        return { items: paginatedItems, nextCursor, hasMore };
      }
    }, 30000);

    res.json({
      success: true,
      data: data.items,
      nextCursor: data.nextCursor,
      hasMore: data.hasMore
    });
  })
);


router.get(
  "/:id/history",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const cacheKey = `candidates:history:${id}`;

    const data = await getCached(cacheKey, async () => {
      // Fetch candidate + applications in parallel
      const [candDoc, appSnap] = await Promise.all([
        firestore.collection("candidates").doc(id).get(),
        firestore.collection("applications").where("candidateId", "==", id).get(),
      ]);

      if (!candDoc.exists) throw new ApiError(404, "Candidate not found");

      const applications = appSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const timeline = applications.map(app => ({
        type: "APPLICATION_CREATED",
        at: app.createdAt,
        applicationId: app.id,
      }));

      const appIds = applications.map(app => app.id);

      if (appIds.length > 0) {
        // Batch into chunks of 30 (Firestore "in" limit)
        const chunks = [];
        for (let i = 0; i < appIds.length; i += 30) chunks.push(appIds.slice(i, i + 30));

        // Run all event + interview batch queries in parallel
        const [eventsSnaps, interviewsSnaps] = await Promise.all([
          Promise.all(chunks.map(chunk =>
            firestore.collection("pipeline_events")
              .where("applicationId", "in", chunk).get()
          )),
          Promise.all(chunks.map(chunk =>
            firestore.collection("interviews")
              .where("applicationId", "in", chunk).get()
          )),
        ]);

        eventsSnaps.forEach(snap =>
          snap.docs.forEach(d => timeline.push({ type: "PIPELINE_MOVED", at: d.data().movedAt, ...d.data() }))
        );
        interviewsSnaps.forEach(snap =>
          snap.docs.forEach(d => timeline.push({ type: "INTERVIEW_SCHEDULED", at: d.data().scheduledStart, ...d.data() }))
        );
      }

      timeline.sort((a, b) => new Date(b.at) - new Date(a.at));

      return { candidate: candDoc.data(), applications, timeline };
    }, 30000); // 30s cache

    res.json({ success: true, data });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = req.body;

    const candRef = firestore.collection("candidates").doc(id);
    const doc = await candRef.get();
    if (!doc.exists) throw new ApiError(404, "Candidate not found");

    if (data.phone) {
      const currentPhoneClean = (doc.data().phone || "").replace(/\D/g, "");
      const newPhoneClean = data.phone.replace(/\D/g, "");
      if (currentPhoneClean !== newPhoneClean) {
        const existingPhone = await firestore.collection("candidates").where("phone", "==", data.phone.trim()).limit(1).get();
        if (!existingPhone.empty && existingPhone.docs[0].id !== id) {
          throw new ApiError(409, "A candidate with this phone number already exists.");
        }
      }
    }

    if (data.email === "" || data.email === null) {
      data.email = "N/A";
    }

    await candRef.update({ ...data, updatedAt: new Date().toISOString() });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      newData: data,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const orgId = req.user.organizationId || "defaultOrg";

    // ✨ Respond immediately — don't block on cache invalidation (was causing 5-19s delays)
    res.json({ success: true, data: { id, ...doc.data(), ...data } });

    // Fire cache invalidation & SSE broadcast AFTER response is sent
    setImmediate(async () => {
      try { await inv.candidate(orgId, id); } catch (_) {}
      sse.broadcastToOrg(orgId, 'CANDIDATE_UPDATED', {
        candidateId: id,
        changes: data,
        updatedBy: req.user.id,
        updatedByName: req.user.fullName || req.user.email,
      });
    });
  }),
);

router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("candidates").select("category").get();
    const list = [...new Set(snapshot.docs.map(doc => doc.data().category).filter(Boolean))];
    res.json({ success: true, data: list });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const doc = await firestore.collection("candidates").doc(id).get();
    if (!doc.exists) throw new ApiError(404, "Candidate not found");

    const data = { id: doc.id, ...doc.data() };

    // Populate file details
    if (data.resumeFileId) {
      const resumeDoc = await firestore.collection("fileMetas").doc(data.resumeFileId).get();
      if (resumeDoc.exists) data.resumeFile = { id: resumeDoc.id, ...resumeDoc.data() };
    }
    if (data.profilePhotoFileId) {
      const photoDoc = await firestore.collection("fileMetas").doc(data.profilePhotoFileId).get();
      if (photoDoc.exists) data.profilePhotoFile = { id: photoDoc.id, ...photoDoc.data() };
    }

    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/resume",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  upload.single("resume"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) throw new ApiError(400, "No resume file uploaded");

    const doc = await firestore.collection("candidates").doc(id).get();
    if (!doc.exists) throw new ApiError(404, "Candidate not found");

    const dest = `resumes/${Date.now()}_${req.file.originalname}`;
    const storageKey = await uploadFileToFirebase(req.file.buffer, dest, req.file.mimetype);
    
    if (!storageKey) {
      throw new ApiError(500, "Failed to upload resume to storage");
    }

    const fileMeta = {
      storageKey,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedById: req.user.id,
      createdAt: new Date().toISOString()
    };
    const fileRef = await firestore.collection("fileMetas").add(fileMeta);
    
    await firestore.collection("candidates").doc(id).update({
      resumeFileId: fileRef.id,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true, data: { resumeFileId: fileRef.id, storageKey } });
  }),
);

router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const doc = await firestore.collection("candidates").doc(id).get();
    if (!doc.exists) throw new ApiError(404, "Candidate not found");
    
    await firestore.collection("candidates").doc(id).update({ isDeleted: true, deletedAt: new Date().toISOString() });

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_CANDIDATE",
      entityType: "CANDIDATE",
      entityId: id,
      oldData: doc.data(),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const orgId = req.user.organizationId || "defaultOrg";
    await inv.candidate(orgId, id);

    sse.broadcastToOrg(orgId, 'CANDIDATE_DELETED', {
      candidateId: id,
      deletedBy: req.user.id,
      deletedByName: req.user.fullName || req.user.email,
    });

    res.json({ success: true, message: "Candidate deleted successfully" });
  }),
);

// DELETE all candidates (admin only - for testing/reset)
router.delete(
  "/all",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("candidates").get();
    const batch = firestore.batch();

    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_ALL_CANDIDATES",
      entityType: "CANDIDATE",
      oldData: { count: snapshot.size },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Invalidate all cache
    invalidateAll();

    res.json({ success: true, message: `Deleted ${snapshot.size} candidates` });
  }),
);

router.get(
  "/reports/joining",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    let query = firestore.collection("candidates").where("doj", "!=", null);

    const snapshot = await query.get();
    let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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

router.post(
  "/:id/transfer",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.organizationId || "defaultOrg";
    const appRef = await firestore.collection("applications").add({
      candidateId: id,
      jobId: toJobId,
      status: "IN_PIPELINE",
      createdAt: new Date().toISOString()
    });

    await inv.application(orgId, id);

    // Fetch job details
    const jobDoc = await firestore.collection("jobs").doc(toJobId).get();
    const toJobTitle = jobDoc.exists ? jobDoc.data().title : "New Job";

    sse.broadcastToOrg(orgId, 'APPLICATION_TRANSFERRED', {
      applicationId: appRef.id,
      candidateId: id,
      toJobId,
      toJobTitle,
      transferredBy: req.user.id,
      transferredByName: req.user.fullName || req.user.email,
    });

    res.json({ success: true, data: { id: appRef.id } });
  })
);

module.exports = router;
