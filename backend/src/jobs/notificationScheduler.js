// src/jobs/notificationScheduler.js
'use strict';

const prisma = require('../config/db');
const cache = require('../services/schedulingCacheService');
const { sendNotification } = require('../utils/notifications');
const inv = require('../utils/cacheInvalidation');

let schedulerInterval = null;

// Queue Depth & Non-Convergence Tracking
const queueMetrics = {
  round1: { lastDepth: 0, staticCycles: 0 },
  round2: { lastDepth: 0, staticCycles: 0 },
  offerLetter: { lastDepth: 0, staticCycles: 0 },
  delayedFeedback: { lastDepth: 0, staticCycles: 0 },
};

function trackQueueConvergence(queueKey, currentDepth) {
  const metric = queueMetrics[queueKey];
  if (!metric) return;

  if (currentDepth === 0) {
    metric.lastDepth = 0;
    metric.staticCycles = 0;
    return;
  }

  if (metric.lastDepth === currentDepth) {
    metric.staticCycles++;
    if (metric.staticCycles >= 3) {
      console.warn(`[NotificationScheduler] [NON-CONVERGENCE WARNING] Queue '${queueKey}' has remained stuck at ${currentDepth} items for ${metric.staticCycles} consecutive cycles.`);
    }
  } else {
    metric.lastDepth = currentDepth;
    metric.staticCycles = 1;
  }
}

/**
 * Processes an array of async functions with a limit on concurrency.
 * @param {Array<Function>} tasks - Array of functions returning promises
 * @param {number} limit - Maximum concurrent executions
 */
async function limitConcurrency(tasks, limit = 5) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(results);
}

/**
 * Main function to scan and process all alert types.
 */
async function processAlerts() {
  try {
    await checkRound1FeedbackAlerts();
    await checkRound2FeedbackAlerts();
    await checkOfferLetterAlerts();
    await checkDelayedFeedbackAlerts();
  } catch (error) {
    console.error('[NotificationScheduler] Error during processing:', error.message);
  }
}

/**
 * 1. Round 1 Feedback Alerts
 * Trigger: 1 hour after scheduledStart has passed.
 * Action: In-app notification sent to interviewers and recruiters.
 */
async function checkRound1FeedbackAlerts() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const interviews = await prisma.interview.findMany({
    where: {
      roundNo: 1,
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      round1SMSAlertSent: false,
      scheduledStart: { lte: oneHourAgo },
    },
    take: 100,
    select: {
      id: true,
      roundNo: true,
      candidateName: true,
      scheduledStart: true,
      organizationId: true,
      createdById: true,
      interviewerIds: true,
      feedback: true,
      applicationId: true,
      application: {
        select: {
          candidate: {
            select: {
              fullName: true,
            },
          },
        },
      },
    },
  });

  trackQueueConvergence('round1', interviews.length);

  if (interviews.length === 0) return;

  const appIds = [...new Set(interviews.map(i => i.applicationId).filter(Boolean))];
  const round2Interviews = appIds.length > 0 ? await prisma.interview.findMany({
    where: {
      applicationId: { in: appIds },
      roundNo: 2,
    },
    select: { applicationId: true }
  }) : [];
  const round2AppIds = new Set(round2Interviews.map(i => i.applicationId));

  const allUserIds = new Set();
  for (const interview of interviews) {
    if (interview.createdById) {
      allUserIds.add(interview.createdById);
    }
    let interviewerIds = [];
    try {
      interviewerIds = typeof interview.interviewerIds === 'string' 
        ? JSON.parse(interview.interviewerIds) 
        : interview.interviewerIds;
    } catch (_) {}
    if (Array.isArray(interviewerIds)) {
      interviewerIds.forEach(id => {
        if (id) allUserIds.add(id);
      });
    }
  }

  const usersList = allUserIds.size > 0 ? await prisma.user.findMany({
    where: {
      id: { in: [...allUserIds] },
      isDeleted: false,
    },
  }) : [];
  const usersMap = new Map(usersList.map(u => [u.id, u]));

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const tasks = interviews.map(interview => async () => {
    try {
      const candidateName = interview.candidateName || interview.application?.candidate?.fullName || 'Candidate';
      const scheduledTime = interview.scheduledStart ? new Date(interview.scheduledStart).toLocaleString() : 'N/A';
      const orgId = interview.organizationId || 'defaultOrg';
      const recruiterId = interview.createdById;
      
      // A. Check if Round 2 already scheduled
      if (round2AppIds.has(interview.applicationId)) {
        await cache.writeRound(interview.id, { round1SMSAlertSent: true }, 'system-scheduler', orgId, interview);
        skippedCount++;
        return;
      }

      // B. Check if feedback is already present
      let feedbackList = [];
      try {
        feedbackList = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback;
      } catch (_) {}
      if (Array.isArray(feedbackList) && feedbackList.length > 0) {
        await cache.writeRound(interview.id, { round1SMSAlertSent: true }, 'system-scheduler', orgId, interview);
        skippedCount++;
        return;
      }

      // C. Get interviewers and recruiter
      let interviewerIds = [];
      try {
        interviewerIds = typeof interview.interviewerIds === 'string' ? JSON.parse(interview.interviewerIds) : interview.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];

      const notifierIds = [...new Set([...interviewerIds, recruiterId].filter(Boolean))];
      const users = notifierIds.map(id => usersMap.get(id)).filter(Boolean);

      // D. Send in-app notifications and trigger SSE broadcast
      const notifPromises = users.map(user => 
        sendNotification({
          userId: user.id,
          title: 'Missed Round 1 Feedback',
          message: `Feedback is pending for ${candidateName} (Round 1, scheduled ${scheduledTime}). Round 2 is unscheduled.`,
          link: `/interviews?highlight=${interview.id}&submitFeedback=true`,
          type: 'WARNING',
        }).catch(() => null)
      );

      await Promise.all(notifPromises);

      // E. Mark alert as sent
      await cache.writeRound(interview.id, { round1SMSAlertSent: true }, 'system-scheduler', orgId, interview);
      sentCount++;

    } catch (err) {
      console.error(`[NotificationScheduler] Error processing Round 1 alert for ${interview.id}:`, err.message);
      failedCount++;
    }
  });

  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Round 1 Alerts: ${interviews.length} found | ${sentCount} alerted | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * 2. Round 2 Feedback Alerts
 * Trigger: After scheduledStart has passed.
 * Action: In-app notification sent to interviewers and recruiters.
 */
async function checkRound2FeedbackAlerts() {
  const now = new Date();

  const interviews = await prisma.interview.findMany({
    where: {
      roundNo: 2,
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      round2EmailAlertSent: false,
      scheduledStart: { lte: now },
    },
    take: 100,
    select: {
      id: true,
      roundNo: true,
      candidateName: true,
      scheduledStart: true,
      organizationId: true,
      createdById: true,
      interviewerIds: true,
      feedback: true,
      offerLetterUrl: true,
      applicationId: true,
      application: {
        select: {
          status: true,
          candidate: {
            select: {
              fullName: true,
            },
          },
        },
      },
    },
  });

  trackQueueConvergence('round2', interviews.length);

  if (interviews.length === 0) return;

  const allUserIds = new Set();
  for (const interview of interviews) {
    if (interview.createdById) {
      allUserIds.add(interview.createdById);
    }
    let interviewerIds = [];
    try {
      interviewerIds = typeof interview.interviewerIds === 'string' 
        ? JSON.parse(interview.interviewerIds) 
        : interview.interviewerIds;
    } catch (_) {}
    if (Array.isArray(interviewerIds)) {
      interviewerIds.forEach(id => {
        if (id) allUserIds.add(id);
      });
    }
  }

  const usersList = allUserIds.size > 0 ? await prisma.user.findMany({
    where: {
      id: { in: [...allUserIds] },
      isDeleted: false,
    },
  }) : [];
  const usersMap = new Map(usersList.map(u => [u.id, u]));

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const tasks = interviews.map(interview => async () => {
    try {
      const candidateName = interview.candidateName || interview.application?.candidate?.fullName || 'Candidate';
      const scheduledTime = interview.scheduledStart ? new Date(interview.scheduledStart).toLocaleString() : 'N/A';
      const orgId = interview.organizationId || 'defaultOrg';
      const recruiterId = interview.createdById;

      // A. Check if feedback is present
      let feedbackList = [];
      try {
        feedbackList = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback;
      } catch (_) {}
      if (Array.isArray(feedbackList) && feedbackList.length > 0) {
        await cache.writeRound(interview.id, { round2EmailAlertSent: true }, 'system-scheduler', orgId, interview);
        skippedCount++;
        return;
      }

      // B. Check if offer letter already posted
      if (interview.offerLetterUrl || interview.application?.status === 'OFFER_SENT') {
        await cache.writeRound(interview.id, { round2EmailAlertSent: true }, 'system-scheduler', orgId, interview);
        skippedCount++;
        return;
      }

      // C. Get interviewers and recruiter
      let interviewerIds = [];
      try {
        interviewerIds = typeof interview.interviewerIds === 'string' ? JSON.parse(interview.interviewerIds) : interview.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];

      const notifierIds = [...new Set([...interviewerIds, recruiterId].filter(Boolean))];
      const users = notifierIds.map(id => usersMap.get(id)).filter(Boolean);

      // D. Send In-app notifications
      const notifPromises = users.map(user =>
        sendNotification({
          userId: user.id,
          title: 'Round 2 Feedback Pending',
          message: `Round 2 interview for ${candidateName} has passed (${scheduledTime}). Please submit feedback and make offer decision.`,
          link: `/interviews?highlight=${interview.id}&submitFeedback=true`,
          type: 'INFO',
        }).catch(() => null)
      );

      await Promise.all(notifPromises);

      // E. Update tracking
      await cache.writeRound(interview.id, { round2EmailAlertSent: true }, 'system-scheduler', orgId, interview);
      sentCount++;

    } catch (err) {
      console.error(`[NotificationScheduler] Error processing Round 2 alert for ${interview.id}:`, err.message);
      failedCount++;
    }
  });

  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Round 2 Alerts: ${interviews.length} found | ${sentCount} alerted | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * 3. Offer Letter Reminders
 * Trigger: 2 days after offer letter was posted/updated.
 * Action: In-app notification sent to recruiter.
 */
async function checkOfferLetterAlerts() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const applications = await prisma.application.findMany({
    where: {
      offerReminderSent: false,
      isDeleted: false,
      status: { notIn: ['JOINED', 'REJECTED'] },
      OR: [
        {
          status: 'OFFER_SENT',
          updatedAt: { lte: twoDaysAgo }
        },
        {
          interviews: {
            some: {
              roundNo: 2,
              offerLetterUrl: { not: null },
              updatedAt: { lte: twoDaysAgo }
            }
          }
        }
      ]
    },
    take: 100,
    select: {
      id: true,
      candidateId: true,
      organizationId: true,
      candidate: {
        select: {
          fullName: true,
          email: true,
          assignedRecruiterId: true,
        },
      },
      job: {
        select: {
          title: true,
          createdById: true,
        },
      },
    },
  });

  trackQueueConvergence('offerLetter', applications.length);

  if (applications.length === 0) return;

  const recruiterIds = new Set();
  for (const app of applications) {
    const recruiterId = app.candidate?.assignedRecruiterId || app.job?.createdById;
    if (recruiterId) {
      recruiterIds.add(recruiterId);
    }
  }

  const usersList = recruiterIds.size > 0 ? await prisma.user.findMany({
    where: {
      id: { in: [...recruiterIds] },
      isDeleted: false,
    },
  }) : [];
  const usersMap = new Map(usersList.map(u => [u.id, u]));

  let sentCount = 0;
  let failedCount = 0;

  const tasks = applications.map(app => async () => {
    try {
      const candidateName = app.candidate?.fullName || 'Candidate';
      const orgId = app.organizationId || 'defaultOrg';
      const recruiterId = app.candidate?.assignedRecruiterId || app.job?.createdById;
      const recruiterUser = recruiterId ? usersMap.get(recruiterId) : null;

      if (recruiterUser) {
        await sendNotification({
          userId: recruiterUser.id,
          title: 'Offer Response Pending',
          message: `Offer sent to ${candidateName} has been pending response for 2 days.`,
          link: `/candidates?status=OFFER_SENT&highlight=${app.id}`,
          type: 'INFO',
        }).catch(() => null);
      }

      await prisma.application.update({
        where: { id: app.id },
        data: { offerReminderSent: true },
      });

      await inv.application(orgId, app.candidateId);
      sentCount++;
      
    } catch (err) {
      console.error(`[NotificationScheduler] Error processing Offer Letter alert for ${app.id}:`, err.message);
      failedCount++;
    }
  });

  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Offer Letter Alerts: ${applications.length} found | ${sentCount} alerted | ${failedCount} failed`);
}

/**
 * 4. Delayed Feedback Alerts (Rounds >= 2)
 * Trigger: 2 days after scheduledStart has passed.
 * Action: In-app notification sent to all active HR Super Admins.
 */
async function checkDelayedFeedbackAlerts() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  
  // SQL-level query filtering: only fetch interviews where notes does NOT indicate alert was sent
  const interviews = await prisma.interview.findMany({
    where: {
      AND: [
        {
          OR: [
            { roundNo: { gte: 2 } },
            { roundNo: 99 }
          ]
        },
        {
          status: { in: ['SCHEDULED', 'RESCHEDULED'] }
        },
        {
          scheduledStart: {
            lte: twoDaysAgo,
          }
        },
        {
          OR: [
            { notes: null },
            { NOT: { notes: { contains: '"feedbackDelayedAlertSent":true' } } }
          ]
        }
      ]
    },
    take: 100,
    select: {
      id: true,
      roundNo: true,
      candidateName: true,
      jobTitle: true,
      scheduledStart: true,
      feedback: true,
      notes: true,
      application: {
        select: {
          candidate: {
            select: {
              fullName: true,
            },
          },
          job: {
            select: {
              title: true,
            },
          },
        },
      },
    },
  });

  trackQueueConvergence('delayedFeedback', interviews.length);

  if (interviews.length === 0) return;

  const hrAdmins = await prisma.user.findMany({
    where: {
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isDeleted: false
    },
    select: { id: true }
  });

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const interview of interviews) {
    try {
      // 1. Verify if feedback has already been submitted
      let feedbackList = [];
      try {
        feedbackList = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback;
      } catch (_) {}
      if (Array.isArray(feedbackList) && feedbackList.length > 0) {
        let notesObj = {};
        try { notesObj = JSON.parse(interview.notes || '{}'); } catch (_) {}
        notesObj.feedbackDelayedAlertSent = true;
        await prisma.interview.update({
          where: { id: interview.id },
          data: { notes: JSON.stringify(notesObj) }
        });
        skippedCount++;
        continue;
      }

      // 2. Read notes
      let notesObj = {};
      try {
        notesObj = JSON.parse(interview.notes || '{}');
      } catch (e) {}

      if (notesObj.feedbackDelayedAlertSent) {
        skippedCount++;
        continue;
      }

      const candidateName = interview.candidateName || interview.application?.candidate?.fullName || 'Candidate';
      const scheduledTime = interview.scheduledStart ? new Date(interview.scheduledStart).toLocaleString() : 'N/A';
      const roundLabel = interview.roundNo === 1 ? 'Round 1' : interview.roundNo === 2 ? 'Round 2' : 'Final Round';

      // 3. Send in-app notification to all Super Admins
      const notifPromises = hrAdmins.map(admin =>
        sendNotification({
          userId: admin.id,
          title: `Delayed Feedback Alert: ${candidateName}`,
          message: `Feedback for ${candidateName} (${roundLabel}, scheduled ${scheduledTime}) is overdue by >48 hours.`,
          link: `/interviews?highlight=${interview.id}&submitFeedback=true`,
          type: 'WARNING',
        }).catch(() => null)
      );

      await Promise.all(notifPromises);

      // 4. Mark alert sent in DB
      notesObj.feedbackDelayedAlertSent = true;
      notesObj.feedbackDelayedAlertSentAt = new Date().toISOString();
      await prisma.interview.update({
        where: { id: interview.id },
        data: { notes: JSON.stringify(notesObj) }
      });
      sentCount++;

    } catch (err) {
      console.error(`[NotificationScheduler] Error processing delayed feedback alert for ${interview.id}:`, err.message);
      failedCount++;
    }
  }

  console.log(`[NotificationScheduler] Delayed Feedback: ${interviews.length} found | ${sentCount} alerted | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * Starts the background notification scheduler daemon.
 * @param {number} [intervalMs] - Execution interval in milliseconds (default 1 minute)
 */
function startScheduler(intervalMs = 60 * 1000) {
  if (schedulerInterval) {
    return;
  }

  console.log(`[NotificationScheduler] Starting background scheduler, interval: ${intervalMs}ms`);
  
  processAlerts().catch(err => {
    console.error('[NotificationScheduler] Initial alerts execution failed:', err.message);
  });

  schedulerInterval = setInterval(() => {
    processAlerts().catch(err => {
      console.error('[NotificationScheduler] Periodic alerts execution failed:', err.message);
    });
  }, intervalMs);
}

/**
 * Stops the background notification scheduler daemon.
 */
function stopScheduler() {
  if (schedulerInterval) {
    console.log('[NotificationScheduler] Stopping background scheduler.');
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  processAlerts,
  checkDelayedFeedbackAlerts,
  checkRound1FeedbackAlerts,
  checkRound2FeedbackAlerts,
  checkOfferLetterAlerts,
};
