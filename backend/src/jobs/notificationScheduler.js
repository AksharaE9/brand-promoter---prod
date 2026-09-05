// src/jobs/notificationScheduler.js
const prisma = require('../config/db');
const cache = require('../services/schedulingCacheService');
const { sendEmail, sendSMS } = require('../services/notificationService');
const { sendNotification } = require('../utils/notifications');
const inv = require('../utils/cacheInvalidation');

const TARGET_ALERT_EMAIL = process.env.ALERT_RECIPIENT_EMAIL || 'Subramanya@aksharaenterprises.info';

let schedulerInterval = null;

// Circuit Breaker & Configuration State
const providerState = {
  emailWarned: false,
  smsWarned: false,
  emailFailures: 0,
  emailPausedUntil: 0,
  maxConsecutiveFailures: 5,
  pauseDurationMs: 5 * 60 * 1000, // 5 minutes
};

// Queue Depth & Non-Convergence Tracking
const queueMetrics = {
  round1: { lastDepth: 0, staticCycles: 0 },
  round2: { lastDepth: 0, staticCycles: 0 },
  offerLetter: { lastDepth: 0, staticCycles: 0 },
  delayedFeedback: { lastDepth: 0, staticCycles: 0 },
};

function checkEmailAvailable() {
  const hasBrevo = !!process.env.BREVO_API_KEY;
  const hasSmtp = !!(process.env.SMTP_HOST && (process.env.SMTP_USER || process.env.SMTP_PASS));
  if (!hasBrevo && !hasSmtp) {
    if (!providerState.emailWarned) {
      console.warn('[NotificationScheduler] [CONFIG] Email provider not configured (BREVO_API_KEY and SMTP missing). Email dispatches will be skipped.');
      providerState.emailWarned = true;
    }
    return false;
  }
  if (Date.now() < providerState.emailPausedUntil) {
    return false;
  }
  return true;
}

function recordEmailSuccess() {
  providerState.emailFailures = 0;
  providerState.emailPausedUntil = 0;
}

function recordEmailFailure(err) {
  providerState.emailFailures++;
  if (providerState.emailFailures >= providerState.maxConsecutiveFailures) {
    providerState.emailPausedUntil = Date.now() + providerState.pauseDurationMs;
    console.warn(`[NotificationScheduler] [CIRCUIT BREAKER OPEN] ${providerState.emailFailures} consecutive email dispatch failures. Pausing email deliveries for 5 minutes. Last error: ${err?.message || err}`);
  }
}

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
  console.log('[NotificationScheduler] Running periodic check at', new Date().toISOString());
  try {
    await checkRound1FeedbackAlerts();
    await checkRound2FeedbackAlerts();
    await checkOfferLetterAlerts();
    await checkDelayedFeedbackAlerts();
  } catch (error) {
    console.error('[NotificationScheduler] Error during processing:', error);
  }
}

/**
 * 1. Round 1 Feedback Alerts
 * Trigger: 1 hour after scheduledStart has passed.
 * Condition: roundNo = 1, status = SCHEDULED/RESCHEDULED, round1SMSAlertSent = false, feedback is empty, and Round 2 is NOT scheduled.
 */
async function checkRound1FeedbackAlerts() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  // Find candidates scheduled for round 1 in the past who have not had an alert sent
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

  // Optimization 1: Batch fetch all Round 2 interviews matching our applicationIds to avoid N+1 queries
  const appIds = [...new Set(interviews.map(i => i.applicationId).filter(Boolean))];
  const round2Interviews = appIds.length > 0 ? await prisma.interview.findMany({
    where: {
      applicationId: { in: appIds },
      roundNo: 2,
    },
    select: { applicationId: true }
  }) : [];
  const round2AppIds = new Set(round2Interviews.map(i => i.applicationId));

  // Optimization 2: Batch fetch all users to notify across all interviews to avoid N+1 queries
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

  // Map interviews to concurrent dispatch tasks
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

      // B. Check if feedback is actually present
      let feedbackList = [];
      try {
        feedbackList = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback;
      } catch (_) {}
      if (Array.isArray(feedbackList) && feedbackList.length > 0) {
        await cache.writeRound(interview.id, { round1SMSAlertSent: true }, 'system-scheduler', orgId, interview);
        skippedCount++;
        return;
      }

      // C. Get interviewers and recruiter from our pre-fetched map
      let interviewerIds = [];
      try {
        interviewerIds = typeof interview.interviewerIds === 'string' ? JSON.parse(interview.interviewerIds) : interview.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];

      const notifierIds = [...new Set([...interviewerIds, recruiterId].filter(Boolean))];
      const users = notifierIds.map(id => usersMap.get(id)).filter(Boolean);

      const messageContent = `Interviewer missed feedback submission for ${candidateName} (Round 1 scheduled at ${scheduledTime}). The feedback form was missed and Round 2 was not scheduled.`;

      // D. Send SMS / Emails concurrently for this specific interview
      const dispatchPromises = users.map(async (user) => {
        let smsSent = false;
        
        if (user.phone && process.env.BREVO_API_KEY) {
          try {
            const smsResult = await sendSMS({
              recipient: user.phone,
              content: messageContent,
            });
            smsSent = smsResult.success;
          } catch (smsErr) {
            console.error(`[NotificationScheduler] SMS dispatch failed for user ${user.id}:`, smsErr.message);
          }
        }

        // Send Email if SMS was not sent or failed
        if (!smsSent && checkEmailAvailable()) {
          try {
            const emailSubject = `[Urgent Reminder] Missed Round 1 Feedback: ${candidateName}`;
            const emailHtml = `
              <h2>Missed Round 1 Interview Feedback</h2>
              <p>Hello ${user.fullName},</p>
              <p>Feedback has not been submitted for the Round 1 interview of <strong>${candidateName}</strong> scheduled at <strong>${scheduledTime}</strong>.</p>
              <p><strong>Status:</strong> Feedback form was missed and Round 2 has not been scheduled yet.</p>
              <p>Please log in to the ATS portal to submit your feedback or schedule the next round.</p>
              <hr />
              <p><i>Note: This notification was delivered via email because SMS delivery was bypassed or credits are depleted.</i></p>
              <p style="color: #888; font-size: 11px; margin-top: 20px;">[Original Recipient: ${user.fullName} (${user.email || 'N/A'})]</p>
            `;
            const emailRes = await sendEmail({
              to: TARGET_ALERT_EMAIL,
              subject: emailSubject,
              html: emailHtml,
            });
            if (emailRes.success) {
              recordEmailSuccess();
            } else {
              recordEmailFailure(emailRes.error);
            }
          } catch (emailErr) {
            recordEmailFailure(emailErr);
            console.error(`[NotificationScheduler] Email dispatch failed for user ${user.id}:`, emailErr.message);
          }
        }

        // E. Send in-app notification and trigger SSE broadcast
        try {
          await sendNotification({
            userId: user.id,
            title: 'Missed Round 1 Feedback',
            message: `Feedback is pending for ${candidateName} (Round 1, scheduled ${scheduledTime}). Round 2 is unscheduled.`,
            link: `/interviews?highlight=${interview.id}&submitFeedback=true`,
            type: 'WARNING',
          });
        } catch (notifErr) {
          console.error(`[NotificationScheduler] Notification dispatch failed for user ${user.id}:`, notifErr.message);
        }
      });

      await Promise.all(dispatchPromises);

      // F. Mark alert as sent
      await cache.writeRound(interview.id, { round1SMSAlertSent: true }, 'system-scheduler', orgId, interview);
      sentCount++;

    } catch (err) {
      console.error(`[NotificationScheduler] Failed processing Round 1 alert for Interview ${interview.id}:`, err);
      failedCount++;
    }
  });

  // Execute tasks concurrently with a limit of 5
  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Round 1 Alerts: ${interviews.length} pending | ${sentCount} sent | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * 2. Round 2 Feedback Alerts
 * Trigger: After scheduledStart has passed.
 * Condition: roundNo = 2, status = SCHEDULED/RESCHEDULED, round2EmailAlertSent = false, feedback is empty, and offerLetterUrl is empty/null.
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

  // Optimization: Batch fetch all users to notify across all interviews to avoid N+1 queries
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

  // Map interviews to concurrent dispatch tasks
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

      // C. Get interviewers and recruiter from our pre-fetched map
      let interviewerIds = [];
      try {
        interviewerIds = typeof interview.interviewerIds === 'string' ? JSON.parse(interview.interviewerIds) : interview.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];

      const notifierIds = [...new Set([...interviewerIds, recruiterId].filter(Boolean))];
      const users = notifierIds.map(id => usersMap.get(id)).filter(Boolean);

      const frontendBaseUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
      const feedbackUrl = frontendBaseUrl
        ? `${frontendBaseUrl}/interviews?highlight=${interview.id}&submitFeedback=true`
        : `/interviews?highlight=${interview.id}&submitFeedback=true`;

      // D. Send Emails and In-app notifications concurrently
      const dispatchPromises = users.map(async (user) => {
        if (checkEmailAvailable()) {
          try {
            const emailSubject = `[Reminder] Submit Round 2 Feedback: ${candidateName}`;
            const emailHtml = `
              <h2>Round 2 Interview Feedback Required</h2>
              <p>Hello ${user.fullName},</p>
              <p>The Round 2 interview for <strong>${candidateName}</strong> scheduled at <strong>${scheduledTime}</strong> has passed, but feedback has not been submitted.</p>
              <p>Please log in to the ATS portal to submit your interview assessment and select the offer decision.</p>
              <p><a href="${feedbackUrl}" style="padding: 10px 20px; background-color: #1f52cc; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">Submit Feedback Now</a></p>
              <p style="color: #888; font-size: 11px; margin-top: 20px;">[Original Recipient: ${user.fullName} (${user.email || 'N/A'})]</p>
            `;

            const emailRes = await sendEmail({
              to: TARGET_ALERT_EMAIL,
              subject: emailSubject,
              html: emailHtml,
            });
            if (emailRes.success) {
              recordEmailSuccess();
            } else {
              recordEmailFailure(emailRes.error);
            }
          } catch (emailErr) {
            recordEmailFailure(emailErr);
            console.error(`[NotificationScheduler] Round 2 email dispatch failed for user ${user.id}:`, emailErr.message);
          }
        }

        try {
          await sendNotification({
            userId: user.id,
            title: 'Round 2 Feedback Pending',
            message: `Round 2 interview for ${candidateName} has passed. Please submit feedback and make offer decision.`,
            link: `/interviews?highlight=${interview.id}&submitFeedback=true`,
            type: 'INFO',
          });
        } catch (notifErr) {
          console.error(`[NotificationScheduler] Round 2 notification dispatch failed for user ${user.id}:`, notifErr.message);
        }
      });

      await Promise.all(dispatchPromises);

      // E. Update tracking
      await cache.writeRound(interview.id, { round2EmailAlertSent: true }, 'system-scheduler', orgId, interview);
      sentCount++;

    } catch (err) {
      console.error(`[NotificationScheduler] Failed processing Round 2 alert for Interview ${interview.id}:`, err);
      failedCount++;
    }
  });

  // Execute tasks concurrently with a limit of 5
  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Round 2 Alerts: ${interviews.length} pending | ${sentCount} sent | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * 3. Offer Letter Reminders
 * Trigger: 2 days after offer letter was posted/updated.
 * Condition: application.status = OFFER_SENT, application.offerReminderSent = false, and 2 days elapsed since updatedAt.
 */
async function checkOfferLetterAlerts() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  // Find applications where the offer was posted (via status or Round 2 interview) at least 2 days ago without a reminder sent
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

  // Optimization: Batch fetch recruiters for these applications to avoid N+1 queries
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

  // Map applications to concurrent dispatch tasks
  const tasks = applications.map(app => async () => {
    try {
      const candidateName = app.candidate?.fullName || 'Candidate';
      const candidateEmail = app.candidate?.email;
      const jobTitle = app.job?.title || 'the job';
      const orgId = app.organizationId || 'defaultOrg';
      
      const recruiterId = app.candidate?.assignedRecruiterId || app.job?.createdById;
      const recruiterUser = recruiterId ? usersMap.get(recruiterId) : null;

      const dispatchPromises = [];

      // A. Send email reminder to candidate
      if (candidateEmail && candidateEmail !== 'N/A' && checkEmailAvailable()) {
        dispatchPromises.push((async () => {
          try {
            const candidateSubject = `Reminder: Offer Letter for ${jobTitle} - ATS Portal`;
            const candidateHtml = `
              <h2>Your Offer Letter is Pending Response</h2>
              <p>Hello ${candidateName},</p>
              <p>We sent you an offer letter for the position of <strong>${jobTitle}</strong> two days ago.</p>
              <p>We are excited about the prospect of you joining our team. Please review the offer letter and submit your response as soon as possible.</p>
              <p>If you have any questions, feel free to reply directly to this email.</p>
              <br/>
              <p>Best regards,<br/>Hiring Team</p>
              <p style="color: #888; font-size: 11px; margin-top: 20px;">[Original Recipient: Candidate ${candidateName} (${candidateEmail})]</p>
            `;

            const emailRes = await sendEmail({
              to: TARGET_ALERT_EMAIL,
              subject: candidateSubject,
              html: candidateHtml,
            });
            if (emailRes.success) {
              recordEmailSuccess();
            } else {
              recordEmailFailure(emailRes.error);
            }
          } catch (emailErr) {
            recordEmailFailure(emailErr);
            console.error(`[NotificationScheduler] Offer letter email to candidate failed for app ${app.id}:`, emailErr.message);
          }
        })());
      }

      // B. Send email reminder to recruiter
      if (recruiterUser && checkEmailAvailable()) {
        dispatchPromises.push((async () => {
          try {
            const recruiterSubject = `[Follow-up] Offer Response Pending: ${candidateName}`;
            const recruiterHtml = `
              <h2>Offer Decision Pending Response</h2>
              <p>Hello ${recruiterUser.fullName},</p>
              <p>The offer letter sent to <strong>${candidateName}</strong> for the <strong>${jobTitle}</strong> role has been pending response for 2 days.</p>
              <p>Please reach out to the candidate to collect their decision and update their status in the ATS portal.</p>
              <p style="color: #888; font-size: 11px; margin-top: 20px;">[Original Recipient: Recruiter ${recruiterUser.fullName} (${recruiterUser.email || 'N/A'})]</p>
            `;

            const emailRes = await sendEmail({
              to: TARGET_ALERT_EMAIL,
              subject: recruiterSubject,
              html: recruiterHtml,
            });
            if (emailRes.success) {
              recordEmailSuccess();
            } else {
              recordEmailFailure(emailRes.error);
            }
          } catch (emailErr) {
            recordEmailFailure(emailErr);
            console.error(`[NotificationScheduler] Offer letter email to recruiter failed for app ${app.id}:`, emailErr.message);
          }
        })());

        // C. Send in-app notification and SSE
        dispatchPromises.push((async () => {
          try {
            await sendNotification({
              userId: recruiterUser.id,
              title: 'Offer Response Pending',
              message: `Offer sent to ${candidateName} has been pending response for 2 days.`,
              link: `/candidates?status=OFFER_SENT&highlight=${app.id}`,
              type: 'INFO',
            });
          } catch (notifErr) {
            console.error(`[NotificationScheduler] Offer letter notification failed for app ${app.id}:`, notifErr.message);
          }
        })());
      }

      await Promise.all(dispatchPromises);

      // D. Update tracking flag in database and invalidate cache
      await prisma.application.update({
        where: { id: app.id },
        data: { offerReminderSent: true },
      });

      await inv.application(orgId, app.candidateId);
      sentCount++;
      
    } catch (err) {
      console.error(`[NotificationScheduler] Failed processing Offer Letter alert for Application ${app.id}:`, err);
      failedCount++;
    }
  });

  // Execute tasks concurrently with a limit of 5
  await limitConcurrency(tasks, 5);
  console.log(`[NotificationScheduler] Offer Letter Alerts: ${applications.length} pending | ${sentCount} processed | ${failedCount} failed`);
}

/**
 * 4. Delayed Feedback Alerts (Rounds >= 2)
 * Trigger: 2 days after scheduledStart has passed.
 * Condition: roundNo >= 2 or roundNo === 99, status = SCHEDULED/RESCHEDULED, feedback is empty.
 * Action: SMTP email sent to Subramanya (TARGET_ALERT_EMAIL) and all HR Admin users.
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

  // Find all active super admins
  const hrAdmins = await prisma.user.findMany({
    where: {
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isDeleted: false
    },
    select: { email: true, fullName: true }
  });

  const adminEmails = hrAdmins.map(u => u.email).filter(Boolean);
  const recipients = [...new Set([...adminEmails, TARGET_ALERT_EMAIL])].filter(Boolean);

  const isEmailActive = checkEmailAvailable();

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
        // Mark as alerted so it leaves the pending queue
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

      // 2. Read notes to check attempts and backoff
      let notesObj = {};
      try {
        notesObj = JSON.parse(interview.notes || '{}');
      } catch (e) {}

      if (notesObj.feedbackDelayedAlertSent) {
        skippedCount++;
        continue;
      }

      // Check retry backoff (exponential: 2m, 4m, 8m... up to 30m)
      const currentAttempts = (notesObj.delayedAlertAttempts || 0);
      if (notesObj.lastAttemptAt && currentAttempts > 0) {
        const backoffMs = Math.min(30 * 60 * 1000, Math.pow(2, currentAttempts) * 60 * 1000);
        const nextAllowedTime = new Date(notesObj.lastAttemptAt).getTime() + backoffMs;
        if (Date.now() < nextAllowedTime) {
          skippedCount++;
          continue;
        }
      }

      const nextAttempt = currentAttempts + 1;
      notesObj.delayedAlertAttempts = nextAttempt;
      notesObj.lastAttemptAt = new Date().toISOString();

      if (!isEmailActive || recipients.length === 0) {
        // Email provider unavailable or no recipients
        if (nextAttempt >= 3) {
          // Dead-letter: mark as failed and remove from pending queue
          notesObj.feedbackDelayedAlertSent = true;
          notesObj.alertFailed = true;
          notesObj.alertFailureReason = !isEmailActive 
            ? 'Email provider unconfigured or circuit breaker paused' 
            : 'No valid recipient email addresses found';
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notes: JSON.stringify(notesObj) }
          });
          failedCount++;
        } else {
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notes: JSON.stringify(notesObj) }
          });
          skippedCount++;
        }
        continue;
      }

      const candidateName = interview.candidateName || interview.application?.candidate?.fullName || 'Candidate';
      const jobTitle = interview.jobTitle || interview.application?.job?.title || 'Applied Position';
      const scheduledTime = interview.scheduledStart ? new Date(interview.scheduledStart).toLocaleString() : 'N/A';
      const roundLabel = interview.roundNo === 1 ? 'Round 1' : interview.roundNo === 2 ? 'Round 2' : 'Final Round';

      // 3. Send email to HR Admin & Subramanya
      const emailSubject = `[URGENT Alert] Missed Interview Feedback (>2 Days): ${candidateName}`;
      const emailHtml = `
        <h2>Delayed Interview Assessment Alert</h2>
        <p>Dear Admin & Subramanya,</p>
        <p>This is an automated system alert. The interview feedback form for <strong>${candidateName}</strong> has not been submitted for more than <strong>two days</strong> after the scheduled interview time.</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; border-color: #e2e8f0; width: 100%; max-width: 500px;">
          <tr style="background-color: #f8fafc;">
            <td><strong>Candidate</strong></td>
            <td>${candidateName}</td>
          </tr>
          <tr>
            <td><strong>Job Role</strong></td>
            <td>${jobTitle}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td><strong>Round</strong></td>
            <td>${roundLabel}</td>
          </tr>
          <tr>
            <td><strong>Scheduled Time</strong></td>
            <td>${scheduledTime}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td><strong>Status</strong></td>
            <td style="color: #cf3a3a; font-weight: bold;">Feedback Pending > 48 Hours</td>
          </tr>
        </table>
        <p>Please log in to the ATS portal to coordinate feedback submission immediately.</p>
        <p>Best regards,<br/>ATS Alert Daemon</p>
      `;

      let sendSuccess = false;
      let lastSendErr = null;

      for (const email of recipients) {
        try {
          const res = await sendEmail({
            to: email,
            subject: emailSubject,
            html: emailHtml
          });
          if (res && res.success) {
            sendSuccess = true;
          } else {
            lastSendErr = res?.error || 'Email dispatch failed';
          }
        } catch (emailErr) {
          lastSendErr = emailErr.message;
        }
      }

      if (sendSuccess) {
        recordEmailSuccess();
        notesObj.feedbackDelayedAlertSent = true;
        notesObj.feedbackDelayedAlertSentAt = new Date().toISOString();
        delete notesObj.alertFailed;
        delete notesObj.alertFailureReason;
        await prisma.interview.update({
          where: { id: interview.id },
          data: { notes: JSON.stringify(notesObj) }
        });
        sentCount++;
      } else {
        recordEmailFailure(lastSendErr);
        if (nextAttempt >= 3) {
          notesObj.feedbackDelayedAlertSent = true;
          notesObj.alertFailed = true;
          notesObj.alertFailureReason = typeof lastSendErr === 'string' ? lastSendErr : JSON.stringify(lastSendErr);
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notes: JSON.stringify(notesObj) }
          });
          failedCount++;
        } else {
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notes: JSON.stringify(notesObj) }
          });
          skippedCount++;
        }
      }

    } catch (err) {
      console.error(`[NotificationScheduler] Error processing delayed feedback alert for interview ${interview.id}:`, err);
      failedCount++;
    }
  }

  console.log(`[NotificationScheduler] Delayed Feedback: ${interviews.length} found | ${sentCount} sent | ${failedCount} failed | ${skippedCount} skipped`);
}

/**
 * Starts the background notification scheduler daemon.
 * @param {number} [intervalMs] - Execution interval in milliseconds (default 1 minute)
 */
function startScheduler(intervalMs = 60 * 1000) {
  if (schedulerInterval) {
    console.log('[NotificationScheduler] Scheduler is already running.');
    return;
  }

  console.log(`[NotificationScheduler] Starting background scheduler, interval: ${intervalMs}ms`);
  
  // Run immediately on start
  processAlerts().catch(err => {
    console.error('[NotificationScheduler] Initial alerts execution failed:', err);
  });

  schedulerInterval = setInterval(() => {
    processAlerts().catch(err => {
      console.error('[NotificationScheduler] Periodic alerts execution failed:', err);
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
  processAlerts, // For testing and manual triggering
  checkDelayedFeedbackAlerts,
  checkRound1FeedbackAlerts,
  checkRound2FeedbackAlerts,
  checkOfferLetterAlerts,
};
