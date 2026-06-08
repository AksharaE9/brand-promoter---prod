'use strict';
const { tieredGet, tieredSet } = require('./tieredCache');

// Returns stale data immediately if available, 
// triggers background refresh regardless
async function swrGet(key, fetchFn, ttlS = 30, l1TtlMs = 15_000) {
  const { data, tier } = await tieredGet(key, l1TtlMs);

  if (data !== null) {
    // Return stale data immediately
    // Trigger background refresh
    setImmediate(async () => {
      try {
        const fresh = await fetchFn();
        if (fresh !== null) await tieredSet(key, fresh, ttlS, l1TtlMs);
      } catch (err) {
        console.error('[swrCache] background refresh error:', key, err.message);
      }
    });
    return { data, stale: true, tier };
  }

  // Cache miss — must fetch synchronously
  const fresh = await fetchFn();
  if (fresh !== null) await tieredSet(key, fresh, ttlS, l1TtlMs);
  return { data: fresh, stale: false, tier: 'miss' };
}

module.exports = { swrGet };
