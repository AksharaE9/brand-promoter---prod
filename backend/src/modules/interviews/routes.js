const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { upload, offerLetterUpload } = require("../../middleware/upload");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { sendNotification } = require("../../utils/notifications");
const { broadcast } = require("../../utils/sse");

const router = express.Router();

router.use(auth);

router.get(
  "/export-day",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) throw new ApiError(400, "Date is required (YYYY-MM-DD)");

    const start = new Date(`${date}T00:00:00.000Z`).toISOString();
    const end = new Date(`${date}T23:59:59.999Z`).toISOString();

    const snapshot = await firestore.collection("interviews")
      .where("scheduledStart", ">=", start)
      .where("scheduledStart", "<=", end)
      .orderBy("scheduledStart", "asc")
      .get();
    
    const interviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
        doc.fontSize(13).fillColor("#071f52").text(`${timeStr} - ${item.candidateName || "N/A"}`, { underline: true });
        doc.fontSize(10).fillColor("#333").text(`Round: ${item.roundNo} | Role: ${item.jobTitle || "General"}`);
        doc.text(`Interviewers: ${item.interviewerNames || "N/A"} | Mode: ${item.mode}`);
        doc.moveDown(1.5);
      });
    }

    doc.end();
  }),
);

router.get(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const { getCached } = require("../../utils/cache");

    const cacheKey = `interviews_list_${req.user.role}_${req.user.id}_p${page}_l${limit}`;

    const result = await getCached(cacheKey, async () => {
      // Fetch all interviews — try sorted, fall back to unsorted
      let allDocs = [];
      try {
        let query = firestore.collection("interviews");
        if (req.user.role === "INTERVIEWER") {
          query = query.where("interviewerIds", "array-contains", req.user.id);
        }
        const snapshot = await query.orderBy("scheduledStart", "desc").get();
        allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (indexErr) {
        // Firestore index not created — fallback: fetch without orderBy, sort in JS
        console.warn("[interviews] orderBy fallback:", indexErr.message);
        try {
          let query = firestore.collection("interviews");
          if (req.user.role === "INTERVIEWER") {
            query = query.where("interviewerIds", "array-contains", req.user.id);
          }
          const snapshot = await query.get();
          allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          allDocs.sort((a, b) => new Date(b.scheduledStart || 0) - new Date(a.scheduledStart || 0));
        } catch (err2) {
          console.error("[interviews] fetch failed:", err2.message);
          throw err2;
        }
      }

      // Apply pagination in memory
      const total = allDocs.length;
      const paginated = allDocs.slice((page - 1) * limit, page * limit);

      if (paginated.length === 0) {
        return { data: [], pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
      }

      // Collect unique IDs needed
      const appIds    = [...new Set(paginated.map(iv => iv.applicationId).filter(Boolean))];
      const userIds   = [...new Set(paginated.flatMap(iv => iv.interviewerIds || []).filter(Boolean))];

      // Fetch applications individually (safe, no getAll limit issues)
      const appMap = {};
      if (appIds.length > 0) {
        const appSnaps = await Promise.all(
          appIds.map(id => firestore.collection("applications").doc(id).get())
        );
        appSnaps.forEach(snap => { if (snap.exists) appMap[snap.id] = { id: snap.id, ...snap.data() }; });
      }

      // Collect candidate + job IDs from applications
      const candIds = [...new Set(Object.values(appMap).map(a => a.candidateId).filter(Boolean))];
      const jobIds  = [...new Set(Object.values(appMap).map(a => a.jobId).filter(Boolean))];

      // Fetch candidates, jobs, users individually (safe)
      const [candSnaps, jobSnaps, userSnaps] = await Promise.all([
        Promise.all(candIds.map(id => firestore.collection("candidates").doc(id).get())),
        Promise.all(jobIds.map(id  => firestore.collection("jobs").doc(id).get())),
        Promise.all(userIds.map(id => firestore.collection("users").doc(id).get())),
      ]);

      const candMap = {};
      candSnaps.forEach(snap => { if (snap.exists) candMap[snap.id] = { id: snap.id, ...snap.data() }; });
      const jobMap = {};
      jobSnaps.forEach(snap  => { if (snap.exists) jobMap[snap.id]  = { id: snap.id, ...snap.data() }; });
      const userMap = {};
      userSnaps.forEach(snap => { if (snap.exists) userMap[snap.id] = { id: snap.id, ...snap.data() }; });

      // Fetch feedbacks for each interview in parallel
      const feedbackSnaps = await Promise.all(
        paginated.map(iv =>
          firestore.collection("interviewFeedbacks")
            .where("interviewId", "==", iv.id)
            .get()
            .catch(() => ({ docs: [] })) // never crash on missing feedback
        )
      );
      const feedbackMap = {};
      feedbackSnaps.forEach((snap, idx) => {
        feedbackMap[paginated[idx].id] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          submittedBy: userMap[d.data().submittedById] || { fullName: "Interviewer" },
        }));
      });

      // Build populated response
      const populated = paginated.map(iv => {
        const appRaw = appMap[iv.applicationId];
        const app = appRaw ? { ...appRaw } : null;
        if (app) {
          app.candidate = candMap[app.candidateId] || null;
          app.job       = jobMap[app.jobId]        || null;
        }
        return {
          ...iv,
          application: app,
          interviewers: (iv.interviewerIds || []).map(id => userMap[id]).filter(Boolean),
          feedbacks:    feedbackMap[iv.id] || [],
        };
      });
      // Include ALL interviews, even those without candidates (don't filter)

      return {
        data: populated,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }, 30000); // 30s cache

    res.json({ success: true, ...result });
  }),
);

router.post(
  "/",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { applicationId, interviewerIds, scheduledStart, mode, roundNo, round, meetingLink, zohoLink, scheduledEnd } = req.body;
    
    if (!applicationId || !interviewerIds || !scheduledStart || !mode) {
      throw new ApiError(400, "Missing required fields");
    }

    const appDoc = await firestore.collection("applications").doc(applicationId).get();
    if (!appDoc.exists) throw new ApiError(404, "Application not found");

    const interviewData = {
      applicationId,
      interviewerIds,
      scheduledStart,
      scheduledEnd: scheduledEnd || null,
      mode,
      roundNo: parseInt(roundNo) || 1,
      round: round || `Round ${roundNo || 1}`,
      meetingLink: meetingLink || "",
      zohoLink: zohoLink || "",
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      status: "SCHEDULED"
    };

    const docRef = await firestore.collection("interviews").add(interviewData);

    // Invalidate cached interview lists so all users see the new interview
    const { invalidatePattern } = require("../../utils/cache");
    await invalidatePattern('interviews_list_');

    await logAudit({
      actorUserId: req.user.id,
      action: "SCHEDULE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: docRef.id,
      newData: interviewData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: "INTERVIEW_UPDATED", data: { id: docRef.id, ...interviewData } });

    res.status(201).json({ success: true, data: { id: docRef.id, ...interviewData } });
  }),
);

router.post(
  "/:id/feedback",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  offerLetterUpload.single("offerFile"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      technicalRating,
      communicationRating,
      cultureFitRating,
      strengths,
      weaknesses,
      overallComments,
      recommendation,
    } = req.body;

    const interviewRef = firestore.collection("interviews").doc(id);
    const interviewDoc = await interviewRef.get();
    if (!interviewDoc.exists) throw new ApiError(404, "Interview not found");

    // Check if feedback already exists for this interview
    const existingFeedback = await firestore.collection("interviewFeedbacks")
      .where("interviewId", "==", id)
      .limit(1)
      .get();
    
    if (!existingFeedback.empty) {
      throw new ApiError(400, "Feedback has already been submitted for this interview round.");
    }

    const feedbackData = {
      interviewId: id,
      submittedById: req.user.id,
      technicalRating: parseInt(technicalRating) || 0,
      communicationRating: parseInt(communicationRating) || 0,
      cultureFitRating: parseInt(cultureFitRating) || 0,
      strengths: strengths || "",
      weaknesses: weaknesses || req.body.concerns || "",
      overallComments: overallComments || "",
      recommendation: recommendation || "PENDING",
      createdAt: new Date().toISOString()
    };

    if (req.file) {
      feedbackData.offerFileUrl = req.file.path;
      feedbackData.offerFileName = req.file.originalname;
    }

    const feedbackRef = await firestore.collection("interviewFeedbacks").add(feedbackData);

    const updateData = { 
      status: "COMPLETED",
      result: recommendation,
      updatedAt: new Date().toISOString()
    };
    if (req.file) updateData.offerLetterUrl = req.file.path;

    await interviewRef.update(updateData);

    // SYNC: Update Application and Candidate status based on recommendation
    const interviewDataRaw = interviewDoc.data();
    if (interviewDataRaw.applicationId) {
      const appRef = firestore.collection("applications").doc(interviewDataRaw.applicationId);
      const appDoc = await appRef.get();
      
      if (appDoc.exists) {
        const appData = appDoc.data();
        let newStatus = appData.status;
        let candidateStatus = "ACTIVE";

        if (recommendation === "REJECTED") {
          newStatus = "REJECTED";
          candidateStatus = "REJECTED";
        } else if (recommendation === "SELECTED" || recommendation === "OFFER_SENT" || recommendation === "OFFER_LETTER") {
          newStatus = "OFFER_SENT";
          candidateStatus = "OFFER_SENT";
        } else if (recommendation === "JOINED") {
          newStatus = "JOINED";
          candidateStatus = "JOINED";
        }

        // Update Application
        await appRef.update({ status: newStatus, updatedAt: new Date().toISOString() });

        // Update Candidate global status
        if (appData.candidateId) {
          await firestore.collection("candidates").doc(appData.candidateId).update({
            status: candidateStatus,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "SUBMIT_INTERVIEW_FEEDBACK",
      entityType: "INTERVIEW_FEEDBACK",
      entityId: feedbackRef.id,
      newData: feedbackData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: 'INTERVIEW_FEEDBACK_SUBMITTED', interviewId: id, recommendation });

    res.status(201).json({ success: true, data: { id: feedbackRef.id, ...feedbackData } });
  }),
);

router.post(
  "/:id/recording",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) throw new ApiError(400, "Recording file is required");

    const interviewRef = firestore.collection("interviews").doc(id);
    const interviewDoc = await interviewRef.get();
    if (!interviewDoc.exists) throw new ApiError(404, "Interview not found");

    // Use memory buffer for Firebase Storage
    const { uploadFileToFirebase } = require("../../config/firebase");
    const folder = "interview-recordings";
    const fileName = `interview_${id}_${Date.now()}_${req.file.originalname}`;
    
    const fileUrl = await uploadFileToFirebase(req.file.buffer, folder, fileName, req.file.mimetype);

    const fileMeta = {
      storageKey: fileUrl,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedById: req.user.id,
      createdAt: new Date().toISOString()
    };

    const fileRef = await firestore.collection("fileMetas").add(fileMeta);

    await interviewRef.update({
      voiceRecordingFileId: fileRef.id,
      voiceRecordingUrl: fileUrl,
      updatedAt: new Date().toISOString()
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "UPLOAD_INTERVIEW_RECORDING",
      entityType: "INTERVIEW",
      entityId: id,
      newData: { fileId: fileRef.id, url: fileUrl },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, data: { fileId: fileRef.id, url: fileUrl } });
  }),
);

router.delete(
  "/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const interviewRef = firestore.collection("interviews").doc(id);
    const doc = await interviewRef.get();
    if (!doc.exists) throw new ApiError(404, "Interview not found");

    const existing = doc.data();
    await interviewRef.delete();

    await logAudit({
      actorUserId: req.user.id,
      action: "DELETE_INTERVIEW",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: existing,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Interview deleted successfully" });
  }),
);

router.patch(
  "/:id/panelists",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { interviewerIds } = req.body;

    if (!interviewerIds || !Array.isArray(interviewerIds)) {
      throw new ApiError(400, "interviewerIds (array) is required");
    }

    const interviewRef = firestore.collection("interviews").doc(id);
    const doc = await interviewRef.get();
    if (!doc.exists) throw new ApiError(404, "Interview not found");

    const oldData = doc.data();
    await interviewRef.update({
      interviewerIds,
      updatedAt: new Date().toISOString()
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "TRANSFER_INTERVIEW_PANELISTS",
      entityType: "INTERVIEW",
      entityId: id,
      oldData: { interviewerIds: oldData.interviewerIds },
      newData: { interviewerIds },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    broadcast({ type: 'INTERVIEW_PANELISTS_UPDATED', interviewId: id, interviewerIds });

    res.json({ success: true, message: "Panelists transferred successfully" });
  }),
);

// EDIT INTERVIEW ROUTES
router.get(
  "/:roundId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const doc = await firestore.collection("interviews").doc(roundId).get();
    if (!doc.exists) throw new ApiError(404, "Interview not found");
    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  })
);

router.put(
  "/:roundId",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const data = req.body;
    
    const interviewRef = firestore.collection("interviews").doc(roundId);
    const doc = await interviewRef.get();
    if (!doc.exists) throw new ApiError(404, "Interview not found");
    const oldData = doc.data();

    const isSuperAdmin = req.user.role === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      if (new Date(data.scheduledStart) < new Date() && data.scheduledStart !== oldData.scheduledStart) {
        throw new ApiError(400, "Interview date must not be in the past");
      }
      if (oldData.status === "COMPLETED" || oldData.status === "CANCELLED") {
        throw new ApiError(400, `Cannot edit interview in ${oldData.status} status`);
      }
    }

    if (!data.interviewerIds || data.interviewerIds.length === 0) {
      throw new ApiError(400, "Panel members array must contain at least one member");
    }

    if (!["IN_PERSON", "VIRTUAL", "PHONE"].includes(data.mode)) {
      throw new ApiError(400, "Mode must be one of IN_PERSON, VIRTUAL, PHONE");
    }

    if (data.mode === "VIRTUAL" && !data.meetingLink) {
      throw new ApiError(422, "Meeting link is required for virtual interviews");
    }

    const durationMinutes = data.durationMinutes || 60;
    if (durationMinutes < 15 || durationMinutes > 480) {
      throw new ApiError(400, "Duration must be between 15 and 480 minutes");
    }

    let status = oldData.status;
    let rescheduleHistory = oldData.rescheduleHistory || [];

    if (data.scheduledStart !== oldData.scheduledStart && oldData.status === "SCHEDULED") {
      status = "RESCHEDULED";
      rescheduleHistory.push({
        previousDate: oldData.scheduledStart,
        newDate: data.scheduledStart,
        reason: data.rescheduleReason || "No reason provided",
        rescheduledBy: req.user.id,
        rescheduledAt: new Date().toISOString()
      });
    }

    const updateData = {
      ...data,
      status,
      rescheduleHistory,
      updatedAt: new Date().toISOString()
    };

    await interviewRef.update(updateData);

    const updatedDoc = await interviewRef.get();
    const updatedPayload = { id: updatedDoc.id, ...updatedDoc.data() };

    broadcast({ type: "INTERVIEW_UPDATED", data: updatedPayload });

    // Dummy Notification Trigger (You would inject your notification logic here)
    if (data.scheduledStart !== oldData.scheduledStart || data.mode !== oldData.mode) {
      data.interviewerIds.forEach(id => {
        sendNotification(id, "Interview Updated", `Interview has been updated. Date/Mode changed. Reason: ${data.rescheduleReason || 'N/A'}`);
      });
    }

    res.json({ success: true, data: updatedPayload });
  })
);

router.patch(
  "/:roundId/reschedule",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { scheduledStart, mode, rescheduleReason } = req.body;

    const interviewRef = firestore.collection("interviews").doc(roundId);
    const doc = await interviewRef.get();
    if (!doc.exists) throw new ApiError(404, "Interview not found");
    const oldData = doc.data();

    let rescheduleHistory = oldData.rescheduleHistory || [];
    rescheduleHistory.push({
      previousDate: oldData.scheduledStart,
      newDate: scheduledStart,
      reason: rescheduleReason || "No reason provided",
      rescheduledBy: req.user.id,
      rescheduledAt: new Date().toISOString()
    });

    const updateData = {
      scheduledStart,
      mode,
      status: "RESCHEDULED",
      rescheduleHistory,
      updatedAt: new Date().toISOString()
    };

    await interviewRef.update(updateData);
    
    const updatedDoc = await interviewRef.get();
    broadcast({ type: "INTERVIEW_UPDATED", data: { id: updatedDoc.id, ...updatedDoc.data() } });

    res.json({ success: true, data: updateData });
  })
);

router.patch(
  "/:roundId/panel",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const { interviewerIds } = req.body;
    
    if (!interviewerIds || interviewerIds.length === 0) {
      throw new ApiError(400, "Panel members array must contain at least one member");
    }

    const interviewRef = firestore.collection("interviews").doc(roundId);
    await interviewRef.update({ interviewerIds, updatedAt: new Date().toISOString() });

    const updatedDoc = await interviewRef.get();
    broadcast({ type: "INTERVIEW_UPDATED", data: { id: updatedDoc.id, ...updatedDoc.data() } });

    res.json({ success: true, data: { interviewerIds } });
  })
);

router.patch(
  "/:roundId/cancel",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const interviewRef = firestore.collection("interviews").doc(roundId);
    await interviewRef.update({ status: "CANCELLED", updatedAt: new Date().toISOString() });

    const updatedDoc = await interviewRef.get();
    broadcast({ type: "INTERVIEW_UPDATED", data: { id: updatedDoc.id, ...updatedDoc.data() } });

    res.json({ success: true });
  })
);

router.patch(
  "/:roundId/complete",
  requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER"),
  asyncHandler(async (req, res) => {
    const { roundId } = req.params;
    const interviewRef = firestore.collection("interviews").doc(roundId);
    await interviewRef.update({ status: "COMPLETED", updatedAt: new Date().toISOString() });

    const updatedDoc = await interviewRef.get();
    broadcast({ type: "INTERVIEW_UPDATED", data: { id: updatedDoc.id, ...updatedDoc.data() } });

    res.json({ success: true });
  })
);

module.exports = router;
