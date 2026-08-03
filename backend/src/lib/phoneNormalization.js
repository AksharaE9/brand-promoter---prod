'use strict';

/**
 * Normalizes phone numbers for storage and display.
 * Retains digits and a leading '+' if present.
 * Example: "+91 98765-43210" => "+919876543210"
 *
 * @param {string|number|null|undefined} rawNumber
 * @returns {string}
 */
function normalizePhoneNumber(rawNumber) {
  if (rawNumber === null || rawNumber === undefined) return '';
  const str = String(rawNumber).trim();
  if (!str) return '';
  // Excel may emit scientific notation for long numeric phones
  if (/^\d+(\.\d+)?e\+\d+$/i.test(str)) {
    const asNum = Number(str);
    if (Number.isFinite(asNum)) {
      return String(Math.round(asNum));
    }
  }
  return str.replace(/[^\d+]/g, '');
}

/**
 * Stable phone key for duplicate detection (candidate uniqueness).
 * Uses the last 10 digits so "+91 98765 43210" and "9876543210" match.
 *
 * @param {string|number|null|undefined} rawNumber
 * @returns {string} empty when not usable
 */
function normalizePhoneForDedup(rawNumber) {
  const normalized = normalizePhoneNumber(rawNumber);
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 10) return digits.slice(-10);
  if (digits.length >= 7) return digits;
  return '';
}

/**
 * Stable email key for duplicate detection.
 * @param {string|null|undefined} email
 * @returns {string}
 */
function normalizeEmailForDedup(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e === 'n/a' || e === 'na' || e === '-') return '';
  return e;
}

/**
 * Stable external candidate-id key for duplicate detection.
 * @param {string|number|null|undefined} id
 * @returns {string}
 */
function normalizeCandidateIdForDedup(id) {
  const v = String(id ?? '').trim();
  if (!v || v === '-' || v.toLowerCase() === 'n/a') return '';
  // Ignore spreadsheet row numbers mistaken as IDs
  if (/^\d{1,3}$/.test(v)) return '';
  return v.toLowerCase();
}

module.exports = {
  normalizePhoneNumber,
  normalizePhoneForDedup,
  normalizeEmailForDedup,
  normalizeCandidateIdForDedup,
};
