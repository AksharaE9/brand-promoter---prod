const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, offerLetterUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { sendNotification } = require("../../utils/notifications");
const { broadcast } = require("../../utils/sse");
const cache = require("../../services/schedulingCacheService");
const redis = require("../../utils/redisClient");
const KEYS = require("../../utils/schedulingCacheKeys");

const router = express.Router();

router.use(auth);

// ── GET export day (Keep PDF export functioning) ──
router.get(
  "/export-day",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) throw new ApiError(400, "Date is required (YYYY-MM-DD)");

    const start = new Date(`${date}T00:00:00.000Z`).toISOString();
    const end = new Date(`${date}T23:59:59.999Z`).toISOString();

    const snapshot = await firestore.collection("interviews")
      .where("scheduledStart", ">=", start)
      .where("scheduledStart", "<=", end)
      .orderBy("scheduledStart", "asc")
      .get();
    
    const interviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.setHeader("Content-Disposition", `attachment; filename="interviews-${date}.pdf"`);
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(22).fillColor("#071f52").text("Daily Interview Schedule", { align: "center" });
    doc.fontSize(12).fillColor("#6b7895").text(`Date: ${date}`, { align: "center" });
    doc.moveDown(2.5);

    if (interviews.length === 0) {
      doc.fontSize(14).fillColor("#0f1b3d").text("No interviews scheduled for this day.", { align: "center" });
    } else {
      interviews.forEach((item) => {
        const timeStr = new Date(item.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        doc.fontSize(13).fillColor("#071f52").text(`${timeStr} - ${item.candidateName || "N/A"}`, { underline: true });
        doc.fontSize(10).fillColor("#333").text(`Round: ${item.roundNo} | Role: ${item.jobTitle || "General"}`);
        doc.text(`Interviewers: ${item.interviewerNames || "N/A"} | Mode: ${item.mode}`);
        doc.moveDown(1.5);
      });
    }

    doc.end();
  }),
);

// ── GET sync status (for debug/monitoring) ──
router.get(
  '/sync/status',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const dirtyItems = await cache.getDirtyQueue();
    const orgId = req.user.organizationId || "defaultOrg";
    const orgDirty = dirtyItems.filter(i => i.orgId === orgId);
    let lastSync = null;
    try {
      lastSync = await redis.get(KEYS.lastSync(orgId));
    } catch (redisErr) {
      console.warn('[SyncStatus] Failed to get lastSync from Redis:', redisErr.message);
    }
    
    res.json({
      success: true,
      data: {
        pendingSync: orgDirty.length,
        lastSyncAt: lastSync,
        nextSyncIn: '≤5 seconds',
      }
    });
  })
);

// ── GET sync health ──
router.get(
  '/sync/health',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const dirtyItems = await cache.getDirtyQueue();
    const orgId = req.user.organizationId || "defaultOrg";
    const orgDirty = dirtyItems.filter(i => i.orgId === orgId);
    
    const isHealthy = orgDirty.length < 100;
    
    res.json({
      success: true,
      data: {
        healthy: isHealthy,
        pendingSyncCount: orgDirty.length,
        warning: orgDirty.length > 50 ? 'Large dirty queue — sync may be delayed' : null,
        nextSync: '≤5 seconds',
      }
    });
  })
);

// ── POST force sync (Admin Only) ──
router.post(
  '/sync/force',
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { syncQueue } = require('../../jobs/schedulingSyncWorker');
    const job = await syncQueue.add('firebase-sync-manual', {}, { priority: 1 });
    res.json({ success: true, data: { jobId: job.id, message: 'Manual sync triggered' } });
  })
);

// ── GET all rounds (list) ──
router.get(
  '/',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || "defaultOrg";
    const filters = {
      status: req.query.status,
      candidateId: req.query.candidateId,
      interviewerId: req.query.interviewerId || (req.user.role === 'INTERVIEWER' ? req.user.id : undefined),
      jobId: req.query.jobId,
      search: req.query.search,
      cursor: req.query.cursor,       // cursor-based load-more
      limit: req.query.limit || 50,  // default 50 per page
    };

    const { data } = await cache.getRoundsList(orgId, filters);
    res.json({ success: true, ...data });
  })
);

// ── GET single round ──
router.get(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { data } = await cache.getRound(req.params.roundId);
    if (!data) return res.status(404).json({ success: false, error: 'Round not found' });
    res.json({ success: true, data });
  })
);

// ── CREATE round ──
router.post(
  '/',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { applicationId, interviewerIds, scheduledStart, mode } = req.body;
    if (!applicationId || !interviewerIds || !scheduledStart || !mode) {
      throw new ApiError(400, "Missing required fields");
    }

    const orgId = req.user.organizationId || "defaultOrg";
    const roundData = {
      ...req.body,
      roundNo: parseInt(req.body.roundNo) || 1,
      round: req.body.round || `Round ${req.body.roundNo || 1}`,
      meetingLink: req.body.meetingLink || "",
      zohoLink: req.body.zohoLink || "",
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      status: "SCHEDULED"
    };

    const result = await cache.createRound(roundData, orgId, req.user.id);
    
    await logAudit({
      actorUserId: req.user.id,
      action: "SCHEDULE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: result.tempId,
      newData: roundData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json(result);
  })
);

// ── POST submit feedback ──
router.post(
  '/:roundId/feedback',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  offerLetterUpload.single("offerFile"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const {
      technicalRating,
      communicationRating,
      cultureFitRating,
      strengths,
      weaknesses,
      overallComments,
      recommendation,
    } = req.body;

    const { data: current } = await cache.getRound(roundId);
    if (!current) throw new ApiError(404, "Round not found");

    const feedbackEntry = {
      id: `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      submittedBy: req.user.id,
      submittedAt: new Date().toISOString(),
      ratings: {
        technical: parseInt(technicalRating) || 0,
        communication: parseInt(communicationRating) || 0,
        culture: parseInt(cultureFitRating) || 0,
      },
      recommendation: recommendation || "PENDING",
      strengths: strengths || "",
      concerns: weaknesses || req.body.concerns || "",
      notes: overallComments || "",
    };

    if (req.file) {
      feedbackEntry.offerFileUrl = req.file.path;
      feedbackEntry.offerFileName = req.file.originalname;
    }

    const currentFeedbacks = current.feedback || current.feedbacks || [];
    const updatePayload = {
      status: "COMPLETED",
      result: recommendation || "PENDING",
      feedback: [...currentFeedbacks, feedbackEntry],
      outcome: recommendation || "PENDING",
      outcomeSetAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (req.file) {
      updatePayload.offerLetterUrl = req.file.path;
    }

    const result = await cache.writeRound(
      roundId,
      updatePayload,
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "SUBMIT_INTERVIEW_FEEDBACK",
      entityType: "INTERVIEW_FEEDBACK",
      entityId: feedbackEntry.id,
      newData: feedbackEntry,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Also broadcast the specific legacy event
    const { broadcastNamedEvent } = require('../../utils/sse');
    broadcastNamedEvent('INTERVIEW_FEEDBACK_SUBMITTED', { interviewId: roundId, recommendation });

    res.status(201).json({ success: true, data: feedbackEntry });
  })
);

// ── POST upload recording ──
router.post(
  '/:id/recording',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) throw new ApiError(400, "Recording file is required");

    const { data: current } = await cache.getRound(id);
    if (!current) throw new ApiError(404, "Interview not found");

    const { uploadFileToFirebase } = require("../../config/firebase");
    const folder = "interview-recordings";
    const fileName = `interview_${id}_${Date.now()}_${req.file.originalname}`;
    
    const fileUrl = await uploadFileToFirebase(req.file.buffer, folder, fileName, req.file.mimetype);

    const fileMeta = {
      storageKey: fileUrl,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedById: req.user.id,
      createdAt: new Date().toISOString()
    };

    // We can write fileMeta directly to Firestore since it's a side meta table
    const fileRef = await firestore.collection("fileMetas").add(fileMeta);

    const result = await cache.writeRound(
      id,
      {
        voiceRecordingFileId: fileRef.id,
        voiceRecordingUrl: fileUrl,
        updatedAt: new Date().toISOString()
      },
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_INTERVIEW_RECORDING",
      entityType: "INTERVIEW",
      entityId: id,
      newData: { fileId: fileRef.id, url: fileUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { fileId: fileRef.id, url: fileUrl } });
  })
);

// ── DELETE round ──
router.delete(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { data: current } = await cache.getRound(roundId, true);
    if (!current) throw new ApiError(404, "Interview not found");

    const result = await cache.deleteRound(
      roundId,
      req.user.organizationId || "defaultOrg",
      req.user.id,
      current
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: roundId,
      oldData: current,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Interview deleted successfully" });
  })
);

// ── PATCH panel members (Legacy Panelists update) ──
router.patch(
  '/:id/panelists',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { interviewerIds } = req.body;

    if (!interviewerIds || !Array.isArray(interviewerIds)) {
      throw new ApiError(400, "interviewerIds (array) is required");
    }

    const { data: current } = await cache.getRound(id);
    if (!current) throw new ApiError(404, "Interview not found");

    await cache.writeRound(
      id,
      {
        interviewerIds,
        updatedAt: new Date().toISOString()
      },
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "TRANSFER_INTERVIEW_PANELISTS",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: { interviewerIds: current.interviewerIds },
      newData: { interviewerIds },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const { broadcastNamedEvent } = require('../../utils/sse');
    broadcastNamedEvent('INTERVIEW_PANELISTS_UPDATED', { interviewId: id, interviewerIds });

    res.json({ success: true, message: "Panelists transferred successfully" });
  })
);

// ── PUT update round ──
router.put(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const data = req.body;
    
    const { data: current } = await cache.getRound(roundId);
    if (!current) throw new ApiError(404, "Interview not found");

    const isSuperAdmin = req.user.role === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      if (new Date(data.scheduledStart) < new Date() && data.scheduledStart !== current.scheduledStart) {
        throw new ApiError(400, "Interview date must not be in the past");
      }
      if (current.status === "COMPLETED" || current.status === "CANCELLED") {
        throw new ApiError(400, `Cannot edit interview in ${current.status} status`);
      }
    }

    if (!data.interviewerIds || data.interviewerIds.length === 0) {
      throw new ApiError(400, "Panel members array must contain at least one member");
    }

    if (!["IN_PERSON", "VIRTUAL", "PHONE"].includes(data.mode)) {
      throw new ApiError(400, "Mode must be one of IN_PERSON, VIRTUAL, PHONE");
    }

    if (data.mode === "VIRTUAL" && !data.meetingLink) {
      throw new ApiError(422, "Meeting link is required for virtual interviews");
    }

    const durationMinutes = data.durationMinutes || 60;
    if (durationMinutes < 15 || durationMinutes > 480) {
      throw new ApiError(400, "Duration must be between 15 and 480 minutes");
    }

    let status = current.status;
    let rescheduleHistory = current.rescheduleHistory || [];

    if (data.scheduledStart !== current.scheduledStart && current.status === "SCHEDULED") {
      status = "RESCHEDULED";
      rescheduleHistory.push({
        previousDate: current.scheduledStart,
        newDate: data.scheduledStart,
        reason: data.rescheduleReason || "No reason provided",
        rescheduledBy: req.user.id,
        rescheduledAt: new Date().toISOString()
      });
    }

    const updateData = {
      ...data,
      status,
      rescheduleHistory,
      updatedAt: new Date().toISOString()
    };

    const result = await cache.writeRound(
      roundId,
      updateData,
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );

    if (data.scheduledStart !== current.scheduledStart || data.mode !== current.mode) {
      data.interviewerIds.forEach(id => {
        sendNotification({
          userId: id,
          title: "Interview Updated",
          message: `Interview has been updated. Date/Mode changed. Reason: ${data.rescheduleReason || 'N/A'}`
        });
      });
    }

    res.json({ success: true, data: result.data });
  })
);

// ── PATCH status ──
router.patch(
  '/:roundId/status',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'status is required' });
    
    const result = await cache.writeRound(
      req.params.roundId,
      { status, statusNotes: notes, statusUpdatedAt: new Date().toISOString() },
      req.user.id,
      req.user.organizationId || "defaultOrg"
    );
    res.json(result);
  })
);

// ── PATCH reschedule ──
router.patch(
  '/:roundId/reschedule',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { scheduledStart, mode, rescheduleReason } = req.body;

    const { data: current } = await cache.getRound(roundId);
    if (!current) throw new ApiError(404, "Interview not found");

    let rescheduleHistory = current.rescheduleHistory || [];
    rescheduleHistory.push({
      previousDate: current.scheduledStart,
      newDate: scheduledStart,
      reason: rescheduleReason || "No reason provided",
      rescheduledBy: req.user.id,
      rescheduledAt: new Date().toISOString()
    });

    const updateData = {
      scheduledStart,
      mode,
      status: "RESCHEDULED",
      rescheduleHistory,
      updatedAt: new Date().toISOString()
    };

    const result = await cache.writeRound(
      roundId,
      updateData,
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );

    res.json({ success: true, data: result.data });
  })
);

// ── PATCH meet-link ──
router.patch(
  '/:roundId/meet-link',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { meetLink } = req.body;
    
    const result = await cache.writeRound(
      roundId,
      { meetingLink: meetLink, updatedAt: new Date().toISOString() },
      req.user.id,
      req.user.organizationId || "defaultOrg"
    );
    res.json(result);
  })
);

// ── PATCH panel ──
router.patch(
  '/:roundId/panel',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { interviewerIds } = req.body;
    
    if (!interviewerIds || interviewerIds.length === 0) {
      throw new ApiError(400, "Panel members array must contain at least one member");
    }

    const result = await cache.writeRound(
      roundId,
      { interviewerIds, updatedAt: new Date().toISOString() },
      req.user.id,
      req.user.organizationId || "defaultOrg"
    );
    res.json(result);
  })
);

// ── PATCH transfer ──
router.patch(
  '/:roundId/transfer',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { toJobId, toJobTitle, reason } = req.body;
    
    const { data: current } = await cache.getRound(roundId);
    if (!current) throw new ApiError(404, "Round not found");
    
    const result = await cache.writeRound(
      roundId,
      {
        jobId: toJobId,
        jobTitle: toJobTitle,
        transferHistory: [
          ...(current.transferHistory || []),
          {
            fromJobId: current.jobId || "",
            toJobId,
            reason,
            transferredBy: req.user.id,
            transferredAt: new Date().toISOString(),
          }
        ],
        updatedAt: new Date().toISOString()
      },
      req.user.id,
      req.user.organizationId || "defaultOrg",
      current
    );
    res.json(result);
  })
);

// ── PATCH cancel ──
router.patch(
  '/:roundId/cancel',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const result = await cache.writeRound(
      roundId,
      { status: "CANCELLED", updatedAt: new Date().toISOString() },
      req.user.id,
      req.user.organizationId || "defaultOrg"
    );
    res.json({ success: true, data: result.data });
  })
);

// ── PATCH complete ──
router.patch(
  '/:roundId/complete',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const result = await cache.writeRound(
      roundId,
      { status: "COMPLETED", updatedAt: new Date().toISOString() },
      req.user.id,
      req.user.organizationId || "defaultOrg"
    );
    res.json({ success: true, data: result.data });
  })
);

// GET /api/interviews/dead-letter — view dead letter queue (Admin Only)
router.get(
  '/dead-letter',
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const redis = require('../../utils/redisClient');
    const members = await redis.smembers('scheduling:dead-letter:queue');
    const items = members.map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean);
    res.json({ success: true, data: { count: items.length, items } });
  })
);

// POST /api/interviews/dead-letter/:roundId/retry — retry a specific dead letter item (Admin Only)
router.post(
  '/dead-letter/:roundId/retry',
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const redis = require('../../utils/redisClient');
    const { roundId } = req.params;
    const members = await redis.smembers('scheduling:dead-letter:queue');

    const rawTarget = members.find(m => {
      try {
        return JSON.parse(m).roundId === roundId;
      } catch {
        return false;
      }
    });

    if (!rawTarget) {
      return res.status(404).json({ success: false, error: 'Not found in dead letter queue' });
    }

    const target = JSON.parse(rawTarget);

    // Re-add to dirty queue with reset retry count
    const pipeline = redis.pipeline();
    // Use the HSET-based dirty queue schema to match cache service
    const dirtyValue = JSON.stringify({
      roundId,
      orgId: target.orgId,
      isNew: roundId.startsWith('temp_'),
      queuedAt: Date.now(),
    });
    pipeline.hset('scheduling:dirty:queue', `${target.orgId}:${roundId}`, dirtyValue);
    pipeline.setex(`scheduling:round:${roundId}`, 7200, JSON.stringify(target.data));
    pipeline.del(`scheduling:retry:count:${roundId}`);
    pipeline.srem('scheduling:dead-letter:queue', rawTarget);
    await pipeline.exec();

    res.json({ success: true, message: `Round ${roundId} requeued for sync` });
  })
);

// DELETE /api/interviews/dead-letter/clear — clear entire dead letter queue (Admin Only)
router.delete(
  '/dead-letter/clear',
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const redis = require('../../utils/redisClient');
    await redis.del('scheduling:dead-letter:queue');
    res.json({ success: true, message: 'Dead letter queue cleared' });
  })
);

module.exports = router;
