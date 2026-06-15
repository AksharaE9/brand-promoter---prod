'use strict';
const redis = require('../../utils/redisClient');

const DIRTY_QUEUE_KEY  = 'scheduling:dirty:queue';
const MERGE_TIMEOUT_MS = 200; // If dirty merge takes over 200ms, skip it

/**
 * Merges pending dirty rounds into the list result.
 * This MUST complete in under 200ms or it is skipped entirely to prevent response blockages.
 */
async function mergeDirtyQueue(dbRounds, orgId) {
  try {
    // Race the dirty queue fetch against a 200ms timeout
    const dirtyRounds = await Promise.race([
      fetchDirtyRoundsForOrg(orgId),
      new Promise(resolve => setTimeout(() => resolve([]), MERGE_TIMEOUT_MS)),
    ]);

    if (!dirtyRounds || dirtyRounds.length === 0) return dbRounds;

    const dirtyMap = {};
    dirtyRounds.forEach(r => {
      if (r && r.id) dirtyMap[r.id] = r;
    });

    // Replace any DB version with the Redis (fresher) version
    const merged = dbRounds.map(round =>
      dirtyMap[round.id] ? { ...round, ...dirtyMap[round.id] } : round
    );

    // Add new rounds (exist in Redis but not yet in DB)
    const dbIds = new Set(dbRounds.map(r => r.id));
    const newRounds = dirtyRounds.filter(r => r._isNew && !dbIds.has(r.id));

    return [...newRounds, ...merged];
  } catch (err) {
    console.warn('[DirtyMerge] Error merging dirty queue:', err.message);
    // Never block on dirty merge failure — return DB data as-is
    return dbRounds;
  }
}

async function fetchDirtyRoundsForOrg(orgId) {
  let hash = null;
  try {
    hash = await redis.hgetall(DIRTY_QUEUE_KEY);
  } catch (err) {
    console.warn('[DirtyMerge] Failed hgetall:', err.message);
  }
  if (!hash || Object.keys(hash).length === 0) return [];

  const dirtyRoundIds = Object.keys(hash)
    .filter(field => field.startsWith(`${orgId}:`))
    .map(field => field.split(':')[1]);

  if (dirtyRoundIds.length === 0) return [];

  const cacheKeys = dirtyRoundIds.map(id => `scheduling:round:${id}`);
  const values = await redis.mget(...cacheKeys);

  return values
    .map(v => {
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { mergeDirtyQueue };
