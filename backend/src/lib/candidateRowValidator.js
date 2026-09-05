'use strict';

const { normalizePhoneNumber } = require('./phoneNormalization');

/**
 * Validates a raw row object against candidate schema requirements.
 *
 * Rules:
 * - Default (All Candidates):
 *   - name: Mandatory. Non-empty string.
 *   - role: Mandatory. Non-empty string.
 *   - email: Mandatory. Validated email format.
 *   - phone: Mandatory. Must resolve to 7-15 digits.
 *   - resumeLink: Mandatory. Non-empty string.
 *
 * - College Drive Context (`options.isDriveContext = true`):
 *   - name: Mandatory. Non-empty string.
 *   - phone: Mandatory. Must resolve to 7-15 digits.
 *   - role: Optional.
 *   - email: Optional. Validated format if provided.
 *   - resumeLink: Optional.
 *
 * - Both contexts:
 *   - college, location, course, source, company, candidateId: Optional.
 *
 * @param {Record<string, any>} rawRow - Raw row mapped by resolveHeader
 * @param {number} rowNumber - 1-indexed file row number for error logging
 * @param {object} [options] - Configuration options { isDriveContext, schema }
 * @returns {object} { valid, data, warnings, failureReason, errors }
 */
function validateCandidateRow(rawRow, rowNumber, options = {}) {
  const errors = [];
  const warnings = [];
  const isDriveContext = Boolean(options.isDriveContext || options.driveId || options.schema === 'drive');

  const name = String(rawRow.name ?? '').trim();
  if (!name) {
    errors.push('missing required field "name"');
  }

  const role = String(rawRow.role ?? '').trim() || null;
  if (!isDriveContext && !role) {
    errors.push('missing required field "role"');
  }

  const emailRaw = String(rawRow.email ?? '').trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw);
  let email = emailRaw || null;
  if (!isDriveContext) {
    if (!emailRaw) {
      errors.push('missing required field "e-mail"');
    } else if (!isEmailValid) {
      errors.push(`invalid required field "e-mail": "${emailRaw}" is not a valid email address`);
    }
  } else {
    // In drive context, email is optional, but if present must be a valid email
    if (emailRaw && !isEmailValid) {
      errors.push(`invalid field "e-mail": "${emailRaw}" is not a valid email address`);
    }
  }

  const phoneRaw = String(rawRow.phone ?? '').trim();
  const phoneDigits = phoneRaw.replace(/[^\d+]/g, '');
  const phoneValid = /^\+?\d{7,15}$/.test(phoneDigits);
  if (!phoneRaw) {
    errors.push('missing required field "phone number"');
  } else if (!phoneValid) {
    errors.push(`missing or invalid required field "phone number": "${phoneRaw}" is not a valid phone number (must be 7-15 digits)`);
  }

  const resumeLinkRaw = String(rawRow.resumeLink ?? '').trim() || null;
  if (!isDriveContext && !resumeLinkRaw) {
    errors.push('missing required field "resume link"');
  }

  const college = String(rawRow.college ?? '').trim() || null;
  const location = String(rawRow.location ?? '').trim() || null;
  const course = String(rawRow.course ?? '').trim() || null;
  const source = String(rawRow.source ?? '').trim() || null;
  const company = String(rawRow.company ?? '').trim() || null;
  const candidateId = String(rawRow.candidateId ?? rawRow.candidate_id ?? '').trim() || null;

  if (errors.length > 0) {
    return {
      valid: false,
      data: {
        candidateId,
        name,
        role,
        email: isEmailValid ? email : null,
        phone: phoneValid ? phoneDigits : null,
        resumeLinkRaw,
        college,
        location,
        course,
        source,
        company,
      },
      warnings,
      failureReason: `Row ${rowNumber}: ` + errors.join(', '),
      errors: errors.map(err => `Row ${rowNumber}: ${err}`),
    };
  }

  return {
    valid: true,
    data: {
      candidateId,
      name,
      role,
      email: email || null,
      phone: phoneDigits,
      resumeLinkRaw,
      college,
      location,
      course,
      source,
      company,
    },
    warnings,
  };
}

module.exports = {
  validateCandidateRow,
};
