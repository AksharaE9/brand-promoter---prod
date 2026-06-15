'use strict';
const redis = require('../../utils/redisClient');
const prisma = require('../../config/db');

const ENTITY_TTL    = 600;    // 10 minutes
const ENTITY_PREFIX = 'entity:';

/**
 * Populates relations for a list of interview rounds in ONE operation.
 * 
 * Flow:
 *   1. Collect all unique IDs (candidates, jobs, users/panelists)
 *   2. Redis mget for all of them
 *   3. Database query for misses only, run in parallel
 *   4. Merge results in memory
 */
async function populateInterviewRelations(rounds) {
  if (!rounds || rounds.length === 0) return rounds;

  // Collect all unique IDs needed across all rounds (resolve from application relation if needed)
  const candidateIds = [...new Set(rounds.map(r => r.candidateId || r.application?.candidateId).filter(Boolean))];
  const jobIds       = [...new Set(rounds.map(r => r.jobId || r.application?.jobId).filter(Boolean))];
  
  const interviewerIdsList = rounds.flatMap(r => {
    let ids = [];
    try {
      ids = typeof r.interviewerIds === 'string' ? JSON.parse(r.interviewerIds) : r.interviewerIds;
    } catch (_) {}
    return Array.isArray(ids) ? ids : [];
  });
  const panelIds = [...new Set(interviewerIdsList.filter(Boolean))];

  // Build all Redis cache keys
  const candidateKeys = candidateIds.map(id => `${ENTITY_PREFIX}candidates:${id}`);
  const jobKeys       = jobIds.map(id       => `${ENTITY_PREFIX}jobs:${id}`);
  const panelKeys     = panelIds.map(id     => `${ENTITY_PREFIX}users:${id}`);
  const allKeys       = [...candidateKeys, ...jobKeys, ...panelKeys];

  let candidateMap = {};
  let jobMap       = {};
  let userMap      = {};

  // Single Redis mget for ALL entities across ALL rounds
  if (allKeys.length > 0) {
    try {
      const values = await redis.mget(...allKeys);

      let keyIdx = 0;

      // Parse candidates from mget result
      candidateIds.forEach((id) => {
        const val = values[keyIdx++];
        if (val) {
          try { candidateMap[id] = JSON.parse(val); } catch {}
        }
      });

      // Parse jobs from mget result
      jobIds.forEach((id) => {
        const val = values[keyIdx++];
        if (val) {
          try { jobMap[id] = JSON.parse(val); } catch {}
        }
      });

      // Parse panel members from mget result
      panelIds.forEach((id) => {
        const val = values[keyIdx++];
        if (val) {
          try { userMap[id] = JSON.parse(val); } catch {}
        }
      });

    } catch (err) {
      console.warn('[RelationPopulator] Redis mget error:', err.message);
      // Redis down — all will be fetched from CockroachDB below
    }
  }

  // Find what is still missing after Redis
  const missingCandidates = candidateIds.filter(id => !candidateMap[id]);
  const missingJobs       = jobIds.filter(id       => !jobMap[id]);
  const missingPanel      = panelIds.filter(id     => !userMap[id]);

  // Single parallel DB fetch for ALL missing entities
  const dbFetches = [];

  if (missingCandidates.length > 0) {
    dbFetches.push(
      prisma.candidate.findMany({
        where: { id: { in: missingCandidates } },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          currentStage: true,
          profilePhotoFile: {
            select: {
              storageKey: true
            }
          }
        }
      }).then(docs => {
        docs.forEach(d => {
          candidateMap[d.id] = d;
        });
      })
    );
  }

  if (missingJobs.length > 0) {
    dbFetches.push(
      prisma.job.findMany({
        where: { id: { in: missingJobs } },
        select: {
          id: true,
          title: true,
          department: true,
          location: true
        }
      }).then(docs => {
        docs.forEach(d => {
          jobMap[d.id] = d;
        });
      })
    );
  }

  if (missingPanel.length > 0) {
    dbFetches.push(
      prisma.user.findMany({
        where: { id: { in: missingPanel } },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true
        }
      }).then(docs => {
        docs.forEach(d => {
          userMap[d.id] = d;
        });
      })
    );
  }

  // ALL DB fetches run in parallel
  if (dbFetches.length > 0) {
    await Promise.all(dbFetches);
  }

  // Save newly fetched entities to Redis (async, non-blocking)
  const entitiesToCache = [
    ...Object.entries(candidateMap).filter(([id]) => missingCandidates.includes(id))
      .map(([id, data]) => ({ key: `${ENTITY_PREFIX}candidates:${id}`, data })),
    ...Object.entries(jobMap).filter(([id]) => missingJobs.includes(id))
      .map(([id, data]) => ({ key: `${ENTITY_PREFIX}jobs:${id}`, data })),
    ...Object.entries(userMap).filter(([id]) => missingPanel.includes(id))
      .map(([id, data]) => ({ key: `${ENTITY_PREFIX}users:${id}`, data })),
  ];

  if (entitiesToCache.length > 0) {
    setImmediate(async () => {
      try {
        const pl = redis.pipeline();
        entitiesToCache.forEach(({ key, data }) => {
          pl.setex(key, ENTITY_TTL, JSON.stringify(data));
        });
        await pl.exec();
      } catch { /* silent */ }
    });
  }

  // Merge relations into rounds to keep backwards compatibility with frontend expectation
  return rounds.map(round => {
    const candidateId = round.candidateId || round.application?.candidateId;
    const jobId = round.jobId || round.application?.jobId;

    const candidate = candidateId ? candidateMap[candidateId] : null;
    const job = jobId ? jobMap[jobId] : null;
    
    let interviewerIds = [];
    try {
      interviewerIds = typeof round.interviewerIds === 'string' ? JSON.parse(round.interviewerIds) : round.interviewerIds;
    } catch (_) {}
    if (!Array.isArray(interviewerIds)) interviewerIds = [];

    const interviewers = interviewerIds.map(id => userMap[id]).filter(Boolean);

    // Frontend accesses nested object: round.application.candidate
    const application = round.applicationId ? {
      id: round.applicationId,
      candidateId,
      jobId,
      status: round.status,
      candidate,
      job
    } : null;

    return {
      ...round,
      candidateId,
      jobId,
      candidate,
      job,
      interviewers,
      application,
      _candidateName: candidate?.fullName || round.candidateName || null,
      _jobTitle: job?.title || round.jobTitle || null,
      _panelNames: interviewers.map(u => u.fullName),
    };
  });
}

module.exports = { populateInterviewRelations };
