'use strict';
const l1 = require('./l1Cache');

const DEFAULT_TTL = 60;

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
    const val = l1.get(key);
    if (val === null) {
      metrics.misses++;
      return null;
    }
    metrics.hits++;
    return val;
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
    l1.set(key, data, ttlSeconds * 1000);
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] setCache error:', key, err.message);
  }
}

async function deleteCache(key) {
  try {
    metrics.dels++;
    l1.delete(key);
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] deleteCache error:', key, err.message);
  }
}

async function deleteCachePattern(pattern) {
  try {
    l1.deletePattern(pattern);
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

async function setCacheMany(entries, ttlSeconds = DEFAULT_TTL) {
  try {
    entries.forEach(({ key, data }) => {
      metrics.sets++;
      l1.set(key, data, ttlSeconds * 1000);
    });
  } catch (err) {
    metrics.errors++;
    console.error('[Cache] setCacheMany error:', err.message);
  }
}

async function pingCache() {
  return true;
}

function getCacheMetrics() {
  const total = metrics.hits + metrics.misses;
  const hitRate = total > 0 ? ((metrics.hits / total) * 100).toFixed(1) : '0.0';
  return { ...metrics, total, hitRate: `${hitRate}%` };
}

// ── TTL constants ──
const TTL = {
  CANDIDATES:       30,
  APPLICATIONS:     30,
  SCHEDULING_LIST:  30,
  NOTIFICATIONS:    15,
  DASHBOARD:        45,
  AUDIT:            20,
  ANALYTICS:       120,
  JOBS:            120,
  TEAM:            180,
  DRIVES:          120,
  ORG_SETTINGS:   600,
  PANEL_MEMBERS:  300,
  JOB_ROLES:      600,
  ROUND:         7200,
  ROUND_DETAIL:  7200,
  DIRTY:         3600,
};

const inFlightPromises = new Map();

async function getCached(key, fetcher, ttlMs = 60000) {
  const cached = l1.get(key);
  if (cached !== null) {
    return cached;
  }

  if (inFlightPromises.has(key)) {
    return inFlightPromises.get(key);
  }

  const promise = (async () => {
    try {
      const fresh = await fetcher();
      if (fresh !== null && fresh !== undefined) {
        l1.set(key, fresh, ttlMs);
      }
      return fresh;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return promise;
}

async function getCachedWithMutex(key, fetcher, ttlMs = 60000) {
  return getCached(key, fetcher, ttlMs);
}

async function invalidateAll() {
  try {
    l1.store.clear();
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
      l1.delete(key);
    }
  } catch (e) { /* silent */ }
}

module.exports = {
  getCache, setCache, deleteCache, deleteCachePattern,
  deleteManyPatterns, cacheKey, setCacheMany, pingCache, TTL,
  getCacheMetrics,
  getCached,
  getCachedWithMutex,
  invalidate: deleteCache,
  invalidateAll,
  invalidatePattern: deleteCachePattern,
  invalidateOrgAnalyticsAndReports,
};
