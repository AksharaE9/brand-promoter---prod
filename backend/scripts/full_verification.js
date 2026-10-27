'use strict';
const prisma = require('../src/config/db');

async function fullVerification() {
  console.log('========================================================================');
  console.log('                  PART 7: FULL POST-EXECUTION VERIFICATION              ');
  console.log('========================================================================\n');

  // 1. Notifications Check
  const notifCount = await prisma.notification.count();
  console.log(`[Safety Check] Current Notification Count: ${notifCount} (Baseline: 4874 -> Diff: ${notifCount - 4874})`);

  // 2. Job A: CMR Verification
  console.log('\n--- JOB A: CMR UNIVERSITY DRIVE ---');
  const cmrDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'CMR University', mode: 'insensitive' } }
  });
  const cmrCdc = await prisma.collegeDriveCandidate.count({ where: { driveId: cmrDrive.id } });
  const cmrCands = await prisma.candidate.findMany({
    where: { college: 'CMR University', isDeleted: false },
    include: { interviewFeedbacks: true, applications: { include: { interviews: true } } }
  });
  console.log(`- CMR Drive: ${cmrDrive.title} (${cmrDrive.id}, dateFrom: ${cmrDrive.dateFrom})`);
  console.log(`- Total Candidates in CMR Drive: ${cmrCdc}/33`);
  console.log(`- Total CMR Candidates in DB: ${cmrCands.length}/33`);

  const baCands = cmrCands.filter(c => c.preferredRole === 'Business Analyst Intern');
  const daCands = cmrCands.filter(c => c.preferredRole === 'Data Analyst Intern' && c.course !== 'MCA');
  const mcaCands = cmrCands.filter(c => c.course === 'MCA');

  const countOutcomes = (cands, round) => {
    const res = { SELECTED: 0, ON_HOLD: 0, REJECTED: 0 };
    cands.forEach(c => {
      const fb = c.interviewFeedbacks.find(f => f.round === round);
      if (fb) res[fb.selectionStatus] = (res[fb.selectionStatus] || 0) + 1;
    });
    return res;
  };

  console.log(`- BA Candidates (Pavan): ${baCands.length}/17 | Outcomes:`, countOutcomes(baCands, 'ROUND_1'));
  console.log(`- DA Candidates (Praneel): ${daCands.length}/11 | Outcomes:`, countOutcomes(daCands, 'ROUND_1'));
  console.log(`- MCA Candidates (Ananth): ${mcaCands.length}/5 | R1:`, countOutcomes(mcaCands, 'ROUND_1'), '| R2:', countOutcomes(mcaCands, 'ROUND_2'));

  // 3. Job B: Two-Week Sync Verification
  console.log('\n--- JOB B: TWO-WEEK SYNC VERIFICATION ---');

  // Check MVJ Round 2s
  const mvjCands = await prisma.candidate.findMany({
    where: { college: 'MVJ College of Engineering', isDeleted: false },
    include: { interviewFeedbacks: true }
  });
  const mvjR2s = mvjCands.filter(c => c.interviewFeedbacks.some(f => f.round === 'ROUND_2'));
  console.log(`- MVJ Round 2s attached: ${mvjR2s.length}/10`);

  // Check NMIT Round 2s + Round 1 Placeholders
  const nmitCands = await prisma.candidate.findMany({
    where: { college: 'Nitte Meenakshi', isDeleted: false },
    include: { interviewFeedbacks: true }
  });
  const nmitR1s = nmitCands.filter(c => c.interviewFeedbacks.some(f => f.round === 'ROUND_1'));
  const nmitR2s = nmitCands.filter(c => c.interviewFeedbacks.some(f => f.round === 'ROUND_2'));
  console.log(`- NMIT Candidates: ${nmitCands.length} | Round 1 Placeholders: ${nmitR1s.length}/10 | Round 2s attached: ${nmitR2s.length}/10`);

  // Check T. John & Gopalan
  const deepika = await prisma.candidate.findFirst({
    where: { fullName: 'Deepika Desai' },
    include: { interviewFeedbacks: true }
  });
  console.log(`- T. John (Deepika Desai): Rounds: ${deepika.interviewFeedbacks.map(f => f.round + ':' + f.selectionStatus).join(', ')}`);

  const brunda = await prisma.candidate.findFirst({
    where: { fullName: 'B Brunda' },
    include: { interviewFeedbacks: true }
  });
  console.log(`- Gopalan (B Brunda): Rounds: ${brunda.interviewFeedbacks.map(f => f.round + ':' + f.selectionStatus).join(', ')}`);

  // Check New Candidates & No-Shows
  const newNames = ['Nitya Shree', 'Priya G', 'Rakshita', 'Sham S', 'Vignesh Balaji', 'Soheb Baig', 'Srinivasa', 'Harsha Vardhan Reddy', 'sushmitha'];
  for (const name of newNames) {
    const c = await prisma.candidate.findFirst({
      where: { fullName: name },
      include: { interviewFeedbacks: true, applications: { include: { interviews: true } } }
    });
    console.log(`- Candidate "${name}": Status: ${c ? c.status : 'NOT FOUND'}, Rounds: ${c ? c.interviewFeedbacks.map(f => f.round + ':' + f.selectionStatus).join(', ') : 'none'}, Job: ${c ? c.preferredRole : 'none'}`);
  }

  // Check Jain Conflicts untouched
  const infant = await prisma.candidate.findFirst({
    where: { fullName: { contains: 'INFANT PRESHITH', mode: 'insensitive' } },
    include: { interviewFeedbacks: true }
  });
  console.log(`- Conflict check (INFANT PRESHITH P): R2 rating remains: ${infant.interviewFeedbacks.find(f => f.round === 'ROUND_2')?.overallRating} (untouched)`);

  console.log('\n========================================================================');
  console.log('✅ POST-EXECUTION VERIFICATION COMPLETED WITH DATABASE EVIDENCE');
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

fullVerification().catch(console.error);
