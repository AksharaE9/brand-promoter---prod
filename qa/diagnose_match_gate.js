const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function main() {
  console.log('=== PART 1: DIAGNOSIS GATE ===');

  // 1. MatchScore, ParsedResume, ResumeParseJob, JobDescription counts
  const jdCount = await prisma.jobDescription.count();
  const jds = await prisma.jobDescription.findMany({
    include: {
      versions: true,
      aliases: true,
      exclusions: true,
      _count: {
        select: { matchScores: true }
      }
    }
  });
  console.log(`\n1. Job Descriptions: ${jdCount}`);
  for (const jd of jds) {
    console.log(`  - [${jd.id}] ${jd.title} (${jd.status}) | Versions: ${jd.versions.length} | Aliases: ${jd.aliases.length} | MatchScores: ${jd._count.matchScores}`);
  }

  const scoreCount = await prisma.matchScore.count();
  const scoresByBand = await prisma.matchScore.groupBy({
    by: ['band'],
    _count: true
  });
  console.log(`\nTotal MatchScore rows in production DB: ${scoreCount}`);
  console.log('Scores by Band:', scoresByBand);

  const parsedResumeCount = await prisma.parsedResume.count();
  console.log(`\nTotal ParsedResume rows: ${parsedResumeCount}`);

  const jobsByStatus = await prisma.resumeParseJob.groupBy({
    by: ['status'],
    _count: true
  });
  console.log('ResumeParseJobs by Status:', jobsByStatus);

  // 2. Are they linked to the right records?
  const scoresWithCandidate = await prisma.matchScore.findMany({
    take: 10,
    include: {
      candidate: {
        select: { id: true, fullName: true, jobTitle: true, preferredRole: true, isDeleted: true, status: true, college: true }
      },
      jobDescription: { select: { title: true } }
    }
  });
  console.log('\nSample 10 MatchScores:');
  for (const s of scoresWithCandidate) {
    console.log(`  Candidate: ${s.candidate?.fullName} (${s.candidate?.id}) | jobTitle: ${s.candidate?.jobTitle} | preferredRole: ${s.candidate?.preferredRole} | Deleted: ${s.candidate?.isDeleted} | JD: ${s.jobDescription?.title} | Overall: ${s.overall} | Rating/10: ${s.ratingOutOf10} | Band: ${s.band} | isPrimary: ${s.isPrimary}`);
  }

  // Count orphaned scores
  const allScoreCandidateIds = (await prisma.matchScore.findMany({ select: { candidateId: true } })).map(s => s.candidateId);
  const existingCandidates = await prisma.candidate.findMany({
    where: { id: { in: allScoreCandidateIds } },
    select: { id: true, isDeleted: true }
  });
  const existingMap = new Map(existingCandidates.map(c => [c.id, c.isDeleted]));
  let orphaned = 0;
  let softDeleted = 0;
  for (const cid of allScoreCandidateIds) {
    if (!existingMap.has(cid)) orphaned++;
    else if (existingMap.get(cid)) softDeleted++;
  }
  console.log(`\nOrphaned MatchScores (candidate missing): ${orphaned}`);
  console.log(`MatchScores pointing to soft-deleted candidates: ${softDeleted}`);

  // 3. Inspect Distinct Roles in Production Candidates
  const distinctJobTitles = await prisma.candidate.groupBy({
    by: ['jobTitle'],
    _count: true,
    orderBy: {
      _count: {
        jobTitle: 'desc'
      }
    }
  });
  console.log('\nDistinct Candidate jobTitle in Production:');
  for (const r of distinctJobTitles) {
    console.log(`  - jobTitle: "${r.jobTitle}": ${r._count} candidates`);
  }

  const distinctPreferredRoles = await prisma.candidate.groupBy({
    by: ['preferredRole'],
    _count: true,
    orderBy: {
      _count: {
        preferredRole: 'desc'
      }
    }
  });
  console.log('\nDistinct Candidate preferredRole in Production:');
  for (const r of distinctPreferredRoles) {
    console.log(`  - preferredRole: "${r.preferredRole}": ${r._count} candidates`);
  }

  // 4. Check role resolver for these roles
  const { resolveCandidateRole } = require('../backend/src/modules/matching/roleResolver');
  console.log('\nRole Resolution Check:');
  for (const r of distinctJobTitles) {
    const fakeCandidate = { jobTitle: r.jobTitle, preferredRole: r.jobTitle };
    try {
      const res = await resolveCandidateRole(fakeCandidate, 'defaultOrg');
      console.log(`  "${r.jobTitle}" -> ${res.status} | JD: ${res.jd?.title || 'NONE'}`);
    } catch (e) {
      console.log(`  "${r.jobTitle}" -> ERROR: ${e.message}`);
    }
  }

  // 5. Total Candidates and Resumes
  const totalCandidates = await prisma.candidate.count({ where: { isDeleted: false } });
  const candidatesWithResume = await prisma.candidate.count({
    where: { isDeleted: false, resumeFileId: { not: null } }
  });
  console.log(`\nTotal Active Candidates: ${totalCandidates}`);
  console.log(`Active Candidates with resumeFileId: ${candidatesWithResume}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
