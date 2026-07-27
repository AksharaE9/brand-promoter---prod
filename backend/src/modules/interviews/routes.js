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
const { getNextSchedulableRound, validateFeedbackData, ROUND_DISPLAY_LABEL, assertCanScheduleRound } = require("../../lib/interviewTemplates");

const crypto = require("crypto");

const router = express.Router();

router.use(auth);

// Helper middleware to parse body for HTTP QUERY requests if the standard body-parser skipped it
const parseQueryBody = (req, res, next) => {
  if (req.method === 'QUERY' && (!req.body || Object.keys(req.body).length === 0)) {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        if (data) {
          req.body = JSON.parse(data);
        } else {
          req.body = {};
        }
        next();
      } catch (err) {
        res.status(400).json({ success: false, error: 'Invalid JSON body for QUERY request' });
      }
    });
  } else {
    next();
  }
};

const interviewSearchHandler = async (req, res) => {
  const q = (req.body.q || '').trim();
  const filters = req.body.filters || {};
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.body.limit, 10) || 20));
  const cursor = req.body.cursor?.trim();
  const orgId = req.user.organizationId || "defaultOrg";

  const { queryParams } = await buildInterviewListQuery({
    orgId,
    status: filters.status,
    jobId: filters.jobId,
    candidateId: filters.candidateId,
    applicationId: filters.applicationId,
    interviewerId: filters.interviewerId,
    search: q,
    cursor,
    limit,
    date: filters.date,
  });

  const docs = await prisma.interview.findMany({
    ...queryParams,
    take: limit + 1
  });

  const hasMore = docs.length > limit;
  const pageRounds = docs.slice(0, limit);
  const lastDoc = pageRounds[pageRounds.length - 1];
  const nextCursor = hasMore && lastDoc ? lastDoc.id : null;

  const withDirty = await mergeDirtyQueue(pageRounds, orgId);
  const populated = await populateInterviewRelations(withDirty, req.user);

  res.json({
    success: true,
    data: populated,
    nextCursor,
    hasMore,
    pagination: { total: populated.length, hasMore }
  });
};

// Interviews search route with QUERY and POST support
router.all('/search', parseQueryBody, requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"), asyncHandler(async (req, res) => {
  if (req.method === 'QUERY' || req.method === 'POST') {
    return await interviewSearchHandler(req, res);
  }
  res.status(405).set('Allow', 'QUERY, POST').end();
}));


// ── GET export day (PDF Export with SQL Backend) ──
router.get(
  "/export-day",
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
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

// ── Safety constants ──────────────────────────────────────────────────────
// Reduced from 250 — see queryBuilder.js for restoration instructions.
const INTERVIEWS_PAGE_SIZE = 100;

// Hard byte-size ceiling per list response.
// If a lean-projection bug or future field addition causes the payload to grow unexpectedly,
// this will throw a loud 500 with diagnostics BEFORE the response is sent — preventing
// the silent OOM crash pattern that caused 8 instance failures in one hour.
const MAX_RESPONSE_BYTES = 500 * 1024; // 500 KB

/**
 * Enforce response size limit.
 * Returns the serialized buffer if safe, throws ApiError(500) if not.
 */
function enforceResponseSizeLimit(payload) {
  const serialized = Buffer.from(JSON.stringify(payload));
  if (serialized.byteLength > MAX_RESPONSE_BYTES) {
    const kb = Math.round(serialized.byteLength / 1024);
    throw new ApiError(
      500,
      `[InterviewList] Response payload (${kb}KB) exceeds the ${Math.round(MAX_RESPONSE_BYTES / 1024)}KB safety limit. ` +
      `This indicates a query returning unexpectedly large rows — reduce page size or trim the projection.`
    );
  }
  return serialized;
}

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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const requestStart = Date.now();
    const orgId = req.user.organizationId || "defaultOrg";
    const interviewerId = req.query.interviewerId || (req.user.role === 'INTERVIEWER' ? req.user.id : undefined);

    if (req.query.view === 'calendar') {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        throw new ApiError(400, "startDate and endDate are required for calendar view");
      }

      const { queryParams } = await buildInterviewListQuery({
        orgId,
        status:        req.query.status,
        jobId:         req.query.jobId,
        candidateId:   req.query.candidateId,
        applicationId: req.query.applicationId,
        interviewerId,
        search:        req.query.search,
      });

      queryParams.where.scheduledStart = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };

      const dbQueryParams = {
        where: queryParams.where,
        select: {
          id: true,
          candidateId: true,
          candidateName: true,
          applicationId: true,
          roundNo: true,
          round: true,
          scheduledStart: true,
          status: true,
          result: true,
          jobTitle: true,
          mode: true,
          interviewerNames: true,
          interviewerIds: true,
        },
        orderBy: {
          scheduledStart: 'asc',
        }
      };

      const docs = await prisma.interview.findMany(dbQueryParams);

      const formatted = docs.map(iv => {
        let panel = [];
        if (iv.interviewerNames) {
          panel = iv.interviewerNames.split(',').map(n => ({ fullName: n.trim() }));
        }
        return {
          ...iv,
          interviewers: panel,
        };
      });

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Response-Time', `${Date.now() - requestStart}ms`);
      return res.json({ success: true, data: formatted });
    }

    const cacheKey = buildCacheKey(orgId, { ...req.query, interviewerId });
    const cached   = req.query.search?.trim() ? null : await getCache(cacheKey);

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
      applicationId: req.query.applicationId,
      interviewerId,
      search:        req.query.search,
      cursor:        req.query.cursor,
      limit:         req.query.limit,
      date:          req.query.date,
    });

    // We fetch limit + 1 to know if there is a next page
    const takeLimit = limit + 1;
    const dbQueryParams = {
      ...queryParams,
      take: takeLimit
    };

    // ── 2b. Run list query AND total COUNT in parallel ──
    // COUNT returns a single integer — no rows fetched, safe for byte-size limit.
    // Only run totalCount on page 1 (no cursor) to avoid the extra DB round-trip
    // on every subsequent page; consumers read totalCount from page 1 only.
    const isFirstPage = !req.query.cursor;
    const [docs, totalCount] = await Promise.all([
      prisma.interview.findMany(dbQueryParams),
      isFirstPage
        ? prisma.interview.count({ where: queryParams.where })
        : Promise.resolve(null),
    ]);

    // Determine hasMore
    const hasMore = docs.length > limit;
    const pageRounds = docs.slice(0, limit);
    
    // Cursor for next page
    const lastDoc = pageRounds[pageRounds.length - 1];
    const nextCursor = hasMore && lastDoc ? lastDoc.id : null;

    // ── 3. Dirty queue merge (target: < 200ms, times out and skips if slower) ──
    const withDirty = await mergeDirtyQueue(pageRounds, orgId);

    // ── 4. Lean relation population — list mode skips all DB joins ──
    // Using listMode: true means populateInterviewRelations only reshapes
    // the denormalized columns already on each row (candidateName, jobTitle,
    // interviewerNames) without firing any additional DB queries.
    const populated = await populateInterviewRelations(withDirty, req.user, { listMode: true });

    // ── 5. Build response ──
    // totalCount: real DB COUNT(*) from page 1; null on subsequent pages (consumers
    // read it once from page 1 and cache it — see usePaginatedList usage in frontend).
    const responseData = {
      data:       populated || [],
      rows:       populated || [],
      nextCursor,
      hasMore,
      ...(totalCount !== null ? { totalCount } : {}),
      pagination: { total: totalCount ?? (populated || []).length, hasMore }
    };

    // ── 6. Enforce hard byte-size cap BEFORE sending or caching ──
    // This is the defense-in-depth safety net: if a future change reintroduces
    // fat payloads (bad join, added field, corrupt row), this throws a loud 500
    // with diagnostics BEFORE it silently OOMs the instance.
    enforceResponseSizeLimit({ success: true, ...responseData });

    // ── 7. Cache write (non-blocking) ──
    setCache(cacheKey, responseData, TTL.SCHEDULING_LIST).catch(() => {});

    // ── 8. Send response ──
    const duration = Date.now() - requestStart;
    res.setHeader('X-Cache',         'MISS');
    res.setHeader('X-Response-Time', `${duration}ms`);
    res.setHeader('X-Page-Size',     String(pageRounds.length));
    res.json({ success: true, ...responseData });

    // ── 9. Pre-warm individual round caches AFTER response is sent ──
    setImmediate(() => {
      prewarmRounds(populated).catch(() => {});
    });

    // ── 10. Monitor response time ──
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

// ── GET interviews summary ──
router.get(
  '/summary',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || "defaultOrg";
    const cacheKey = `interviews:summary:${orgId}`;
    
    // Check cache (in-process L1 cache, no Redis)
    const cached = await getCache(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached });
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

    const [interviewsToday, pendingFeedback, completedRounds, activePanelistsCount] = await Promise.all([
      // 1. Interviews Today
      prisma.interview.count({
        where: {
          organizationId: orgId,
          scheduledStart: {
            gte: startOfDay,
            lte: endOfDay
          },
          status: { not: 'CANCELLED' }
        }
      }),
      // 2. Pending Feedback
      prisma.interview.count({
        where: {
          organizationId: orgId,
          scheduledStart: {
            lt: now
          },
          status: { not: 'CANCELLED' },
          feedback: {
            equals: []
          }
        }
      }),
      // 3. Completed Rounds
      prisma.interview.count({
        where: {
          organizationId: orgId,
          status: 'COMPLETED'
        }
      }),
      // 4. Active Panelists Count
      prisma.user.count({
        where: {
          organizationId: orgId,
          role: 'INTERVIEWER',
          isActive: true,
          isDeleted: false
        }
      })
    ]);

    const summaryData = {
      interviewsToday,
      pendingFeedback,
      completedRounds,
      activePanelistsCount
    };

    // Cache the result for 30 seconds
    await setCache(cacheKey, summaryData, 30);

    res.setHeader('X-Cache', 'MISS');
    res.json({ success: true, data: summaryData });
  })
);

// ── GET single round details (Consolidated) ──
router.get(
  '/:roundId/details',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { data: round } = await cache.getRound(roundId);
    if (!round) {
      return res.status(404).json({ success: false, error: 'Round not found' });
    }
    
    // Populate relations for this round (candidate, job, interviewers)
    const populated = await populateInterviewRelations([round], req.user);
    res.json({ success: true, data: populated[0] });
  })
);

// ── GET single round ──
router.get(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { data } = await cache.getRound(req.params.roundId);
    if (!data) return res.status(404).json({ success: false, error: 'Round not found' });
    res.json({ success: true, data });
  })
);

// ── CREATE round ──
router.post(
  '/',
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
  asyncHandler(async (req, res) => {
    const { applicationId, interviewerIds, scheduledStart, mode } = req.body;
    if (!applicationId || !interviewerIds || !scheduledStart || !mode) {
      throw new ApiError(400, "Missing required fields");
    }

    const roundNo = parseInt(req.body.roundNo) || 1;

    // Check if this exact round already exists (Duplicate Check)
    const existingRound = await prisma.interview.findFirst({
      where: {
        applicationId,
        roundNo,
        status: { not: "CANCELLED" }
      }
    });
    if (existingRound) {
      throw new ApiError(409, `Round ${roundNo} is already scheduled or completed for this candidate (Duplicate).`);
    }

    // Resolve candidate and job details from application if not fully provided
    const appInfo = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: true,
        job: true
      }
    });
    if (!appInfo) {
      throw new ApiError(404, "Application not found");
    }

    const resolvedCandidateId = req.body.candidateId || appInfo.candidateId;
    const resolvedCandidateName = req.body.candidateName || appInfo.candidate?.fullName || "";
    const resolvedJobId = req.body.jobId || appInfo.jobId;
    const resolvedJobTitle = req.body.jobTitle || appInfo.job?.title || "";

    const orgId = req.user.organizationId || "defaultOrg";
    const roundData = {
      ...req.body,
      candidateId: resolvedCandidateId,
      candidateName: resolvedCandidateName,
      jobId: resolvedJobId,
      jobTitle: resolvedJobTitle,
      roundNo,
      round: req.body.round || `Round ${roundNo}`,
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
        actorName: req.user.fullName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: "SCHEDULE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: result.tempId || result.data?.id,
        entityName: `${roundData.candidateName || result.data?.candidateName || 'Candidate'} - ${roundData.round || ('Round ' + (roundData.roundNo || 1))}`,
        newData: roundData,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        orgId,
      });
    });
  })
);

// ── 4 FIXED ROUNDS: Derived Scheduling Endpoint (POST /api/interviews/:candidateId/schedule) ──
router.post(
  '/:candidateId/schedule',
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
  asyncHandler(async (req, res) => {
    const { candidateId } = req.params;
    const { scheduledStart, mode, interviewerIds, durationMinutes, meetingLink } = req.body;

    if (!mode || typeof mode !== 'string' || !mode.trim()) {
      throw new ApiError(400, "Interview mode is required");
    }
    const validModes = ['IN_PERSON', 'VIRTUAL', 'PHONE', 'DRIVE', 'WALK_IN_DRIVE'];
    if (!validModes.includes(mode)) {
      throw new ApiError(400, `Invalid interview mode: "${mode}"`);
    }
    if (!scheduledStart) {
      throw new ApiError(400, "Scheduled start date/time is required");
    }
    if (isNaN(Date.parse(scheduledStart))) {
      throw new ApiError(400, "Invalid scheduled start date/time format");
    }
    if (mode !== 'WALK_IN_DRIVE') {
      if (!interviewerIds || !Array.isArray(interviewerIds) || interviewerIds.length === 0) {
        throw new ApiError(400, "At least one interviewer must be selected");
      }
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new ApiError(404, "Candidate not found");

    // Fetch existing completed feedback rounds and scheduled interviews for candidate to derive next round
    const completedFeedbacks = await prisma.interviewFeedback.findMany({
      where: { candidateId },
      select: { round: true },
      orderBy: { createdAt: 'asc' },
    });

    const existingInterviews = await prisma.interview.findMany({
      where: { candidateId, status: { not: 'CANCELLED' } },
      select: { roundNo: true, round: true },
    });

    const feedbackRounds = completedFeedbacks.map((f) => f.round);
    const scheduledRounds = existingInterviews.map((i) => {
      if (i.roundNo === 1) return 'ROUND_1';
      if (i.roundNo === 2) return 'ROUND_2';
      return 'FINAL_ROUND';
    });

    const completedRounds = Array.from(new Set([...feedbackRounds, ...scheduledRounds]));
    const nextRound = getNextSchedulableRound(completedRounds);

    if (!nextRound) {
      throw new ApiError(409, "All 3 interview rounds are already completed for this candidate.");
    }

    // Sequential Round Gating: Ensure prior round's feedback exists
    await assertCanScheduleRound(prisma, candidateId, nextRound);



    const roundNo = completedRounds.length + 1;
    const roundLabel = ROUND_DISPLAY_LABEL[nextRound];
    const orgId = req.user.organizationId || "defaultOrg";

    const roundData = {
      candidateId,
      candidateName: candidate.fullName,
      roundNo,
      round: roundLabel,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : new Date(),
      durationMinutes: parseInt(durationMinutes) || 60,
      mode: mode || "VIRTUAL",
      meetingLink: meetingLink || "",
      interviewerIds: Array.isArray(interviewerIds) ? interviewerIds : [],
      organizationId: orgId,
      createdById: req.user.id,
      status: "SCHEDULED",
    };

    const newInterview = await prisma.interview.create({
      data: roundData,
    });

    res.status(201).json({
      success: true,
      data: {
        ...newInterview,
        derivedRound: nextRound,
        roundLabel,
      },
    });
  })
);

// ── 4 FIXED ROUNDS: Schema-Driven Feedback Submission Endpoint (POST /api/interviews/:candidateId/feedback) ──
router.post(
  '/:candidateId/feedback',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { candidateId } = req.params;
    const { round, data } = req.body;

    if (!round || !data) {
      throw new ApiError(400, "round and data fields are required");
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new ApiError(404, "Candidate not found");

    // Resolve template version (Option A: editing keeps same version)
    let templateVersion = parseInt(req.body.templateVersion);
    if (!templateVersion) {
      const existing = await prisma.interviewFeedback.findUnique({
        where: {
          candidateId_round: {
            candidateId,
            round,
          },
        },
      });
      templateVersion = existing ? existing.templateVersion : 2;
    }

    // Strict schema-driven validation
    const validation = validateFeedbackData(round, data, { templateVersion });
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: "Feedback validation failed",
        errors: validation.errors,
      });
    }

    const selectionStatus = data.selectionStatus || data.status || "HOLD";
    const overallRating = data.overallRating !== undefined && data.overallRating !== null ? Number(data.overallRating) : null;

    const offerLetterDocumentUrl = data.offerLetterDocument ? (typeof data.offerLetterDocument === 'string' ? data.offerLetterDocument : JSON.stringify(data.offerLetterDocument)) : null;
    const offerLetterEmailAttachmentUrl = data.offerLetterEmailAttachment ? (typeof data.offerLetterEmailAttachment === 'string' ? data.offerLetterEmailAttachment : JSON.stringify(data.offerLetterEmailAttachment)) : null;

    // Upsert feedback on (candidateId, round)
    const feedbackRecord = await prisma.interviewFeedback.upsert({
      where: {
        candidateId_round: {
          candidateId,
          round,
        },
      },
      create: {
        candidateId,
        round,
        submittedById: req.user.id,
        templateVersion,
        feedbackData: data,
        selectionStatus,
        overallRating,
        offerLetterDocumentUrl,
        offerLetterEmailAttachmentUrl,
      },
      update: {
        submittedById: req.user.id,
        templateVersion,
        feedbackData: data,
        selectionStatus,
        overallRating,
        offerLetterDocumentUrl,
        offerLetterEmailAttachmentUrl,
        updatedAt: new Date(),
      },
    });

    // Update candidate status if REJECTED
    if (selectionStatus === 'REJECTED') {
      await prisma.candidate.update({
        where: { id: candidateId },
        data: { status: 'REJECTED' },
      }).catch(() => {});
    }

    // Automatically complete or update matching Interview round in scheduling system
    const roundNoList = round === 'ROUND_1' ? [1]
                      : round === 'ROUND_2' ? [2]
                      : [3, 99];
    const matchedInterviews = await prisma.interview.findMany({
      where: {
        candidateId,
        roundNo: { in: roundNoList },
      },
    });

    const srv = require('../../services/schedulingCacheService');
    for (const activeInterview of matchedInterviews) {
      let feedbackList = [];
      try {
        feedbackList = typeof activeInterview.feedback === 'string' ? JSON.parse(activeInterview.feedback) : activeInterview.feedback;
      } catch (_) {}
      if (!Array.isArray(feedbackList)) feedbackList = [];

      const newFbItem = {
        id: feedbackRecord.id,
        submittedById: feedbackRecord.submittedById,
        feedbackData: data,
        templateVersion: templateVersion,
        selectionStatus: selectionStatus,
        overallRating: overallRating,
        createdAt: feedbackRecord.createdAt,
        updatedAt: feedbackRecord.updatedAt,
      };

      let updatedList = [];
      const existingIdx = feedbackList.findIndex(f => f.id === feedbackRecord.id || (!f.id && f.submittedById === req.user.id));
      if (existingIdx >= 0) {
        updatedList = [...feedbackList];
        updatedList[existingIdx] = { ...feedbackList[existingIdx], ...newFbItem };
      } else {
        updatedList = [...feedbackList, newFbItem];
      }

      const updatePayload = {
        feedback: updatedList,
      };

      if (activeInterview.status === 'SCHEDULED' || activeInterview.status === 'PENDING') {
        updatePayload.status = 'COMPLETED';
        updatePayload.result = selectionStatus;
        updatePayload.outcome = selectionStatus;
        updatePayload.outcomeSetAt = new Date().toISOString();
      }

      await srv.writeRound(
        activeInterview.id,
        updatePayload,
        req.user.id,
        req.user.organizationId || "defaultOrg",
        activeInterview
      );
    }

    // Emit interview-feedback:updated SSE event
    const sse = require('../../utils/sse');
    sse.broadcastToOrg(req.user.organizationId || 'defaultOrg', 'interview-feedback:updated', {
      candidateId,
      feedbackId: feedbackRecord.id,
      round,
    });

    res.status(200).json({
      success: true,
      data: feedbackRecord,
    });
  })
);

// ── GET stored feedback for specific candidate and round ──
router.get(
  '/:candidateId/feedback/:round',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { candidateId, round } = req.params;

    const feedbackRecord = await prisma.interviewFeedback.findUnique({
      where: {
        candidateId_round: {
          candidateId,
          round,
        },
      },
    });

    if (!feedbackRecord) {
      throw new ApiError(404, `No feedback submitted for candidate in ${round}`);
    }

    res.json({
      success: true,
      data: feedbackRecord.feedbackData,
      record: feedbackRecord,
    });
  })
);

// ── GET all stored feedbacks for candidate ──
router.get(
  '/:candidateId/feedback',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { candidateId } = req.params;

    const feedbacks = await prisma.interviewFeedback.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      success: true,
      data: feedbacks,
    });
  })
);

// ── DELETE stored feedback for specific candidate and round (soft delete) ──
router.delete(
  '/:candidateId/feedback/:round',
  requireRoles("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { candidateId, round } = req.params;

    // Get candidate for audit log
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { fullName: true }
    });

    const candidateName = candidate?.fullName || 'Unknown Candidate';

    // 1. Soft-delete in interview_feedbacks table if exists
    const existingFeedback = await prisma.interviewFeedback.findFirst({
      where: {
        candidateId,
        round,
      },
    });

    let previousStatus = 'UNKNOWN';
    let feedbackId = 'N/A';

    if (existingFeedback) {
      feedbackId = existingFeedback.id;
      previousStatus = existingFeedback.selectionStatus;
      
      await prisma.interviewFeedback.update({
        where: { id: existingFeedback.id },
        data: { deletedAt: new Date() },
      });
    }

    // 2. Also check and soft delete in interviews table feedback JSON column
    const roundNo = round === 'ROUND_1' ? 1
                  : round === 'ROUND_2' ? 2
                  : 99; // Final Round is 99 or similar
    
    const interviews = await prisma.interview.findMany({
      where: {
        candidateId,
        roundNo,
      },
    });

    for (const interview of interviews) {
      let feedbackList = [];
      try {
        feedbackList = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback;
      } catch (_) {}
      if (!Array.isArray(feedbackList)) feedbackList = [];

      let updated = false;
      const updatedFeedbackList = feedbackList.map(f => {
        if (!f.deletedAt && !f.deleted_at) {
          f.deletedAt = new Date().toISOString();
          updated = true;
        }
        return f;
      });

      if (updated) {
        const updatePayload = {
          status: 'SCHEDULED',
          result: null,
          outcome: null,
          outcomeSetAt: null,
          feedback: updatedFeedbackList,
        };

        await cache.writeRound(
          interview.id,
          updatePayload,
          req.user.id,
          req.user.organizationId || "defaultOrg",
          interview
        );
      }
    }

    // 3. Write audit log
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.fullName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'DELETE_INTERVIEW_FEEDBACK',
      entityType: 'INTERVIEW_FEEDBACK',
      entityId: feedbackId,
      entityName: `Feedback for ${candidateName} - ${round}`,
      newData: null,
      oldData: { round, previousStatus },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      orgId: req.user.organizationId || 'defaultOrg',
    });

    // Broadcast SSE event so frontend updates
    const sse = require('../../utils/sse');
    sse.broadcastToOrg(req.user.organizationId || 'defaultOrg', 'interview-feedback:updated', {
      candidateId,
      round,
      deleted: true,
    });

    res.json({
      success: true,
      message: 'Feedback soft-deleted successfully.',
    });
  })
);


// ── POST submit feedback ──
router.post(
  '/:roundId/feedback',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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

    const existingIndex = currentFeedbacks.findIndex(f => f.submittedBy === req.user.id);
    let targetIndex = existingIndex;
    if (targetIndex === -1 && currentFeedbacks.length > 0 && req.user.role === 'SUPER_ADMIN') {
      targetIndex = 0;
    }

    let finalFeedbacks = [];
    let savedFeedbackEntry = feedbackEntry;
    if (targetIndex !== -1) {
      savedFeedbackEntry = {
        ...currentFeedbacks[targetIndex],
        ratings: {
          technical: parseInt(technicalRating) || 0,
          communication: parseInt(communicationRating) || 0,
          culture: parseInt(cultureFitRating) || 0,
        },
        recommendation: recommendation || "PENDING",
        strengths: strengths || "",
        concerns: weaknesses || req.body.concerns || "",
        notes: overallComments || "",
        updatedAt: new Date().toISOString(),
      };
      if (req.file) {
        savedFeedbackEntry.offerFileUrl = req.file.path;
        savedFeedbackEntry.offerFileName = req.file.originalname;
      }
      currentFeedbacks[targetIndex] = savedFeedbackEntry;
      finalFeedbacks = currentFeedbacks;
    } else {
      finalFeedbacks = [...currentFeedbacks, feedbackEntry];
    }

    const updatePayload = {
      status: "COMPLETED",
      result: recommendation || "PENDING",
      feedback: finalFeedbacks,
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
    res.status(201).json({ success: true, data: savedFeedbackEntry });

    // ── Side effects run AFTER response is on the wire ──
    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        actorName: req.user.fullName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: "SUBMIT_INTERVIEW_FEEDBACK",
        entityType: "INTERVIEW_FEEDBACK",
        entityId: feedbackEntry.id,
        entityName: `Feedback for ${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
        newData: feedbackEntry,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        orgId: req.user.organizationId || "defaultOrg",
      });

      const { broadcastNamedEvent } = require('../../utils/sse');
      broadcastNamedEvent('INTERVIEW_FEEDBACK_SUBMITTED', { interviewId: roundId, recommendation });
    });
  })
);

// ── POST upload recording ──
router.post(
  '/:id/recording',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
      actorName: req.user.fullName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "UPLOAD_INTERVIEW_RECORDING",
      entityType: "INTERVIEW",
      entityId: id,
      entityName: `${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
      newData: { fileId: fileMeta.id, url: fileUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      orgId: req.user.organizationId || "defaultOrg",
    });

    res.json({ success: true, data: { fileId: fileMeta.id, url: fileUrl } });
  })
);

// ── DELETE round ──
router.delete(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
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
        actorName: req.user.fullName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: "DELETE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: roundId,
        entityName: `${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
        oldData: current,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        orgId: req.user.organizationId || "defaultOrg",
      });
    });
  })
);

// ── PATCH panel members ──
router.patch(
  '/:id/panelists',
  requireRoles("SUPER_ADMIN", "RECRUITER", "USER"),
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
      actorName: req.user.fullName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "TRANSFER_INTERVIEW_PANELISTS",
      entityType: "INTERVIEW",
      entityId: id,
      entityName: `${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
      oldData: { interviewerIds: current.interviewerIds },
      newData: { interviewerIds },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      orgId: req.user.organizationId || "defaultOrg",
    });

    const { broadcastNamedEvent } = require('../../utils/sse');
    broadcastNamedEvent('INTERVIEW_PANELISTS_UPDATED', { interviewId: id, interviewerIds });

    res.json({ success: true, message: "Panelists transferred successfully" });
  })
);

// ── PUT update round ──
router.put(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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

    if (!["IN_PERSON", "VIRTUAL", "PHONE", "ONLINE", "DRIVE"].includes(data.mode)) {
      throw new ApiError(400, "Mode must be one of IN_PERSON, VIRTUAL, ONLINE, PHONE, DRIVE");
    }

    if ((data.mode === "VIRTUAL" || data.mode === "ONLINE") && !data.meetingLink) {
      throw new ApiError(422, "Meeting link is required for virtual/online interviews");
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

    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        actorName: req.user.fullName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: "UPDATE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: roundId,
        entityName: `${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
        oldData: current,
        newData: updateData,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        orgId: req.user.organizationId || "defaultOrg",
      });
    });
  })
);

// ── PATCH update round ──
router.patch(
  '/:roundId',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { data: current } = await cache.getRound(roundId);
    if (!current) throw new ApiError(404, "Interview not found");

    // Merge partial body changes with existing round data to support partial PATCH
    const mergedData = {
      ...current,
      ...req.body,
    };

    // Safe parsing of interviewerIds (DB column is Json, might be double-serialized string in tests)
    let interviewerIds = mergedData.interviewerIds;
    if (typeof interviewerIds === 'string') {
      try {
        interviewerIds = JSON.parse(interviewerIds);
      } catch (_) {
        interviewerIds = [];
      }
    }
    mergedData.interviewerIds = interviewerIds;

    const isSuperAdmin = req.user.role === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      if (req.body.scheduledStart && new Date(req.body.scheduledStart) < new Date() && req.body.scheduledStart !== current.scheduledStart) {
        throw new ApiError(400, "Interview date must not be in the past");
      }
      if (current.status === "COMPLETED" || current.status === "CANCELLED") {
        throw new ApiError(400, `Cannot edit interview in ${current.status} status`);
      }
    }

    if (('interviewerIds' in req.body) && (!Array.isArray(interviewerIds) || interviewerIds.length === 0)) {
      throw new ApiError(400, "Panel members array must contain at least one member");
    }

    if (req.body.mode && !["IN_PERSON", "VIRTUAL", "PHONE", "ONLINE", "DRIVE"].includes(req.body.mode)) {
      throw new ApiError(400, "Mode must be one of IN_PERSON, VIRTUAL, ONLINE, PHONE, DRIVE");
    }

    // Only validate virtual meeting link if the caller is changing mode or meetingLink
    const isUpdatingModeOrLink = ('mode' in req.body) || ('meetingLink' in req.body);
    if (isUpdatingModeOrLink && (mergedData.mode === "VIRTUAL" || mergedData.mode === "ONLINE") && !mergedData.meetingLink) {
      throw new ApiError(422, "Meeting link is required for virtual/online interviews");
    }

    if (req.body.durationMinutes) {
      const durationMinutes = parseInt(req.body.durationMinutes);
      if (isNaN(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
        throw new ApiError(400, "Duration must be between 15 and 480 minutes");
      }
    }

    let status = req.body.status || current.status;
    let rescheduleHistory = current.rescheduleHistory;
    if (typeof rescheduleHistory === 'string') {
      try {
        rescheduleHistory = JSON.parse(rescheduleHistory);
      } catch (_) {
        rescheduleHistory = [];
      }
    }
    if (!Array.isArray(rescheduleHistory)) rescheduleHistory = [];

    if (req.body.scheduledStart && req.body.scheduledStart !== current.scheduledStart && current.status === "SCHEDULED") {
      status = "RESCHEDULED";
      rescheduleHistory.push({
        previousDate: current.scheduledStart,
        newDate: req.body.scheduledStart,
        reason: req.body.rescheduleReason || "No reason provided",
        rescheduledBy: req.user.id,
        rescheduledAt: new Date().toISOString()
      });
    }

    const updateData = {
      ...mergedData,
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

    if (req.body.scheduledStart !== current.scheduledStart || req.body.mode !== current.mode) {
      const interviewersToNotify = mergedData.interviewerIds || [];
      interviewersToNotify.forEach(id => {
        sendNotification({
          userId: id,
          title: "Interview Updated",
          message: `Interview has been updated. Date/Mode changed. Reason: ${req.body.rescheduleReason || 'N/A'}`
        });
      });
    }

    res.json({ success: true, data: result.data });

    // Side effect: log audit
    setImmediate(() => {
      logAudit({
        actorUserId: req.user.id,
        actorName: req.user.fullName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: "UPDATE_INTERVIEW",
        entityType: "INTERVIEW",
        entityId: roundId,
        entityName: `${current.candidateName || 'Candidate'} - ${current.round || ('Round ' + (current.roundNo || 1))}`,
        oldData: current,
        newData: updateData,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        orgId: req.user.organizationId || "defaultOrg",
      });
    });
  })
);

// ── PATCH status ──
router.patch(
  '/:roundId/status',
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
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
