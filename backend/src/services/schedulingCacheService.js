// src/services/schedulingCacheService.js
const redis = require('../utils/redisClient');
const KEYS = require('../utils/schedulingCacheKeys');
const prisma = require('../config/db');
const sse = require('../utils/sse');
const inv = require('../utils/cacheInvalidation');

const isSafeKey = (key) => key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const ROUND_TTL = 60 * 60 * 2;        // 2 hours — rounds stay in cache
const LIST_TTL = 300;                  // 5 minutes — list cache
const DIRTY_TTL = 60 * 60;             // 1 hour — dirty queue entries

// ─────────────────────────────────────────────
// POPULATION HELPER (Matches original populator, optimized via Redis entity caching)
// ─────────────────────────────────────────────

async function getEntitiesCached(collectionName, ids) {
  if (!ids || ids.length === 0) return {};

  const redisKeys = ids.map(id => `entity:${collectionName}:${id}`);
  let cachedVals = [];
  try {
    cachedVals = await redis.mget(...redisKeys);
  } catch (err) {
    console.warn(`[SchedulingCache] mget failed for ${collectionName}:`, err.message);
    cachedVals = new Array(ids.length).fill(null);
  }

  const resultMap = {};
  const missingIds = [];

  cachedVals.forEach((val, index) => {
    const id = ids[index];
    if (val && isSafeKey(id)) {
      try {
        resultMap[id] = JSON.parse(val);
      } catch (_) {
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

      const pipeline = redis.pipeline();
      fetched.forEach(item => {
        resultMap[item.id] = item;
        pipeline.setex(`entity:${collectionName}:${item.id}`, 600, JSON.stringify(item)); // 10 min TTL
      });
      await pipeline.exec();
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
    // 1. Check Redis first
    let cached = null;
    try {
      cached = await redis.get(KEYS.round(roundId));
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis getRound failed, falling back to database:', redisErr.message);
    }
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.isDeleted && !includeDeleted) return { source: 'cache', data: null };
      return { source: 'cache', data: parsed };
    }
    
    // 2. Cache miss — fetch from CockroachDB
    const round = await prisma.interview.findUnique({
      where: { id: roundId }
    });
    if (!round) return { source: 'db', data: null };
    
    if (round.isDeleted) {
      try {
        await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify({ ...round, isDeleted: true }));
      } catch (_) {}
      if (!includeDeleted) return { source: 'db', data: null };
    }
    
    // 3. Populate cache for next read
    try {
      await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify(round));
    } catch (_) {}
    
    return { source: 'db', data: round };
  } catch (err) {
    console.error('[SchedulingCache] getRound error:', err);
    throw err;
  }
}

async function getRoundsList(orgId, filters = {}) {
  const filterHash = hashFilters(filters);
  const cacheKey = KEYS.roundsList(orgId, filterHash);
  const isSearch = !!(filters.search && filters.search.trim());

  // Pagination params
  const limit = Math.min(200, parseInt(filters.limit, 10) || 50);
  const cursor = filters.cursor?.trim();

  try {
    // 1. Try Redis list cache
    if (!isSearch) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return { source: 'cache', data: JSON.parse(cached) };
      } catch (redisErr) {
        console.warn('[SchedulingCache] Redis getRoundsList read failed:', redisErr.message);
      }
    }

    // 2. Build Prisma query where clause
    const where = {
      organizationId: orgId
    };

    if (filters.status) {
      where.status = filters.status;
    }

    // Build application relation filters
    const applicationWhere = {};
    if (filters.candidateId) {
      applicationWhere.candidateId = filters.candidateId;
    }
    if (filters.jobId) {
      applicationWhere.jobId = filters.jobId;
    }
    if (isSearch) {
      const q = filters.search.trim();
      applicationWhere.OR = [
        {
          candidate: {
            fullName: {
              contains: q,
              mode: 'insensitive'
            }
          }
        },
        {
          job: {
            title: {
              contains: q,
              mode: 'insensitive'
            }
          }
        }
      ];
    }

    if (Object.keys(applicationWhere).length > 0) {
      where.application = applicationWhere;
    }

    if (filters.interviewerId) {
      where.interviewerIds = {
        array_contains: filters.interviewerId
      };
    }

    // Retrieve limit + 1 items to see if there is a next page
    const take = limit + 1;

    const queryParams = {
      where,
      orderBy: [
        { scheduledStart: 'desc' },
        { id: 'desc' }
      ],
      take,
      select: {
        id: true,
        applicationId: true,
        candidateId: true,
        candidateName: true,
        jobId: true,
        jobTitle: true,
        roundNo: true,
        round: true,
        scheduledStart: true,
        durationMinutes: true,
        mode: true,
        meetingLink: true,
        zohoLink: true,
        status: true,
        result: true,
        outcome: true,
        outcomeSetAt: true,
        notes: true,
        organizationId: true,
        createdById: true,
        interviewerIds: true,
        interviewerNames: true,
        feedback: true,
        rescheduleHistory: true,
        transferHistory: true,
        offerLetterUrl: true,
        voiceRecordingFileId: true,
        voiceRecordingUrl: true,
        createdAt: true,
        updatedAt: true,
        application: {
          select: {
            id: true,
            candidateId: true,
            jobId: true,
            status: true,
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                profilePhotoFile: {
                  select: {
                    storageKey: true
                  }
                }
              }
            },
            job: {
              select: {
                id: true,
                title: true,
                department: true,
                location: true
              }
            }
          }
        }
      }
    };

    if (cursor) {
      queryParams.cursor = { id: cursor };
      queryParams.skip = 1;
    }

    const rounds = await prisma.interview.findMany(queryParams);

    // 3. Merge dirty queue (Redis caches for unsynced/optimistic rounds)
    let merged = await mergeWithDirtyQueue(rounds, orgId);
    let activeRounds = merged.filter(r => !r.isDeleted);

    // If cursor is active, filter out any new rounds that might have been prepended from the dirty queue
    // because they are only meant for the first page.
    if (cursor) {
      activeRounds = activeRounds.filter(r => !r._isNew || rounds.some(fr => fr.id === r.id));
    }

    // Slice active rounds to the page limit
    const pageRounds = activeRounds.slice(0, limit);

    // Determine hasMore: if either activeRounds has items beyond the limit, or database returned limit + 1
    const hasMore = activeRounds.length > limit || rounds.length > limit;
    const nextCursor = hasMore && pageRounds[pageRounds.length - 1] ? pageRounds[pageRounds.length - 1].id : null;

    // 4. Populate details (like feedbacks and interviewers) only for the sliced page
    const populated = await populateInterviews(pageRounds, { skipFeedbacks: true });

    // Pre-warm individual round caches asynchronously
    setImmediate(() => {
      if (populated.length > 0) {
        const prewarmPipeline = redis.pipeline();
        populated.forEach(r => {
          if (isSafeKey(r.id)) prewarmPipeline.setex(KEYS.round(r.id), ROUND_TTL, JSON.stringify(r));
        });
        prewarmPipeline.exec().catch(err => console.warn('[SchedulingCache] Pre-warm failed:', err.message));
      }
    });

    const result = {
      data: populated,
      nextCursor,
      hasMore,
      pagination: { total: activeRounds.length, hasMore }
    };

    // Cache only first-page queries
    if (!cursor) {
      try {
        await redis.setex(cacheKey, LIST_TTL, JSON.stringify(result));
        await redis.sadd(`scheduling:rounds:lists:${orgId}`, cacheKey);
      } catch (_) {}
    }

    return { source: 'db', data: result };
  } catch (err) {
    console.error('[SchedulingCache] getRoundsList error:', err);
    throw err;
  }
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
// WRITE OPERATIONS — write to Redis, queue DB sync
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
    
    let redisSuccess = false;
    try {
      updated._pendingSync = true;
      updated._lastWriteMs = Date.now();
      await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify(updated));
      await logWrite(roundId, updatePayload, performedBy, timestamp);
      await addToDirtyQueue(roundId, orgId);
      redisSuccess = true;
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis writeRound failed, writing directly to DB:', redisErr.message);
    }

    if (!redisSuccess) {
      const cleanUpdate = cleanDatabasePayload(updated);
      
      await prisma.interview.update({
        where: { id: roundId },
        data: cleanUpdate
      });
    }
    
    try {
      await redis.del(`entity:feedbacks:${roundId}`);
      await invalidateListCaches(orgId);
    } catch (_) {}
    
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
    
    return { success: true, data: updated, syncPending: redisSuccess };
  } catch (err) {
    console.error('[SchedulingCache] writeRound error:', err);
    throw err;
  }
}

async function createRound(roundData, orgId, createdBy) {
  try {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timestamp = new Date().toISOString();
    
    const newRound = {
      ...roundData,
      id: tempId,
      organizationId: orgId,
      createdById: createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: roundData.status || 'SCHEDULED',
      isDeleted: false,
    };
    
    let redisSuccess = false;
    try {
      newRound._pendingSync = true;
      newRound._isNew = true;
      newRound._lastWriteMs = Date.now();
      await redis.setex(KEYS.round(tempId), ROUND_TTL, JSON.stringify(newRound));
      await addToDirtyQueue(tempId, orgId, true);
      redisSuccess = true;
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis createRound failed, writing directly to DB:', redisErr.message);
    }

    let finalRound = { ...newRound };
    if (!redisSuccess) {
      const cleanRound = cleanDatabasePayload(newRound);
      
      const created = await prisma.interview.create({
        data: cleanRound
      });
      finalRound.id = created.id;
    }
    
    try {
      await invalidateListCaches(orgId);
    } catch (_) {}
    
    setImmediate(() => {
      inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    });
    
    sse.broadcastToOrg(orgId, 'ROUND_CREATED', {
      roundId: finalRound.id,
      round: finalRound,
      orgId,
      timestamp,
    });
    
    return { success: true, data: finalRound, tempId: redisSuccess ? tempId : undefined };
  } catch (err) {
    console.error('[SchedulingCache] createRound error:', err);
    throw err;
  }
}

async function deleteRound(roundId, orgId, deletedBy, currentData = null) {
  try {
    const current = currentData || (await getRound(roundId, true)).data;
    if (!current) throw new Error(`Round ${roundId} not found`);
    
    const updated = {
      ...current,
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy,
    };
    
    let redisSuccess = false;
    try {
      updated._pendingSync = true;
      updated._lastWriteMs = Date.now();
      await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify(updated));
      await addToDirtyQueue(roundId, orgId);
      redisSuccess = true;
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis deleteRound failed, deleting directly in DB:', redisErr.message);
    }

    if (!redisSuccess) {
      await prisma.interview.delete({
        where: { id: roundId }
      }).catch(() => {});
    }
    
    try {
      await redis.del(`entity:feedbacks:${roundId}`);
      await invalidateListCaches(orgId);
    } catch (_) {}
    
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
  const field = `${orgId}:${roundId}`;
  const value = JSON.stringify({
    roundId,
    orgId,
    isNew,
    queuedAt: Date.now(),
  });
  
  try {
    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.dirtyQueue(), field, value);
    pipeline.expire(KEYS.dirtyQueue(), DIRTY_TTL);
    await pipeline.exec();
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis addToDirtyQueue failed:', redisErr.message);
    throw redisErr;
  }
}

async function getDirtyQueue() {
  let hash = null;
  try {
    hash = await redis.hgetall(KEYS.dirtyQueue());
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis getDirtyQueue failed:', redisErr.message);
  }
  if (!hash || Object.keys(hash).length === 0) return [];
  
  return Object.entries(hash).map(([field, val]) => {
    try {
      const parsed = JSON.parse(val);
      return {
        orgId: parsed.orgId,
        roundId: parsed.roundId,
        isNew: parsed.isNew,
        raw: field,
      };
    } catch {
      const [orgId, roundId] = field.split(':');
      return { orgId, roundId, isNew: false, raw: field };
    }
  });
}

async function removeFromDirtyQueue(rawKeys) {
  if (rawKeys.length === 0) return;
  try {
    await redis.hdel(KEYS.dirtyQueue(), ...rawKeys);
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis removeFromDirtyQueue failed:', redisErr.message);
  }
}

async function mergeWithDirtyQueue(dbRounds, orgId) {
  try {
    let hash = null;
    try {
      hash = await redis.hgetall(KEYS.dirtyQueue());
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis hgetall in mergeWithDirtyQueue failed:', redisErr.message);
    }
    if (!hash || Object.keys(hash).length === 0) return dbRounds;
    
    const dirtyRoundIds = Object.keys(hash)
      .filter(field => field.startsWith(`${orgId}:`))
      .map(field => field.split(':')[1]);
    
    if (dirtyRoundIds.length === 0) return dbRounds;
    
    const dirtyRounds = await Promise.all(
      dirtyRoundIds.map(async id => {
        try {
          const cached = await redis.get(KEYS.round(id));
          return cached ? JSON.parse(cached) : null;
        } catch (_) {
          return null;
        }
      })
    );
    
    const dirtyMap = {};
    dirtyRounds.filter(Boolean).forEach(r => { if (isSafeKey(r.id)) dirtyMap[r.id] = r; });
    
    const merged = dbRounds.map(r => (isSafeKey(r.id) && dirtyMap[r.id]) || r);
    
    const newRounds = Object.values(dirtyMap).filter(r => 
      r._isNew && !dbRounds.find(fr => fr.id === r.id)
    );
    
    return [...newRounds, ...merged];
  } catch (err) {
    console.error('[SchedulingCache] mergeWithDirtyQueue error:', err);
    return dbRounds;
  }
}

async function invalidateListCaches(orgId) {
  try {
    const setKey = `scheduling:rounds:lists:${orgId}`;
    const keys = await redis.smembers(setKey);
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      pipeline.del(...keys);
      pipeline.del(setKey);
      await pipeline.exec();
    }
  } catch (err) {
    console.warn('[SchedulingCache] Redis invalidateListCaches failed:', err.message);
  }
}

async function invalidateRound(roundId) {
  try {
    await redis.del(KEYS.round(roundId));
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis invalidateRound failed:', redisErr.message);
  }
}

async function logWrite(roundId, payload, performedBy, timestamp) {
  try {
    const logKey = KEYS.writeLog(roundId);
    const entry = JSON.stringify({ payload: Object.keys(payload), performedBy, timestamp });
    const pipeline = redis.pipeline();
    pipeline.lpush(logKey, entry);
    pipeline.ltrim(logKey, 0, 9);
    pipeline.expire(logKey, 3600);
    await pipeline.exec();
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis logWrite failed:', redisErr.message);
  }
}

function hashFilters(filters) {
  return Buffer.from(JSON.stringify(filters)).toString('base64').slice(0, 20);
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
