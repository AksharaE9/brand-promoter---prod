/**
 * interviewUtils.js
 *
 * Shared pure utility functions for the Interviews module.
 * Extracted here so both InterviewSchedule.jsx and ExcelView.jsx can import
 * from one source of truth — avoids duplicate inline definitions.
 */

/**
 * parseNotesSafely — parses the interview `notes` JSON field.
 *
 * The `notes` column stores an encoded JSON object:
 *   { phoneFollowUp: { name, data }, emailFollowUp: { name, data } }
 *
 * If the field is null, empty, or malformed, returns safe defaults.
 *
 * @param {string | null} notesStr
 * @returns {{ phoneFollowUp: object|null, emailFollowUp: object|null }}
 */
export function parseNotesSafely(notesStr) {
  if (!notesStr) return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null, morningFollowUp: null };
  try {
    const parsed = JSON.parse(notesStr);
    if (parsed && typeof parsed === 'object') {
      return {
        phoneFollowUp:  parsed.phoneFollowUp  || null,
        emailFollowUp:  parsed.emailFollowUp  || null,
        nextSchedule:   parsed.nextSchedule   || null,
        morningFollowUp: parsed.morningFollowUp || null,
      };
    }
  } catch (_) { /* ignore */ }
  return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null, morningFollowUp: null };
}

/**
 * getFirstFeedback — safely extracts the first feedback entry from an interview.
 *
 * Backend stores feedback as a JSON array (string in DB, parsed array in API response).
 * The array may be empty or malformed on older records.
 *
 * Feedback entry shape (from /interviews/:id/feedback route):
 * {
 *   id, submittedBy (userId string OR populated user object), submittedAt,
 *   ratings: { technical, communication, culture },
 *   recommendation, strengths,
 *   concerns,   ← overallComments was mapped to 'notes', weaknesses → 'concerns'
 *   notes,      ← overallComments
 * }
 *
 * @param {object} iv - A single interview record
 * @returns {object|null}
 */
export function getFirstFeedback(iv) {
  const raw = iv?.feedback;
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? (arr[0] || null) : null;
  } catch {
    return null;
  }
}

/**
 * getStatusLabel — returns the human-readable label for an interview result value.
 * Matches the List View's status pill display.
 *
 * NOTE: `result` (outcome) is the displayed "status" in the UI, not `status` (workflow state).
 *
 * @param {string|null} result - The interview `result` field
 * @returns {string}
 */
export function getStatusLabel(result) {
  const labels = {
    PASS:         'PASS',
    SELECTED:     'SELECTED',
    FAIL:         'FAIL',
    REJECTED:     'REJECTED',
    ON_HOLD:      'ON HOLD',
    OFFER_LETTER: 'OFFER LETTER',
    DIDNT_JOIN:   "DIDN'T JOIN",
  };
  return labels[result] || result || 'PENDING';
}
