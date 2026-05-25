const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler } = require("../../utils/errors");

const { getCached } = require("../../utils/cache");

const router = express.Router();

router.use(auth);

router.get(
  "/init",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    // Shared org-level cache key — all users share same cached dashboard data
    const cacheKey = `dashboard_init_org`;
    const data = await getCached(cacheKey, async () => {
      async function safeCount(collectionRef) {
        try {
          const snap = await collectionRef.count().get();
          return snap.data().count;
        } catch (err) {
          const allSnap = await collectionRef.limit(1000).get();
          return allSnap.size;
        }
      }

      const [candidateCount, jobCount, userCount, applicationSnap, interviewSnap] = await Promise.all([
        safeCount(firestore.collection("candidates")),
        safeCount(firestore.collection("jobs").where("isActive", "==", true)),
        safeCount(firestore.collection("users").where("status", "==", "ACTIVE")),
        (async () => {
          try {
            return await firestore.collection("applications").orderBy("createdAt", "desc").limit(10).get();
          } catch (e) {
            const snap = await firestore.collection("applications").limit(10).get();
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
          }
        })(),
        (async () => {
          try {
            return await firestore.collection("interviews").where("scheduledStart", ">=", new Date().toISOString()).orderBy("scheduledStart", "asc").limit(5).get();
          } catch (e) {
            const snap = await firestore.collection("interviews").limit(5).get();
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs.sort((a, b) => new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0));
            return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
          }
        })()
      ]);

      let applications = applicationSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Batch fetch candidates + jobs in 2 round-trips (not N individual fetches)
      if (applications.length > 0) {
        const candidateIds = [...new Set(applications.map(a => a.candidateId).filter(Boolean))];
        const jobIds = [...new Set(applications.map(a => a.jobId).filter(Boolean))];

        const [candSnaps, jobSnaps] = await Promise.all([
          candidateIds.length > 0
            ? firestore.getAll(...candidateIds.map(id => firestore.collection("candidates").doc(id)))
            : Promise.resolve([]),
          jobIds.length > 0
            ? firestore.getAll(...jobIds.map(id => firestore.collection("jobs").doc(id)))
            : Promise.resolve([]),
        ]);

        const candMap = {};
        candSnaps.forEach(doc => { if (doc.exists) candMap[doc.id] = { id: doc.id, ...doc.data() }; });
        const jobMap = {};
        jobSnaps.forEach(doc => { if (doc.exists) jobMap[doc.id] = { id: doc.id, ...doc.data() }; });

        applications = applications
          .map(app => ({ ...app, candidate: candMap[app.candidateId] || null, job: jobMap[app.jobId] || null }))
          .filter(app => app.candidate !== null);
      }

      const interviews = interviewSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Funnel counts in parallel
      const statuses = ['PENDING', 'SCREENING', 'INTERVIEWING', 'OFFER_SENT', 'JOINED', 'REJECTED'];
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
        upcomingInterviews: interviews,
      };
    }, 60000); // 60s shared cache

    res.json({ success: true, data });
  })
);

router.get(
  "/recruiter-summary",
  requireRoles("RECRUITER"),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    // We need to count applications of candidates assigned to this recruiter
    // In Firestore, this requires a composite query.
    // stats: active (INTERVIEWING/SCREENING), pendingOffer (OFFER_SENT), joined (JOINED)
    
    const [activeSnap, offerSnap, joinedSnap] = await Promise.all([
      firestore.collection("candidates").where("mentorId", "==", userId).get(), // We'll have to filter in-memory for now or use complex indexes
      // Actually, let's just get the candidates and map
    ]);

    const candidates = activeSnap.docs.map(d => d.data());
    const stats = {
      active: 0,
      pendingOffer: 0,
      joined: 0
    };

    // This is still slightly heavy but better than fetching ALL and filtering
    candidates.forEach(c => {
      // Logic from RecruiterDashboard
      // (This would be even better if applications were subcollections or if we had a summary doc)
    });
    
    res.json({ success: true, data: stats }); // Placeholder, I'll refine this in a bit
  })
);

module.exports = router;
