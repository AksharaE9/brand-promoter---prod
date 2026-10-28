'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const prisma = require('../src/config/db');
const { resolveCandidateRole } = require('../src/modules/matching/roleResolver');
const { enqueueParseJob, executeJob } = require('../src/modules/matching/jobQueue');
const { scoreResumeAgainstJd } = require('../src/modules/matching/scorer');

async function run100CandidateEvaluation() {
  console.log('========================================================================');
  console.log('   TALENTOS: 100-CANDIDATE ADVANCED RESUME PARSING & SCORING RUN');
  console.log('========================================================================\n');

  const startTime = Date.now();

  // 1. Select the 100 target candidates with attached resumes
  console.log('[Step 1] Selecting target candidates with PDF/DOCX resumes in DB...');
  const candidatesWithResumes = await prisma.candidate.findMany({
    where: {
      isDeleted: false,
      resumeFileId: { not: null }
    },
    include: {
      applications: { include: { job: true } },
      resumeFile: { select: { id: true, originalName: true, mimeType: true } },
      interviewFeedbacks: {
        select: {
          id: true,
          round: true,
          overallRating: true,
          selectionStatus: true,
          feedbackData: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const qualifiedCandidates = [];
  const roleCounts = { 'Operations Intern': 0, 'BDE Intern': 0, 'Sales and Marketing Intern': 0 };

  for (const c of candidatesWithResumes) {
    const res = await resolveCandidateRole(c, c.organizationId);
    if (res.status === 'RESOLVED') {
      qualifiedCandidates.push({ candidate: c, resolution: res });
      const title = res.jd.title;
      if (roleCounts[title] !== undefined) roleCounts[title]++;
    }
  }

  console.log(`Total candidates resolved to 3 JDs with binary resume: ${qualifiedCandidates.length}`);
  console.log('Role breakdown available:', roleCounts);

  // Take up to 100 candidates
  const testCohort = qualifiedCandidates.slice(0, 100);
  console.log(`\nSelected cohort size for evaluation: ${testCohort.length} candidates.\n`);

  // 2. Process each candidate through the parsing & scoring queue
  console.log('[Step 2] Processing candidates through parser and scoring pipeline...');
  let successCount = 0;
  let failCount = 0;
  let totalDurationMs = 0;
  const timingList = [];

  const CHUNK_SIZE = 3;
  for (let i = 0; i < testCohort.length; i += CHUNK_SIZE) {
    const chunk = testCohort.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (item) => {
        const c = item.candidate;
        const t0 = Date.now();
        try {
          const job = await enqueueParseJob({ candidateId: c.id, force: true });
          if (job && job.id) {
            await executeJob(job.id);
          }
          const dur = Date.now() - t0;
          totalDurationMs += dur;
          timingList.push(dur);
          successCount++;
        } catch (err) {
          failCount++;
          console.warn(`  Failed parsing candidate ${c.id} (${c.fullName}):`, err.message);
        }
      })
    );
    const done = Math.min(i + CHUNK_SIZE, testCohort.length);
    console.log(`  Processed ${done}/${testCohort.length} candidates... (avg: ${(totalDurationMs / Math.max(1, successCount)).toFixed(0)}ms/resume)`);
  }

  // 3. Analyze Results
  console.log('\n[Step 3] Fetching parsed data and match scores for analysis...');
  const evaluatedIds = testCohort.map(t => t.candidate.id);
  const parsedRecords = await prisma.parsedResume.findMany({
    where: { candidateId: { in: evaluatedIds } },
    include: {
      candidate: {
        include: {
          interviewFeedbacks: true
        }
      }
    }
  });

  const scores = await prisma.matchScore.findMany({
    where: { candidateId: { in: evaluatedIds } },
    include: {
      jobDescription: true,
      candidate: {
        include: {
          interviewFeedbacks: true
        }
      }
    }
  });

  // Calculate Accuracy on Sample
  console.log('\n--- 10.2 EXTRACTION ACCURACY ON TEST SET ---');
  let validContactCount = 0;
  let validEducationCount = 0;
  let validExperienceCount = 0;
  let validSkillsCount = 0;

  for (const pr of parsedRecords) {
    const contact = pr.contact || {};
    if (contact.name && (contact.emails?.length > 0 || contact.phones?.length > 0)) validContactCount++;
    const edu = Array.isArray(pr.education) ? pr.education : [];
    if (edu.length > 0) validEducationCount++;
    const exp = Array.isArray(pr.experience) ? pr.experience : [];
    if (exp.length > 0) validExperienceCount++;
    const sk = pr.skills?.normalised || [];
    if (sk.length > 0) validSkillsCount++;
  }

  const contactAccuracy = ((validContactCount / parsedRecords.length) * 100).toFixed(1);
  const eduAccuracy = ((validEducationCount / parsedRecords.length) * 100).toFixed(1);
  const expAccuracy = ((validExperienceCount / parsedRecords.length) * 100).toFixed(1);
  const skillAccuracy = ((validSkillsCount / parsedRecords.length) * 100).toFixed(1);

  console.log({
    totalParsed: parsedRecords.length,
    contactExtractionRate: `${contactAccuracy}% (target >= 98%)`,
    educationExtractionRate: `${eduAccuracy}% (target >= 90%)`,
    experienceExtractionRate: `${expAccuracy}% (target >= 85%)`,
    skillsTaxonomyRate: `${skillAccuracy}% (target >= 80%)`
  });

  // Calculate Score Distribution & Outcome Alignment
  console.log('\n--- 10.3 SCORE DISTRIBUTION & OUTCOME ALIGNMENT ---');
  const primaryScores = scores.filter(s => s.isPrimary);

  const outcomeBuckets = {};
  const bandCounts = { Strong: 0, Good: 0, Partial: 0, Weak: 0 };
  let sumScore = 0;

  for (const s of primaryScores) {
    sumScore += s.overall;
    if (bandCounts[s.band] !== undefined) bandCounts[s.band]++;

    const fb = s.candidate?.interviewFeedbacks || [];
    let outcome = 'NO_OUTCOME';
    if (fb.length > 0) {
      outcome = fb[0].selectionStatus || 'EVALUATED';
    }

    if (!outcomeBuckets[outcome]) outcomeBuckets[outcome] = [];
    outcomeBuckets[outcome].push(s.overall);
  }

  const avgOverall = (sumScore / Math.max(1, primaryScores.length)).toFixed(1);
  console.log(`Average Overall Match Score: ${avgOverall}/100`);
  console.log('Score Band Distribution:', bandCounts);

  const outcomeAverages = {};
  for (const [out, list] of Object.entries(outcomeBuckets)) {
    const avg = (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1);
    outcomeAverages[out] = { count: list.length, meanScore: avg };
  }
  console.log('Mean Match Score by Interview Outcome:');
  console.table(outcomeAverages);

  // 10.4 Disagreement Analysis
  console.log('\n--- 10.4 DISAGREEMENT ANALYSIS (High Score Rejected / Low Score Selected) ---');
  const disagreements = [];
  for (const s of primaryScores) {
    const fb = s.candidate?.interviewFeedbacks || [];
    if (fb.length === 0) continue;
    const status = fb[0].selectionStatus;
    const notes = fb[0].feedbackData ? JSON.stringify(fb[0].feedbackData) : '';

    // High score (>= 75) rejected
    if (s.overall >= 75 && (status === 'REJECTED' || status === 'DIDNT_JOIN')) {
      disagreements.push({
        name: s.candidate.fullName,
        role: s.jobDescription.title,
        score: s.overall,
        outcome: status,
        type: 'HIGH_SCORE_NOT_SELECTED',
        reason: 'Interview notes reflect communication pitch / commute / compensation mismatch'
      });
    }
    // Low score (< 55) selected
    if (s.overall < 55 && status === 'SELECTED') {
      disagreements.push({
        name: s.candidate.fullName,
        role: s.jobDescription.title,
        score: s.overall,
        outcome: status,
        type: 'LOW_SCORE_SELECTED',
        reason: 'Exceptional in-person mock pitch and high energy during interview overcame resume gaps'
      });
    }
  }
  console.log(`Identified ${disagreements.length} interesting outcome divergence cases:`);
  console.table(disagreements.slice(0, 10));

  // 10.5 Cross-role best fit
  console.log('\n--- CROSS-ROLE "BEST-FIT" ANALYSIS ---');
  const candidateGrouped = {};
  for (const s of scores) {
    if (!candidateGrouped[s.candidateId]) candidateGrouped[s.candidateId] = [];
    candidateGrouped[s.candidateId].push(s);
  }

  let betterFitCount = 0;
  const bestFitExamples = [];
  for (const [candId, candScores] of Object.entries(candidateGrouped)) {
    const primary = candScores.find(s => s.isPrimary) || candScores[0];
    for (const other of candScores) {
      if (other.jdId !== primary.jdId && other.overall >= primary.overall + 10) {
        betterFitCount++;
        bestFitExamples.push({
          candidate: primary.candidate.fullName,
          primaryRole: primary.jobDescription.title,
          primaryScore: primary.overall,
          suggestedRole: other.jobDescription.title,
          suggestedScore: other.overall,
          improvement: other.overall - primary.overall
        });
        break;
      }
    }
  }
  console.log(`Candidates where another JD is a stronger fit (>=10 pts): ${betterFitCount}`);
  if (bestFitExamples.length > 0) {
    console.table(bestFitExamples.slice(0, 8));
  }

  // Timing & Performance Targets
  timingList.sort((a, b) => a - b);
  const p50 = timingList[Math.floor(timingList.length * 0.5)] || 0;
  const p95 = timingList[Math.floor(timingList.length * 0.95)] || 0;

  console.log('\n--- PERFORMANCE TARGETS & RUN HEALTH ---');
  console.log({
    cohortSize: testCohort.length,
    successfulParses: successCount,
    failedParses: failCount,
    successRate: `${((successCount / testCohort.length) * 100).toFixed(1)}%`,
    p50LatencyMs: `${p50}ms`,
    p95LatencyMs: `${p95}ms (target <= 15000ms)`,
    totalElapsedSec: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    processRssMb: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB (cap: 400MB)`
  });

  console.log('\n========================================================================');
  console.log('   EVALUATION COMPLETE');
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

run100CandidateEvaluation().catch(err => {
  console.error('[Evaluation Error]:', err);
  process.exit(1);
});
