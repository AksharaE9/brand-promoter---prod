const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler } = require("../../utils/errors");
const { getCached, invalidate } = require("../../utils/cache");

const router = express.Router();
router.use(auth);

/**
 * Safe count — tries Firestore count() aggregation, falls back to fetching docs
 */
async function safeCount(query) {
  try {
    const snap = await query.count().get();
    return snap.data().count || 0;
  } catch (_) {
    const snap = await query.limit(2000).get();
    return snap.size;
  }
}

/**
 * GET /dashboard/init
 * Shared org-level 60s cache. Cache is invalidated on any mutation via invalidateDashboard().
 */
router.get(
  "/init",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    // Use bypass flag from frontend SSE refresh to skip cache
    const skipCache = req.query._t ? true : false;
    const cacheKey = "dashboard_init_org";

    if (skipCache) await invalidate(cacheKey);

    const data = await getCached(cacheKey, async () => {
      // Run all independent queries in parallel
      const [candidateCount, jobCount, userCount] = await Promise.all([
        safeCount(firestore.collection("candidates")),
        safeCount(firestore.collection("jobs").where("isActive", "==", true)),
        safeCount(firestore.collection("users")),
      ]);

      // Recent applications with fallback ordering
      let applicationDocs = [];
      try {
        const snap = await firestore.collection("applications")
          .orderBy("createdAt", "desc")
          .limit(10)
          .get();
        applicationDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (_) {
        const snap = await firestore.collection("applications").limit(10).get();
        applicationDocs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      }

      // Upcoming interviews with fallback
      let interviewDocs = [];
      try {
        const snap = await firestore.collection("interviews")
          .where("scheduledStart", ">=", new Date().toISOString())
          .orderBy("scheduledStart", "asc")
          .limit(10)
          .get();
        interviewDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (_) {
        const snap = await firestore.collection("interviews").limit(10).get();
        interviewDocs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0));
      }

      // Populate candidate + job data for recent applications (batch fetch)
      let applications = applicationDocs;
      if (applications.length > 0) {
        const candIds = [...new Set(applications.map(a => a.candidateId).filter(Boolean))];
        const jobIds  = [...new Set(applications.map(a => a.jobId).filter(Boolean))];

        const [candSnaps, jobSnaps] = await Promise.all([
          Promise.all(candIds.map(id => firestore.collection("candidates").doc(id).get())),
          Promise.all(jobIds.map(id => firestore.collection("jobs").doc(id).get())),
        ]);

        const candMap = {};
        candSnaps.forEach(s => { if (s.exists) candMap[s.id] = { id: s.id, ...s.data() }; });
        const jobMap = {};
        jobSnaps.forEach(s => { if (s.exists) jobMap[s.id] = { id: s.id, ...s.data() }; });

        applications = applications.map(app => ({
          ...app,
          candidate: candMap[app.candidateId] || null,
          job: jobMap[app.jobId] || null,
        }));
        // Don't filter out apps with missing candidates — keep them for the feed
      }

      // Funnel counts in parallel
      const statuses = ["PENDING", "SCREENING", "INTERVIEWING", "OFFER_SENT", "JOINED", "REJECTED"];
      const funnelCounts = await Promise.all(
        statuses.map(s => safeCount(firestore.collection("applications").where("status", "==", s)))
      );
      const funnel = Object.fromEntries(statuses.map((s, i) => [s, funnelCounts[i]]));

      return {
        stats: {
          candidates: candidateCount,
          activeJobs: jobCount,
          activeUsers: userCount,
          totalApplications: Object.values(funnel).reduce((a, b) => a + b, 0),
          funnel,
        },
        recentApplications: applications,
        upcomingInterviews: interviewDocs,
      };
    }, 60000); // 60s cache

    res.json({ success: true, data });
  })
);

/**
 * GET /dashboard/recruiter-summary
 */
router.get(
  "/recruiter-summary",
  requireRoles("RECRUITER", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const cacheKey = `recruiter_summary_${userId}`;

    const data = await getCached(cacheKey, async () => {
      const candSnap = await firestore.collection("candidates")
        .where("mentorId", "==", userId)
        .get();
      const candidates = candSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const stats = { active: 0, pendingOffer: 0, joined: 0 };
      candidates.forEach(c => {
        if (["INTERVIEWING", "SCREENING"].includes(c.status)) stats.active++;
        if (c.status === "OFFER_SENT") stats.pendingOffer++;
        if (c.status === "JOINED") stats.joined++;
      });

      return { stats, candidateCount: candidates.length };
    }, 30000);

    res.json({ success: true, data });
  })
);

module.exports = router;
