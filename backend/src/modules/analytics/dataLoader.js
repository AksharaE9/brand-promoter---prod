// src/modules/analytics/dataLoader.js
'use strict';
const { db } = require('../../config/firebase');
const { getCache, setCache, TTL } = require('../../utils/cache');

const activePromises = new Map();
const STAGES_CACHE_TTL   = 120; // 2 minutes

async function loadAnalyticsBase(orgId, startDate, endDate) {
  const cKey = `analytics:base:${orgId}:${startDate.toISOString().slice(0,10)}:${endDate.toISOString().slice(0,10)}`;

  const cached = await getCache(cKey);
  if (cached) return cached;

  if (activePromises.has(cKey)) {
    return activePromises.get(cKey);
  }

  const promise = (async () => {
    // Fire all queries in parallel
    const [candSnap, intSnap, appSnap, userSnap] = await Promise.all([
      db.collection('candidates')
        .where('organizationId', '==', orgId)
        .where('isDeleted',      '==', false)
        .where('createdAt',      '>=', startDate.toISOString())
        .where('createdAt',      '<=', endDate.toISOString())
        .get(),
      db.collection('interviews')
        .where('organizationId', '==', orgId)
        .where('isDeleted',      '==', false)
        .get(),
      db.collection('applications')
        .where('organizationId', '==', orgId)
        .where('isDeleted',      '==', false)
        .where('createdAt',      '>=', startDate.toISOString())
        .where('createdAt',      '<=', endDate.toISOString())
        .get(),
      db.collection('users')
        .where('organizationId', '==', orgId)
        .where('isDeleted',      '==', false)
        .where('status',         '==', 'ACTIVE')
        .get(),
    ]);

    const data = {
      candidates:   candSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      interviews:   intSnap.docs.map(d  => ({ id: d.id, ...d.data() })),
      applications: appSnap.docs.map(d  => ({ id: d.id, ...d.data() })),
      users:        userSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    };

    await setCache(cKey, data, TTL.ANALYTICS);
    return data;
  })();

  activePromises.set(cKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cKey);
  }
}

async function getPipelineStages() {
  const cacheKey = "global:pipeline_stages";

  try {
    const cached = await getCache(cacheKey);
    if (cached !== null) return cached;
  } catch (_) { /* fall through */ }

  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    const stagesSnap = await db.collection("pipeline_stages").get();
    const stages = stagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    try {
      await setCache(cacheKey, stages, STAGES_CACHE_TTL);
    } catch (_) { /* non-fatal */ }

    return stages;
  })();

  activePromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cacheKey);
  }
}

module.exports = {
  loadAnalyticsBase,
  getPipelineStages,
};
