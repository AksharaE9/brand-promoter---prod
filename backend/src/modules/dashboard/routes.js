const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler } = require("../../utils/errors");
const { getCached, invalidate } = require("../../utils/cache");

const router = express.Router();
router.use(auth);


/**
 * Optimally fetches all dashboard counts, status funnels, recent applications, and interviews in parallel.
 */
async function fetchDashboardData(orgId) {
  // Compute today's UTC midnight boundaries for interview count
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const startOfToday = new Date(`${todayStr}T00:00:00.000Z`);
  const endOfToday   = new Date(`${todayStr}T23:59:59.999Z`);

  // Run unified metrics query and list lookups in parallel
  const [
    coreMetricsRaw,
    statusGroups,
    stageCountsRaw,
    stages,
    recentApplications,
    upcomingInterviews,
  ] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM candidates WHERE "organizationId" = $1 AND "isDeleted" = false) as candidate_count,
        (SELECT COUNT(*)::int FROM jobs WHERE "organizationId" = $1 AND "isActive" = true) as job_count,
        (SELECT COUNT(*)::int FROM users WHERE "organizationId" = $1 AND "isDeleted" = false AND status = 'ACTIVE') as user_count,
        (SELECT COUNT(*)::int FROM applications WHERE "organizationId" = $1 AND "isDeleted" = false) as total_apps,
        (SELECT COUNT(*)::int FROM interviews WHERE "organizationId" = $1 AND "scheduledStart" >= $2 AND "scheduledStart" <= $3 AND status != 'CANCELLED') as today_interviews
    `, orgId, startOfToday, endOfToday),
    prisma.application.groupBy({
      by: ["status"],
      where: { organizationId: orgId, isDeleted: false },
      _count: { _all: true },
    }),
    prisma.application.groupBy({
      by: ["currentStageId"],
      where: { organizationId: orgId, isDeleted: false, status: "IN_PIPELINE" },
      _count: { _all: true },
    }),
    prisma.pipelineStage.findMany(),
    prisma.application.findMany({
      where: { organizationId: orgId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      take: 6, // Bounded for Live Feed rendering
      select: {
        id: true,
        status: true,
        createdAt: true,
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true } },
      },
    }),
    prisma.interview.findMany({
      where: { organizationId: orgId, scheduledStart: { gte: now } },
      orderBy: { scheduledStart: "asc" },
      take: 10, // Bounded for upcoming interviews feed
      select: {
        id: true,
        candidateId: true,
        candidateName: true,
        jobId: true,
        jobTitle: true,
        roundNo: true,
        round: true,
        scheduledStart: true,
        mode: true,
        status: true,
        result: true,
        interviewerNames: true,
        interviewerIds: true,
      }
    }),
  ]);

  const metrics = coreMetricsRaw?.[0] || {};
  const candidateCount = metrics.candidate_count || 0;
  const jobCount = metrics.job_count || 0;
  const userCount = metrics.user_count || 0;
  const totalApps = metrics.total_apps || 0;
  const interviewsTodayCount = metrics.today_interviews || 0;

  const statusCounts = {};
  statusGroups.forEach(g => {
    statusCounts[g.status] = g._count._all;
  });

  const joinedCount = statusCounts["JOINED"] || 0;
  const rejectedCount = statusCounts["REJECTED"] || 0;
  const offerSentCount = statusCounts["OFFER_SENT"] || 0;
  const pendingStatusCount = statusCounts["PENDING"] || 0;

  const stageCountsMap = {};
  stageCountsRaw.forEach((item) => {
    if (item.currentStageId) {
      stageCountsMap[item.currentStageId] = item._count._all;
    }
  });

  const stageCounts = stages.map((s) => {
    const count = stageCountsMap[s.id] || 0;
    return { id: s.id, name: (s.name || "").toLowerCase(), count };
  });

  // Categorize application stages into funnel categories
  let pendingCount = pendingStatusCount;
  let screeningCount = 0;
  let interviewCount = 0;
  let offerCount = offerSentCount;

  stageCounts.forEach((sc) => {
    if (sc.name.includes("screen") || sc.name.includes("screening")) {
      screeningCount += sc.count;
    } else if (sc.name.includes("interview") || sc.name.includes("technical") || sc.name.includes("hr")) {
      interviewCount += sc.count;
    } else if (sc.name.includes("offer")) {
      offerCount += sc.count;
    } else {
      pendingCount += sc.count;
    }
  });

  const sumCounted = joinedCount + rejectedCount + offerCount + screeningCount + interviewCount + pendingCount;
  if (totalApps > sumCounted) pendingCount += (totalApps - sumCounted);

  return {
    stats: {
      candidates: candidateCount,
      activeJobs: jobCount,
      activeUsers: userCount,
      totalApplications: totalApps,
      funnel: {
        PENDING: pendingCount,
        SCREENING: screeningCount,
        INTERVIEWING: interviewCount,
        OFFER_SENT: offerCount,
        JOINED: joinedCount,
        REJECTED: rejectedCount,
      },
    },
    recentApplications,
    upcomingInterviews,
    interviewsTodayCount,  // real COUNT(*) — replaces the capped filter on frontend
  };
}

/**
 * Common dashboard route handler returning consolidated payload from bounded LRU cache.
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
  const skipCache = req.query._t || req.query.fresh ? true : false;
  const orgId = req.user.organizationId || "defaultOrg";
  const cacheKey = `dashboard:summary:${orgId}`;

  if (skipCache) {
    await invalidate(cacheKey);
  }

  const data = await getCached(cacheKey, () => fetchDashboardData(orgId), 300000); // 5 min TTL
  res.json({ success: true, data });
});

/**
 * GET /dashboard/summary
 * Consolidated single dashboard summary API.
 */
router.get("/summary", requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"), getDashboardSummary);

/**
 * GET /dashboard/init
 * For backward-compatibility with existing frontend references.
 */
router.get("/init", requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"), getDashboardSummary);

/**
 * GET /dashboard/recruiter-summary
 */
router.get(
  "/recruiter-summary",
  requireRoles("RECRUITER", "SUPER_ADMIN", "USER"),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const cacheKey = `dashboard:recruiter-summary:${userId}`;
    const skipCache = req.query._t || req.query.fresh ? true : false;

    if (skipCache) {
      await invalidate(cacheKey);
    }

    const data = await getCached(cacheKey, async () => {
      const candidates = await prisma.candidate.findMany({
        where: { mentorId: userId, isDeleted: false },
        select: { id: true, status: true },
      });

      const stats = { active: 0, pendingOffer: 0, joined: 0 };
      candidates.forEach((c) => {
        if (["INTERVIEWING", "SCREENING"].includes(c.status)) stats.active++;
        if (c.status === "OFFER_SENT") stats.pendingOffer++;
        if (c.status === "JOINED") stats.joined++;
      });

      return { stats, candidateCount: candidates.length };
    }, 15000); // 15s TTL

    res.json({ success: true, data });
  })
);

module.exports = router;
module.exports.fetchDashboardData = fetchDashboardData;
