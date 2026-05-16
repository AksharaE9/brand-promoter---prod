const memoryCache = new Map();

/**
 * In-memory cache with TTL
 * @param {string} key
 * @param {Function} fetcher
 * @param {number} ttlMs
 */
async function getCached(key, fetcher, ttlMs = 60000) {
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const data = await fetcher();
  
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttlMs
  });
  
  return data;
}

async function invalidate(key) {
  memoryCache.delete(key);
}

// Clear all cache (call after data mutations)
async function invalidateAll() {
  memoryCache.clear();
  console.log("🗑️ All in-memory cache cleared");
}

// Invalidate by pattern (e.g., "candidates_list_*")
async function invalidatePattern(prefix) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

module.exports = { getCached, invalidate, invalidateAll, invalidatePattern };
