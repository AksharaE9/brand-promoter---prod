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

module.exports = { getCached, invalidate };
