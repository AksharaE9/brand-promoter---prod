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
    // Fire queries in parallel with only single-field equality filters to avoid index requirements
    const [candSnap, intSnap, appSnap, userSnap] = await Promise.all([
      db.collection('candidates')
        .where('organizationId', '==', orgId)
        .get(),
      db.collection('interviews')
        .where('organizationId', '==', orgId)
        .get(),
      db.collection('applications')
        .where('organizationId', '==', orgId)
        .get(),
      db.collection('users')
        .where('organizationId', '==', orgId)
        .get(),
    ]);

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const candidates = candSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.isDeleted === false && c.createdAt && c.createdAt >= startISO && c.createdAt <= endISO);

    const interviews = intSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(i => i.isDeleted === false);

    const applications = appSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.isDeleted === false && a.createdAt && a.createdAt >= startISO && a.createdAt <= endISO);

    const users = userSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.isDeleted === false && u.status === 'ACTIVE');

    const data = { candidates, interviews, applications, users };

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
