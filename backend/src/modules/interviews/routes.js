const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, offerLetterUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { sendNotification } = require("../../utils/notifications");
const { broadcast } = require("../../utils/sse");
const cache = require("../../services/schedulingCacheService");
const l1 = require("../../utils/l1Cache");
const KEYS = require("../../utils/schedulingCacheKeys");
const { getCache, setCache, TTL } = require("../../utils/cache");
const { buildInterviewListQuery } = require("./queryBuilder");
const { populateInterviewRelations } = require("./relationPopulator");
const { mergeDirtyQueue } = require("./dirtyQueueMerger");
const crypto = require("crypto");

const router = express.Router();

router.use(auth);

// ── GET export day (PDF Export with SQL Backend) ──
router.get(
  "/export-day",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) throw new ApiError(400, "Date is required (YYYY-MM-DD)");

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const interviews = await prisma.interview.findMany({
      where: {
        scheduledStart: {
          gte: start,
          lte: end
        }
      },
      orderBy: { scheduledStart: 'asc' }
    });

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
        const timeStr = item.scheduledStart ? new Date(item.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "N/A";
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
    const orgId = req.user.organizationId || "defaultOrg";
    const lastSync = l1.get(KEYS.lastSync(orgId)) || new Date().toISOString();
    
    res.json({
      success: true,
      data: {
        pendingSync: 0,
        lastSyncAt: lastSync,
        nextSyncIn: 'instant (sync writes enabled)',
      }
    });
  })
);

// ── GET sync health ──
router.get(
  '/sync/health',
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        healthy: true,
        pendingSyncCount: 0,
        warning: null,
        nextSync: 'instant (sync writes enabled)',
      }
    });
  })
);

// ── POST force sync (Admin Only) ──
router.post(
  '/sync/force',
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { jobId: 'sync-manual-noop', message: 'Database writes are already synchronous' } });
  })
);

function buildCacheKey(orgId, query) {
  const parts = [
    query.status       || '',
    query.jobId        || '',
    query.candidateId  || '',
    query.interviewerId || '',
    query.search       || '',
    query.cursor       || 'start',
    query.limit        || '20',
  ].join(':');
  const hash = crypto.createHash('md5').update(parts).digest('hex').slice(0, 12);
  return `interviews:list:${orgId}:${hash}`;
}

async function prewarmRounds(rounds) {
  if (!rounds || rounds.length === 0) return;
  try {
    rounds.forEach(r => {
      if (r && r.id) {
        l1.set(KEYS.round(r.id), r, 7200 * 1000);
      }
    });
  } catch (err) {
    console.warn('[CacheWarmer] prewarmRounds failed:', err.message);
  }
}

// ── GET all rounds (list) ──
router.get(
  '/',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const requestStart = Date.now();
    const orgId = req.user.organizationId || "defaultOrg";
    const interviewerId = req.query.interviewerId || (req.user.role === 'INTERVIEWER' ? req.user.id : undefined);

    // ── 1. Cache check (target: < 10ms on hit) ──
    const cacheKey = buildCacheKey(orgId, { ...req.query, interviewerId });
    const cached   = await getCache(cacheKey);

    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Response-Time', `${Date.now() - requestStart}ms`);
      return res.json({ success: true, ...cached });
    }

    // ── 2. Build and execute query (target: < 150ms with index) ──
    const { queryParams, limit } = await buildInterviewListQuery({
      orgId,
      status:        req.query.status,
      jobId:         req.query.jobId,
      candidateId:   req.query.candidateId,
      interviewerId,
      search:        req.query.search,
      cursor:        req.query.cursor,
      limit:         req.query.limit,
    });

    // We fetch limit + 1 to know if there is a next page
    const takeLimit = limit + 1;
    const dbQueryParams = {
      ...queryParams,
      take: takeLimit
    };

    const prisma = require('../../config/db');
    const docs = await prisma.interview.findMany(dbQueryParams);

    // Determine hasMore
    const hasMore = docs.length > limit;
    const pageRounds = docs.slice(0, limit);
    
    // Cursor for next page
    const lastDoc = pageRounds[pageRounds.length - 1];
    const nextCursor = hasMore && lastDoc ? lastDoc.id : null;

    // ── 3. Dirty queue merge (target: < 200ms, times out and skips if slower) ──
    const withDirty = await mergeDirtyQueue(pageRounds, orgId);

    // ── 4. Relation population (target: < 500ms with full Redis hit) ──
    const populated = await populateInterviewRelations(withDirty);

    // ── 5. Build response ──
    const responseData = {
      data:       populated,
      nextCursor,
      hasMore,
      pagination: { total: populated.length, hasMore }
    };

    // ── 6. Cache write (non-blocking) ──
    setCache(cacheKey, responseData, TTL.SCHEDULING_LIST).catch(() => {});

    // ── 7. Send response immediately ──
    res.setHeader('X-Cache',         'MISS');
    res.setHeader('X-Response-Time', `${Date.now() - requestStart}ms`);
    res.json({ success: true, ...responseData });

    // ── 8. Pre-warm individual round caches AFTER response is sent ──
    setImmediate(() => {
      prewarmRounds(populated).catch(() => {});
    });

    // ── 9. Monitor response time ──
    const duration = Date.now() - requestStart;
    if (duration > 2000) {
      console.warn(
        `[InterviewList:SLOW] ${duration}ms | org:${orgId} | ` +
        `rounds:${populated.length} | ` +
        `cache:MISS | ` +
        `query:${req.query.cursor ? 'page-N' : 'page-1'}`
      );
    }
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

    // ── Respond IMMEDIATELY — client never waits for audit log ──
    res.status(201).json(result);

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        action: "SCHEDULE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: result.tempId || result.data?.id,
        newData: roundData,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    });
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

    let currentFeedbacks = [];
    try {
      currentFeedbacks = typeof current.feedback === 'string' ? JSON.parse(current.feedback) : current.feedback;
    } catch (_) {}
    if (!Array.isArray(currentFeedbacks)) currentFeedbacks = [];

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

    // ── Respond IMMEDIATELY — client never waits for audit log or SSE broadcast ──
    res.status(201).json({ success: true, data: feedbackEntry });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        action: "SUBMIT_INTERVIEW_FEEDBACK",
        entityType: "INTERVIEW_FEEDBACK",
        entityId: feedbackEntry.id,
        newData: feedbackEntry,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      const { broadcastNamedEvent } = require('../../utils/sse');
      broadcastNamedEvent('INTERVIEW_FEEDBACK_SUBMITTED', { interviewId: roundId, recommendation });
    });
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

    const { uploadFileToCloudinary } = require("../../config/cloudinary");
    const folder = "interview-recordings";
    const fileName = `interview_${id}_${Date.now()}_${req.file.originalname}`;
    
    const fileUrl = await uploadFileToCloudinary(req.file.buffer, folder, fileName, req.file.mimetype);

    // Write fileMeta to CockroachDB using Prisma
    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey: fileUrl,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.user.id,
      }
    });

    await cache.writeRound(
      id,
      {
        voiceRecordingFileId: fileMeta.id,
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
      newData: { fileId: fileMeta.id, url: fileUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { fileId: fileMeta.id, url: fileUrl } });
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

    await cache.deleteRound(
      roundId,
      req.user.organizationId || "defaultOrg",
      req.user.id,
      current
    );

    // ── Respond IMMEDIATELY — client never waits for audit log ──
    res.json({ success: true, message: "Interview deleted successfully" });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        action: "DELETE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: roundId,
        oldData: current,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    });
  })
);

// ── PATCH panel members ──
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

    logAudit({
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
    
    let rescheduleHistory = [];
    try {
      rescheduleHistory = typeof current.rescheduleHistory === 'string' ? JSON.parse(current.rescheduleHistory) : current.rescheduleHistory;
    } catch (_) {}
    if (!Array.isArray(rescheduleHistory)) rescheduleHistory = [];

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

    let rescheduleHistory = [];
    try {
      rescheduleHistory = typeof current.rescheduleHistory === 'string' ? JSON.parse(current.rescheduleHistory) : current.rescheduleHistory;
    } catch (_) {}
    if (!Array.isArray(rescheduleHistory)) rescheduleHistory = [];

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
    
    let transferHistory = [];
    try {
      transferHistory = typeof current.transferHistory === 'string' ? JSON.parse(current.transferHistory) : current.transferHistory;
    } catch (_) {}
    if (!Array.isArray(transferHistory)) transferHistory = [];

    const result = await cache.writeRound(
      roundId,
      {
        jobId: toJobId,
        jobTitle: toJobTitle,
        transferHistory: [
          ...transferHistory,
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

module.exports = router;
