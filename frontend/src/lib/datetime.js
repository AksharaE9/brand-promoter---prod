/**
 * Single source of truth for 24-hour date/time formatting across the ATS platform.
 */

export function getOrgTimeZone() {
  try {
    const orgSettings = JSON.parse(localStorage.getItem('orgSettings') || '{}');
    return orgSettings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (_) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/**
 * Formats an ISO string or Date into 24-hour time format (e.g. "09:40" or "14:15").
 * @param {string|Date|number} isoString 
 * @param {string} [timeZone] 
 * @returns {string}
 */
export function formatTime24h(isoString, timeZone = getOrgTimeZone()) {
  if (!isoString) return '';
  const dateObj = typeof isoString === 'string' || typeof isoString === 'number' ? new Date(isoString) : isoString;
  if (isNaN(dateObj.getTime())) return '';

  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(dateObj);
}

/**
 * Formats an ISO string or Date into full date + 24-hour time format (e.g. "22 Jul 2026, 09:40").
 * @param {string|Date|number} isoString 
 * @param {string} [timeZone] 
 * @returns {string}
 */
export function formatDateTime24h(isoString, timeZone = getOrgTimeZone()) {
  if (!isoString) return '';
  const dateObj = typeof isoString === 'string' || typeof isoString === 'number' ? new Date(isoString) : isoString;
  if (isNaN(dateObj.getTime())) return '';

  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(dateObj);

  return `${date}, ${formatTime24h(dateObj, timeZone)}`;
}

export function getTodayString(timeZone = getOrgTimeZone()) {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
