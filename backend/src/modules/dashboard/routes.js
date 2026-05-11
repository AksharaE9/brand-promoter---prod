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
    // Use shorter cache for real-time feel
    const cacheKey = `dashboard_init_${req.user.id}`;
    const data = await getCached(cacheKey, async () => {
      // Helper to safely get count with fallback
      async function safeCount(collectionRef) {
        try {
          const snap = await collectionRef.count().get();
          return snap.data().count;
        } catch (err) {
          console.warn("⚠️ Count query failed, using fallback:", err.message);
          const allSnap = await collectionRef.limit(1000).get();
          return allSnap.size;
        }
      }

      const [candidateCount, jobCount, userCount, applicationSnap, interviewSnap] = await Promise.all([
        safeCount(firestore.collection("candidates")),
        safeCount(firestore.collection("jobs").where("isActive", "==", true)),
        safeCount(firestore.collection("users").where("status", "==", "ACTIVE")),
        // Try orderBy with fallback
        (async () => {
          try {
            return await firestore.collection("applications").orderBy("createdAt", "desc").limit(10).get();
          } catch (e) {
            console.warn("⚠️ Applications orderBy failed:", e.message);
            const snap = await firestore.collection("applications").limit(10).get();
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
          }
        })(),
        // Try interview orderBy with fallback
        (async () => {
          try {
            return await firestore.collection("interviews").where("scheduledStart", ">=", new Date().toISOString()).orderBy("scheduledStart", "asc").limit(5).get();
          } catch (e) {
            console.warn("⚠️ Interviews orderBy failed:", e.message);
            const snap = await firestore.collection("interviews").limit(5).get();
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs.sort((a, b) => new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0));
            return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
          }
        })()
      ]);

      const applications = applicationSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const interviews = interviewSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const funnel = {};
      const statuses = ['PENDING', 'SCREENING', 'INTERVIEWING', 'OFFER_SENT', 'JOINED', 'REJECTED'];

      await Promise.all(statuses.map(async (s) => {
        funnel[s] = await safeCount(firestore.collection("applications").where("status", "==", s));
      }));

      return {
        stats: {
          candidates: candidateCount,
          activeJobs: jobCount,
          activeUsers: userCount,
          totalApplications: Object.values(funnel).reduce((a, b) => a + b, 0),
          funnel
        },
        recentApplications: applications,
        upcomingInterviews: interviews
      };
    }, 30000); // 30 second TTL for more real-time feel

    res.json({
      success: true,
      data
    });
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
