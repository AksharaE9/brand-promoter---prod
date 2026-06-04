const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { notifyAdmins, sendNotification } = require("../../utils/notifications");
const sse = require("../../utils/sse");
const inv = require("../../utils/cacheInvalidation");
const { getCached } = require("../../utils/cache");

const router = express.Router();

router.use(auth);

function deriveApplicationStatus(stageName) {
  const normalized = (stageName || "").toLowerCase();
  if (normalized === "selected") return "SELECTED";
  if (normalized === "joined") return "JOINED";
  if (normalized === "rejected") return "REJECTED";
  return "IN_PIPELINE";
}

router.get(
  "/stages",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { jobId } = req.query;
    const cacheKey = `pipeline:stages:${jobId || 'global'}`;

    const stages = await getCached(cacheKey, async () => {
      let snapshot;
      if (jobId) {
        snapshot = await firestore.collection("pipeline_stages")
          .where("jobId", "in", [jobId, null])
          .get();
      } else {
        snapshot = await firestore.collection("pipeline_stages")
          .where("jobId", "==", null)
          .get();
      }
      const s = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      s.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      return s;
    }, 120000); // 2 min cache — stages rarely change

    res.json({ success: true, data: stages });
  }),
);

router.post(
  "/stages",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { jobId = null, name, sortOrder, isTerminal = false } = req.body;
    if (!name || !sortOrder) {
      throw new ApiError(400, "name and sortOrder are required");
    }

    if (jobId) {
      const jobDoc = await firestore.collection("jobs").doc(jobId).get();
      if (!jobDoc.exists) throw new ApiError(404, "Job not found");
    }

    const stageData = {
      jobId,
      name,
      sortOrder,
      isTerminal,
      createdAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("pipeline_stages").add(stageData);

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_STAGE",
      entityType: "PIPELINE_STAGE",
      entityId: docRef.id,
      newData: stageData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: { id: docRef.id, ...stageData } });
  }),
);

router.patch(
  "/applications/:applicationId/move",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    const { toStageId, remark = null, feedback = null } = req.body;

    if (!toStageId) throw new ApiError(400, "toStageId is required");

    const appRef = firestore.collection("applications").doc(applicationId);
    const appDoc = await appRef.get();
    if (!appDoc.exists) throw new ApiError(404, "Application not found");

    const application = appDoc.data();

    const stageDoc = await firestore.collection("pipeline_stages").doc(toStageId).get();
    if (!stageDoc.exists) throw new ApiError(404, "Target stage not found");
    
    const toStage = stageDoc.data();
    if (toStage.jobId && toStage.jobId !== application.jobId) {
      throw new ApiError(400, "Target stage does not belong to application job");
    }

    const nextStatus = deriveApplicationStatus(toStage.name);
    const updateData = {
      currentStageId: toStageId,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    };

    await appRef.update(updateData);

    const eventData = {
      applicationId,
      fromStageId: application.currentStageId,
      toStageId: toStageId,
      remark,
      feedback,
      movedById: req.user.id,
      movedAt: new Date().toISOString()
    };

    const eventRef = await firestore.collection("pipeline_events").add(eventData);

    await logAudit({
      actorUserId: req.user.id,
      action: "MOVE_PIPELINE_STAGE",
      entityType: "APPLICATION",
      entityId: applicationId,
      oldData: {
        currentStageId: application.currentStageId,
        status: application.status,
      },
      newData: {
        currentStageId: toStageId,
        status: nextStatus,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // ✨ Respond immediately — don't block on notifications/cache invalidation
    res.json({ success: true, data: { id: applicationId, ...application, ...updateData } });

    // Fire side effects AFTER response
    setImmediate(async () => {
      try {
        const candidateDoc = await firestore.collection("candidates").doc(application.candidateId).get();
        const candidateName = candidateDoc.exists ? candidateDoc.data().fullName : "Candidate";
        const orgId = req.user.organizationId || "defaultOrg";

        await Promise.all([
          notifyAdmins({ title: 'Pipeline Update', message: `${candidateName} moved to ${toStage.name}`, link: `/candidates/${application.candidateId}` }),
          sendNotification({ userId: req.user.id, title: 'Candidate Moved', message: `You moved ${candidateName} to ${toStage.name}`, link: `/candidates/${application.candidateId}` }),
          inv.application(orgId, application.candidateId),
          inv.analytics(orgId),
        ]);

        sse.broadcastToOrg(orgId, 'APPLICATION_STAGE_CHANGED', {
          applicationId,
          candidateId: application.candidateId,
          fromStage: application.currentStageId,
          toStage: toStageId,
          changedBy: req.user.id,
          changedByName: req.user.fullName,
        });
      } catch (err) {
        console.error('[Pipeline] Post-move side effects error:', err.message);
      }
    });
  }),
);

router.get(
  "/applications/:applicationId/history",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { applicationId } = req.params;
    
    const appDoc = await firestore.collection("applications").doc(applicationId).get();
    if (!appDoc.exists) throw new ApiError(404, "Application not found");

    const snapshot = await firestore.collection("pipeline_events")
      .where("applicationId", "==", applicationId)
      .orderBy("movedAt", "desc")
      .get();

    const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.json({ success: true, data: events });
  }),
);

module.exports = router;
