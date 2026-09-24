/**
 * Shared frontend date validation and sanity bounds for interview scheduling.
 * Typo-protection window: 2020-01-01 to 2035-12-31.
 * Allows unrestricted past and future scheduling within this window.
 */

export const MIN_SCHEDULING_YEAR = 2020;
export const MAX_SCHEDULING_YEAR = 2035;
export const MIN_SCHEDULING_DATE = '2020-01-01';
export const MAX_SCHEDULING_DATE = '2035-12-31';

/**
 * Validates a scheduled date/time against typo-protection sanity bounds (2020-2035).
 * Allows all past and future dates freely within this wide window.
 *
 * @param {string|Date|number} raw - The raw date or date-time string/object.
 * @returns {{ valid: boolean, error?: string, date?: Date, isPast?: boolean, isoString?: string }}
 */
export function validateSchedulingDate(raw) {
  if (!raw) {
    return { valid: false, error: 'Scheduled date/time is required' };
  }

  let d;
  if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { valid: false, error: 'Scheduled date/time is required' };
    }

    // Check for impossible dates in YYYY-MM-DD or DD-MM-YYYY format
    const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);

    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10);
      const day = parseInt(isoMatch[3], 10);
      if (month < 1 || month > 12) {
        return { valid: false, error: `Invalid month (${month}) in date "${trimmed}"` };
      }
      const daysInMonth = new Date(year, month, 0).getDate();
      if (day < 1 || day > daysInMonth) {
        return { valid: false, error: `Invalid day (${day}) for month ${month} in date "${trimmed}"` };
      }
    } else if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10);
      const year = parseInt(dmyMatch[3], 10);
      if (month >= 1 && month <= 12) {
        const daysInMonth = new Date(year, month, 0).getDate();
        if (day < 1 || day > daysInMonth) {
          return { valid: false, error: `Invalid day (${day}) for month ${month} in date "${trimmed}"` };
        }
      }
    }

    d = new Date(trimmed);
  } else if (typeof raw === 'number') {
    d = new Date(raw);
  } else {
    return { valid: false, error: 'Invalid scheduled date/time input' };
  }

  if (isNaN(d.getTime())) {
    return { valid: false, error: `Invalid scheduled date/time format "${raw}"` };
  }

  const year = d.getFullYear();
  if (year < MIN_SCHEDULING_YEAR || year > MAX_SCHEDULING_YEAR) {
    return {
      valid: false,
      error: `Scheduled date year (${year}) must be between ${MIN_SCHEDULING_YEAR} and ${MAX_SCHEDULING_YEAR}`,
    };
  }

  const isPast = d.getTime() < Date.now();

  return {
    valid: true,
    date: d,
    isPast,
    isoString: d.toISOString(),
  };
}
