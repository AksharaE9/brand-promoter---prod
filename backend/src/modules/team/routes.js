const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const { broadcast } = require("../../utils/sse");

const router = express.Router();
router.use(auth);

// RECRUITERS
router.get("/recruiters/:id", asyncHandler(async (req, res) => {
  const doc = await firestore.collection("users").doc(req.params.id).get();
  if (!doc.exists) throw new ApiError(404, "Recruiter not found");
  res.json({ success: true, data: { id: doc.id, ...doc.data() } });
}));

router.put("/recruiters/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) {
    throw new ApiError(403, "You can only edit your own profile");
  }

  const payload = { ...req.body, updatedAt: new Date().toISOString() };
  
  if (!isSuperAdmin) {
    // Strip protected fields
    delete payload.role;
    delete payload.userType;
    delete payload.maxActiveCandidates;
    delete payload.department;
    delete payload.designation;
    delete payload.employeeId;
    delete payload.reportingTo;
    delete payload.isActive;
    delete payload.status;
  }

  await firestore.collection("users").doc(id).update(payload);
  
  const doc = await firestore.collection("users").doc(id).get();
  broadcast({ type: "RECRUITER_UPDATED", userId: id });

  res.json({ success: true, data: { id, ...doc.data() } });
}));

router.patch("/recruiters/:id/status", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { status } = req.body;
  await firestore.collection("users").doc(req.params.id).update({ 
    status, isActive: status === "ACTIVE", updatedAt: new Date().toISOString() 
  });
  broadcast({ type: "RECRUITER_STATUS_UPDATED", userId: req.params.id, status });
  res.json({ success: true, data: { status } });
}));

// INTERVIEWERS
router.get("/interviewers/:id", asyncHandler(async (req, res) => {
  const doc = await firestore.collection("users").doc(req.params.id).get();
  if (!doc.exists) throw new ApiError(404, "Interviewer not found");
  res.json({ success: true, data: { id: doc.id, ...doc.data() } });
}));

router.put("/interviewers/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const isSelf = req.user.id === id;

  if (!isSuperAdmin && !isSelf) {
    throw new ApiError(403, "You can only edit your own profile");
  }

  const payload = { ...req.body, updatedAt: new Date().toISOString() };
  
  if (!isSuperAdmin) {
    delete payload.role;
    delete payload.userType;
    delete payload.department;
    delete payload.designation;
    delete payload.employeeId;
    delete payload.reportingTo;
    delete payload.isActive;
    delete payload.status;
  }

  await firestore.collection("users").doc(id).update(payload);
  
  const doc = await firestore.collection("users").doc(id).get();
  broadcast({ type: "INTERVIEWER_UPDATED", userId: id });

  res.json({ success: true, data: { id, ...doc.data() } });
}));

router.patch("/interviewers/:id/status", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const { status } = req.body;
  await firestore.collection("users").doc(req.params.id).update({ 
    status, isActive: status === "ACTIVE", updatedAt: new Date().toISOString() 
  });
  broadcast({ type: "INTERVIEWER_STATUS_UPDATED", userId: req.params.id, status });
  res.json({ success: true, data: { status } });
}));

module.exports = router;
