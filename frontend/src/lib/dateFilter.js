/** Date-range helpers for candidate pool filters. */

export const DATE_FILTER_PRESETS = [
  { value: 'All', label: 'All Dates' },
  { value: 'Today', label: 'Today' },
  { value: 'ThisWeek', label: 'This Week' },
  { value: 'ThisMonth', label: 'This Month' },
  { value: 'LastMonth', label: 'Last Month' },
  { value: 'Custom', label: 'Custom Range' },
];

/** Parse ISO / Date / common string dates into a local Date at midnight, or null. */
export function parseFilterDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value).trim();
  if (!raw || /^#+$/.test(raw)) return null;

  // yyyy-MM-dd or ISO
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // dd-MM-yyyy or dd/MM/yyyy
  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) {
      const tmp = day;
      day = month;
      month = tmp;
    }
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return d;
    }
  }

  const native = new Date(raw);
  if (isNaN(native.getTime())) return null;
  return new Date(native.getFullYear(), native.getMonth(), native.getDate());
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Resolve preset / custom inputs into an inclusive { start, end } range, or null for All. */
export function resolveDateFilterRange(preset, customFrom = '', customTo = '') {
  if (!preset || preset === 'All') return null;

  const now = new Date();
  const today = startOfDay(now);

  if (preset === 'Today') {
    return { start: today, end: endOfDay(today) };
  }

  if (preset === 'ThisWeek') {
    const day = today.getDay(); // 0 Sun
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(today);
    start.setDate(today.getDate() + mondayOffset);
    return { start: startOfDay(start), end: endOfDay(today) };
  }

  if (preset === 'ThisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (preset === 'LastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (preset === 'Custom') {
    const start = parseFilterDate(customFrom);
    const end = parseFilterDate(customTo);
    if (!start && !end) return null;
    return {
      start: start ? startOfDay(start) : new Date(1970, 0, 1),
      end: end ? endOfDay(end) : endOfDay(today),
    };
  }

  return null;
}

/**
 * Pick the tab-relevant date for a candidate card.
 * - JOINED → date of joining
 * - OFFER_SENT / REJECTED → selection / decision / status update time
 * - Pool / others → created date
 */
export function getCandidateFilterDate(candidate, statusFilter) {
  if (statusFilter === 'JOINED') {
    return parseFilterDate(
      candidate.joiningDate || candidate.dateOfJoining || candidate.doj
    );
  }
  if (statusFilter === 'OFFER_SENT' || statusFilter === 'REJECTED') {
    return parseFilterDate(
      candidate.offerDecidedAt || candidate.appUpdatedAt || candidate.updatedAt || candidate.createdAt
    );
  }
  return parseFilterDate(candidate.createdAt || candidate.updatedAt);
}

export function matchesDateFilter(candidate, statusFilter, preset, customFrom, customTo) {
  const range = resolveDateFilterRange(preset, customFrom, customTo);
  if (!range) return true;

  const value = getCandidateFilterDate(candidate, statusFilter);
  if (!value) return false;
  return value >= range.start && value <= range.end;
}

/** Short label shown under the date filter for the active tab. */
export function dateFilterHint(statusFilter) {
  if (statusFilter === 'JOINED') return 'by date of joining';
  if (statusFilter === 'OFFER_SENT') return 'by selection / offer date';
  if (statusFilter === 'REJECTED') return 'by rejection date';
  return 'by created date';
}
