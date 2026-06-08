// src/services/schedulingCacheService.js
const redis = require('../utils/redisClient');
const KEYS = require('../utils/schedulingCacheKeys');
const { db, admin } = require('../config/firebase');
const sse = require('../utils/sse');
const inv = require('../utils/cacheInvalidation');

const isSafeKey = (key) => key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const ROUND_TTL = 60 * 60 * 2;        // 2 hours — rounds stay in cache
const LIST_TTL = 300;                  // 5 minutes — list cache (longer = fewer cold Firestore hits)
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
      const refs = missingIds.map(id => db.collection(collectionName).doc(id));
      const snaps = await db.getAll(...refs);

      const pipeline = redis.pipeline();
      snaps.forEach(snap => {
        if (snap && snap.exists && isSafeKey(snap.id)) {
          const docData = { id: snap.id, ...snap.data() };
          resultMap[snap.id] = docData;
          pipeline.setex(`entity:${collectionName}:${snap.id}`, 600, JSON.stringify(docData)); // 10 min TTL
        }
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

  // Gathers unique applicationIds and interviewerIds
  const appIds = [...new Set(rounds.map(iv => iv.applicationId).filter(Boolean))];
  const userIds = [...new Set(rounds.flatMap(iv => iv.interviewerIds || []).filter(Boolean))];

  // Fetch applications cached
  const appMap = await getEntitiesCached("applications", appIds);

  // Gathers candidate and job IDs
  const candIds = [...new Set(Object.values(appMap).map(a => a.candidateId).filter(Boolean))];
  const jobIds  = [...new Set(Object.values(appMap).map(a => a.jobId).filter(Boolean))];

  // Fetch candidates, jobs, and users in parallel
  const [candMap, jobMap, userMap] = await Promise.all([
    getEntitiesCached("candidates", candIds),
    getEntitiesCached("jobs", jobIds),
    getEntitiesCached("users", userIds),
  ]);

  // Feedbacks: skip in list view (only needed when opening a specific round detail)
  const feedbackMap = {};
  rounds.forEach(iv => { if (isSafeKey(iv.id)) feedbackMap[iv.id] = []; });

  if (!skipFeedbacks) {
    const interviewIds = rounds.map(iv => iv.id).filter(Boolean);
    if (interviewIds.length > 0) {
      let cachedFbs = [];
      try {
        const fbRedisKeys = interviewIds.map(id => `entity:feedbacks:${id}`);
        cachedFbs = await redis.mget(...fbRedisKeys);
      } catch (err) {
        console.warn("[SchedulingCache] mget failed for feedbacks:", err.message);
        cachedFbs = new Array(interviewIds.length).fill(null);
      }

      const missingIvIds = [];
      cachedFbs.forEach((val, idx) => {
        const ivId = interviewIds[idx];
        if (val) {
          try { feedbackMap[ivId] = JSON.parse(val); } catch (_) { missingIvIds.push(ivId); }
        } else {
          missingIvIds.push(ivId);
        }
      });

      if (missingIvIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < missingIvIds.length; i += 30) chunks.push(missingIvIds.slice(i, i + 30));
        try {
          const chunkSnaps = await Promise.all(
            chunks.map(chunk => db.collection("interviewFeedbacks").where("interviewId", "in", chunk).get())
          );
          const fetchedMap = {};
          missingIvIds.forEach(id => { if (isSafeKey(id)) fetchedMap[id] = []; });
          chunkSnaps.forEach(snap => {
            if (snap && snap.docs) {
              snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.interviewId && isSafeKey(data.interviewId) && fetchedMap[data.interviewId]) {
                  const subUser = (isSafeKey(data.submittedById) && userMap[data.submittedById]) || { fullName: 'Interviewer' };
                  fetchedMap[data.interviewId].push({ id: doc.id, ...data, submittedBy: subUser });
                }
              });
            }
          });
          const pipeline = redis.pipeline();
          Object.entries(fetchedMap).forEach(([ivId, fbs]) => {
            if (isSafeKey(ivId)) {
              feedbackMap[ivId] = fbs;
              pipeline.setex(`entity:feedbacks:${ivId}`, 120, JSON.stringify(fbs));
            }
          });
          await pipeline.exec();
        } catch (fbErr) {
          console.error('[SchedulingCache] feedback fetch error:', fbErr.message);
        }
      }
    }
  }

  // Construct populated rounds
  return rounds.map(iv => {
    const appRaw = (isSafeKey(iv.applicationId) && appMap[iv.applicationId]) || null;
    const app = appRaw ? { ...appRaw } : null;
    if (app) {
      app.candidate = (isSafeKey(app.candidateId) && candMap[app.candidateId]) || null;
      app.job       = (isSafeKey(app.jobId) && jobMap[app.jobId]) || null;
    }

    // Merge database feedbacks with Redis write-through feedbacks
    const finalFeedbacks = [...((isSafeKey(iv.id) && feedbackMap[iv.id]) || [])];
    const roundFeedbacks = iv.feedback || iv.feedbacks || [];

    roundFeedbacks.forEach(fb => {
      if (!finalFeedbacks.find(f => f.id === fb.id)) {
        const submittedById = (typeof fb.submittedBy === 'string') ? fb.submittedBy : (fb.submittedById || fb.submittedBy?.id || fb.submittedBy);
        const submittedByObj = (typeof fb.submittedBy === 'string')
          ? ((isSafeKey(fb.submittedBy) && userMap[fb.submittedBy]) || { fullName: "Interviewer" })
          : (fb.submittedBy || { fullName: "Interviewer" });

        finalFeedbacks.push({
          ...fb,
          submittedById,
          submittedBy: submittedByObj
        });
      }
    });

    return {
      ...iv,
      application: app,
      interviewers: (iv.interviewerIds || []).map(id => isSafeKey(id) && userMap[id]).filter(Boolean),
      feedbacks:    finalFeedbacks,
    };
  });
}


// ─────────────────────────────────────────────
// READ OPERATIONS
// ─────────────────────────────────────────────

function convertTimestampsToDates(data) {
  if (!data) return data;
  const result = { ...data };
  const dateFields = ['scheduledStart', 'scheduledEnd', 'createdAt', 'updatedAt', 'deletedAt', 'completedAt'];
  dateFields.forEach(field => {
    const val = result[field];
    if (val && typeof val === 'object') {
      if (typeof val.toDate === 'function') {
        result[field] = val.toDate().toISOString();
      } else if (val._seconds !== undefined) {
        result[field] = new Date(val._seconds * 1000 + Math.floor(val._nanoseconds / 1000000)).toISOString();
      }
    }
  });
  return result;
}

async function getRound(roundId, includeDeleted = false) {
  try {
    // 1. Check Redis first
    let cached = null;
    try {
      cached = await redis.get(KEYS.round(roundId));
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis getRound failed, falling back to Firestore:', redisErr.message);
    }
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.isDeleted && !includeDeleted) return { source: 'cache', data: null };
      return { source: 'cache', data: parsed };
    }
    
    // 2. Cache miss — fetch from Firebase
    const doc = await db.collection('interviews').doc(roundId).get();
    if (!doc.exists) return { source: 'firebase', data: null };
    
    let data = { id: doc.id, ...doc.data() };
    data = convertTimestampsToDates(data);
    
    if (data.isDeleted) {
      try {
        await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify({ ...data, isDeleted: true }));
      } catch (_) {}
      if (!includeDeleted) return { source: 'firebase', data: null };
    }
    
    // 3. Populate cache for next read
    try {
      await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify(data));
    } catch (_) {}
    
    return { source: 'firebase', data };
  } catch (err) {
    console.error('[SchedulingCache] getRound error:', err);
    throw err;
  }
}

async function getRoundsList(orgId, filters = {}) {
  const filterHash = hashFilters(filters);
  const cacheKey = KEYS.roundsList(orgId, filterHash);
  const isSearch = !!(filters.search && filters.search.trim());

  // Pagination params: default 50, max 200
  const limit = Math.min(200, parseInt(filters.limit, 10) || 50);
  const cursor = filters.cursor?.trim(); // last doc ID for load-more

  try {
    // 1. Try Redis list cache — skip cache for search (must be fresh)
    if (!isSearch) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return { source: 'cache', data: JSON.parse(cached) };
      } catch (redisErr) {
        console.warn('[SchedulingCache] Redis getRoundsList read failed:', redisErr.message);
      }
    }

    // 2. Build Firestore query — skip feedback fields in select (fetched lazily)
    let query = db.collection('interviews')
      .where('organizationId', '==', orgId)
      .where('isDeleted', '==', false)
      .select(
        'applicationId', 'interviewerIds', 'status', 'roundNo', 'round',
        'meetingLink', 'zohoLink', 'scheduledStart', 'scheduledEnd',
        'createdAt', 'updatedAt', 'outcome', 'isDeleted', 'organizationId'
        // NOTE: 'feedback'/'feedbacks' intentionally excluded from list — loaded on detail view
      );

    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.candidateId) query = query.where('candidateId', '==', filters.candidateId);
    if (filters.interviewerId) query = query.where('interviewerIds', 'array-contains', filters.interviewerId);

    let docs = [];
    try {
      const snap = await query.orderBy('scheduledStart', 'desc').get();
      docs = snap.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }));
    } catch (err) {
      const snap = await query.get();
      docs = snap.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }));
      docs.sort((a, b) => new Date(b.scheduledStart || 0) - new Date(a.scheduledStart || 0));
    }

    // 3. Merge dirty queue + filter deleted
    const merged = await mergeWithDirtyQueue(docs, orgId);
    let activeRounds = merged.filter(r => !r.isDeleted);

    // 4. In-memory filters
    if (filters.jobId) {
      activeRounds = activeRounds.filter(r => r.applicationId && r.application?.jobId === filters.jobId);
    }
    if (isSearch) {
      // For search: populate ALL then filter (we need candidate names)
      const allPopulated = await populateInterviews(activeRounds, { skipFeedbacks: true });
      const q = filters.search.trim().toLowerCase();
      const filtered = allPopulated.filter(r => {
        const candName = (r.application?.candidate?.fullName || '').toLowerCase();
        const jobTitle = (r.application?.job?.title || '').toLowerCase();
        return candName.includes(q) || jobTitle.includes(q);
      });
      return {
        source: 'firebase',
        data: { data: filtered, pagination: { total: filtered.length, hasMore: false } }
      };
    }

    // 5. Cursor pagination on raw docs (before populate — minimize populate calls)
    const total = activeRounds.length;
    let startIdx = 0;
    if (cursor) {
      const idx = activeRounds.findIndex(r => r.id === cursor);
      if (idx !== -1) startIdx = idx + 1;
    }
    const pageRounds = activeRounds.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + limit < total;
    const nextCursor = hasMore && pageRounds[pageRounds.length - 1] ? pageRounds[pageRounds.length - 1].id : null;

    // 6. Populate only the page slice (NOT all interviews) — key speedup
    const populated = await populateInterviews(pageRounds, { skipFeedbacks: true });

    // Pre-warm individual round caches asynchronously (don't block response)
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
      pagination: { total, hasMore }
    };

    // Cache only first-page queries (no cursor = first page)
    if (!cursor) {
      try {
        await redis.setex(cacheKey, LIST_TTL, JSON.stringify(result));
        await redis.sadd(`scheduling:rounds:lists:${orgId}`, cacheKey);
      } catch (_) {}
    }

    return { source: 'firebase', data: result };
  } catch (err) {
    console.error('[SchedulingCache] getRoundsList error:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// WRITE OPERATIONS — write to Redis, queue Firebase sync
// ─────────────────────────────────────────────

async function writeRound(roundId, updatePayload, performedBy, orgId, currentData = null) {
  try {
    // 1. Get current state (from Redis or Firebase)
    const current = currentData || (await getRound(roundId)).data;
    if (!current) throw new Error(`Round ${roundId} not found`);
    
    // 2. Merge update into current state
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
      // 3. Write updated state to Redis immediately
      await redis.setex(KEYS.round(roundId), ROUND_TTL, JSON.stringify(updated));
      // 4. Log this write for conflict detection
      await logWrite(roundId, updatePayload, performedBy, timestamp);
      // 5. Add to dirty queue for Firebase sync
      await addToDirtyQueue(roundId, orgId);
      redisSuccess = true;
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis writeRound failed, writing directly to Firestore:', redisErr.message);
    }

    if (!redisSuccess) {
      // Clean up internal metadata fields before writing to Firestore
      const cleanUpdate = { ...updated };
      delete cleanUpdate.id;
      delete cleanUpdate.application;
      delete cleanUpdate.interviewers;
      delete cleanUpdate.feedbacks;
      delete cleanUpdate._pendingSync;
      delete cleanUpdate._lastWriteMs;
      await db.collection('interviews').doc(roundId).update(cleanUpdate);
    }
    
    try {
      // Invalidate feedbacks cache
      await redis.del(`entity:feedbacks:${roundId}`);
      // Invalidate list caches synchronously to prevent race conditions on subsequent reads
      await invalidateListCaches(orgId);
    } catch (_) {}
    
    // Invalidate other caches (analytics, dashboard) ASYNCHRONOUSLY — do NOT block the response
    setImmediate(() => {
      inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    });
    
    // 7. Broadcast real-time update via SSE to all connected clients
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
    // 1. Generate a temporary ID for optimistic rendering
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
      // 2. Store in Redis with temp ID
      await redis.setex(KEYS.round(tempId), ROUND_TTL, JSON.stringify(newRound));
      // 3. Add to dirty queue as a new document
      await addToDirtyQueue(tempId, orgId, true);
      redisSuccess = true;
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis createRound failed, writing directly to Firestore:', redisErr.message);
    }

    let finalRound = { ...newRound };
    if (!redisSuccess) {
      const cleanRound = { ...newRound };
      delete cleanRound.id;
      delete cleanRound.application;
      delete cleanRound.interviewers;
      delete cleanRound.feedbacks;
      delete cleanRound._pendingSync;
      delete cleanRound._isNew;
      delete cleanRound._lastWriteMs;
      const docRef = await db.collection('interviews').add(cleanRound);
      finalRound.id = docRef.id;
    }
    
    try {
      // Invalidate list caches synchronously to prevent race conditions on subsequent reads
      await invalidateListCaches(orgId);
    } catch (_) {}
    
    // Invalidate other caches (analytics, dashboard) ASYNCHRONOUSLY — do NOT block the response
    setImmediate(() => {
      inv.interview(orgId).catch(err => console.error('[CacheInvalidation] interview error:', err.message));
    });
    
    // 5. SSE broadcast
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
      console.warn('[SchedulingCache] Redis deleteRound failed, deleting directly in Firestore:', redisErr.message);
    }

    if (!redisSuccess) {
      await db.collection('interviews').doc(roundId).update({
        isDeleted: true,
        deletedAt: updated.deletedAt,
        deletedBy
      });
    }
    
    try {
      await redis.del(`entity:feedbacks:${roundId}`);
      // Invalidate list caches synchronously to prevent race conditions on subsequent reads
      await invalidateListCaches(orgId);
    } catch (_) {}
    
    // Invalidate other caches (analytics, dashboard) asynchronously
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
  // Use HSET so re-queuing the same roundId overwrites instead of duplicating
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
    throw redisErr; // Propagate so caller knows Redis write failed
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
        raw: field, // the hash field key for removal
      };
    } catch {
      // Fallback: parse from field key
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

async function mergeWithDirtyQueue(firebaseRounds, orgId) {
  try {
    let hash = null;
    try {
      hash = await redis.hgetall(KEYS.dirtyQueue());
    } catch (redisErr) {
      console.warn('[SchedulingCache] Redis hgetall in mergeWithDirtyQueue failed:', redisErr.message);
    }
    if (!hash || Object.keys(hash).length === 0) return firebaseRounds;
    
    // Filter entries belonging to this org
    const dirtyRoundIds = Object.keys(hash)
      .filter(field => field.startsWith(`${orgId}:`))
      .map(field => field.split(':')[1]);
    
    if (dirtyRoundIds.length === 0) return firebaseRounds;
    
    // Fetch all dirty rounds from Redis
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
    
    // Replace Firebase versions with Redis versions for dirty rounds
    const merged = firebaseRounds.map(r => (isSafeKey(r.id) && dirtyMap[r.id]) || r);
    
    // Add new rounds that exist in Redis but not yet in Firebase
    const newRounds = Object.values(dirtyMap).filter(r => 
      r._isNew && !firebaseRounds.find(fr => fr.id === r.id)
    );
    
    return [...newRounds, ...merged];
  } catch (err) {
    console.error('[SchedulingCache] mergeWithDirtyQueue error:', err);
    return firebaseRounds;
  }
}

// ─────────────────────────────────────────────
// CACHE INVALIDATION
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// WRITE LOG FOR CONFLICT DETECTION
// ─────────────────────────────────────────────

async function logWrite(roundId, payload, performedBy, timestamp) {
  try {
    const logKey = KEYS.writeLog(roundId);
    const entry = JSON.stringify({ payload: Object.keys(payload), performedBy, timestamp });
    const pipeline = redis.pipeline();
    pipeline.lpush(logKey, entry);
    pipeline.ltrim(logKey, 0, 9);  // keep last 10 writes
    pipeline.expire(logKey, 3600);
    await pipeline.exec();
  } catch (redisErr) {
    console.warn('[SchedulingCache] Redis logWrite failed:', redisErr.message);
  }
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────

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
