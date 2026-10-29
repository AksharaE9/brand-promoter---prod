'use strict';

require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');
const { resolveCandidateRole, getCachedActiveJds } = require('../backend/src/modules/matching/roleResolver');
const { determineCandidateMatchState } = require('../backend/src/modules/matching/scoringService');

async function runBackfillAndReconciliation() {
  console.log('================================================================');
  console.log('PART 2 — DATA: ELIGIBLE CANDIDATE AUDIT & RECONCILIATION');
  console.log('================================================================\n');

  const totalCandidatesCount = await prisma.candidate.count({ where: { isDeleted: false } });
  console.log(`Total non-deleted candidates in production DB: ${totalCandidatesCount}`);

  // Warm caches
  await getCachedActiveJds('defaultOrg');

  // Load candidates with lean fields
  const candidates = await prisma.candidate.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      jobTitle: true,
      organizationId: true,
      resumeFileId: true,
      resumeLinkOriginal: true,
      resumeLinkDownload: true,
      resumeLinkProvider: true,
      isDeleted: true,
      applications: {
        select: {
          id: true,
          job: { select: { id: true, title: true } }
        }
      }
    }
  });

  console.log(`Loaded ${candidates.length} candidates. Fetching match scores and jobs...`);

  // Load all primary match scores in one query
  const allScores = await prisma.matchScore.findMany({
    where: { isPrimary: true },
    select: {
      candidateId: true,
      overall: true,
      ratingOutOf10: true,
      band: true,
      jobDescription: { select: { id: true, title: true } }
    }
  });
  const scoreMap = new Map();
  for (const s of allScores) {
    if (!scoreMap.has(s.candidateId)) scoreMap.set(s.candidateId, []);
    scoreMap.get(s.candidateId).push(s);
  }

  // Load latest parse jobs
  const allJobs = await prisma.resumeParseJob.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      candidateId: true,
      status: true,
      lastError: true
    }
  });
  const jobMap = new Map();
  for (const j of allJobs) {
    if (!jobMap.has(j.candidateId)) {
      jobMap.set(j.candidateId, [j]);
    }
  }

  // Target roles to track
  const ROLE_CATEGORIES = [
    'Operations Intern',
    'Business Development Executive Intern',
    'Sales and Marketing Intern',
    'Data Analyst Intern',
    'Other / Unmapped'
  ];

  const stateCountsByRole = {};
  for (const r of ROLE_CATEGORIES) {
    stateCountsByRole[r] = {
      SCORED: 0,
      QUEUED: 0,
      FAILED: 0,
      NO_RESUME: 0,
      UNSUPPORTED_FILE: 0,
      NO_JD: 0,
      UNMAPPED_ROLE: 0,
      TOTAL: 0
    };
  }

  const bandCountsByRole = {
    'Operations Intern': { Strong: 0, Good: 0, Partial: 0, Weak: 0 },
    'Business Development Executive Intern': { Strong: 0, Good: 0, Partial: 0, Weak: 0 },
    'Sales and Marketing Intern': { Strong: 0, Good: 0, Partial: 0, Weak: 0 },
  };

  let alreadyScored = 0;
  let invalidExclusionScored = 0;

  for (const c of candidates) {
    c.matchScores = scoreMap.get(c.id) || [];
    c.resumeParseJobs = jobMap.get(c.id) || [];

    const rawRole = c.preferredRole || c.jobTitle || 'Unspecified';
    const resolution = await resolveCandidateRole(c, c.organizationId || 'defaultOrg');

    let roleGroup = 'Other / Unmapped';
    if (resolution.status === 'EXCLUDED') {
      roleGroup = 'Data Analyst Intern';
    } else if (resolution.status === 'RESOLVED' && resolution.jd) {
      roleGroup = resolution.jd.title;
    } else if (/data\s*analyst/i.test(rawRole) || /business\s*analyst/i.test(rawRole)) {
      roleGroup = 'Data Analyst Intern';
    }

    if (!stateCountsByRole[roleGroup]) {
      roleGroup = 'Other / Unmapped';
    }

    // Safety check: Data Analyst candidates must never be scored against the 3 JDs
    if (roleGroup === 'Data Analyst Intern') {
      if (c.matchScores.length > 0) {
        console.warn(`[SAFETY PURGE] Candidate ${c.fullName} (${c.id}) has score for excluded role! Removing...`);
        await prisma.matchScore.deleteMany({ where: { candidateId: c.id } });
        invalidExclusionScored++;
        c.matchScores = [];
      }
    }

    const stateResult = await determineCandidateMatchState(c, resolution);
    const state = stateResult.state;
    stateCountsByRole[roleGroup][state] = (stateCountsByRole[roleGroup][state] || 0) + 1;
    stateCountsByRole[roleGroup].TOTAL += 1;

    if (state === 'SCORED') {
      alreadyScored++;
      const primary = c.matchScores[0];
      if (primary && bandCountsByRole[roleGroup]) {
        const band = primary.band || 'Weak';
        if (bandCountsByRole[roleGroup][band] !== undefined) {
          bandCountsByRole[roleGroup][band]++;
        }
      }
    }
  }

  console.log('\n--- RECONCILIATION SUMMARY (THE 7 STATES ACROSS ALL ROLES) ---\n');
  console.table(
    Object.keys(stateCountsByRole).map(role => ({
      Role: role,
      SCORED: stateCountsByRole[role].SCORED,
      QUEUED: stateCountsByRole[role].QUEUED,
      FAILED: stateCountsByRole[role].FAILED,
      NO_RESUME: stateCountsByRole[role].NO_RESUME,
      UNSUPPORTED_FILE: stateCountsByRole[role].UNSUPPORTED_FILE,
      NO_JD: stateCountsByRole[role].NO_JD,
      UNMAPPED_ROLE: stateCountsByRole[role].UNMAPPED_ROLE,
      TOTAL: stateCountsByRole[role].TOTAL
    }))
  );

  console.log('\n--- BAND DISTRIBUTION FOR SCORED CANDIDATES ---');
  console.table(bandCountsByRole);

  console.log(`\nAlready Scored (kept valid): ${alreadyScored}`);
  console.log(`Invalid Exclusion Scores Purged: ${invalidExclusionScored}`);
  console.log(`Total Candidates Evaluated: ${candidates.length}\n`);

  await prisma.$disconnect();
  return { stateCountsByRole, bandCountsByRole, alreadyScored, invalidExclusionScored };
}

if (require.main === module) {
  runBackfillAndReconciliation().catch(err => {
    console.error('Backfill error:', err);
    process.exit(1);
  });
}

module.exports = { runBackfillAndReconciliation };
