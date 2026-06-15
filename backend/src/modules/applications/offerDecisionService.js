const prisma = require('../../config/db');
const { asyncHandler, ApiError } = require('../../utils/errors');
const { logAudit } = require('../../utils/audit');
const sse = require('../../utils/sse');
const { sendNotification, notifyAdmins } = require('../../utils/notifications');
const inv = require('../../utils/cacheInvalidation');

const VALID_OFFER_STATUSES = ['OFFER_SENT'];

async function fetchApplication(applicationId) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { select: { id: true, fullName: true } },
      job: { select: { id: true, title: true } },
    },
  });
  if (!app) throw new ApiError(404, 'Application not found');
  return app;
}

async function markAsJoined(req, res) {
  const { applicationId } = req.params;
  const { dateOfJoining, notes } = req.body;
  const decidedByUserId = req.user.id;

  const app = await fetchApplication(applicationId);

  if (!VALID_OFFER_STATUSES.includes(app.status)) {
    throw new ApiError(409, `Cannot mark as joined — application is currently ${app.status}, not OFFER_SENT`);
  }

  const candidateName = app.candidate?.fullName || 'Unknown Candidate';
  const jobTitle = app.job?.title || 'Unknown Role';

  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: 'JOINED',
      joiningDate: dateOfJoining || null,
    },
  });

  if (app.candidateId) {
    await prisma.candidate.update({
      where: { id: app.candidateId },
      data: {
        status: 'JOINED',
        doj: dateOfJoining || null,
      },
    });
  }

  const orgId = req.user.organizationId || 'defaultOrg';
  await inv.application(orgId, app.candidateId);

  logAudit({
    actorUserId: decidedByUserId,
    action: 'MARK_AS_JOINED',
    entityType: 'APPLICATION',
    entityId: applicationId,
    oldData: { status: app.status },
    newData: { status: 'JOINED' },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sse.broadcastToOrg(orgId, 'CANDIDATE_JOINED', {
    candidateId: app.candidateId,
    decision: 'JOINED',
    dateOfJoining: dateOfJoining || null,
    decidedBy: decidedByUserId,
    decidedByName: req.user.fullName || req.user.email,
  });

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

  res.json({ success: true, data: updated });
}

async function markAsRejected(req, res) {
  const { applicationId } = req.params;
  const { rejectionReason = 'OTHER', notes } = req.body;
  const decidedByUserId = req.user.id;

  const app = await fetchApplication(applicationId);

  if (!VALID_OFFER_STATUSES.includes(app.status)) {
    throw new ApiError(409, `Cannot reject — application is currently ${app.status}, not OFFER_SENT`);
  }

  const candidateName = app.candidate?.fullName || 'Unknown Candidate';
  const jobTitle = app.job?.title || 'Unknown Role';

  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: { status: 'REJECTED' },
  });

  if (app.candidateId) {
    await prisma.candidate.update({
      where: { id: app.candidateId },
      data: { status: 'REJECTED' },
    });
  }

  const orgId = req.user.organizationId || 'defaultOrg';
  await inv.application(orgId, app.candidateId);

  logAudit({
    actorUserId: decidedByUserId,
    action: 'MARK_AS_REJECTED',
    entityType: 'APPLICATION',
    entityId: applicationId,
    oldData: { status: app.status },
    newData: { status: 'REJECTED', rejectionReason },
    metadata: { rejectionReason, notes: notes || null },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

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

  res.json({ success: true, data: updated });
}

module.exports = { markAsJoined: asyncHandler(markAsJoined), markAsRejected: asyncHandler(markAsRejected) };
