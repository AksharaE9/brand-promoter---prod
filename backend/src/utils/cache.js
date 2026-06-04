'use strict';
const redis = require('./redisClient');

const DEFAULT_TTL = 60;

// ── Core operations ──
async function getCache(key) {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.error('[Cache] getCache error:', key, err.message);
    return null;
  }
}

async function setCache(key, data, ttlSeconds = DEFAULT_TTL) {
  try {
    if (data === null || data === undefined) return;
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    console.error('[Cache] setCache error:', key, err.message);
  }
}

async function deleteCache(key) {
  try {
    await redis.del(key);
  } catch (err) {
    console.error('[Cache] deleteCache error:', key, err.message);
  }
}

async function deleteCachePattern(pattern) {
  try {
    // Use SCAN instead of KEYS for production safety
    let cursor = '0';
    const keysToDelete = [];
    do {
      const [newCursor, keys] = await redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', 100
      );
      cursor = newCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      const pipeline = redis.pipeline();
      keysToDelete.forEach(k => pipeline.del(k));
      await pipeline.exec();
    }
  } catch (err) {
    console.error('[Cache] deleteCachePattern error:', pattern, err.message);
  }
}

async function deleteManyPatterns(patterns) {
  await Promise.all(patterns.map(p => deleteCachePattern(p)));
}

function cacheKey(...parts) {
  if (parts.length === 1 && Array.isArray(parts[0])) {
    return parts[0].filter(Boolean).join(':');
  }
  return parts.filter(Boolean).join(':');
}

// ── Pipeline batch set ──
async function setCacheMany(entries, ttlSeconds = DEFAULT_TTL) {
  try {
    const pipeline = redis.pipeline();
    entries.forEach(({ key, data }) => {
      pipeline.setex(key, ttlSeconds, JSON.stringify(data));
    });
    await pipeline.exec();
  } catch (err) {
    console.error('[Cache] setCacheMany error:', err.message);
  }
}

// ── Health check ──
async function pingCache() {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

// ── TTL constants ──
const TTL = {
  DASHBOARD:    60,
  CANDIDATES:   30,
  JOBS:        120,
  TEAM:        120,
  ANALYTICS:   120,
  AUDIT:        30,
  DRIVES:       60,
  ROUND:      7200,
  ROUND_LIST:    5,
  DIRTY:      3600,
};

// ── Backward-compatible API ──
async function getCached(key, fetcher, ttlMs = 60000) {
  const cached = await getCache(key);
  if (cached !== null) {
    return cached;
  }
  const data = await fetcher();
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
  await setCache(key, data, ttlSec);
  return data;
}

/**
 * Cache-aside with mutex to prevent stampede.
 * On cache miss, acquires a short lock before calling the fetcher.
 * Other concurrent requests wait and retry instead of all hitting Firestore.
 */
async function getCachedWithMutex(key, fetcher, ttlMs = 60000) {
  // 1. Check cache
  const cached = await getCache(key);
  if (cached !== null) return cached;

  // 2. Try to acquire a mutex lock
  const lockKey = `mutex:${key}`;
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));

  try {
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);

    if (lockAcquired) {
      // We hold the lock — fetch and populate cache
      try {
        const data = await fetcher();
        await setCache(key, data, ttlSec);
        return data;
      } finally {
        await redis.del(lockKey).catch(() => {});
      }
    }

    // Lock held by another request — wait and retry up to 3 times
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      const retryCache = await getCache(key);
      if (retryCache !== null) return retryCache;
    }

    // All retries failed — fall through to direct fetch (no caching to avoid stale)
    return await fetcher();
  } catch (err) {
    console.error('[Cache] getCachedWithMutex error:', key, err.message);
    // Fallback: bypass cache entirely
    return await fetcher();
  }
}

async function invalidateAll() {
  try {
    const prefixes = [
      'dashboard:*', 'analytics:*', 'candidates:*', 'interviews:*',
      'team:*', 'jobs:*', 'users_list_*', 'recruiter_summary_*',
      'candidates_list_*', 'interviews_list_*', 'dashboard_init_*',
      'analytics_*'
    ];
    for (const prefix of prefixes) {
      await deleteCachePattern(prefix);
    }
  } catch { /* silent */ }
}

async function invalidateOrgAnalyticsAndReports(orgId) {
  try {
    const org = orgId || "defaultOrg";
    const keys = [
      `analytics_data_loader:${org}`,
      `analytics_overview_route_${org}`,
      `analytics_pipeline_route_${org}`,
      `analytics_interviewer_load_route_${org}`,
      `analytics_recruiter_performance_route_${org}`,
      `analytics_source_analysis_route_${org}`,
      `analytics_stage_conversion_route_${org}`,
      `analytics_monthly_trends_route_${org}`,
      `reports_candidates_${org}`,
      `reports_interviews_${org}`,
      `reports_recruiter_activity_${org}`,
      `reports_hiring_progress_${org}`
    ];
    for (const key of keys) {
      await deleteCachePattern(key);
    }
  } catch (e) { /* silent */ }
}

module.exports = {
  getCache, setCache, deleteCache, deleteCachePattern,
  deleteManyPatterns, cacheKey, setCacheMany, pingCache, TTL,
  // Backward-compatible API
  getCached,
  getCachedWithMutex,
  invalidate: deleteCache,
  invalidateAll,
  invalidatePattern: deleteCachePattern,
  invalidateOrgAnalyticsAndReports,
};
