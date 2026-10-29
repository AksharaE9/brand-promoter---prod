'use strict';

const MIN_SCHEDULING_YEAR = 2020;
const MAX_SCHEDULING_YEAR = 2035;
const MIN_SCHEDULING_DATE = '2020-01-01';
const MAX_SCHEDULING_DATE = '2035-12-31';

/**
 * Validates a scheduled date/time against typo-protection sanity bounds (2020-2035).
 * Allows all past and future dates freely within this wide window.
 * Rejects unparseable dates and impossible dates (e.g., Feb 31).
 *
 * @param {string|Date|number} raw - The raw date or date-time string/object.
 * @returns {{ valid: boolean, error?: string, date?: Date, isPast?: boolean, isoString?: string }}
 */
function validateSchedulingDate(raw) {
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

const JOINING_PLACEHOLDERS = new Set([
  '-', '--', 'na', 'n/a', 'none', 'null', 'nil',
  'immediate', 'immediately', 'immediate joining',
  'october', 'november', 'december',
  'within a week or two', 'for next week', '1st week of november',
  'after 11th november'
]);

/**
 * Validates and normalizes candidate joining dates.
 * Rejects survey placeholders ('-', 'Immediate', 'NA') to null.
 * Returns clean ISO 'YYYY-MM-DD' calendar date string or null.
 */
function parseJoiningDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString().split('T')[0];
  }
  const str = String(raw).trim();
  const lower = str.toLowerCase();
  if (JOINING_PLACEHOLDERS.has(lower)) return null;

  // 1. Direct YYYY-MM-DD or leading ISO calendar date (no timezone shift)
  const isoMatch = str.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. DD-MM-YYYY (with -, /, ., or space)
  const dmyMatch = str.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 3. Excel serial numbers (number or 5-digit string, e.g. 40000-50000)
  if (typeof raw === 'number' || /^\d{5}$/.test(str)) {
    const serial = Number(raw);
    if (serial >= 40000 && serial <= 50000) {
      const utcMs = (serial - 25569) * 86400000;
      return new Date(utcMs).toISOString().split('T')[0];
    }
  }

  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' };

  // 4. 'November 1' or 'Nov 1' or 'Nov 1st'
  const monthFirstMatch = str.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (monthFirstMatch) {
    const mStr = monthFirstMatch[1].toLowerCase();
    const day = parseInt(monthFirstMatch[2], 10);
    const mm = months[mStr];
    if (mm && day >= 1 && day <= 31) {
      return `2026-${mm}-${String(day).padStart(2, '0')}`;
    }
  }

  // 5. '5th Oct', '28th Sept'
  const ordinalMatch = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i);
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1], 10);
    const mStr = ordinalMatch[2].toLowerCase();
    const mm = months[mStr];
    if (mm && day >= 1 && day <= 31) {
      return `2026-${mm}-${String(day).padStart(2, '0')}`;
    }
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    if (year >= 2024 && year <= 2030) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

module.exports = {
  MIN_SCHEDULING_YEAR,
  MAX_SCHEDULING_YEAR,
  MIN_SCHEDULING_DATE,
  MAX_SCHEDULING_DATE,
  validateSchedulingDate,
  parseJoiningDate,
};
