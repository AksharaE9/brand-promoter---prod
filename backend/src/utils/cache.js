const redis = require('./redisClient');

const DEFAULT_TTL = 60; // seconds

// ── Low-level Redis cache primitives ──────────────────────────

async function getCache(key) {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null; // never let cache failure break the app
  }
}

async function setCache(key, data, ttlSeconds = DEFAULT_TTL) {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch {
    // silent fail
  }
}

async function deleteCache(key) {
  try {
    await redis.del(key);
  } catch { /* silent */ }
}

async function deleteCachePattern(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch { /* silent */ }
}

function cacheKey(parts) {
  return parts.filter(Boolean).join(':');
}

// ── Backward-compatible high-level API ────────────────────────
// Used by existing endpoints: getCached(key, fetcher, ttlMs)

/**
 * Get-or-fetch pattern with Redis cache.
 * @param {string} key   - Cache key
 * @param {Function} fetcher - Async function to compute value on miss
 * @param {number} ttlMs - TTL in milliseconds (converted to seconds for Redis)
 */
async function getCached(key, fetcher, ttlMs = 60000) {
  // Try Redis first
  const cached = await getCache(key);
  if (cached !== null) {
    return cached;
  }

  // Cache miss — compute
  const data = await fetcher();

  // Store in Redis (convert ms → s, minimum 1s)
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
  await setCache(key, data, ttlSec);

  return data;
}

async function invalidate(key) {
  await deleteCache(key);
}

async function invalidateAll() {
  try {
    // Only clear keys with known ATS prefixes, not all Redis keys
    const prefixes = [
      'dashboard:*', 'analytics:*', 'candidates:*', 'interviews:*',
      'team:*', 'jobs:*', 'users_list_*', 'recruiter_summary_*',
      'candidates_list_*', 'interviews_list_*', 'dashboard_init_*',
      'analytics_*'
    ];
    for (const prefix of prefixes) {
      await deleteCachePattern(prefix);
    }
  } catch {
    // silent
  }
}

async function invalidatePattern(prefix) {
  await deleteCachePattern(`${prefix}*`);
}

module.exports = {
  // New explicit API
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  cacheKey,
  // Backward-compatible API
  getCached,
  invalidate,
  invalidateAll,
  invalidatePattern,
};
