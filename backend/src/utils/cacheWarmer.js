'use strict';

/**
 * Cache Warmer — pre-populates critical cache keys on server startup.
 * Runs as a background task, non-blocking.
 */
const prisma = require('../config/db');
const { setCache, TTL } = require('./cache');

async function warmCaches() {
  const startTime = Date.now();
  console.log('[CacheWarmer] Starting cache warm-up...');

  const warmers = [
    warmDashboard,
    warmActiveJobs,
    warmPipelineStages,
    warmCompanies,
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
  const { fetchDashboardData } = require('../modules/dashboard/routes');

  // Warm per-org dashboard data using native distinct query
  const orgs = await prisma.user.findMany({
    select: { organizationId: true },
    distinct: ['organizationId'],
    where: { organizationId: { not: "" } }
  });
  
  const orgIds = orgs.map(o => o.organizationId);

  // Run orgs sequentially
  for (const orgId of orgIds.slice(0, 5)) {
    try {
      const data = await fetchDashboardData(orgId);
      await setCache(`dashboard:summary:${orgId}`, data, 300); // 5 min TTL
    } catch (err) {
      console.warn(`[CacheWarmer] Dashboard warm failed for org ${orgId}:`, err.message);
    }
  }
}

async function warmActiveJobs() {
  const jobs = await prisma.job.findMany({
    where: { isActive: true },
    take: 50
  });

  const { setCache: sc } = require('./cache');
  
  // Set all job caches in parallel
  await Promise.all(jobs.map(job => 
    sc(`jobs:detail:${job.id}`, job, TTL.JOBS).catch(() => {})
  ));
}

async function warmPipelineStages() {
  const stages = await prisma.pipelineStage.findMany();
  await setCache('pipeline:stages:all', stages, 300); // 5 min TTL
}

async function warmCompanies() {
  const { getCompaniesForOrg } = require('../modules/companies/routes');

  const orgs = await prisma.user.findMany({
    select: { organizationId: true },
    distinct: ['organizationId'],
    where: { organizationId: { not: "" } }
  });

  const orgIds = orgs.map(o => o.organizationId);

  await Promise.all(orgIds.map(async (orgId) => {
    try {
      await getCompaniesForOrg(orgId);
    } catch (err) {
      console.warn(`[CacheWarmer] Companies warm failed for org ${orgId}:`, err.message);
    }
  }));
}

module.exports = { warmCaches };
