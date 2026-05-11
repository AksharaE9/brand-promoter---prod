const cache = new Map();

/**
 * Simple in-memory cache with TTL
 * @param {string} key
 * @param {Function} fetcher
 * @param {number} ttlMs
 */
async function getCached(key, fetcher, ttlMs = 60000) {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && (now - cached.timestamp < ttlMs)) {
    return cached.data;
  }

  const data = await fetcher();
  cache.set(key, { data, timestamp: now });
  return data;
}

function invalidate(key) {
  cache.delete(key);
}

// Clear all cache (call after data mutations)
function invalidateAll() {
  cache.clear();
  console.log("🗑️ All cache cleared");
}

// Invalidate by pattern (e.g., "candidates_list_*")
function invalidatePattern(prefix) {
  let cleared = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      cleared++;
    }
  }
  console.log(`🗑️ Cleared ${cleared} cache entries with prefix: ${prefix}`);
}

module.exports = { getCached, invalidate, invalidateAll, invalidatePattern };
