'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/normalizer.js
 *
 * Normalization utilities for Recruit AI / HireIQ interview assessment payloads:
 * - Scores (raw, scale, normalized to 100, rating out of 10)
 * - Recommendation (strong_yes, yes, maybe, no, not_assessed)
 * - Status (COMPLETED, NO_SHOW, EXPIRED, CANCELLED, IN_PROGRESS)
 * - IST date formatting
 * - SHA-256 payload hashing for deduplication
 */

const crypto = require('crypto');

function computePayloadHash(payload) {
  if (!payload) return null;
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function parseNumericScore(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'NA' || trimmed.toUpperCase() === 'NULL') {
      return null;
    }
    const num = Number(trimmed);
    return isNaN(num) ? null : num;
  }
  return null;
}

function normalizeScore(scoreObj, rawScoreFallback) {
  let raw = null;
  let scaleMax = 100;

  if (typeof scoreObj === 'number' || typeof scoreObj === 'string') {
    raw = parseNumericScore(scoreObj);
  } else if (scoreObj && typeof scoreObj === 'object') {
    const candidateVal = scoreObj.raw !== undefined ? scoreObj.raw : (scoreObj.score !== undefined ? scoreObj.score : scoreObj.total);
    raw = parseNumericScore(candidateVal);
    
    if (typeof scoreObj.scaleMax === 'number' && scoreObj.scaleMax > 0) {
      scaleMax = scoreObj.scaleMax;
    } else if (typeof scoreObj.outOf === 'number' && scoreObj.outOf > 0) {
      scaleMax = scoreObj.outOf;
    }
  } else if (rawScoreFallback !== undefined) {
    raw = parseNumericScore(rawScoreFallback);
  }

  if (raw === null || isNaN(raw)) {
    return {
      scoreRaw: null,
      scoreScale: 100,
      scoreNormalised100: null,
      ratingOutOf10: null
    };
  }

  // Cap at 0 to scaleMax
  const clampedRaw = Math.max(0, Math.min(raw, scaleMax));
  const normalised100 = Math.round(((clampedRaw / scaleMax) * 100) * 10) / 10;
  const ratingOutOf10 = Math.round((normalised100 / 10) * 10) / 10;

  return {
    scoreRaw: raw,
    scoreScale: scaleMax,
    scoreNormalised100: normalised100,
    ratingOutOf10: ratingOutOf10
  };
}

function normalizeRecommendation(rec) {
  if (!rec || typeof rec !== 'string') return 'not_assessed';
  const clean = rec.trim().toLowerCase().replace(/[\s-]+/g, '_');

  // Negative recommendations must be checked before "hire" to avoid false positive on "no_hire"
  if (/(^|_)(no_hire|no|reject|rejected|fail|failed|not_recommended)(_|$)/.test(clean)) {
    return 'no';
  }
  if (/(^|_)(strong_yes|strongly_hire|strong_hire)(_|$)/.test(clean)) {
    return 'strong_yes';
  }
  if (/(^|_)(yes|hire|select|selected|pass)(_|$)/.test(clean)) {
    return 'yes';
  }
  if (/(^|_)(maybe|borderline|hold|review)(_|$)/.test(clean)) {
    return 'maybe';
  }
  return 'not_assessed';
}

function normalizeStatus(statusStr) {
  if (!statusStr || typeof statusStr !== 'string') return 'COMPLETED';
  const clean = statusStr.trim().toLowerCase();

  if (clean.includes('no_show') || clean.includes('did_not_join') || clean.includes('not_responded') || clean.includes('noshow')) {
    return 'NO_SHOW';
  }
  if (clean.includes('cancel')) {
    return 'CANCELLED';
  }
  if (clean.includes('expire')) {
    return 'EXPIRED';
  }
  if (clean.includes('progress') || clean.includes('started') || clean.includes('ongoing')) {
    return 'IN_PROGRESS';
  }
  return 'COMPLETED';
}

module.exports = {
  computePayloadHash,
  normalizeScore,
  normalizeRecommendation,
  normalizeStatus
};
