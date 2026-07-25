// src/services/schedulingCacheService.js
const l1 = require('../utils/l1Cache');
const KEYS = require('../utils/schedulingCacheKeys');
const prisma = require('../config/db');
const sse = require('../utils/sse');
const inv = require('../utils/cacheInvalidation');

const isSafeKey = (key) => key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const ROUND_TTL = 60 * 60 * 2;        // 2 hours — rounds stay in cache
const LIST_TTL = 300;                  // 5 minutes — list cache
const DIRTY_TTL = 60 * 60;             // 1 hour — dirty queue entries

// ─────────────────────────────────────────────
// POPULATION HELPER (Matches original populator, optimized via l1 cache)
// ─────────────────────────────────────────────

async function getEntitiesCached(collectionName, ids) {
  if (!ids || ids.length === 0) return {};

  const resultMap = {};
  const missingIds = [];

  ids.forEach(id => {
    if (isSafeKey(id)) {
      const cached = l1.get(`entity:${collectionName}:${id}`);
      if (cached) {
        resultMap[id] = cached;
      } else {
        missingIds.push(id);
      }
    } else {
      missingIds.push(id);
    }
  });

  if (missingIds.length > 0) {
    try {
      let fetched = [];
      if (collectionName === "applications") {
        fetched = await prisma.application.findMany({
          where: { id: { in: missingIds } },
          include: { candidate: true, job: true }
        });
      } else if (collectionName === "candidates") {
        fetched = await prisma.candidate.findMany({ where: { id: { in: missingIds } } });
      } else if (collectionName === "jobs") {
        fetched = await prisma.job.findMany({ where: { id: { in: missingIds } } });
      } else if (collectionName === "users") {
        fetched = await prisma.user.findMany({ where: { id: { in: missingIds } } });
      }

      fetched.forEach(item => {
        resultMap[item.id] = item;
        l1.set(`entity:${collectionName}:${item.id}`, item, 600 * 1000); // 10 min TTL
      });
    } catch (err) {
      console.error(`[SchedulingCache] Entity fetch error for ${collectionName}:`, err.message);
    }
  }

  return resultMap;
}

async function populateInterviews(rounds, { skipFeedbacks = false } = {}) {
  if (!rounds || rounds.length === 0) return [];

  // Filter out rounds that already have application, candidate, and job populated
  const unpopulatedRounds = rounds.filter(iv => !iv.application || !iv.application.candidate || !iv.application.job);

  // Gathers unique applicationIds and interviewerIds
  const appIds = [...new Set(unpopulatedRounds.map(iv => iv.applicationId).filter(Boolean))];
  
  const interviewerIdsList = rounds.flatMap(iv => {
    let ids = [];
    try {
      ids = typeof iv.interviewerIds === 'string' ? JSON.parse(iv.interviewerIds) : iv.interviewerIds;
    } catch (_) {}
    return Array.isArray(ids) ? ids : [];
  });

  const feedbackUserIds = rounds.flatMap(iv => {
    let fb = [];
    try {
      fb = typeof iv.feedback === 'string' ? JSON.parse(iv.feedback) : iv.feedback;
    } catch (_) {}
    if (!Array.isArray(fb)) fb = [];
    return fb.map(f => f.submittedBy);
  });

  const userIds = [...new Set([...interviewerIdsList, ...feedbackUserIds].filter(Boolean))];

  // Fetch applications cached (only for unpopulated ones)
  const appMap = appIds.length > 0 ? await getEntitiesCached("applications", appIds) : {};

  // Gathers candidate and job IDs
  const candIds = [...new Set(Object.values(appMap).map(a => a.candidateId).filter(Boolean))];
  const jobIds  = [...new Set(Object.values(appMap).map(a => a.jobId).filter(Boolean))];

  // Fetch candidates, jobs, and users in parallel
  const [candMap, jobMap, userMap] = await Promise.all([
    candIds.length > 0 ? getEntitiesCached("candidates", candIds) : Promise.resolve({}),
    jobIds.length > 0 ? getEntitiesCached("jobs", jobIds) : Promise.resolve({}),
    userIds.length > 0 ? getEntitiesCached("users", userIds) : Promise.resolve({}),
  ]);

  // Construct populated rounds
  return rounds.map(iv => {
    let app = iv.application;
    if (app && (!app.candidate || !app.job)) {
      app = { ...app };
      if (!app.candidate && isSafeKey(app.candidateId)) {
        app.candidate = candMap[app.candidateId] || null;
      }
      if (!app.job && isSafeKey(app.jobId)) {
        app.job = jobMap[app.jobId] || null;
      }
    } else if (!app) {
      const appRaw = (isSafeKey(iv.applicationId) && appMap[iv.applicationId]) || null;
      app = appRaw ? { ...appRaw } : null;
      if (app) {
        app.candidate = (isSafeKey(app.candidateId) && candMap[app.candidateId]) || null;
        app.job       = (isSafeKey(app.jobId) && jobMap[app.jobId]) || null;
      }
    }

    let interviewerIds = [];
    try {
      interviewerIds = typeof iv.interviewerIds === 'string' ? JSON.parse(iv.interviewerIds) : iv.interviewerIds;
    } catch (_) {}
    if (!Array.isArray(interviewerIds)) interviewerIds = [];

    let feedback = [];
    try {
      feedback = typeof iv.feedback === 'string' ? JSON.parse(iv.feedback) : iv.feedback;
    } catch (_) {}
    if (!Array.isArray(feedback)) feedback = [];

    // Map submittedBy ID to user details inside feedback
    const populatedFeedback = feedback.map(fb => {
      const submittedById = fb.submittedBy;
      const submittedByObj = (isSafeKey(submittedById) && userMap[submittedById]) || { fullName: "Interviewer" };
      return {
        ...fb,
        submittedById,
        submittedBy: submittedByObj
      };
    });

    return {
      ...iv,
      application: app,
      interviewers: interviewerIds.map(id => isSafeKey(id) && userMap[id]).filter(Boolean),
      feedbacks:    populatedFeedback,
    };
  });
}

// ─────────────────────────────────────────────
// READ OPERATIONS
// ─────────────────────────────────────────────

async function getRound(roundId, includeDeleted = false) {
  try {
    const round = await prisma.interview.findUnique({
      where: { id: roundId }
    });
    if (!round) return { source: 'db', data: null };
    
    if (round.isDeleted && !includeDeleted) {
      return { source: 'db', data: null };
    }
    
    return { source: 'db', data: round };
  } catch (err) {
    console.error('[SchedulingCache] getRound error:', err);
    throw err;
  }
}

async function getRoundsList(orgId, filters = {}) {
  const limit = Math.min(200, parseInt(filters.limit, 10) || 50);
  const cursor = filters.cursor?.trim();
  const isSearch = !!(filters.search && filters.search.trim());

  try {
    // ─── Build base WHERE for interviews ─────────────────────────────────────
    const where = { 
      organizationId: orgId,
      candidateId: { not: null }
    };

    if (filters.status) where.status = filters.status;

    const applicationWhere = {
      candidate: {
        isDeleted: false
      }
    };
    if (filters.candidateId)   applicationWhere.candidateId = filters.candidateId;
    if (filters.jobId)         applicationWhere.jobId = filters.jobId;

    if (isSearch) {
      const q = filters.search.trim();
      applicationWhere.OR = [
        { candidate: { fullName: { contains: q, mode: 'insensitive' } } },
        { job:       { title:    { contains: q, mode: 'insensitive' } } },
      ];
    }
    where.application = applicationWhere;
    if (filters.interviewerId)  where.interviewerIds = { array_contains: filters.interviewerId };

    // ─── When fetching for a specific candidate/application, return all rounds ─
    // (no grouping needed — just return all matching, ordered by roundNo)
    if (filters.candidateId || filters.applicationId) {
      if (filters.applicationId) where.applicationId = filters.applicationId;
      const rounds = await prisma.interview.findMany({
        where,
        orderBy: [{ roundNo: 'asc' }],
        select: interviewSelectFields(),
      });
      const populated = await populateInterviews(rounds, { skipFeedbacks: true });
      return {
        source: 'db',
        data: { data: populated, nextCursor: null, hasMore: false, pagination: { total: populated.length, hasMore: false } }
      };
    }

    // ─── GROUP-BASED PAGINATION ────────────────────────────────────────────────
    // Strategy:
    //   1. Find the `limit` most-recent DISTINCT applicationIds (ordered by their
    //      latest scheduledStart), applying cursor for pagination.
    //   2. Fetch ALL interviews for those applicationIds in one query.
    //   3. This guarantees every candidate card always shows ALL their rounds.

    // Step 1: Get latest scheduledStart per applicationId (for ordering & cursor)
    // We do this by fetching interviews ordered by scheduledStart desc, collecting
    // unique applicationIds until we have `limit+1` of them.
    const SCAN_LIMIT = (limit + 1) * 15; // scan enough rows to find limit distinct apps
    const scanWhere = { ...where };

    // Cursor: we store the last applicationId and its latest scheduledStart
    let cursorAppId = null;
    let cursorDate  = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed  = JSON.parse(decoded);
        cursorAppId   = parsed.appId;
        cursorDate    = parsed.date;
      } catch (_) { /* invalid cursor — start from beginning */ }
    }

    // Apply date cursor to the where clause
    if (cursorDate && cursorAppId) {
      scanWhere.OR = [
        { scheduledStart: { lt: cursorDate } },
        { scheduledStart: cursorDate, applicationId: { lt: cursorAppId } },
      ];
    }

    const scanned = await prisma.interview.findMany({
      where: scanWhere,
      orderBy: [{ scheduledStart: 'desc' }, { applicationId: 'desc' }],
      take: SCAN_LIMIT,
      select: { id: true, applicationId: true, scheduledStart: true },
    });

    // Collect distinct applicationIds in order, up to limit+1
    const seenApps    = new Set();
    const orderedApps = []; // [{ appId, latestDate }]
    for (const iv of scanned) {
      if (!iv.applicationId || seenApps.has(iv.applicationId)) continue;
      seenApps.add(iv.applicationId);
      orderedApps.push({ appId: iv.applicationId, latestDate: iv.scheduledStart });
      if (orderedApps.length >= limit + 1) break;
    }

    const hasMore   = orderedApps.length > limit;
    const pageApps  = orderedApps.slice(0, limit);
    const pageAppIds = pageApps.map(a => a.appId);

    // Next cursor = last item on this page
    let nextCursor = null;
    if (hasMore && pageApps.length > 0) {
      const last = pageApps[pageApps.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ appId: last.appId, date: last.latestDate })).toString('base64');
    }

    // Step 2: Fetch ALL rounds for these applicationIds
    let allRounds = [];
    if (pageAppIds.length > 0) {
      allRounds = await prisma.interview.findMany({
        where: { applicationId: { in: pageAppIds } },
        orderBy: [{ applicationId: 'asc' }, { roundNo: 'asc' }],
        select: interviewSelectFields(),
      });
    }

    // Step 3: Populate and return
    const populated = await populateInterviews(allRounds, { skipFeedbacks: true });

    // Re-order: preserve the page order (most-recent application first)
    const appOrder = new Map(pageAppIds.map((id, idx) => [id, idx]));
    populated.sort((a, b) => {
      const oa = appOrder.get(a.applicationId) ?? 9999;
      const ob = appOrder.get(b.applicationId) ?? 9999;
      if (oa !== ob) return oa - ob;
      return (a.roundNo ?? 0) - (b.roundNo ?? 0); // rounds within same app: ascending
    });

    return {
      source: 'db',
      data: {
        data: populated,
        nextCursor,
        hasMore,
        pagination: { total: populated.length, hasMore }
      }
    };
  } catch (err) {
    console.error('[SchedulingCache] getRoundsList error:', err);
    throw err;
  }
}

// Shared select fields for interview queries
function interviewSelectFields() {
  return {
    id: true, applicationId: true, candidateId: true, candidateName: true,
    jobId: true, jobTitle: true, roundNo: true, round: true,
    scheduledStart: true, durationMinutes: true, mode: true,
    meetingLink: true, zohoLink: true, status: true, result: true,
    outcome: true, outcomeSetAt: true, organizationId: true,
    createdById: true, interviewerIds: true, interviewerNames: true,
    feedback: true, rescheduleHistory: true, transferHistory: true,
    offerLetterUrl: true, voiceRecordingFileId: true, voiceRecordingUrl: true,
    notes: true,
    createdAt: true, updatedAt: true,
    application: {
      select: {
        id: true, candidateId: true, jobId: true, status: true,
        candidate: {
          select: {
            id: true, fullName: true, email: true, phone: true,
            profilePhotoFile: { select: { storageKey: true } }
          }
        },
        job: { select: { id: true, title: true, department: true, location: true } }
      }
    }
  };
}



function cleanDatabasePayload(payload) {
  const allowedFields = [
    'applicationId',
    'candidateId',
    'candidateName',
    'jobId',
    'jobTitle',
    'roundNo',
    'round',
    'scheduledStart',
    'durationMinutes',
    'mode',
    'meetingLink',
    'zohoLink',
    'status',
    'result',
    'outcome',
    'outcomeSetAt',
    'notes',
    'organizationId',
    'createdById',
    'interviewerIds',
    'interviewerNames',
    'feedback',
    'rescheduleHistory',
    'transferHistory',
    'offerLetterUrl',
    'voiceRecordingFileId',
    'voiceRecordingUrl',
    'round1SMSAlertSent',
    'round2EmailAlertSent',
    'createdAt',
    'updatedAt'
  ];

  const cleaned = {};
  allowedFields.forEach(field => {
    if (payload[field] !== undefined) {
      cleaned[field] = payload[field];
    }
  });

  if (cleaned.scheduledStart) cleaned.scheduledStart = new Date(cleaned.scheduledStart);
  if (cleaned.outcomeSetAt) cleaned.outcomeSetAt = new Date(cleaned.outcomeSetAt);
  if (cleaned.createdAt) cleaned.createdAt = new Date(cleaned.createdAt);
  if (cleaned.updatedAt) cleaned.updatedAt = new Date(cleaned.updatedAt);

  if (cleaned.roundNo !== undefined && cleaned.roundNo !== null) {
    cleaned.roundNo = parseInt(cleaned.roundNo) || 1;
  }
  if (cleaned.durationMinutes !== undefined && cleaned.durationMinutes !== null) {
    cleaned.durationMinutes = parseInt(cleaned.durationMinutes) || 60;
  }

  return cleaned;
}

// ─────────────────────────────────────────────
// WRITE OPERATIONS
// ─────────────────────────────────────────────

async function writeRound(roundId, updatePayload, performedBy, orgId, currentData = null) {
  try {
    const current = currentData || (await getRound(roundId)).data;
    if (!current) throw new Error(`Round ${roundId} not found`);
    
    const timestamp = new Date().toISOString();
    const updated = {
      ...current,
      ...updatePayload,
      updatedAt: timestamp,
      lastModifiedBy: performedBy,
    };
    
    const cleanUpdate = cleanDatabasePayload(updated);
    
    await prisma.interview.update({
      where: { id: roundId },
      data: cleanUpdate
    });
    
    setImmediate(() => {
      inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    });
    
    sse.broadcastToOrg(orgId, 'SCHEDULING_UPDATE', {
      type: 'ROUND_UPDATED',
      roundId,
      round: updated,
      orgId,
      performedBy,
      timestamp,
    });
    
    return { success: true, data: updated, syncPending: false };
  } catch (err) {
    console.error('[SchedulingCache] writeRound error:', err);
    throw err;
  }
}

async function createRound(roundData, orgId, createdBy) {
  try {
    const timestamp = new Date().toISOString();
    
    const newRound = {
      ...roundData,
      organizationId: orgId,
      createdById: createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: roundData.status || 'SCHEDULED',
      isDeleted: false,
    };
    
    const cleanRound = cleanDatabasePayload(newRound);
    
    const created = await prisma.interview.create({
      data: cleanRound
    });
    
    setImmediate(() => {
      inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    });
    
    sse.broadcastToOrg(orgId, 'ROUND_CREATED', {
      roundId: created.id,
      round: created,
      orgId,
      timestamp,
    });
    
    return { success: true, data: created };
  } catch (err) {
    console.error('[SchedulingCache] createRound error:', err);
    throw err;
  }
}

async function deleteRound(roundId, orgId, deletedBy, currentData = null) {
  try {
    await prisma.interview.delete({
      where: { id: roundId }
    });
    
    inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    
    sse.broadcastToOrg(orgId, 'ROUND_DELETED', {
      roundId,
      orgId,
    });
    
    return { success: true };
  } catch (err) {
    console.error('[SchedulingCache] deleteRound error:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// DIRTY QUEUE MANAGEMENT
// ─────────────────────────────────────────────

async function addToDirtyQueue(roundId, orgId, isNew = false) {
  return;
}

async function getDirtyQueue() {
  return [];
}

async function removeFromDirtyQueue(rawKeys) {
  return;
}

async function mergeWithDirtyQueue(dbRounds, orgId) {
  return dbRounds;
}

async function invalidateListCaches(orgId) {
  return;
}

async function invalidateRound(roundId) {
  return;
}

module.exports = {
  getRound,
  getRoundsList,
  writeRound,
  createRound,
  deleteRound,
  addToDirtyQueue,
  getDirtyQueue,
  removeFromDirtyQueue,
  invalidateListCaches,
  invalidateRound,
  populateInterviews
};
