'use strict';

const prisma = require('../../config/db');

let cachedExclusions = null;
let exclusionsFetchedAt = 0;
async function getCachedExclusions() {
  if (cachedExclusions && (Date.now() - exclusionsFetchedAt) < 60000) {
    return cachedExclusions;
  }
  cachedExclusions = await prisma.roleExclusion.findMany();
  exclusionsFetchedAt = Date.now();
  return cachedExclusions;
}

let cachedActiveJds = {};
let jdsFetchedAt = {};
async function getCachedActiveJds(orgId) {
  if (cachedActiveJds[orgId] && (Date.now() - (jdsFetchedAt[orgId] || 0)) < 60000) {
    return cachedActiveJds[orgId];
  }
  const jds = await prisma.jobDescription.findMany({
    where: { status: 'active', organizationId: orgId },
    include: {
      aliases: true,
      versions: { orderBy: { version: 'desc' }, take: 1 }
    }
  });
  cachedActiveJds[orgId] = jds;
  jdsFetchedAt[orgId] = Date.now();
  return jds;
}

function normalizeRoleText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/['’`,.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a candidate's role to the nearest active Job Description.
 *
 * Precedence:
 * 1. The ATS job the candidate is attached to, if linked to an active JD.
 * 2. Exclusions check: words matching role exclusions immediately return EXCLUDED.
 * 3. Exact or substring match against active JD RoleAliases (kind = 'include').
 * 4. Match against active JD RoleAliases (kind = 'review') -> marked resolution: 'review'.
 * 5. Otherwise returns SKIPPED_NO_JD.
 *
 * @param {object} candidate - Candidate record with preferredRole, jobTitle, and applications[]
 * @param {string} [orgId='defaultOrg']
 * @returns {Promise<{
 *   status: 'RESOLVED' | 'EXCLUDED' | 'SKIPPED_NO_JD',
 *   jd: object | null,
 *   jdVersion: object | null,
 *   resolutionKind: 'direct_job' | 'include' | 'review' | null,
 *   aliasMatched: string | null,
 *   reason: string | null
 * }>}
 */
async function resolveCandidateRole(candidate, orgId = 'defaultOrg') {
  const roleRaw = (candidate.preferredRole || candidate.jobTitle || '').trim();
  const roleNorm = normalizeRoleText(roleRaw);

  if (!roleNorm) {
    return {
      status: 'SKIPPED_NO_JD',
      jd: null,
      jdVersion: null,
      resolutionKind: null,
      aliasMatched: null,
      reason: 'No role or job title specified on candidate'
    };
  }

  // Fetch active JDs with their aliases and latest versions (cached for 60s)
  const activeJds = await getCachedActiveJds(orgId);

  // 1. Check if candidate is attached to a Job that links directly to a JD
  if (Array.isArray(candidate.applications) && candidate.applications.length > 0) {
    for (const app of candidate.applications) {
      if (app.jobId) {
        const linkedJd = activeJds.find(j => j.jobId === app.jobId);
        if (linkedJd && linkedJd.versions.length > 0) {
          return {
            status: 'RESOLVED',
            jd: linkedJd,
            jdVersion: linkedJd.versions[0],
            resolutionKind: 'direct_job',
            aliasMatched: app.job?.title || linkedJd.title,
            reason: 'Matched via candidate application job'
          };
        }
      }
    }
  }

  // 2. Exclusions win over everything (cached for 60s)
  const exclusions = await getCachedExclusions();
  const roleWords = roleNorm.split(' ');

  for (const exc of exclusions) {
    const excNorm = exc.normalizedTerm;
    // Exact match or multi-word phrase match
    if (roleNorm === excNorm || roleNorm.includes(excNorm)) {
      return {
        status: 'EXCLUDED',
        jd: null,
        jdVersion: null,
        resolutionKind: null,
        aliasMatched: null,
        reason: `Matches role exclusion: "${exc.term}" (${exc.reason || 'Restricted profile'})`
      };
    }
    // Single word check
    if (excNorm.split(' ').length === 1 && roleWords.includes(excNorm)) {
      return {
        status: 'EXCLUDED',
        jd: null,
        jdVersion: null,
        resolutionKind: null,
        aliasMatched: null,
        reason: `Matches role exclusion word: "${exc.term}"`
      };
    }
  }

  // 3. Check 'include' aliases
  for (const jd of activeJds) {
    if (jd.versions.length === 0) continue;
    const includeAliases = jd.aliases.filter(a => a.kind === 'include');

    for (const a of includeAliases) {
      if (roleNorm === a.normalizedAlias || roleNorm.includes(a.normalizedAlias)) {
        return {
          status: 'RESOLVED',
          jd,
          jdVersion: jd.versions[0],
          resolutionKind: 'include',
          aliasMatched: a.alias,
          reason: `Matched alias "${a.alias}" for JD "${jd.title}"`
        };
      }
    }
  }

  // 4. Check 'review' aliases (e.g. Telecaller, Telesales, BDE/SME)
  for (const jd of activeJds) {
    if (jd.versions.length === 0) continue;
    const reviewAliases = jd.aliases.filter(a => a.kind === 'review');

    for (const a of reviewAliases) {
      if (roleNorm === a.normalizedAlias || roleNorm.includes(a.normalizedAlias)) {
        return {
          status: 'UNMAPPED_ROLE',
          jd,
          jdVersion: jd.versions[0],
          resolutionKind: 'review',
          aliasMatched: a.alias,
          reason: `Resolved under review tier: "${a.alias}" -> "${jd.title}" (pending admin approval)`
        };
      }
    }
  }

  // 5. No match
  return {
    status: 'SKIPPED_NO_JD',
    jd: null,
    jdVersion: null,
    resolutionKind: null,
    aliasMatched: null,
    reason: `Role "${roleRaw}" does not resolve to any active Job Description`
  };
}

function clearJdCache() {
  cachedActiveJds = {};
  jdsFetchedAt = {};
  cachedExclusions = null;
  exclusionsFetchedAt = 0;
}

module.exports = {
  resolveCandidateRole,
  normalizeRoleText,
  getCachedActiveJds,
  clearJdCache
};
