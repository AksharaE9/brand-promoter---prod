'use strict';
const l1 = require('./l1Cache');
const redis = require('./redisClient');

const L1_TTL_MS = {
  DASHBOARD:    15_000,   // 15 seconds in-process
  JOBS:         60_000,   // 60 seconds
  TEAM:         60_000,
  ORG_SETTINGS: 300_000,  // 5 minutes
  PANEL:        120_000,  // 2 minutes
};

async function tieredGet(key, l1TtlMs = 15_000) {
  // L1 — synchronous, zero I/O
  const l1hit = l1.get(key);
  if (l1hit !== null) return { data: l1hit, tier: 'l1' };

  // L2 — Redis, ~1-3ms
  try {
    // Note: getCache from cache.js will compress/decompress if enabled.
    // To stay clean and keep code modular, we can import getCache and setCache from './cache' 
    // or run directly on redis. Since we want compression support, let's require it dynamically
    // or perform direct decompression here. Let's require cache.js dynamically to avoid circular dependencies,
    // or implement the compression check if cache.js is modified.
    // Let's import getCache/setCache from './cache' dynamically inside the function, or just use the redisClient.
    // Wait, let's check if there are circular dependencies. cache.js does not require tieredCache.js,
    // so importing `./cache` is completely safe!
    const cache = require('./cache');
    const val = await cache.getCache(key);
    if (val !== null) {
      l1.set(key, val, l1TtlMs); // populate L1 for next request
      return { data: val, tier: 'l2' };
    }
  } catch (err) {
    console.error('[TieredCache] get error:', err.message);
  }

  return { data: null, tier: 'miss' };
}

async function tieredSet(key, data, redisTtlS = 60, l1TtlMs = 15_000) {
  if (data === null || data === undefined) return;
  const cache = require('./cache');
  
  // Write to both tiers simultaneously
  await Promise.all([
    cache.setCache(key, data, redisTtlS).catch(() => {}),
  ]);
  l1.set(key, data, l1TtlMs);
}

async function tieredDelete(key) {
  l1.delete(key);
  const cache = require('./cache');
  await cache.deleteCache(key).catch(() => {});
}

async function tieredDeletePattern(prefix) {
  l1.deletePattern(prefix);
  const cache = require('./cache');
  await cache.deleteCachePattern(prefix + '*').catch(() => {});
}

module.exports = { tieredGet, tieredSet, tieredDelete, tieredDeletePattern, L1_TTL_MS };
