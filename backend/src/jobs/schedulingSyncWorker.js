// src/jobs/schedulingSyncWorker.js
const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const prisma = require('../config/db');
const redis = require('../utils/redisClient');
const KEYS = require('../utils/schedulingCacheKeys');
const {
  getDirtyQueue,
  removeFromDirtyQueue,
  getRound,
  invalidateListCaches,
} = require('../services/schedulingCacheService');

const SYNC_QUEUE_NAME = 'scheduling-firebase-sync'; // Keep queue name same to avoid configuration edits
const MAX_BATCH_SIZE = 500;

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

const syncQueue = new Queue(SYNC_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

async function scheduleSyncJob() {
  const repeatableJobs = await syncQueue.getRepeatableJobs();
  await Promise.all(
    repeatableJobs
      .filter(j => j.name === 'firebase-sync')
      .map(j => syncQueue.removeRepeatableByKey(j.key))
  );
  
  await syncQueue.add('firebase-sync', {}, {
    repeat: { every: 5000 },  // every 5 seconds
    jobId: 'firebase-sync-repeatable',
  });
  
  console.log('[SchedulingSync] Sync job scheduled every 5 seconds');
}

async function syncApplicationAndCandidateStatus(interviewId, recommendation) {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId }
    });
    if (!interview || !interview.applicationId) return;
    
    const app = await prisma.application.findUnique({
      where: { id: interview.applicationId }
    });
    
    if (app) {
      let newStatus = app.status;
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

      await prisma.application.update({
        where: { id: app.id },
        data: { status: newStatus }
      });

      await prisma.candidate.update({
        where: { id: app.candidateId },
        data: { status: candidateStatus }
      });
    }
  } catch (err) {
    console.error("[SchedulingSync] Status sync error:", err.message);
  }
}

const worker = new Worker(
  SYNC_QUEUE_NAME,
  async (job) => {
    const syncStart = Date.now();
    
    const lockKey = KEYS.syncLock();
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 60);
    if (!lockAcquired) {
      console.log('[SchedulingSync] Sync already in progress, skipping');
      return { skipped: true };
    }
    
    const lockExtender = setInterval(async () => {
      try { await redis.expire(lockKey, 60); } catch { /* ignore */ }
    }, 15000);
    
    try {
      const dirtyItems = await getDirtyQueue();
      
      if (dirtyItems.length === 0) {
        return { synced: 0 };
      }
      
      console.log(`[SchedulingSync] Syncing ${dirtyItems.length} dirty rounds to CockroachDB`);
      
      // Fetch all round data in a single MGET call to avoid parallel network congestion
      const roundKeys = dirtyItems.map(item => KEYS.round(item.roundId));
      let cachedRounds = [];
      try {
        cachedRounds = await redis.mget(...roundKeys);
      } catch (err) {
        console.error('[SchedulingSync] MGET failed, falling back to individual database checks:', err.message);
        cachedRounds = await Promise.all(dirtyItems.map(async item => {
          const { data } = await getRound(item.roundId, true);
          return data ? JSON.stringify(data) : null;
        }));
      }

      const roundData = dirtyItems.map((item, index) => {
        const cached = cachedRounds[index];
        return {
          ...item,
          roundData: cached ? JSON.parse(cached) : null
        };
      });
      
      let totalSynced = 0;
      const syncedRawKeys = [];
      const tempToRealIdMap = {};
      const allSyncedIds = [];
      
      // Sync all items in parallel to avoid blocked event loop and timeouts
      await Promise.all(roundData.map(async (item) => {
        if (!item.roundData) {
          console.warn(`[SchedulingSync] Round ${item.roundId} not found in Redis, skipping`);
          syncedRawKeys.push(item.raw);
          return;
        }
        
        const { 
          _pendingSync, _isNew, _lastWriteMs, 
          id, application, feedbacks, ...cleanData 
        } = item.roundData;
        
        let realId = item.roundId;
        
        // Prepare DB fields
        const dataPayload = {
          applicationId: cleanData.applicationId || null,
          candidateId: cleanData.candidateId || null,
          candidateName: cleanData.candidateName || null,
          jobId: cleanData.jobId || null,
          jobTitle: cleanData.jobTitle || null,
          roundNo: cleanData.roundNo ? parseInt(cleanData.roundNo) : 1,
          round: cleanData.round || null,
          scheduledStart: cleanData.scheduledStart ? new Date(cleanData.scheduledStart) : null,
          durationMinutes: cleanData.durationMinutes ? parseInt(cleanData.durationMinutes) : 60,
          mode: cleanData.mode || "VIRTUAL",
          meetingLink: cleanData.meetingLink || null,
          zohoLink: cleanData.zohoLink || null,
          status: cleanData.status || "SCHEDULED",
          result: cleanData.result || null,
          outcome: cleanData.outcome || null,
          outcomeSetAt: cleanData.outcomeSetAt ? new Date(cleanData.outcomeSetAt) : null,
          notes: cleanData.notes || null,
          organizationId: cleanData.organizationId || "defaultOrg",
          createdById: cleanData.createdById || null,
          interviewerIds: cleanData.interviewerIds || [],
          feedback: cleanData.feedback || [],
          rescheduleHistory: cleanData.rescheduleHistory || [],
          transferHistory: cleanData.transferHistory || [],
          offerLetterUrl: cleanData.offerLetterUrl || null,
          voiceRecordingFileId: cleanData.voiceRecordingFileId || null,
          voiceRecordingUrl: cleanData.voiceRecordingUrl || null,
        };

        if (cleanData.isDeleted) {
          if (!item.isNew && !item.roundId.startsWith('temp_')) {
            await prisma.interview.delete({ where: { id: item.roundId } }).catch(() => {});
          }
        } else if (item.isNew && item.roundId.startsWith('temp_')) {
          const created = await prisma.interview.create({
            data: {
              ...dataPayload,
              id: undefined
            }
          });
          tempToRealIdMap[item.roundId] = created.id;
          realId = created.id;
        } else {
          await prisma.interview.upsert({
            where: { id: item.roundId },
            update: dataPayload,
            create: {
              id: item.roundId,
              ...dataPayload
            }
          });
        }
        
        allSyncedIds.push(realId);

        // Sync statuses if feedback was updated
        if (dataPayload.feedback && Array.isArray(dataPayload.feedback)) {
          for (const fb of dataPayload.feedback) {
            if (fb.recommendation) {
              await syncApplicationAndCandidateStatus(realId, fb.recommendation);
            }
          }
        }

        totalSynced++;
        syncedRawKeys.push(item.raw);
      }));
      
      // Update mappings and marks in Redis
      await Promise.all(
        Object.entries(tempToRealIdMap).map(async ([tempId, realId]) => {
          const cachedData = await redis.get(KEYS.round(tempId));
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            parsed.id = realId;
            parsed._pendingSync = false;
            parsed._isNew = false;
            await redis.setex(KEYS.round(realId), 7200, JSON.stringify(parsed));
            await redis.del(KEYS.round(tempId));
          }
        })
      );
      
      await Promise.all(
        syncedRawKeys.map(async rawKey => {
          const roundId = rawKey.split(':')[1];
          const realId = tempToRealIdMap[roundId] || roundId;
          const cachedData = await redis.get(KEYS.round(realId));
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            parsed._pendingSync = false;
            parsed._isNew = false;
            await redis.setex(KEYS.round(realId), 7200, JSON.stringify(parsed));
          }
        })
      );
      
      await removeFromDirtyQueue(syncedRawKeys);

      const uniqueOrgs = [...new Set(dirtyItems.map(i => i.orgId || "defaultOrg"))];
      await Promise.all(uniqueOrgs.map(orgId => invalidateListCaches(orgId)));
      
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
      
      if (dirtyItems.length > 0) {
        const orgs = [...new Set(dirtyItems.map(i => i.orgId))];
        const syncTimestamp = new Date().toISOString();
        await Promise.all(orgs.map(orgId => redis.set(KEYS.lastSync(orgId), syncTimestamp)));
      }
      
      return { synced: totalSynced, duration, tempIdMap: tempToRealIdMap };
      
    } finally {
      clearInterval(lockExtender);
      await redis.del(lockKey);
    }
  },
  {
    connection: workerConnection,
    concurrency: 1,
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

module.exports = { worker, syncQueue, scheduleSyncJob };
