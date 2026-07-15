// src/modules/analytics/dataLoader.js
'use strict';
const prisma = require('../../config/db');
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
    // Fire queries in parallel to fetch from CockroachDB with selected lightweight fields
    const [candidates, interviews, applications, users] = await Promise.all([
      prisma.candidate.findMany({
        where: {
          organizationId: orgId,
          isDeleted: false,
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          assignedRecruiterId: true,
          mentorId: true,
          source: true,
          organizationId: true,
          isDeleted: true
        }
      }),
      prisma.interview.findMany({
        where: {
          organizationId: orgId
        },
        select: {
          id: true,
          candidateId: true,
          interviewerIds: true,
          createdById: true,
          scheduledStart: true,
          mode: true,
          status: true,
          organizationId: true,
          createdAt: true,
          result: true
        }
      }),
      prisma.application.findMany({
        where: {
          organizationId: orgId,
          isDeleted: false,
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          id: true,
          candidateId: true,
          jobId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          currentStageId: true,
          organizationId: true,
          isDeleted: true
        }
      }),
      prisma.user.findMany({
        where: {
          organizationId: orgId,
          isDeleted: false,
          status: 'ACTIVE'
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          organizationId: true,
          isDeleted: true,
          userType: true
        }
      }),
    ]);

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
    const stages = await prisma.pipelineStage.findMany();

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

async function getOrgAnalyticsData(orgId) {
  const start = new Date(0);
  const end = new Date("2100-01-01T00:00:00.000Z");
  const data = await loadAnalyticsBase(orgId, start, end);
  return {
    candidates: data.candidates,
    interviews: data.interviews,
    applications: data.applications,
    apps: data.applications, // alias for reports/routes destructuring compatibility
    users: data.users
  };
}

module.exports = {
  loadAnalyticsBase,
  getPipelineStages,
  getOrgAnalyticsData,
};
