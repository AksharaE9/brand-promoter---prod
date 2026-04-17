const express = require("express");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler } = require("../../utils/errors");

const router = express.Router();

router.use(auth);

router.get(
  "/init",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    // Single parallel block for high-level counts
    const [candidateCount, jobCount, applications, interviews, userCount] = await Promise.all([
      prisma.candidate.count(),
      prisma.job.count({ where: { isActive: true } }),
      prisma.application.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          candidate: { select: { fullName: true, profilePhotoFile: { select: { storageKey: true } } } },
          job: { select: { title: true } },
          currentStage: { select: { name: true } }
        }
      }),
      prisma.interview.findMany({
        where: { scheduledStart: { gte: new Date() } },
        take: 10,
        orderBy: { scheduledStart: "asc" },
        include: {
          application: {
            select: { candidate: { select: { fullName: true } } }
          }
        }
      }),
      prisma.user.count({ where: { status: "ACTIVE" } })
    ]);

    // Calculate funnel stats efficiently
    const funnel = await prisma.application.groupBy({
      by: ["status"],
      _count: { _all: true }
    });

    res.json({
      success: true,
      data: {
        stats: {
          candidates: candidateCount,
          activeJobs: jobCount,
          activeUsers: userCount,
          totalApplications: applications.length, // Rough count from recent
          funnel: funnel.reduce((acc, curr) => ({ ...acc, [curr.status]: curr._count._all }), {})
        },
        recentApplications: applications,
        upcomingInterviews: interviews
      }
    });
  })
);

module.exports = router;
