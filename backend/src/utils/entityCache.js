'use strict';
const redis = require('./redisClient');
const { db: adminDb } = require('../config/firebase');
const { isRedisUnavailable } = require('./cache');

const ENTITY_TTL    = 600;  // 10 minutes per entity
const ENTITY_PREFIX = 'entity:';

async function getEntitiesCached(collection, ids) {
  if (!ids || ids.length === 0) return {};

  const uniqueIds = [...new Set(ids.filter(Boolean).map(id => id.toString()))];
  if (uniqueIds.length === 0) return {};

  const cacheKeys = uniqueIds.map(id => `${ENTITY_PREFIX}${collection}:${id}`);

  let cachedValues = {};
  let missingIds   = [];

  // Single Redis mget for all IDs
  try {
    const values = await redis.mget(...cacheKeys);
    uniqueIds.forEach((id, idx) => {
      if (values[idx] !== null) {
        try {
          cachedValues[id] = JSON.parse(values[idx]);
        } catch (parseErr) {
          missingIds.push(id); // Corrupted cache entry — re-fetch
        }
      } else {
        missingIds.push(id);
      }
    });
  } catch (err) {
    if (!isRedisUnavailable(err)) {
      console.error('[EntityCache] mget error:', err.message);
    }
    // Redis down — all IDs are misses
    missingIds = uniqueIds;
  }

  // Batch fetch missing entities from Firestore
  if (missingIds.length > 0) {
    try {
      // Firestore getAll supports up to 1000 docs in some cases, chunk to 30 for safety
      const chunks = [];
      for (let i = 0; i < missingIds.length; i += 30) {
        chunks.push(missingIds.slice(i, i + 30));
      }

      const allDocs = await Promise.all(
        chunks.map(chunk =>
          adminDb.getAll(...chunk.map(id => adminDb.collection(collection).doc(id)))
        )
      );

      // Write found docs to Redis and result map
      const savePipeline = redis.pipeline();
      let hasEntriesToSave = false;

      allDocs.flat().forEach(doc => {
        if (doc.exists) {
          const data = { id: doc.id, ...doc.data() };
          cachedValues[doc.id] = data;
          savePipeline.setex(
            `${ENTITY_PREFIX}${collection}:${doc.id}`,
            ENTITY_TTL,
            JSON.stringify(data)
          );
          hasEntriesToSave = true;
        }
      });

      if (hasEntriesToSave) {
        savePipeline.exec().catch(err => {
          if (!isRedisUnavailable(err)) {
            console.error('[EntityCache] Pipeline save error:', err.message);
          }
        });
      }
    } catch (err) {
      console.error('[EntityCache] Firestore getAll error:', err.message);
    }
  }

  return cachedValues;
}

// Invalidate a single entity's cache (call after mutations)
async function invalidateEntity(collection, id) {
  try {
    await redis.del(`${ENTITY_PREFIX}${collection}:${id}`);
  } catch (err) { /* silent */ }
}

// Invalidate multiple entities at once
async function invalidateEntities(collection, ids) {
  if (!ids || ids.length === 0) return;
  try {
    const keys = ids.map(id => `${ENTITY_PREFIX}${collection}:${id}`);
    const pl   = redis.pipeline();
    keys.forEach(k => pl.del(k));
    await pl.exec();
  } catch (err) { /* silent */ }
}

module.exports = { getEntitiesCached, invalidateEntity, invalidateEntities };
