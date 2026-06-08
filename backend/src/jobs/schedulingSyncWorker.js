// src/jobs/schedulingSyncWorker.js
const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const { db, admin } = require('../config/firebase');
const redis = require('../utils/redisClient');
const KEYS = require('../utils/schedulingCacheKeys');
const {
  getDirtyQueue,
  removeFromDirtyQueue,
  getRound,
  invalidateListCaches,
} = require('../services/schedulingCacheService');

const SYNC_QUEUE_NAME = 'scheduling-firebase-sync';
const MAX_BATCH_SIZE = 500; // Firestore batch limit

const connectionConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
};

const connectionOptions = {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableOfflineQueue: true,
  keepAlive: 30000,
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ENOTFOUND'];
    return targetErrors.some(e => err.message.includes(e));
  },
};

let queueConnection;
let workerConnection;

if (typeof connectionConfig === 'string') {
  queueConnection = new Redis(connectionConfig, connectionOptions);
  workerConnection = new Redis(connectionConfig, connectionOptions);
} else {
  queueConnection = new Redis({ ...connectionConfig, ...connectionOptions });
  workerConnection = new Redis({ ...connectionConfig, ...connectionOptions });
}

queueConnection.on('error', (err) => console.error('[BullMQ Queue Redis] Error:', err.message));
workerConnection.on('error', (err) => console.error('[BullMQ Worker Redis] Error:', err.message));

// ── Queue and Scheduler setup ──
const syncQueue = new Queue(SYNC_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

// Schedule the repeating sync job on startup
async function scheduleSyncJob() {
  // Remove any existing repeatable job first to avoid duplicates
  const repeatableJobs = await syncQueue.getRepeatableJobs();
  await Promise.all(
    repeatableJobs
      .filter(j => j.name === 'firebase-sync')
      .map(j => syncQueue.removeRepeatableByKey(j.key))
  );
  
  // Add the new repeatable job — every 5 seconds
  await syncQueue.add('firebase-sync', {}, {
    repeat: { every: 5000 },  // 5 seconds
    jobId: 'firebase-sync-repeatable',
  });
  
  console.log('[SchedulingSync] Sync job scheduled every 5 seconds');
}

// ── Status sync helper for application and candidate status ──
async function syncApplicationAndCandidateStatus(interviewId, recommendation) {
  try {
    const interviewDoc = await db.collection("interviews").doc(interviewId).get();
    if (!interviewDoc.exists) return;
    
    const interviewDataRaw = interviewDoc.data();
    if (interviewDataRaw.applicationId) {
      const appRef = db.collection("applications").doc(interviewDataRaw.applicationId);
      const appDoc = await appRef.get();
      
      if (appDoc.exists) {
        const appData = appDoc.data();
        let newStatus = appData.status;
        let candidateStatus = "ACTIVE";

        if (recommendation === "REJECTED") {
          newStatus = "REJECTED";
          candidateStatus = "REJECTED";
        } else if (recommendation === "SELECTED" || recommendation === "OFFER_SENT" || recommendation === "OFFER_LETTER") {
          newStatus = "OFFER_SENT";
          candidateStatus = "OFFER_SENT";
        } else if (recommendation === "JOINED") {
          newStatus = "JOINED";
          candidateStatus = "JOINED";
        }

        // Update Application
        await appRef.update({ status: newStatus, updatedAt: new Date().toISOString() });

        // Update Candidate global status
        if (appData.candidateId) {
          await db.collection("candidates").doc(appData.candidateId).update({
            status: candidateStatus,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  } catch (err) {
    console.error("[SchedulingSync] Status sync error:", err.message);
  }
}

// ── Worker ──
const worker = new Worker(
  SYNC_QUEUE_NAME,
  async (job) => {
    const syncStart = Date.now();
    
    // Acquire sync lock — prevent concurrent syncs
    const lockKey = KEYS.syncLock();
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 60);
    if (!lockAcquired) {
      console.log('[SchedulingSync] Sync already in progress, skipping');
      return { skipped: true };
    }
    
    // Extend lock every 15s to prevent expiry during long syncs
    const lockExtender = setInterval(async () => {
      try { await redis.expire(lockKey, 60); } catch { /* ignore */ }
    }, 15000);
    
    try {
      // 1. Get all dirty rounds from Redis
      const dirtyItems = await getDirtyQueue();
      
      if (dirtyItems.length === 0) {
        return { synced: 0 };
      }
      
      // Check retry counts — move items exceeding MAX_RETRIES to dead letter queue
      const retryKeys = dirtyItems.map(item => `scheduling:retry:count:${item.roundId}`);
      const retryCounts = retryKeys.length > 0 ? await redis.mget(...retryKeys) : [];
      
      const toSync = [];
      const toDeadLetter = [];
      const MAX_RETRIES = 3;
      
      dirtyItems.forEach((item, idx) => {
        const count = parseInt(retryCounts[idx] || '0', 10);
        if (count >= MAX_RETRIES) {
          toDeadLetter.push(item);
        } else {
          toSync.push(item);
        }
      });
      
      // Move failing items to dead letter queue
      if (toDeadLetter.length > 0) {
        const dlPipeline = redis.pipeline();
        for (const item of toDeadLetter) {
          const cachedData = await redis.get(KEYS.round(item.roundId));
          const dlEntry = JSON.stringify({
            roundId: item.roundId,
            orgId: item.orgId,
            data: cachedData ? JSON.parse(cachedData) : null,
            failedAt: new Date().toISOString(),
            retries: MAX_RETRIES,
          });
          dlPipeline.sadd('scheduling:dead-letter:queue', dlEntry);
          dlPipeline.del(`scheduling:retry:count:${item.roundId}`);
        }
        await dlPipeline.exec();
        
        // Remove from dirty queue
        await removeFromDirtyQueue(toDeadLetter.map(item => item.raw));
        console.error(`[SchedulingSync] Moved ${toDeadLetter.length} rounds to dead letter queue after ${MAX_RETRIES} failures`);
      }
      
      if (toSync.length === 0) {
        return { synced: 0, deadLettered: toDeadLetter.length };
      }
      
      console.log(`[SchedulingSync] Syncing ${toSync.length} dirty rounds to Firebase`);
      
      // 2. Fetch all dirty rounds from Redis in parallel
      const roundData = await Promise.all(
        toSync.map(async item => {
          const { data } = await getRound(item.roundId, true);
          return { ...item, roundData: data };
        })
      );
      
      // 3. Split into batches of 500 (Firestore batch limit)
      const batches = [];
      for (let i = 0; i < roundData.length; i += MAX_BATCH_SIZE) {
        batches.push(roundData.slice(i, i + MAX_BATCH_SIZE));
      }
      
      let totalSynced = 0;
      const syncedRawKeys = [];
      const tempToRealIdMap = {};
      const allSyncedIds = [];
      
      for (const batch of batches) {
        const firestoreBatch = db.batch();
        const batchItems = [];
        
        for (const item of batch) {
          if (!item.roundData) {
            console.warn(`[SchedulingSync] Round ${item.roundId} not found in Redis, skipping`);
            syncedRawKeys.push(item.raw);
            continue;
          }
          
          // Clean internal Redis metadata fields before writing to Firebase
          const { 
            _pendingSync, _isNew, _lastWriteMs, 
            id, application, feedbacks, ...cleanData 
          } = item.roundData;
          
          let docRef;
          let realId = item.roundId;
          
          if (item.isNew && item.roundId.startsWith('temp_')) {
            // New document — create with auto-generated Firebase ID
            docRef = db.collection('interviews').doc();
            tempToRealIdMap[item.roundId] = docRef.id;
            realId = docRef.id;
          } else {
            docRef = db.collection('interviews').doc(item.roundId);
          }
          
          allSyncedIds.push(realId);

          // Convert ISO strings back to Firestore Timestamps
          const firestoreData = convertDatesToTimestamps(cleanData);
          
          // Process nested feedback entries and write to interviewFeedbacks collection
          if (cleanData.feedback && Array.isArray(cleanData.feedback)) {
            for (const fb of cleanData.feedback) {
              if (!fb.id || fb.id.startsWith('temp_')) {
                const fbRef = db.collection('interviewFeedbacks').doc();
                fb.id = fbRef.id;
                
                const fbData = {
                  interviewId: realId,
                  submittedById: fb.submittedBy,
                  technicalRating: parseInt(fb.ratings?.technical || fb.technicalRating) || 0,
                  communicationRating: parseInt(fb.ratings?.communication || fb.communicationRating) || 0,
                  cultureFitRating: parseInt(fb.ratings?.culture || fb.cultureFitRating) || 0,
                  strengths: fb.strengths || "",
                  weaknesses: fb.weaknesses || fb.concerns || "",
                  overallComments: fb.notes || fb.overallComments || "",
                  recommendation: fb.recommendation || "PENDING",
                  createdAt: fb.submittedAt || new Date().toISOString()
                };
                
                if (fb.offerFileUrl) {
                  fbData.offerFileUrl = fb.offerFileUrl;
                  fbData.offerFileName = fb.offerFileName;
                }

                firestoreBatch.set(fbRef, fbData);
                
                // Update applications and candidates statuses in Firestore
                await syncApplicationAndCandidateStatus(realId, fb.recommendation);
              }
            }
          }
          
          if (cleanData.isDeleted) {
            if (!item.isNew) firestoreBatch.delete(docRef);
          } else if (item.isNew) {
            firestoreBatch.set(docRef, firestoreData);
          } else {
            firestoreBatch.set(docRef, firestoreData, { merge: true });
          }
          
          batchItems.push(item);
        }
        
        try {
          // Commit the Firestore batch
          await firestoreBatch.commit();
          totalSynced += batchItems.length;
          
          // Update Redis entries for temp ID → real ID mappings
          await Promise.all(
            Object.entries(tempToRealIdMap).map(async ([tempId, realId]) => {
              const cachedData = await redis.get(KEYS.round(tempId));
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                parsed.id = realId;
                parsed._pendingSync = false;
                parsed._isNew = false;
                // Store under real ID
                await redis.setex(KEYS.round(realId), 7200, JSON.stringify(parsed));
                // Remove temp ID key
                await redis.del(KEYS.round(tempId));
              }
            })
          );
          
          // Mark as no longer pending sync in Redis
          await Promise.all(
            batchItems.map(async item => {
              const realId = tempToRealIdMap[item.roundId] || item.roundId;
              const cachedData = await redis.get(KEYS.round(realId));
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                parsed._pendingSync = false;
                parsed._isNew = false;
                await redis.setex(KEYS.round(realId), 7200, JSON.stringify(parsed));
              }
            })
          );
          
          syncedRawKeys.push(...batchItems.map(i => i.raw));
          
          // Clear retry counts on success
          const successPipeline = redis.pipeline();
          batchItems.forEach(item => {
            successPipeline.del(`scheduling:retry:count:${item.roundId}`);
          });
          await successPipeline.exec();
          
        } catch (batchErr) {
          console.error('[SchedulingSync] Firestore batch commit failed:', batchErr.message);
          
          // Increment retry counts for all items in this batch
          const failPipeline = redis.pipeline();
          batchItems.forEach(item => {
            failPipeline.incr(`scheduling:retry:count:${item.roundId}`);
            failPipeline.expire(`scheduling:retry:count:${item.roundId}`, 3600);
          });
          await failPipeline.exec();
        }
      }
      
      // 4. Remove synced items from dirty queue
      if (syncedRawKeys.length > 0) {
        await removeFromDirtyQueue(syncedRawKeys);
      }

      // Clear Redis list caches for all involved organizations to guarantee fresh reads after sync
      const uniqueOrgs = [...new Set(toSync.map(i => i.orgId || "defaultOrg"))];
      await Promise.all(uniqueOrgs.map(orgId => invalidateListCaches(orgId)));
      
      // 5. Broadcast sync completion via SSE
      if (totalSynced > 0) {
        const sse = require('../utils/sse');
        uniqueOrgs.forEach(orgId => {
          sse.broadcastToOrg(orgId, 'SCHEDULING_SYNC_COMPLETE', {
            synced: totalSynced,
            tempIdMap: tempToRealIdMap,
            syncedIds: allSyncedIds,
            timestamp: new Date().toISOString(),
          });
        });
      }
      
      const duration = Date.now() - syncStart;
      console.log(`[SchedulingSync] Synced ${totalSynced} rounds in ${duration}ms`);
      
      // Update last sync timestamp
      if (toSync.length > 0) {
        const orgs = [...new Set(toSync.map(i => i.orgId))];
        const syncTimestamp = new Date().toISOString();
        await Promise.all(orgs.map(orgId => redis.set(KEYS.lastSync(orgId), syncTimestamp)));
      }
      
      return { synced: totalSynced, duration, tempIdMap: tempToRealIdMap, deadLettered: toDeadLetter.length };
      
    } finally {
      clearInterval(lockExtender);
      await redis.del(lockKey);
    }
  },
  {
    connection: workerConnection,
    concurrency: 1,  // only one sync at a time
    lockDuration: 60000,
    stalledInterval: 15000,
    maxStalledCount: 2,
  }
);

worker.on('completed', (job, result) => {
  if (!result?.skipped && result?.synced > 0) {
    console.log(`[SchedulingSync] Job completed: ${result.synced} rounds synced`);
  }
});

worker.on('failed', (job, err) => {
  console.error(`[SchedulingSync] Job failed:`, err.message);
});

// Helper — convert ISO strings to Firestore Timestamps
function convertDatesToTimestamps(data) {
  const result = { ...data };
  const dateFields = ['scheduledStart', 'scheduledEnd', 'createdAt', 'updatedAt', 'deletedAt', 'completedAt'];
  dateFields.forEach(field => {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = admin.firestore.Timestamp.fromDate(new Date(result[field]));
    }
  });
  return result;
}

module.exports = { worker, syncQueue, scheduleSyncJob };
