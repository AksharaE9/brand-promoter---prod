'use strict';

/**
 * Scheduling Audit Logger
 * Structured audit logging for all scheduling write operations.
 * Uses the existing audit system to log who/what/when/old/new.
 */
const { logAudit } = require('./audit');

const ACTIONS = {
  CREATE: 'SCHEDULING_ROUND_CREATED',
  UPDATE: 'SCHEDULING_ROUND_UPDATED',
  DELETE: 'SCHEDULING_ROUND_DELETED',
  RESCHEDULE: 'SCHEDULING_ROUND_RESCHEDULED',
  STATUS_CHANGE: 'SCHEDULING_STATUS_CHANGED',
  PANEL_CHANGE: 'SCHEDULING_PANEL_CHANGED',
  FEEDBACK: 'SCHEDULING_FEEDBACK_SUBMITTED',
  TRANSFER: 'SCHEDULING_CANDIDATE_TRANSFERRED',
  SYNC: 'SCHEDULING_FIREBASE_SYNCED',
};

/**
 * Log a scheduling audit event
 * @param {Object} params
 * @param {string} params.action - One of ACTIONS values
 * @param {string} params.performedBy - User ID who performed the action
 * @param {string} params.orgId - Organization ID
 * @param {string} params.roundId - Interview round ID
 * @param {Object} [params.before] - State before the change
 * @param {Object} [params.after] - State after the change
 * @param {Object} [params.metadata] - Additional context
 */
async function logSchedulingAudit({
  action,
  performedBy,
  orgId,
  roundId,
  before = null,
  after = null,
  metadata = {},
}) {
  try {
    await logAudit({
      action,
      performedBy,
      organizationId: orgId,
      resourceType: 'interview_round',
      resourceId: roundId,
      details: {
        ...(before ? { before: summarizeRound(before) } : {}),
        ...(after ? { after: summarizeRound(after) } : {}),
        ...metadata,
      },
    });
  } catch (err) {
    // Audit logging should never crash the main operation
    console.error('[SchedulingAudit] Failed to log:', err.message);
  }
}

/**
 * Summarize a round object for audit (strip large/internal fields)
 */
function summarizeRound(round) {
  if (!round) return null;
  return {
    id: round.id,
    status: round.status,
    applicationId: round.applicationId,
    interviewerIds: round.interviewerIds,
    scheduledStart: round.scheduledStart,
    scheduledEnd: round.scheduledEnd,
    meetingLink: round.meetingLink,
    roundType: round.roundType,
    roundNumber: round.roundNumber,
  };
}

module.exports = {
  ACTIONS,
  logSchedulingAudit,
};
