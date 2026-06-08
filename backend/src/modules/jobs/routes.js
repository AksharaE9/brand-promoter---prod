const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");

const router = express.Router();

router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("jobs")
      .where("isActive", "==", true)
      .orderBy("createdAt", "desc")
      .get();
    
    const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
    const { getCached } = require("../../utils/cache");
    const orgId = req.user.organizationId || "defaultOrg";
    const cacheKeyStr = `jobs:list:${orgId}:${cursor || 'start'}:${limit}:${req.query.isActive || ''}:${req.query.search || ''}`;

    const result = await getCached(cacheKeyStr, async () => {
      let query = firestore.collection("jobs");
      
      if (req.query.isActive === "true") query = query.where("isActive", "==", true);
      if (req.query.isActive === "false") query = query.where("isActive", "==", false);

      let snapshot;
      let items = [];
      try {
        snapshot = await query.orderBy("createdAt", "desc").get();
        items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (e) {
        console.log("⚠️ Missing Index for Jobs Sort. Falling back to in-memory sort.");
        snapshot = await query.get();
        items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      }

      if (req.query.search) {
        const search = req.query.search.toLowerCase();
        items = items.filter(item => 
          (item.title && item.title.toLowerCase().includes(search)) ||
          (item.department && item.department.toLowerCase().includes(search)) ||
          (item.location && item.location.toLowerCase().includes(search))
        );
      }

      let startIndex = 0;
      if (cursor) {
        const idx = items.findIndex(item => item.id === cursor);
        if (idx !== -1) {
          startIndex = idx + 1;
        }
      }

      const paginated = items.slice(startIndex, startIndex + limit);
      const nextCursor = (startIndex + limit < items.length) ? paginated[paginated.length - 1].id : null;
      const hasMore = startIndex + limit < items.length;

      return {
        data: paginated,
        nextCursor,
        hasMore,
      };
    }, 120000); // 120s cache

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

    const jobData = {
      title,
      department,
      location,
      employmentType,
      experienceMin,
      experienceMax,
      openingsCount: Number(openingsCount),
      description,
      isActive: true,
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("jobs").add(jobData);
    const job = { id: docRef.id, ...jobData };

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.job(orgId, docRef.id);

    await notifyAdmins({
      title: "New Job Posted",
      message: `A new job "${title}" has been posted by ${req.user.fullName}`,
      type: "JOB_POSTED",
      link: `/jobs/${job.id}`,
    });

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'JOB_CREATED', {
      jobId: docRef.id,
      title,
      status: 'ACTIVE',
      createdBy: req.user.id,
      createdByName: req.user.fullName,
    });

    res.status(201).json({ success: true, data: job });
  }),
);

router.get(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const doc = await firestore.collection("jobs").doc(req.params.id).get();
    if (!doc.exists) throw new ApiError(404, "Job not found");

    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  }),
);

router.patch(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = { ...req.body, updatedAt: new Date().toISOString() };
    delete updateData.id;

    await firestore.collection("jobs").doc(id).update(updateData);
    
    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.job(orgId, id);

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'JOB_UPDATED', {
      jobId: id,
      changes: updateData,
      updatedBy: req.user.id,
    });
    res.json({ success: true, message: "Job updated successfully" });
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

    const docRef = firestore.collection("jobs").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) throw new ApiError(404, "Job not found");

    const oldActive = doc.data().isActive;
    await docRef.update({ isActive, updatedAt: new Date().toISOString() });
    const updated = { id, ...doc.data(), isActive };

    const orgId = req.user.organizationId || "defaultOrg";
    const inv = require("../../utils/cacheInvalidation");
    await inv.job(orgId, id);

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_JOB_STATUS",
      entityType: "JOB",
      entityId: id,
      oldData: { isActive: oldActive },
      newData: { isActive: updated.isActive },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const sse = require("../../utils/sse");
    sse.broadcastToOrg(orgId, 'JOB_STATUS_CHANGED', {
      jobId: id,
      status: isActive ? 'ACTIVE' : 'INACTIVE',
      changedBy: req.user.id,
      changedByName: req.user.fullName,
    });

    res.json({ success: true, data: updated });
  }),
);

// FEATURE 1: Job Documents
router.get(
  "/:id/documents",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const snapshot = await firestore.collection("job_documents")
      .where("jobId", "==", id)
      .orderBy("uploadedAt", "desc")
      .get();
    
    const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

    const docData = {
      jobId: id,
      type,
      googleDriveLink,
      uploadedById: req.user.id,
      uploadedByName: req.user.fullName,
      uploadedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("job_documents").add(docData);
    res.status(201).json({ success: true, data: { id: docRef.id, ...docData } });
  })
);

router.put(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { googleDriveLink } = req.body;

    await firestore.collection("job_documents").doc(docId).update({
      googleDriveLink,
      updatedAt: new Date().toISOString()
    });

    const doc = await firestore.collection("job_documents").doc(docId).get();
    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  })
);

router.delete(
  "/:id/documents/:docId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { docId } = req.params;
    await firestore.collection("job_documents").doc(docId).delete();
    res.json({ success: true });
  })
);

// FEATURE 1: Job Questions
router.get(
  "/:id/questions",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const snapshot = await firestore.collection("job_questions")
      .where("jobId", "==", id)
      .orderBy("createdAt", "desc")
      .get();
    
    const questions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

    const questionData = {
      jobId: id,
      question,
      competency,
      difficulty,
      addedById: req.user.id,
      addedByName: req.user.fullName,
      createdAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("job_questions").add(questionData);
    res.status(201).json({ success: true, data: { id: docRef.id, ...questionData } });
  })
);

router.put(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { question, competency, difficulty } = req.body;

    await firestore.collection("job_questions").doc(questionId).update({
      question, competency, difficulty,
      updatedAt: new Date().toISOString()
    });

    const doc = await firestore.collection("job_questions").doc(questionId).get();
    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  })
);

router.delete(
  "/:id/questions/:questionId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    await firestore.collection("job_questions").doc(questionId).delete();
    res.json({ success: true });
  })
);

module.exports = router;
