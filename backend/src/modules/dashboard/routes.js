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
    const data = await getCached("dashboard_init", async () => {
      const [candidateCount, jobCount, userCount, applicationSnap, interviewSnap] = await Promise.all([
        firestore.collection("candidates").count().get(),
        firestore.collection("jobs").where("isActive", "==", true).count().get(),
        firestore.collection("users").where("status", "==", "ACTIVE").count().get(),
        firestore.collection("applications").orderBy("createdAt", "desc").limit(10).get(),
        firestore.collection("interviews").where("scheduledStart", ">=", new Date().toISOString()).orderBy("scheduledStart", "asc").limit(5).get()
      ]);

      const applications = applicationSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const interviews = interviewSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const funnel = {};
      const statuses = ['PENDING', 'SCREENING', 'INTERVIEWING', 'OFFER_SENT', 'JOINED', 'REJECTED'];
      
      await Promise.all(statuses.map(async (s) => {
        const snap = await firestore.collection("applications").where("status", "==", s).count().get();
        funnel[s] = snap.data().count;
      }));

      return {
        stats: {
          candidates: candidateCount.data().count,
          activeJobs: jobCount.data().count,
          activeUsers: userCount.data().count,
          totalApplications: Object.values(funnel).reduce((a, b) => a + b, 0),
          funnel
        },
        recentApplications: applications,
        upcomingInterviews: interviews
      };
    }, 60000); // 1 minute TTL

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
