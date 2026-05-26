const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const { broadcast } = require("../../utils/sse");
const { markAsJoined, markAsRejected } = require("./offerDecisionService");

const router = express.Router();

router.use(auth);

// ── Offer Decision Routes ─────────────────────────────────────────────────────
router.post(
  "/:applicationId/join",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  markAsJoined
);

router.post(
  "/:applicationId/reject",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  markAsRejected
);

async function resolveDefaultStage(jobId) {
  // In Firestore, we'll look for stages in the "pipeline_stages" collection
  const snapshot = await firestore.collection("pipeline_stages")
    .where("jobId", "==", jobId)
    .orderBy("sortOrder", "asc")
    .limit(1)
    .get();
  
  if (!snapshot.empty) return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

  const globalSnapshot = await firestore.collection("pipeline_stages")
    .where("jobId", "==", null)
    .orderBy("sortOrder", "asc")
    .limit(1)
    .get();
  
  if (!globalSnapshot.empty) return { id: globalSnapshot.docs[0].id, ...globalSnapshot.docs[0].data() };

  return null;
}

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { candidateId, jobId, currentStageId, shortlisted = false } = req.body;

    if (!candidateId || !jobId) {
      throw new ApiError(400, "candidateId and jobId are required");
    }

    const [candidateDoc, jobDoc] = await Promise.all([
      firestore.collection("candidates").doc(candidateId).get(),
      firestore.collection("jobs").doc(jobId).get()
    ]);

    if (!candidateDoc.exists) throw new ApiError(404, "Candidate not found");
    if (!jobDoc.exists) throw new ApiError(404, "Job not found");

    const candidate = { id: candidateDoc.id, ...candidateDoc.data() };
    const job = { id: jobDoc.id, ...jobDoc.data() };

    const duplicateSnap = await firestore.collection("applications")
      .where("candidateId", "==", candidateId)
      .where("jobId", "==", jobId)
      .limit(1)
      .get();
    
    if (!duplicateSnap.empty) {
      throw new ApiError(409, "Application already exists for this candidate and job");
    }

    let stageId = currentStageId;
    if (!stageId) {
      const defaultStage = await resolveDefaultStage(jobId);
      if (!defaultStage) {
        throw new ApiError(400, "No pipeline stages found. Create stages first.");
      }
      stageId = defaultStage.id;
    }

    const applicationData = {
      candidateId,
      jobId,
      currentStageId: stageId,
      shortlisted,
      status: "IN_PIPELINE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("applications").add(applicationData);
    const applicationId = docRef.id;

    // Record initial pipeline event
    await firestore.collection("pipeline_events").add({
      applicationId,
      fromStageId: null,
      toStageId: stageId,
      remark: "Application created",
      movedById: req.user.id,
      movedByName: req.user.fullName,
      movedAt: new Date().toISOString()
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_APPLICATION",
      entityType: "APPLICATION",
      entityId: applicationId,
      newData: applicationData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await notifyAdmins({
      title: 'New Application',
      message: `${candidate.fullName} applied for ${job.title}`,
      link: `/candidates/${candidateId}`
    });

    res.status(201).json({ success: true, data: { id: applicationId, ...applicationData } });
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 20;

    let query = firestore.collection("applications");
    if (req.query.jobId) query = query.where("jobId", "==", req.query.jobId);
    if (req.query.candidateId) query = query.where("candidateId", "==", req.query.candidateId);
    if (req.query.stageId) query = query.where("currentStageId", "==", req.query.stageId);

    // Try orderBy, fallback if no index
    let hasOrderBy = false;
    try {
      query = query.orderBy("createdAt", "desc");
      hasOrderBy = true;
    } catch (e) {
      console.warn("⚠️ orderBy skipped - no index:", e.message);
    }

    // Get data
    let snapshot;
    try {
      snapshot = await query.limit(page * limit).get();
    } catch (queryErr) {
      console.error("❌ Query failed:", queryErr.message);
      // Fallback: simple query without order
      snapshot = await firestore.collection("applications").limit(page * limit).get();
    }
    let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort in memory if no orderBy
    if (!hasOrderBy) {
      items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    // Page-based slicing
    const paginated = items.slice((page - 1) * limit, page * limit);

    // Get total count - with fallback
    let total = paginated.length;
    try {
      const totalSnap = await query.count().get();
      total = totalSnap.data().count;
    } catch (countErr) {
      console.warn("⚠️ Count query failed:", countErr.message);
      // Count all documents
      try {
        const allSnap = await firestore.collection("applications").limit(1000).get();
        total = allSnap.size;
      } catch (e) { total = paginated.length; }
    }

    // Populate relations
    if (paginated.length > 0) {
      const candidateIds = [...new Set(paginated.map(a => a.candidateId))];
      const jobIds = [...new Set(paginated.map(a => a.jobId))];
      const stageIds = [...new Set(paginated.map(a => a.currentStageId).filter(Boolean))];

      const candRefs = candidateIds.map(id => firestore.collection("candidates").doc(id));
      const jobRefs = jobIds.map(id => firestore.collection("jobs").doc(id));
      const stageRefs = stageIds.map(id => firestore.collection("pipeline_stages").doc(id));

      const [candSnaps, jobSnaps, stageSnaps] = await Promise.all([
        candRefs.length > 0 ? firestore.getAll(...candRefs) : Promise.resolve([]),
        jobRefs.length > 0 ? firestore.getAll(...jobRefs) : Promise.resolve([]),
        stageRefs.length > 0 ? firestore.getAll(...stageRefs) : Promise.resolve([])
      ]);

      const candMap = {};
      candSnaps.forEach(s => { if (s.exists) candMap[s.id] = { id: s.id, ...s.data() }; });
      const jobMap = {};
      jobSnaps.forEach(s => { if (s.exists) jobMap[s.id] = { id: s.id, ...s.data() }; });
      const stageMap = {};
      stageSnaps.forEach(s => { if (s.exists) stageMap[s.id] = { id: s.id, ...s.data() }; });

      paginated.forEach(a => {
        a.candidate = candMap[a.candidateId] || null;
        a.job = jobMap[a.jobId] || null;
        a.currentStage = stageMap[a.currentStageId] || null;
      });
    }

    res.json({
      success: true,
      data: paginated,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const doc = await firestore.collection("applications").doc(req.params.id).get();
    if (!doc.exists) throw new ApiError(404, "Application not found");
    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  }),
);

router.patch(
  "/:id/shortlist",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { shortlisted } = req.body || {};

    if (typeof shortlisted !== "boolean") {
      throw new ApiError(400, "shortlisted must be boolean");
    }

    const docRef = firestore.collection("applications").doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) throw new ApiError(404, "Application not found");
    const existing = doc.data();

    await docRef.update({ shortlisted, updatedAt: new Date().toISOString() });

    await logAudit({
      actorUserId: req.user.id,
      action: shortlisted ? "SHORTLIST_APPLICATION" : "UNSHORTLIST_APPLICATION",
      entityType: "APPLICATION",
      entityId: id,
      oldData: { shortlisted: existing.shortlisted },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { id, ...existing, shortlisted } });
  }),
);

router.patch(
  "/:id/status",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, joiningDate } = req.body;

    if (!status) throw new ApiError(400, "status is required");

    const docRef = firestore.collection("applications").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) throw new ApiError(404, "Application not found");

    const oldData = doc.data();
    const updatePayload = { 
      status, 
      updatedAt: new Date().toISOString() 
    };
    if (joiningDate) updatePayload.joiningDate = joiningDate;
    
    await docRef.update(updatePayload);

    // Sync candidate status for sidebar views
    if (['JOINED', 'REJECTED', 'OFFER_SENT'].includes(status)) {
      const candUpdate = {
        status,
        updatedAt: new Date().toISOString()
      };
      if (status === 'JOINED' && joiningDate) {
        candUpdate.doj = joiningDate;
      }
      await firestore.collection("candidates").doc(oldData.candidateId).update(candUpdate);
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_APPLICATION_STATUS",
      entityType: "APPLICATION",
      entityId: id,
      oldData: { status: oldData.status },
      newData: { status },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: 'APPLICATION_STATUS_UPDATED', applicationId: id, status });

    res.json({ success: true, data: { id, status } });
  }),
);

module.exports = router;
