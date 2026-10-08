'use strict';

/**
 * cellNormalizer.js — Unified Boundary Normalization for Spreadsheets & Imports
 *
 * Enforces boundary rules:
 * 1. Trim leading/trailing whitespace, collapse internal whitespace, strip zero-width characters and UTF-8 BOM.
 * 2. Unicode normalization (NFC).
 * 3. Canonical email normalization (lowercasing, trimming) + placeholder email detection.
 * 4. Canonical phone normalization (E.164 + 10-digit standard Indian format).
 */

const PLACEHOLDER_EMAIL_PATTERNS = [
  /^dummy(@.*)?$/i,
  /^dummy\d*@/i,
  /^fake(@.*)?$/i,
  /^fake\d*@/i,
  /^placeholder(@.*)?$/i,
  /^noemail(@.*)?$/i,
  /^no_email(@.*)?$/i,
  /^none(@.*)?$/i,
  /^null(@.*)?$/i,
  /^nil(@.*)?$/i,
  /^notavailable(@.*)?$/i,
  /^notprovided(@.*)?$/i,
  /^abc@xyz\./i,
];

/**
 * Strips zero-width characters, BOM, trims and collapses internal whitespace.
 */
function normalizeString(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // Strip BOM & zero-width chars
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  // Unicode NFC normalization
  try {
    s = s.normalize('NFC');
  } catch (_) {}
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Detects if an email string is a placeholder / dummy / test identity.
 */
function isPlaceholderEmail(emailStr) {
  if (!emailStr) return true;
  const clean = normalizeString(emailStr).toLowerCase();
  if (!clean || clean === 'n/a' || clean === 'na' || clean === '-' || clean === 'nil') return true;

  for (const pattern of PLACEHOLDER_EMAIL_PATTERNS) {
    if (pattern.test(clean)) return true;
  }

  // Specific dummy domain checks
  if (clean.endsWith('@dummy.com') || clean.endsWith('@fake.com') || clean.endsWith('@noemail.com')) return true;

  return false;
}

/**
 * Validates whether an email has a standard valid format.
 */
function isValidEmailFormat(emailStr) {
  if (!emailStr) return false;
  const clean = normalizeString(emailStr);
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(clean);
}

/**
 * Normalizes email address.
 * Returns { email, isPlaceholder, rawValue, isValid }
 */
function normalizeEmailCell(rawEmail) {
  const cleaned = normalizeString(rawEmail).toLowerCase();
  if (!cleaned) {
    return { email: null, isPlaceholder: false, rawValue: '', isValid: false, needsContactDetails: false };
  }

  const isPlaceholder = isPlaceholderEmail(cleaned);
  const isValid = isValidEmailFormat(cleaned);

  return {
    email: (isPlaceholder || !isValid) ? null : cleaned,
    isPlaceholder,
    rawValue: cleaned,
    isValid,
    needsContactDetails: isPlaceholder || !isValid,
  };
}

/**
 * Normalizes a phone number to standard format.
 */
function normalizePhoneCell(rawPhone) {
  const cleaned = normalizeString(rawPhone);
  if (!cleaned) return { phone: '', phoneNormalized: null, digits: '', isValid: false };

  // Strip non-digit and non-plus characters (e.g. whitespace, dashes, parentheses)
  const phoneDigits = cleaned.replace(/[^\d+]/g, '');
  const onlyDigits = cleaned.replace(/[^\d]/g, '');

  let phoneNormalized = null;
  const isValid = onlyDigits.length >= 7 && onlyDigits.length <= 15;

  if (onlyDigits.length === 10) {
    phoneNormalized = `+91${onlyDigits}`;
  } else if (onlyDigits.length === 12 && onlyDigits.startsWith('91')) {
    phoneNormalized = `+${onlyDigits}`;
  } else if (phoneDigits.startsWith('+') && isValid) {
    phoneNormalized = `+${onlyDigits}`;
  } else if (isValid) {
    phoneNormalized = onlyDigits;
  }

  return {
    phone: phoneDigits,
    phoneNormalized: phoneNormalized || (onlyDigits ? `+${onlyDigits}` : null),
    digits: onlyDigits,
    isValid,
  };
}

/**
 * Normalizes all fields of a candidate row mapped from a spreadsheet.
 */
function normalizeCandidateRow(rawRow) {
  const normalized = {};

  for (const [key, val] of Object.entries(rawRow)) {
    if (val === null || val === undefined) {
      normalized[key] = '';
      continue;
    }

    if (key === 'email') {
      const emailResult = normalizeEmailCell(val);
      normalized.email = emailResult.email;
      normalized.emailRaw = emailResult.rawValue;
      normalized.isPlaceholderEmail = emailResult.isPlaceholder;
      normalized.isEmailValid = emailResult.isValid;
      normalized.needsContactDetails = emailResult.needsContactDetails;
    } else if (key === 'phone') {
      const phoneResult = normalizePhoneCell(val);
      normalized.phone = phoneResult.phone;
      normalized.phoneNormalized = phoneResult.phoneNormalized;
      normalized.phoneDigits = phoneResult.digits;
      normalized.isPhoneValid = phoneResult.isValid;
    } else {
      normalized[key] = normalizeString(val);
    }
  }

  return normalized;
}

module.exports = {
  normalizeString,
  isPlaceholderEmail,
  isValidEmailFormat,
  normalizeEmailCell,
  normalizePhoneCell,
  normalizeCandidateRow,
};
