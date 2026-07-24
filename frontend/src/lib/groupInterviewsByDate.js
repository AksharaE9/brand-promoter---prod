/**
 * groupInterviewsByDate
 *
 * A single source-of-truth utility for bucketing interviews into calendar cells.
 *
 * KEY DESIGN DECISIONS:
 * - Uses local Date methods (getFullYear/getMonth/getDate) NOT UTC methods.
 *   This is intentional: if the server stores timestamps as UTC ISO strings
 *   (e.g. "2026-07-16T07:00:00Z") and the org is in IST (UTC+5:30), calling
 *   .toDateString() or .getUTCDate() would bucket the interview on the wrong day.
 *   By using local Date methods, we let the browser's timezone (IST) normalise
 *   the timestamp correctly before comparison.
 * - Returns Map<'YYYY-MM-DD', interview[]> — both the chip renderer and the
 *   count badge consume this exact map, eliminating the divergence bug.
 * - The `viewDate` param restricts output to the currently displayed month
 *   so the map stays small.
 *
 * @param {Array} interviews - The already-filtered interviews array (post filterMine + roundFilter)
 * @param {Date}  viewDate   - Any date within the month currently displayed in the calendar
 * @returns {Map<string, Array>} Map keyed by 'YYYY-MM-DD', value is array of interview records
 */
export function groupInterviewsByDate(interviews, viewDate) {
  const map = new Map();
  if (!Array.isArray(interviews) || !viewDate) return map;

  interviews.forEach((iv) => {
    if (!iv?.scheduledStart) return;
    if (iv._optimistic) return; // skip optimistic inserts that haven't persisted yet

    const d = new Date(iv.scheduledStart);
    const key = toDateKey(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(iv);
  });

  // Sort each day's list by scheduledStart ascending (earliest first)
  map.forEach((list) => {
    list.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
  });

  return map;
}

/**
 * toDateKey — converts a Date object to a 'YYYY-MM-DD' string using LOCAL timezone.
 * Call this for BOTH the interview date AND the calendar cell date so the comparison
 * is always apples-to-apples (same timezone, same format).
 *
 * @param {Date} date
 * @returns {string} e.g. '2026-07-16'
 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

import { formatTime24h, formatDateTime24h } from './datetime';

export { formatTime24h, formatDateTime24h };

/**
 * formatTime12h — legacy alias pointing to formatTime24h for 24-hour time format consistency.
 * @param {Date|string} date
 * @returns {string} e.g. "09:40"
 */
export function formatTime12h(date) {
  return formatTime24h(date);
}


/**
 * getStatusStyle — returns Tailwind class strings for an interview's result/status.
 * Matches the status vocabulary already used in List View (REJECTED, PASS, etc.)
 *
 * @param {string} result - The interview `result` field value
 * @returns {{ bg: string, text: string, dot: string }}
 */
export function getStatusStyle(result) {
  switch (result) {
    case 'PASS':
    case 'SELECTED':
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };
    case 'FAIL':
    case 'REJECTED':
      return { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' };
    case 'ON_HOLD':
      return { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' };
    case 'OFFER_LETTER':
      return { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' };
    case 'DIDNT_JOIN':
      return { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
    default:
      // PENDING / SCHEDULED / null
      return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
  }
}

/**
 * getCandidateInitials — extracts up to 2 initials from a full name.
 *
 * @param {string} fullName
 * @returns {string} e.g. 'SK' for 'Shivaraj Khot'
 */
export function getCandidateInitials(fullName) {
  if (!fullName) return '?';
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');
}
