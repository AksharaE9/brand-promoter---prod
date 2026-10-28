'use strict';
const prisma = require('../src/config/db');

async function verifyAll() {
  console.log('========================================================================');
  console.log('            RRCE POST-INJECTION COMPREHENSIVE VERIFICATION              ');
  console.log('========================================================================\n');

  const checkResults = [];
  function check(name, pass, details = '') {
    checkResults.push({ name, pass, details });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
  }

  // 1. Fetch Drive
  const drive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'RRCE' }, isDeleted: false }
  });
  check('Drive exists', !!drive, `ID: ${drive?.id}, Title: "${drive?.title}"`);

  // 2. Drive candidates count (24 RRCE + 1 Rakshita = 25)
  const driveCandidates = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: drive.id },
    orderBy: { createdAt: 'asc' }
  });
  check('Drive candidate count is 25 (24 + Rakshita)', driveCandidates.length === 25, `Count: ${driveCandidates.length}`);

  const rakshitaInDrive = driveCandidates.find(dc => dc.candidateId === 'cmvqbje7d005rtbqoy2wvmg7c');
  check('Rakshita enrolled in drive', !!rakshitaInDrive, `Name: ${rakshitaInDrive?.fullName}`);

  // 3. RRCE Imported candidates count (24)
  const rrceCandidates = await prisma.candidate.findMany({
    where: { source: 'RRCE_DRIVE_IMPORT_2026-10-28', isDeleted: false },
    include: {
      resumeFile: true,
      applications: {
        include: {
          interviews: true
        }
      },
      interviewFeedbacks: true
    }
  });
  check('24 candidates carry RRCE marker', rrceCandidates.length === 24, `Count: ${rrceCandidates.length}`);

  const candidateIds = rrceCandidates.map(c => c.id);

  // 4. Round 1 records count (24)
  const r1Interviews = await prisma.interview.findMany({
    where: {
      candidateId: { in: candidateIds },
      roundNo: 1
    }
  });
  check('24 Round 1 interview records exist', r1Interviews.length === 24, `Count: ${r1Interviews.length}`);

  // 5. No Round 2+ records
  const r2Interviews = await prisma.interview.findMany({
    where: {
      candidateId: { in: candidateIds },
      roundNo: { gte: 2 }
    }
  });
  check('Zero Round 2+ interviews', r2Interviews.length === 0, `Count: ${r2Interviews.length}`);

  // 6. Outcomes exactly 8 SELECTED, 16 REJECTED
  const selectedInterviews = r1Interviews.filter(i => i.outcome === 'SELECTED');
  const rejectedInterviews = r1Interviews.filter(i => i.outcome === 'REJECTED');
  check('Outcomes: exactly 8 SELECTED', selectedInterviews.length === 8, `Count: ${selectedInterviews.length}`);
  check('Outcomes: exactly 16 REJECTED', rejectedInterviews.length === 16, `Count: ${rejectedInterviews.length}`);

  const nonOutcome = r1Interviews.filter(i => !['SELECTED', 'REJECTED'].includes(i.outcome));
  check('Zero lifecycle-only outcome values', nonOutcome.length === 0, `Non-outcome count: ${nonOutcome.length}`);

  // 7. Panelist Vinay Shetty on all 24
  const vinayInterviews = r1Interviews.filter(i => i.interviewerNames === 'Vinay Shetty');
  check('Panelist Vinay Shetty on all 24', vinayInterviews.length === 24, `Count: ${vinayInterviews.length}`);

  // 8. Roles: 22 Data Analyst Intern, 1 BDE Intern, 1 Sales & Marketing Executive Intern
  const daRoles = rrceCandidates.filter(c => c.preferredRole === 'Data Analyst Intern');
  const bdeRoles = rrceCandidates.filter(c => c.preferredRole === 'BDE Intern');
  const smeRoles = rrceCandidates.filter(c => c.preferredRole === 'SALES AND MARKETING EXECUTIVE INTERN');
  check('22 Data Analyst Intern roles', daRoles.length === 22, `Count: ${daRoles.length}`);
  check('1 BDE Intern role (Manoj Kumar R)', bdeRoles.length === 1 && bdeRoles[0].fullName === 'Manoj Kumar R', `Candidate: ${bdeRoles[0]?.fullName}`);
  check('1 Sales & Marketing Executive Intern role (Sanjana Desai)', smeRoles.length === 1 && smeRoles[0].fullName === 'Sanjana Desai', `Candidate: ${smeRoles[0]?.fullName}`);

  // 9. Resumes attached: 23 have resumeFileId, Ragini Sharma none
  const withResume = rrceCandidates.filter(c => c.resumeFileId !== null && c.resumeFile !== null);
  const ragini = rrceCandidates.find(c => c.fullName === 'Ragini Sharma');
  check('23 resumes attached', withResume.length === 23, `Count: ${withResume.length}`);
  check('Ragini Sharma has no resume attached', ragini && ragini.resumeFileId === null, `Ragini resumeFileId: ${ragini?.resumeFileId}`);

  // 10. Ratings Spot-Checks
  const feedbacks = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: candidateIds }, round: 'ROUND_1' }
  });
  check('24 Round 1 InterviewFeedbacks', feedbacks.length === 24, `Count: ${feedbacks.length}`);

  const balaJee = rrceCandidates.find(c => c.fullName === 'Bala Jee');
  const balaFb = feedbacks.find(f => f.candidateId === balaJee?.id);
  check('Bala Jee rating exactly 9.5 (highest)', balaFb?.overallRating === 9.5, `Rating: ${balaFb?.overallRating}`);

  const jeevitha = rrceCandidates.find(c => c.fullName === 'Jeevitha S');
  const jeevithaFb = feedbacks.find(f => f.candidateId === jeevitha?.id);
  check('Jeevitha S rating exactly 6.5', jeevithaFb?.overallRating === 6.5, `Rating: ${jeevithaFb?.overallRating}`);

  const tejaswini = rrceCandidates.find(c => c.fullName === 'Tejaswini L S');
  const tejaswiniFb = feedbacks.find(f => f.candidateId === tejaswini?.id);
  check('Tejaswini L S rating exactly 3', tejaswiniFb?.overallRating === 3, `Rating: ${tejaswiniFb?.overallRating}`);

  const pruthvi = rrceCandidates.find(c => c.fullName === 'Pruthvi K L');
  const pruthviFb = feedbacks.find(f => f.candidateId === pruthvi?.id);
  check('Pruthvi K L rating is NULL (not 0)', pruthviFb?.overallRating === null, `Rating: ${pruthviFb?.overallRating}`);

  // 11. Comments verbatim spot-checks
  const sahil = rrceCandidates.find(c => c.fullName === 'Sahil Pandey');
  const sahilFb = feedbacks.find(f => f.candidateId === sahil?.id);
  const sahilCommentsPass = (sahilFb?.feedbackData?.comments || '').includes('He is a good candidate with great knowledge of tech');
  check('Sahil Pandey comments verbatim and untruncated', sahilCommentsPass, `Comments snippet: "${sahilFb?.feedbackData?.comments?.slice(0, 60)}..."`);

  const manoj = rrceCandidates.find(c => c.fullName === 'Manoj Kumar R');
  const manojFb = feedbacks.find(f => f.candidateId === manoj?.id);
  check('Manoj Kumar R duration is 6 Months', manojFb?.feedbackData?.duration === '6 Months', `Duration: ${manojFb?.feedbackData?.duration}`);
  check('Manoj Kumar R DL/two-wheeler is yes', manojFb?.feedbackData?.twoWheelerDL === 'yes', `DL: ${manojFb?.feedbackData?.twoWheelerDL}`);

  // 12. College & Course on resume checks
  const lavanya = rrceCandidates.find(c => c.fullName === 'Lavanya K R');
  check('Lavanya K R college is ACS College of Engineering', (lavanya?.college || '').includes('ACS College of Engineering'), `College: ${lavanya?.college}`);

  const thanusha = rrceCandidates.find(c => c.fullName === 'Thanusha R');
  check('Thanusha R course is MCA', (thanusha?.course || '').includes('MCA'), `Course: ${thanusha?.course}`);

  const varshitha = rrceCandidates.find(c => c.fullName === 'Varshitha B');
  check('Varshitha B course is MCA', (varshitha?.course || '').includes('MCA'), `Course: ${varshitha?.course}`);

  // 13. Quality Check Queue check (Zero records for RRCE)
  const qcRecords = await prisma.qualityCheck.findMany({
    where: { candidateId: { in: candidateIds } }
  });
  check('Zero candidates in Second Round Quality Check queue', qcRecords.length === 0, `QC Count: ${qcRecords.length}`);

  // 14. Notifications check
  const notifCountAfter = await prisma.notification.count();
  console.log(`\nNotifications count in DB: ${notifCountAfter}`);

  // Summary
  const allPass = checkResults.every(c => c.pass);
  console.log('\n========================================================================');
  console.log(`VERIFICATION RESULT: ${allPass ? 'ALL CHECKS PASSED (100%)' : 'SOME CHECKS FAILED'}`);
  console.log(`Passed: ${checkResults.filter(c => c.pass).length} / ${checkResults.length}`);
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

verifyAll().catch(console.error);
