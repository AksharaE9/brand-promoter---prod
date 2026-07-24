'use strict';

function getOrgTimeZone() {
  return process.env.TZ || 'UTC';
}

function formatTime24h(isoString, timeZone = getOrgTimeZone()) {
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

function formatDateTime24h(isoString, timeZone = getOrgTimeZone()) {
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

module.exports = {
  getOrgTimeZone,
  formatTime24h,
  formatDateTime24h,
};
