'use strict';

const { normalizeString, normalizeEmailCell, normalizePhoneCell } = require('./cellNormalizer');

/**
 * Validates a raw row object against candidate schema requirements.
 *
 * Rules:
 * - Default (All Candidates):
 *   - name: Mandatory. Non-empty string.
 *   - role: Mandatory. Non-empty string.
 *   - email: Mandatory. Validated email format (non-placeholder).
 *   - phone: Mandatory. Must resolve to 7-15 digits.
 *   - resumeLink: Mandatory. Non-empty valid URL.
 *
 * - College Drive Context (`options.isDriveContext = true`):
 *   - name: Mandatory. Non-empty string.
 *   - phone: Mandatory. Must resolve to 7-15 digits.
 *   - role: Optional.
 *   - email: Optional. Validated format if provided; placeholder/incomplete emails are accepted as empty email with needs_contact_details flag.
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

  const name = normalizeString(rawRow.name ?? '');
  if (!name) {
    errors.push('missing required field "name"');
  }

  const role = normalizeString(rawRow.role ?? '') || null;
  // Role is required for All Candidates but optional for College Drive context
  if (!isDriveContext && !role) {
    errors.push('missing required field "role"');
  }

  const emailResult = normalizeEmailCell(rawRow.email);
  let email = emailResult.email;
  let needsContactDetails = emailResult.needsContactDetails;
  const rawEmail = emailResult.rawValue;

  if (!isDriveContext) {
    // Email is required for All Candidates
    if (!rawEmail) {
      errors.push('missing required field "e-mail"');
    } else if (emailResult.isPlaceholder) {
      errors.push(`invalid required field "e-mail": "${rawEmail}" is a placeholder email and cannot be used as candidate identity`);
    } else if (!emailResult.isValid) {
      errors.push(`invalid required field "e-mail": "${rawEmail}" is not a valid email address`);
    }
  } else {
    // Email is optional for College Drive
    if (rawEmail) {
      if (emailResult.isPlaceholder) {
        email = null;
        needsContactDetails = true;
        warnings.push(`Row ${rowNumber}: Email "${rawEmail}" is a placeholder; imported with needs_contact_details flag`);
      } else if (!emailResult.isValid) {
        email = null;
        needsContactDetails = true;
        warnings.push(`Row ${rowNumber}: Incomplete email handle "${rawEmail}"; imported without email (needs_contact_details flag set)`);
      }
    }
  }

  const phoneRaw = normalizeString(rawRow.phone ?? '');
  const phoneResult = normalizePhoneCell(rawRow.phone);
  if (!phoneRaw) {
    errors.push('missing required field "phone number"');
  } else if (!phoneResult.isValid) {
    errors.push(`missing or invalid required field "phone number": "${rawRow.phone || ''}" is not a valid phone number (must be 7-15 digits)`);
  }

  const resumeLinkRaw = normalizeString(rawRow.resumeLink ?? '') || null;
  if (!isDriveContext) {
    if (!resumeLinkRaw) {
      errors.push('missing required field "resume link"');
    } else if (!/^https?:\/\/\S+/i.test(resumeLinkRaw)) {
      errors.push(`invalid field "resume link": "${resumeLinkRaw}" is not a valid URL`);
    }
  } else {
    // In drive context, resume link is optional, but if present must be a valid URL
    if (resumeLinkRaw && !/^https?:\/\/\S+/i.test(resumeLinkRaw)) {
      errors.push(`invalid field "resume link": "${resumeLinkRaw}" is not a valid URL`);
    }
  }

  const college = normalizeString(rawRow.college ?? '') || null;
  const location = normalizeString(rawRow.location ?? '') || null;
  const course = normalizeString(rawRow.course ?? '') || null;
  const source = normalizeString(rawRow.source ?? '') || null;
  const company = normalizeString(rawRow.company ?? '') || null;
  const candidateId = normalizeString(rawRow.candidateId ?? rawRow.candidate_id ?? '') || null;

  if (errors.length > 0) {
    return {
      valid: false,
      data: {
        candidateId,
        name,
        role,
        email: email || null,
        rawEmail,
        needsContactDetails,
        phone: phoneResult.phone,
        phoneNormalized: phoneResult.phoneNormalized,
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
      rawEmail,
      needsContactDetails,
      phone: phoneResult.phone,
      phoneNormalized: phoneResult.phoneNormalized,
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

