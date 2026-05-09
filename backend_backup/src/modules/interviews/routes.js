const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const { sendNotification } = require("../../utils/notifications");

const router = express.Router();

router.use(auth);

router.get(
  "/export-day",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) throw new ApiError(400, "Date is required (YYYY-MM-DD)");

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    console.log(`[PDF EXPORT] Request for ${date}. Range: ${start.toISOString()} to ${end.toISOString()}`);

    try {
      const interviews = await prisma.interview.findMany({
        where: {
          scheduledStart: { gte: start, lte: end },
        },
        include: {
          application: {
            include: {
              candidate: { select: { fullName: true, email: true, phone: true } },
              job: { select: { title: true } },
            },
          },
          interviewers: { select: { fullName: true } },
        },
        orderBy: { scheduledStart: "asc" },
      });

      console.log(`[PDF EXPORT] Found ${interviews.length} interviews for ${date}`);

      res.setHeader("Content-Disposition", `attachment; filename="interviews-${date}.pdf"`);
      res.setHeader("Content-Type", "application/pdf");

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(22).fillColor("#071f52").text("Daily Interview Schedule", { align: "center" });
      doc.fontSize(12).fillColor("#6b7895").text(`Date: ${date}`, { align: "center" });
      doc.moveDown(2.5);

      if (interviews.length === 0) {
        doc.fontSize(14).fillColor("#0f1b3d").text("No interviews scheduled for this day.", { align: "center" });
      } else {
        interviews.forEach((item) => {
          const timeStr = new Date(item.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          doc.fontSize(13).fillColor("#071f52").text(`${timeStr} - ${item.application?.candidate?.fullName || "N/A"}`, { underline: true });
          doc.fontSize(10).fillColor("#333").text(`Round: ${item.roundNo} | Role: ${item.application?.job?.title || "General"}`);
          const interviewerNames = item.interviewers?.map((u) => u.fullName).join(", ") || "N/A";
          doc.text(`Interviewers: ${interviewerNames} | Mode: ${item.mode}`);
          doc.fillColor("#666").text(`Contact: ${item.application?.candidate?.email || item.application?.candidate?.phone || "N/A"}`);
          doc.moveDown(1.5);
        });
      }

      doc.end();
      console.log(`[PDF EXPORT] Stream closed for ${date}`);
    } catch (err) {
      console.error(`[PDF EXPORT] CRITICAL ERROR:`, err);
      if (!res.headersSent) {
        res.status(500).send(`PDF Generation Error: ${err.message}`);
      }
    }
  }),
);

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const {
      applicationId,
      roundNo, // Keep for legacy if needed
      round,   // New specific label
      interviewerIds, // New array
      scheduledStart,
      scheduledEnd = null,
      mode,
      meetingLink = null,
      zohoLink = null,
    } = req.body;

    if (!applicationId || !interviewerIds || !Array.isArray(interviewerIds) || interviewerIds.length === 0 || !scheduledStart || !mode) {
      throw new ApiError(
        400,
        "applicationId, interviewerIds (array), scheduledStart, and mode are required",
      );
    }
    if (!["ONLINE", "OFFLINE", "PHONE"].includes(mode)) {
      throw new ApiError(400, "mode must be ONLINE, OFFLINE, or PHONE");
    }

    const [application, interviewers] = await Promise.all([
      prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } }),
      prisma.user.findMany({
        where: { id: { in: interviewerIds } },
        select: { id: true, status: true },
      }),
    ]);

    if (!application) throw new ApiError(404, "Application not found");
    if (interviewers.length !== interviewerIds.length) throw new ApiError(404, "One or more interviewers not found");
    if (interviewers.some(u => u.status !== "ACTIVE")) throw new ApiError(400, "One or more interviewers are inactive");

    const interview = await prisma.interview.create({
      data: {
        applicationId,
        roundNo: parseInt(roundNo) || 1,
        round: round || `Round ${roundNo}`,
        scheduledStart: new Date(scheduledStart),
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        mode,
        meetingLink,
        zohoLink,
        createdById: req.user.id,
        interviewers: {
          connect: interviewerIds.map(id => ({ id }))
        }
      },
      include: {
        application: {
          select: {
            id: true,
            candidate: { select: { id: true, fullName: true } },
            job: { select: { id: true, title: true } },
          },
        },
        interviewers: { select: { id: true, fullName: true, email: true } },
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "SCHEDULE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: interview.id,
      newData: {
        applicationId,
        round,
        interviewerIds,
        scheduledStart,
        scheduledEnd,
        mode,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // --- Automated Pipeline Transition: Move to 'Interview' stage ---
    try {
      // Find the "Interview" stage for this job (or global)
      const stage = await prisma.pipelineStage.findFirst({
        where: {
          name: { equals: "Interview", mode: "insensitive" },
          OR: [
            { jobId: interview.application.job.id },
            { jobId: null }
          ]
        },
        orderBy: { jobId: "desc" } // Prioritize job-specific stage
      });

      if (stage) {
        await prisma.application.update({
          where: { id: applicationId },
          data: { currentStageId: stage.id }
        });

        await prisma.stageHistory.create({
          data: {
            applicationId,
            stageId: stage.id,
            changedById: req.user.id,
            remark: `Auto-moved to Interview stage (Interview Scheduled: ${interview.round})`
          }
        });
      }
    } catch (err) {
      console.error("[AUTO-TRANSITION] Failed to move application to Interview stage:", err);
    }
    // -------------------------------------------------------------

    // Notify Interviewers
    for (const userId of interviewerIds) {
      await sendNotification({
        userId,
        title: "New Interview Assigned",
        message: `You have been scheduled for ${interview.round} with ${interview.application.candidate.fullName}.`,
        link: `/schedule?date=${new Date(scheduledStart).toISOString().split('T')[0]}`,
        type: "INTERVIEW"
      });
    }

    res.status(201).json({ success: true, data: interview });
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.applicationId) where.applicationId = req.query.applicationId;
    if (req.query.interviewerId) {
      where.interviewers = { some: { id: req.query.interviewerId } };
    }
    if (req.query.mode) where.mode = req.query.mode;

    if (req.query.from || req.query.to) {
      where.scheduledStart = {};
      if (req.query.from) where.scheduledStart.gte = new Date(req.query.from);
      if (req.query.to) where.scheduledStart.lte = new Date(req.query.to);
    }

    const interviews = await prisma.interview.findMany({
      where,
      orderBy: { scheduledStart: "asc" },
      include: {
        application: {
          select: {
            id: true,
            candidate: { select: { id: true, fullName: true } },
            job: { select: { id: true, title: true } },
          },
        },
        interviewers: { select: { id: true, fullName: true, email: true } },
        feedbacks: {
          include: {
            submittedBy: { select: { id: true, fullName: true } }
          }
        },
        voiceRecordingFile: {
          select: {
            id: true,
            storageKey: true,
            originalName: true,
            mimeType: true,
            createdAt: true,
          },
        },
      },
    });

    res.json({ success: true, data: interviews });
  }),
);

router.post(
  "/:id/voice-recording",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  (req, res, next) => {
    req.uploadFolder = "interview-recordings";
    next();
  },
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      throw new ApiError(400, "Voice recording file is required (field: file)");
    }

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: { voiceRecordingFile: true, interviewers: { select: { id: true } } },
    });
    if (!interview) {
      throw new ApiError(404, "Interview not found");
    }

    if (req.user.role === "INTERVIEWER" && !interview.interviewers.some(u => u.id === req.user.id)) {
      throw new ApiError(403, "You can upload recording only for your assigned interview");
    }

    const cloudinaryUrl = req.file.path;
    const cloudinaryPublicId = req.file.filename;

    const fileMeta = await prisma.fileMeta.create({
      data: {
        storageKey: cloudinaryUrl, // Absolute URL
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "application/octet-stream",
        sizeBytes: BigInt(req.file.size || 0),
        uploadedById: req.user.id,
      },
    });

    await prisma.interview.update({
      where: { id },
      data: { voiceRecordingFileId: fileMeta.id },
    });

    // NOTE: Manual file cleanup (fs.unlink) is no longer needed for Cloudinary.

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_INTERVIEW_RECORDING",
      entityType: "INTERVIEW",
      entityId: id,
      newData: {
        fileId: fileMeta.id,
        fileName: fileMeta.originalName,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: {
        fileId: fileMeta.id,
        originalName: fileMeta.originalName,
        url: fileMeta.storageKey, // Absolute Cloudinary URL
      },
    });
  }),
);

router.post(
  "/:id/feedback",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      technicalRating,
      communicationRating,
      cultureFitRating,
      strengths,
      concerns,
      recommendation,
      overallComments,
    } = req.body;

    if (
      !technicalRating ||
      !communicationRating ||
      !cultureFitRating ||
      !strengths ||
      !concerns ||
      !recommendation ||
      !overallComments
    ) {
      throw new ApiError(
        400,
        "technicalRating, communicationRating, cultureFitRating, strengths, concerns, recommendation, and overallComments are required",
      );
    }

    if (!["PASS", "FAIL", "HOLD", "PENDING", "OFFER"].includes(recommendation)) {
      throw new ApiError(400, "Invalid recommendation");
    }

    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { id: true, result: true, mandatoryFeedbackSubmitted: true, interviewers: { select: { id: true } } },
    });
    if (!interview) throw new ApiError(404, "Interview not found");

    if (req.user.role === "INTERVIEWER" && !interview.interviewers.some(u => u.id === req.user.id)) {
      throw new ApiError(403, "You can only submit feedback for interviews assigned to you");
    }

    const existingFeedback = await prisma.interviewFeedback.findFirst({
      where: { interviewId: id, submittedById: req.user.id },
      select: { id: true },
    });

    let feedback;
    if (existingFeedback) {
      feedback = await prisma.interviewFeedback.update({
        where: { id: existingFeedback.id },
        data: {
          technicalRating,
          communicationRating,
          cultureFitRating,
          strengths,
          concerns,
          recommendation,
          overallComments,
        }
      });
    } else {
      feedback = await prisma.interviewFeedback.create({
        data: {
          interviewId: id,
          technicalRating,
          communicationRating,
          cultureFitRating,
          strengths,
          concerns,
          recommendation,
          overallComments,
          submittedById: req.user.id,
        },
      });
    }

    await prisma.interview.update({
      where: { id },
      data: {
        result: recommendation,
        mandatoryFeedbackSubmitted: true,
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "SUBMIT_INTERVIEW_FEEDBACK",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: { mandatoryFeedbackSubmitted: interview.mandatoryFeedbackSubmitted, result: interview.result },
      newData: { mandatoryFeedbackSubmitted: true, result: recommendation },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // --- Automated Pipeline Transition: Move to 'Selected' if OFFER is recommended ---
    if (recommendation === "OFFER") {
      try {
        const interviewFull = await prisma.interview.findUnique({
          where: { id },
          include: { application: { select: { id: true, jobId: true } } }
        });

        const stage = await prisma.pipelineStage.findFirst({
          where: {
            name: { equals: "Selected", mode: "insensitive" },
            OR: [
              { jobId: interviewFull.application.jobId },
              { jobId: null }
            ]
          },
          orderBy: { jobId: "desc" }
        });

        if (stage) {
          await prisma.application.update({
            where: { id: interviewFull.application.id },
            data: { currentStageId: stage.id }
          });

          await prisma.stageHistory.create({
            data: {
              applicationId: interviewFull.application.id,
              stageId: stage.id,
              changedById: req.user.id,
              remark: "Auto-moved to Selected stage (OFFER recommendation submitted)"
            }
          });
        }
      } catch (err) {
        console.error("[AUTO-TRANSITION] Failed to move application to Selected stage:", err);
      }
    }
    // --------------------------------------------------------------------------------

    // Notify Admins/Recruiters
    const admins = await prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "RECRUITER"] } },
      select: { id: true }
    });
    for (const admin of admins) {
      if (admin.id === req.user.id) continue;
      await sendNotification({
        userId: admin.id,
        title: "Interview Feedback Submitted",
        message: `${req.user.fullName} submitted ${recommendation} feedback for an interview.`,
        link: `/candidate/${interview.applicationId}`, // Assuming application ID is used in URL
        type: "FEEDBACK"
      });
    }

    res.status(201).json({ success: true, data: feedback });
  }),
);

router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        application: {
          select: {
            candidate: { select: { fullName: true } }
          }
        }
      }
    });

    if (!interview) {
      throw new ApiError(404, "Interview not found");
    }

    await prisma.interview.delete({
      where: { id },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: {
        candidateName: interview.application?.candidate?.fullName,
        round: interview.round,
        scheduledStart: interview.scheduledStart
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Interview deleted successfully" });
  }),
);

// FEATURE 3: Inline Meet Link Update
router.patch(
  "/:id/meet-link",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { meetingLink } = req.body;

    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { id: true, meetingLink: true, interviewers: { select: { id: true } } }
    });

    if (!interview) throw new ApiError(404, "Interview not found");

    if (req.user.role === "INTERVIEWER" && !interview.interviewers.some(u => u.id === req.user.id)) {
      throw new ApiError(403, "You can only update meet links for interviews assigned to you");
    }

    const updated = await prisma.interview.update({
      where: { id },
      data: { meetingLink }
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPDATE_INTERVIEW_MEET_LINK",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: { meetingLink: interview.meetingLink },
      newData: { meetingLink },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: updated });
  })
);

module.exports = router;
