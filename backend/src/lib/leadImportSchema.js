'use strict';

/**
 * Lead Import Schema Definition & Completion Percentage Helper
 *
 * Configurable field schema for telecalling lead sheet imports.
 * Placeholders: 'name' and 'phone' (required minimum set).
 */

/** @type {Array<{ key: string, label: string, required: boolean }>} */
const LEAD_IMPORT_SCHEMA = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone Number', required: true },
];

/**
 * Normalizes phone numbers to string text preserving leading zeros or '+'
 * and preventing scientific notation conversion.
 */
function normalizePhoneText(rawPhone) {
  if (rawPhone === undefined || rawPhone === null) return '';
  let str = String(rawPhone).trim();
  // Handle scientific notation string like 9.87654321e9 or 9.87654321e+9
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(str)) {
    try {
      str = BigInt(Math.round(Number(str))).toString();
    } catch (_) {}
  }
  return str;
}


/**
 * Validates a raw parsed row against the lead import schema.
 * Returns { valid: boolean, leadData: object, errors: string[] }.
 */
function validateLeadRow(rawRow, schema = LEAD_IMPORT_SCHEMA) {
  const errors = [];
  const leadData = {};

  for (const field of schema) {
    const rawVal = rawRow[field.key] ?? rawRow[field.label];
    let val = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';

    if (field.key === 'phone') {
      val = normalizePhoneText(rawVal);
    }

    if (field.required && !val) {
      errors.push(`Missing required field: ${field.label}`);
    } else {
      leadData[field.key] = val;
    }
  }

  // Copy any extra raw non-internal keys into leadData JSON
  for (const [k, v] of Object.entries(rawRow)) {
    if (k.startsWith('_') || schema.some(s => s.key === k || s.label === k)) continue;
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      leadData[k] = String(v).trim();
    }
  }

  return {
    valid: errors.length === 0,
    leadData,
    errors,
  };
}

/**
 * Computes live completion percentage from callsDone vs totalLeadsToday.
 * Capped at 100%.
 */
function computeCompletionPercentage(callsDone, totalLeadsToday) {
  const done = Number(callsDone) || 0;
  const total = Number(totalLeadsToday) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

module.exports = {
  LEAD_IMPORT_SCHEMA,
  normalizePhoneText,
  validateLeadRow,
  computeCompletionPercentage,
};
