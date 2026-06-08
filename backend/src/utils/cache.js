'use strict';
const redis = require('./redisClient');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_TTL = 60;
const COMPRESS_THRESHOLD = 1024; // compress values over 1KB
const COMPRESSED_PREFIX  = 'gz:';

// ── Metrics tracking ──
const metrics = {
  hits:   0,
  misses: 0,
  errors: 0,
  sets:   0,
  dels:   0,
};

// ── Core operations ──
async function getCache(key) {
  try {
    const val = await redis.get(key);
    if (!val) {
      metrics.misses++;
      return null;
    }

    metrics.hits++;
    let json;
    if (val.startsWith(COMPRESSED_PREFIX)) {
      const compressed = Buffer.from(val.slice(COMPRESSED_PREFIX.length), 'base64');
      json = (await gunzip(compressed)).toString();
    } else {
      json = val;
    }

    return JSON.parse(json);
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] getCache error:', key, err.message);
    return null;
  }
}

async function setCache(key, data, ttlSeconds = DEFAULT_TTL) {
  try {
    if (data === null || data === undefined) return;
    metrics.sets++;

    const json = JSON.stringify(data);
    let value;

    if (json.length > COMPRESS_THRESHOLD) {
      const compressed = await gzip(json);
      value = COMPRESSED_PREFIX + compressed.toString('base64');
    } else {
      value = json;
    }

    await redis.setex(key, ttlSeconds, value);
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] setCache error:', key, err.message);
  }
}

async function deleteCache(key) {
  try {
    metrics.dels++;
    await redis.del(key);
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] deleteCache error:', key, err.message);
  }
}


async function deleteCachePattern(pattern) {
  try {
    let cursor = '0';
    const toDelete = [];
    do {
      const [next, keys] = await redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', '200'
      );
      cursor = next;
      if (keys.length) toDelete.push(...keys);
    } while (cursor !== '0');

    if (toDelete.length === 0) return;

    // Delete in batches of 100 to avoid blocking Redis
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      metrics.dels += batch.length;
      const pipeline = redis.pipeline();
      batch.forEach(k => pipeline.del(k));
      await pipeline.exec();
    }
  } catch (err) {
    metrics.errors++;
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
      metrics.sets++;
      pipeline.setex(key, ttlSeconds, JSON.stringify(data));
    });
    await pipeline.exec();
  } catch (err) {
    metrics.errors++;
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

function getCacheMetrics() {
  const total = metrics.hits + metrics.misses;
  const hitRate = total > 0 ? ((metrics.hits / total) * 100).toFixed(1) : '0.0';
  return { ...metrics, total, hitRate: `${hitRate}%` };
}

// ── TTL constants ──
const TTL = {
  // High volatility — changes many times per day
  CANDIDATES:       30,   // 30 seconds
  APPLICATIONS:     30,
  SCHEDULING_LIST:  30,
  NOTIFICATIONS:    15,   // 15 seconds — near real-time
  DASHBOARD:        45,
  AUDIT:            20,

  // Medium volatility — changes a few times per day
  ANALYTICS:       120,   // 2 minutes
  JOBS:            120,
  TEAM:            180,   // 3 minutes
  DRIVES:          120,

  // Low volatility — changes rarely
  ORG_SETTINGS:   600,   // 10 minutes
  PANEL_MEMBERS:  300,   // 5 minutes
  JOB_ROLES:      600,

  // Scheduling write-through cache
  ROUND:         7200,   // 2 hours — rounds stay warm
  ROUND_DETAIL:  7200,
  DIRTY:         3600,   // 1 hour — dirty queue entries
};

// ── Backward-compatible API ──
async function getCached(key, fetcher, ttlMs = 60000) {
  const { tieredGet, tieredSet } = require('./tieredCache');
  const { data } = await tieredGet(key, ttlMs);
  if (data !== null) {
    return data;
  }
  const fresh = await fetcher();
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
  await tieredSet(key, fresh, ttlSec, ttlMs);
  return fresh;
}

/**
 * Cache-aside with mutex to prevent stampede.
 */
async function getCachedWithMutex(key, fetcher, ttlMs = 60000) {
  const cached = await getCache(key);
  if (cached !== null) return cached;

  const lockKey = `mutex:${key}`;
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));

  try {
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);

    if (lockAcquired) {
      try {
        const data = await fetcher();
        await setCache(key, data, ttlSec);
        return data;
      } finally {
        await redis.del(lockKey).catch(() => {});
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      const retryCache = await getCache(key);
      if (retryCache !== null) return retryCache;
    }

    return await fetcher();
  } catch (err) {
    console.error('[Cache] getCachedWithMutex error:', key, err.message);
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
      await deleteCache(key);
    }
  } catch (e) { /* silent */ }
}

module.exports = {
  getCache, setCache, deleteCache, deleteCachePattern,
  deleteManyPatterns, cacheKey, setCacheMany, pingCache, TTL,
  getCacheMetrics,
  // Backward-compatible API
  getCached,
  getCachedWithMutex,
  invalidate: deleteCache,
  invalidateAll,
  invalidatePattern: deleteCachePattern,
  invalidateOrgAnalyticsAndReports,
};
