const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler } = require("../../utils/errors");
const { getCached, invalidate } = require("../../utils/cache");
const { swrGet } = require("../../utils/swrCache");
const { tieredDelete } = require("../../utils/tieredCache");

const router = express.Router();
router.use(auth);

/**
 * GET /dashboard/init
 * Shared org-level cache. Invalidated on mutations via invalidateDashboard().
 */
async function fetchDashboardData(orgId) {
  // Fetch pipeline stages
  const stages = await prisma.pipelineStage.findMany();

  // Run all counts in parallel
  const [
    candidateCount,
    jobCount,
    userCount,
    totalApps,
    joinedCount,
    rejectedCount,
    offerSentCount,
    pendingStatusCount,
    recentApplications,
    upcomingInterviews,
  ] = await Promise.all([
    prisma.candidate.count({ where: { organizationId: orgId, isDeleted: false } }),
    prisma.job.count({ where: { organizationId: orgId, isActive: true } }),
    prisma.user.count({ where: { organizationId: orgId, isDeleted: false, status: "ACTIVE" } }),
    prisma.application.count({ where: { organizationId: orgId, isDeleted: false } }),
    prisma.application.count({ where: { organizationId: orgId, isDeleted: false, status: "JOINED" } }),
    prisma.application.count({ where: { organizationId: orgId, isDeleted: false, status: "REJECTED" } }),
    prisma.application.count({ where: { organizationId: orgId, isDeleted: false, status: "OFFER_SENT" } }),
    prisma.application.count({ where: { organizationId: orgId, isDeleted: false, status: "PENDING" } }),
    prisma.application.findMany({
      where: { organizationId: orgId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true } },
      },
    }),
    prisma.interview.findMany({
      where: { organizationId: orgId, scheduledStart: { gte: new Date() } },
      orderBy: { scheduledStart: "asc" },
      take: 10,
    }),
  ]);

  // Stage counts (Optimized: group by currentStageId in a single query to prevent N+1 queries)
  const stageCountsRaw = await prisma.application.groupBy({
    by: ["currentStageId"],
    where: {
      organizationId: orgId,
      isDeleted: false,
      status: "IN_PIPELINE",
    },
    _count: {
      _all: true,
    },
  });

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

  // Build funnel
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
  };
}

/**
 * GET /dashboard/init
 * Shared org-level cache. Invalidated on mutations via invalidateDashboard().
 */
router.get(
  "/init",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER", "USER"),
  asyncHandler(async (req, res) => {
    const skipCache = req.query._t ? true : false;
    const orgId = req.user.organizationId || "default";
    const cacheKey = `dashboard_init_org:${orgId}`;

    if (skipCache) await tieredDelete(cacheKey);

    const result = await swrGet(cacheKey, () => fetchDashboardData(orgId), 180, 90_000);

    res.json({ success: true, data: result.data });
  })
);

/**
 * GET /dashboard/recruiter-summary
 */
router.get(
  "/recruiter-summary",
  requireRoles("RECRUITER", "SUPER_ADMIN", "USER"),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const cacheKey = `recruiter_summary_${userId}`;

    const result = await swrGet(cacheKey, async () => {
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
    }, 30, 10000);

    res.json({ success: true, data: result.data });
  })
);

module.exports = router;
module.exports.fetchDashboardData = fetchDashboardData;
