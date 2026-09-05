'use strict';

/**
 * candidateResolver.js — Shared candidate lookup utilities.
 *
 * WHY THIS FILE EXISTS:
 *   bulkFeedbackUpload.processor.js and bulkInterviewUpload.processor.js
 *   previously imported `resolveCandidateByNumber` directly from
 *   `../modules/candidates/routes` — a 1,850-line Express routes file.
 *   Importing a routes file from a background job processor forces Express
 *   middleware registration and top-level side effects to run in an unsafe
 *   context, causing silent crashes and TDZ errors under load.
 *
 *   This module is the single source of truth for phone-based candidate
 *   lookups. Both routes AND processors import from here.
 */

const prisma = require('../config/db');
const { normalizePhoneNumber, normalizePhoneForDedup } = require('./phoneNormalization');
const BoundedLRU = require('./lruCache');
const candidateLookupCache = new BoundedLRU({ max: 1000, ttl: 60000 });

/**
 * Resolves a candidate record by phone number using a normalized lookup.
 *
 * Tries multiple phone formats to maximise match rate:
 *   - Exact normalized form   (+919876543210)
 *   - 10-digit dedup key      (9876543210)
 *   - Raw string as stored
 *
 * @param {string|number|null} rawNumber
 * @param {string|null} organizationId - If provided, scopes lookup to this org.
 * @returns {Promise<object|null>} Candidate record (id, fullName, email, phone,
 *   preferredRole, currentCompany, organizationId) or null if not found.
 */
async function resolveCandidateByNumber(rawNumber, organizationId = null) {
  if (!rawNumber) return null;

  const cacheKey = `${organizationId || 'all'}:${String(rawNumber).trim()}`;
  const cached = candidateLookupCache.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  const normalized = normalizePhoneNumber(rawNumber);
  if (!normalized) {
    candidateLookupCache.set(cacheKey, null);
    return null;
  }

  const dedupKey = normalizePhoneForDedup(rawNumber);

  const orClauses = [
    { phoneNormalized: normalized },
    { phone: String(rawNumber).trim() },
  ];

  // Also try the 10-digit dedup key if it differs from the full normalized form
  if (dedupKey && dedupKey !== normalized) {
    orClauses.push({ phoneNormalized: { endsWith: dedupKey } });
  }

  const where = {
    isDeleted: false,
    OR: orClauses,
  };

  if (organizationId) {
    where.organizationId = organizationId;
  }

  try {
    const candidate = await prisma.candidate.findFirst({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        phoneNormalized: true,
        preferredRole: true,
        currentCompany: true,
        organizationId: true,
      },
    });

    candidateLookupCache.set(cacheKey, candidate || null);
    return candidate;
  } catch (err) {
    console.error(`[CandidateResolver] Lookup error for ${rawNumber}:`, err.message);
    return null;
  }
}

/**
 * Resolves a batch of candidates by phone number in a single query.
 * Used by batch-insert steps to avoid N+1 lookups.
 *
 * @param {string[]} rawNumbers - Array of raw phone strings from the sheet
 * @param {string|null} organizationId
 * @returns {Promise<Map<string, object>>} Map of dedupKey (10-digit) → candidate
 */
async function resolveCandidatesByNumbers(rawNumbers, organizationId = null) {
  if (!rawNumbers || rawNumbers.length === 0) return new Map();

  const dedupKeys = [...new Set(
    rawNumbers
      .map(n => normalizePhoneForDedup(n))
      .filter(Boolean)
  )];

  if (dedupKeys.length === 0) return new Map();

  const where = {
    isDeleted: false,
    OR: dedupKeys.map(key => ({ phoneNormalized: { endsWith: key } })),
  };

  if (organizationId) {
    where.organizationId = organizationId;
  }

  const candidates = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      phoneNormalized: true,
      preferredRole: true,
      currentCompany: true,
      organizationId: true,
    },
  });

  // Build lookup: dedupKey → candidate (last-10-digits key)
  const resultMap = new Map();
  for (const cand of candidates) {
    const key = normalizePhoneForDedup(cand.phoneNormalized || cand.phone || '');
    if (key) {
      resultMap.set(key, cand);
    }
  }

  return resultMap;
}

module.exports = {
  resolveCandidateByNumber,
  resolveCandidatesByNumbers,
};
