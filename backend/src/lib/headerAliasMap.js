'use strict';

/**
 * Normalizes incoming CSV/XLSX header text to canonical field keys.
 * Matches case-insensitively, strips UTF-8 BOM if present, and trims whitespace.
 * Also strips trailing asterisks (e.g. "Name *" or "phone number*") so recruiters
 * removing or leaving asterisks does not break mapping.
 */
const HEADER_ALIASES = {
  'name': 'name',
  'full name': 'name',
  'candidate name': 'name',

  'role': 'role',
  'position': 'role',
  'job role': 'role',

  'e-mail': 'email',
  'email': 'email',
  'email address': 'email',

  'phone number': 'phone',
  'phone': 'phone',
  'mobile': 'phone',
  'mobile number': 'phone',
  'contact number': 'phone',

  'resume link': 'resumeLink',
  'resume': 'resumeLink',
  'resume url': 'resumeLink',
  'cv link': 'resumeLink',
  'resume lonk': 'resumeLink', // tolerated typo

  'college': 'college',
  'university': 'college',

  'location': 'location',
  'city': 'location',

  'course': 'course',
  'degree': 'course',

  'source': 'source',
  'lead source': 'source',
  'referral': 'source',

  'company': 'company',
  'current company': 'company',
  'employer': 'company',

  // Round / Round Number Aliases
  'round': 'round',
  'round number': 'round',
  'round_number': 'round',
  'roundnumber': 'round',
  'interview round': 'round',

  // Meeting Mode Aliases
  'meeting mode': 'mode',
  'meeting_mode': 'mode',
  'interview mode': 'mode',
  'interview_mode': 'mode',
  'mode': 'mode',

  // Start Date / Time Aliases
  'start date': 'startDateTime',
  'start date & time': 'startDateTime',
  'start date and time': 'startDateTime',
  'start_date_time': 'startDateTime',
  'startdatetime': 'startDateTime',
  'scheduled start': 'startDateTime',
  'scheduled_start': 'startDateTime',
  'scheduledstart': 'startDateTime',
  'start': 'startDateTime',
};

function resolveHeader(rawHeader) {
  if (rawHeader === undefined || rawHeader === null) return null;
  // Clean BOM, remove trailing asterisks and surrounding space
  const cleaned = String(rawHeader)
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/\s*\*+$/, '')
    .trim();
  const key = cleaned.toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}

module.exports = {
  HEADER_ALIASES,
  resolveHeader,
};
