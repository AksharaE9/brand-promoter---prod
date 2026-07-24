'use strict';

/**
 * Normalizes phone numbers to standard format for lookup and deduplication.
 * Retains digits and leading '+' if present.
 * Example: "+91 98765-43210" => "+919876543210"
 * Example: "98765 43210" => "9876543210"
 * 
 * @param {string|number|null|undefined} rawNumber
 * @returns {string}
 */
function normalizePhoneNumber(rawNumber) {
  if (rawNumber === null || rawNumber === undefined) return '';
  const str = String(rawNumber).trim();
  if (!str) return '';
  return str.replace(/[^\d+]/g, '');
}

module.exports = {
  normalizePhoneNumber,
};
