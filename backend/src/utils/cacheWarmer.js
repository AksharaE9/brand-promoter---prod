'use strict';

/**
 * Cache Warmer — pre-populates critical cache keys on server startup.
 * Runs as a background task, non-blocking.
 */
const { db } = require('../config/firebase');
const { setCache, TTL } = require('./cache');

async function warmCaches() {
  const startTime = Date.now();
  console.log('[CacheWarmer] Starting cache warm-up...');

  const warmers = [
    warmDashboard,
    warmActiveJobs,
    warmPipelineStages,
  ];

  let succeeded = 0;
  let failed = 0;

  for (const warmer of warmers) {
    try {
      await warmer();
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`[CacheWarmer] ${warmer.name} failed:`, err.message);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[CacheWarmer] Completed in ${duration}ms — ${succeeded} succeeded, ${failed} failed`);
}

async function warmDashboard() {
  // Warm per-org dashboard data
  // Get all unique organizationIds from users collection
  const usersSnap = await db.collection('users').select('organizationId').get();
  const orgIds = [...new Set(
    usersSnap.docs
      .map(d => d.data().organizationId)
      .filter(Boolean)
  )];

  for (const orgId of orgIds.slice(0, 10)) { // Limit to 10 orgs on startup
    try {
      const [candidateCount, jobCount] = await Promise.all([
        db.collection('candidates').count().get().then(s => s.data().count).catch(() => 0),
        db.collection('jobs').where('isActive', '==', true).count().get().then(s => s.data().count).catch(() => 0),
      ]);

      await setCache(`dashboard_init_org:${orgId}`, {
        _warmed: true,
        candidateCount,
        activeJobCount: jobCount,
        warmedAt: new Date().toISOString(),
      }, TTL.DASHBOARD);
    } catch (err) {
      console.warn(`[CacheWarmer] Dashboard warm failed for org ${orgId}:`, err.message);
    }
  }
}

async function warmActiveJobs() {
  const snap = await db.collection('jobs')
    .where('isActive', '==', true)
    .limit(200)
    .get();

  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Don't cache full list — just warm individual job entries
  const { setCache: sc } = require('./cache');
  for (const job of jobs) {
    await sc(`jobs:detail:${job.id}`, job, TTL.JOBS);
  }
}

async function warmPipelineStages() {
  const snap = await db.collection('pipeline_stages').get();
  const stages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  await setCache('pipeline:stages:all', stages, 300); // 5 min TTL
}

module.exports = { warmCaches };
