const { db: firestore } = require('../../config/firebase');
const { asyncHandler, ApiError } = require('../../utils/errors');
const { logAudit } = require('../../utils/audit');
const sse = require('../../utils/sse');
const { sendNotification, notifyAdmins } = require('../../utils/notifications');
const inv = require('../../utils/cacheInvalidation');

const VALID_OFFER_STATUSES = ['OFFER_SENT'];

/**
 * Fetches application with candidate and job data
 */
async function fetchApplication(applicationId) {
  const doc = await firestore.collection('applications').doc(applicationId).get();
  if (!doc.exists) throw new ApiError(404, 'Application not found');

  const app = { id: doc.id, ...doc.data() };

  // Fetch candidate and job in parallel
  const [candDoc, jobDoc] = await Promise.all([
    app.candidateId ? firestore.collection('candidates').doc(app.candidateId).get() : null,
    app.jobId ? firestore.collection('jobs').doc(app.jobId).get() : null,
  ]);

  app.candidate = candDoc?.exists ? { id: candDoc.id, ...candDoc.data() } : null;
  app.job = jobDoc?.exists ? { id: jobDoc.id, ...jobDoc.data() } : null;

  return app;
}

/**
 * Mark an application as JOINED
 */
async function markAsJoined(req, res) {
  const { applicationId } = req.params;
  const { dateOfJoining, notes } = req.body;
  const decidedByUserId = req.user.id;

  const app = await fetchApplication(applicationId);

  // Status guard
  if (!VALID_OFFER_STATUSES.includes(app.status)) {
    throw new ApiError(409, `Cannot mark as joined — application is currently ${app.status}, not OFFER_SENT`);
  }

  // Idempotency guard
  if (app.offerDecision) {
    throw new ApiError(409, `Offer decision already recorded as ${app.offerDecision}`);
  }

  const now = new Date().toISOString();
  const candidateName = app.candidate?.fullName || 'Unknown Candidate';
  const jobTitle = app.job?.title || 'Unknown Role';

  // Update application
  const updatePayload = {
    status: 'JOINED',
    offerDecision: 'JOINED',
    offerDecidedAt: now,
    offerDecidedBy: decidedByUserId,
    offerDecisionNotes: notes || null,
    dateOfJoining: dateOfJoining || null,
    offerLetterStatus: 'NOT_STARTED',
    backgroundCheck: 'NOT_STARTED',
    onboardingStatus: 'NOT_STARTED',
    updatedAt: now,
  };

  await firestore.collection('applications').doc(applicationId).update(updatePayload);
  const orgId = req.user.organizationId || 'defaultOrg';
  await inv.application(orgId, app.candidateId);

  // Sync candidate record status
  if (app.candidateId) {
    await firestore.collection('candidates').doc(app.candidateId).update({
      status: 'JOINED',
      doj: dateOfJoining || null,
      updatedAt: now,
    });
  }

  // Activity log
  await firestore.collection('activityLogs').add({
    applicationId,
    action: 'OFFER_ACCEPTED_JOINED',
    actorUserId: decidedByUserId,
    metadata: { candidateName, jobTitle, dateOfJoining },
    createdAt: now,
  });

  await logAudit({
    actorUserId: decidedByUserId,
    action: 'MARK_AS_JOINED',
    entityType: 'APPLICATION',
    entityId: applicationId,
    oldData: { status: app.status },
    newData: { status: 'JOINED', offerDecision: 'JOINED' },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const ssePayload = {
    type: 'JOINED',
    applicationId,
    candidateId: app.candidateId,
    candidateName,
    jobId: app.jobId,
    jobTitle,
    offerDecidedAt: now,
    dateOfJoining: dateOfJoining || null,
  };

  // Broadcast named SSE event to org
  sse.broadcastToOrg(orgId, 'CANDIDATE_JOINED', {
    candidateId: app.candidateId,
    decision: 'JOINED',
    dateOfJoining: dateOfJoining || null,
    decidedBy: decidedByUserId,
    decidedByName: req.user.fullName || req.user.email,
  });

  // Notify admins (non-blocking)
  try {
    await notifyAdmins({
      title: 'Candidate Joined',
      message: `${candidateName} has joined for the role of ${jobTitle}`,
      link: `/candidates?status=JOINED&highlight=${applicationId}`,
      type: 'STAGE_CHANGE',
    });
  } catch (err) {
    console.error('[OFFER] Notification failed (non-fatal):', err.message);
  }

  const updatedApp = { id: applicationId, ...app, ...updatePayload };
  res.json({ success: true, data: updatedApp });
}

/**
 * Mark an application as REJECTED
 */
async function markAsRejected(req, res) {
  const { applicationId } = req.params;
  const { rejectionReason = 'OTHER', notes } = req.body;
  const decidedByUserId = req.user.id;

  const app = await fetchApplication(applicationId);

  if (!VALID_OFFER_STATUSES.includes(app.status)) {
    throw new ApiError(409, `Cannot reject — application is currently ${app.status}, not OFFER_SENT`);
  }

  if (app.offerDecision) {
    throw new ApiError(409, `Offer decision already recorded as ${app.offerDecision}`);
  }

  const now = new Date().toISOString();
  const candidateName = app.candidate?.fullName || 'Unknown Candidate';
  const jobTitle = app.job?.title || 'Unknown Role';

  const updatePayload = {
    status: 'REJECTED',
    offerDecision: 'REJECTED',
    offerDecidedAt: now,
    offerDecidedBy: decidedByUserId,
    offerDecisionNotes: notes || null,
    rejectionReason: rejectionReason || 'OTHER',
    rejectedAt: now,
    rejectedBy: decidedByUserId,
    updatedAt: now,
  };

  await firestore.collection('applications').doc(applicationId).update(updatePayload);
  const orgId = req.user.organizationId || 'defaultOrg';
  await inv.application(orgId, app.candidateId);

  // Sync candidate record status
  if (app.candidateId) {
    await firestore.collection('candidates').doc(app.candidateId).update({
      status: 'REJECTED',
      updatedAt: now,
    });
  }

  // Activity log
  await firestore.collection('activityLogs').add({
    applicationId,
    action: 'OFFER_REJECTED',
    actorUserId: decidedByUserId,
    metadata: { candidateName, jobTitle, rejectionReason },
    createdAt: now,
  });

  await logAudit({
    actorUserId: decidedByUserId,
    action: 'MARK_AS_REJECTED',
    entityType: 'APPLICATION',
    entityId: applicationId,
    oldData: { status: app.status },
    newData: { status: 'REJECTED', offerDecision: 'REJECTED', rejectionReason },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const ssePayload = {
    type: 'REJECTED',
    applicationId,
    candidateId: app.candidateId,
    candidateName,
    jobId: app.jobId,
    jobTitle,
    offerDecidedAt: now,
    rejectionReason,
  };

  // Broadcast named SSE event to org
  sse.broadcastToOrg(orgId, 'CANDIDATE_REJECTED', {
    candidateId: app.candidateId,
    decision: 'REJECTED',
    rejectionReason,
    decidedBy: decidedByUserId,
    decidedByName: req.user.fullName || req.user.email,
  });

  try {
    await notifyAdmins({
      title: 'Offer Rejected',
      message: `The offer for ${candidateName} (${jobTitle}) was rejected — ${rejectionReason.replace(/_/g, ' ')}`,
      link: `/candidates?status=REJECTED&highlight=${applicationId}`,
      type: 'REJECTION',
    });
  } catch (err) {
    console.error('[OFFER] Notification failed (non-fatal):', err.message);
  }

  const updatedApp = { id: applicationId, ...app, ...updatePayload };
  res.json({ success: true, data: updatedApp });
}

module.exports = { markAsJoined: asyncHandler(markAsJoined), markAsRejected: asyncHandler(markAsRejected) };
