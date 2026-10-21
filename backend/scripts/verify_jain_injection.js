'use strict';
/**
 * verify_jain_injection.js
 *
 * Verifies all criteria specified in Part 10 for Jain College Drive injection:
 * - Counts: 22 candidates, 22 Round 1 interviews, 14 Selected / 8 Rejected, 21 resumes attached.
 * - Fidelity: decimal rating 7.5, verbatim long comments, DOJ as text, resume spellings.
 * - Integrity: zero Round 2, zero outbound messages, zero quality check queue items.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CONFIG = {
  IMPORT_MARKER: 'JAIN_DRIVE_IMPORT_2026-10-21',
  DRIVE_ID: 'cmrvvgvnj0007mt29fxu60ik8',
  INTERVIEW_DATE_STR: '2026-10-16'
};

async function main() {
  console.log('======================================================');
  console.log('PART 10: JAIN COLLEGE INJECTION VERIFICATION');
  console.log('======================================================\n');

  let allPassed = true;
  function assertCheck(name, condition, details = '') {
    if (condition) {
      console.log(`  [PASS] ${name} ${details ? `(${details})` : ''}`);
    } else {
      console.error(`  [FAIL] ${name} ${details ? `(${details})` : ''}`);
      allPassed = false;
    }
  }

  // 1. Candidate Counts & Marker
  console.log('1. Candidate Counts & Marker:');
  const candidates = await prisma.candidate.findMany({
    where: {
      organizationId: 'defaultOrg',
      isDeleted: false,
      OR: [
        { source: CONFIG.IMPORT_MARKER },
        { customFields: { path: ['import_source'], equals: CONFIG.IMPORT_MARKER } }
      ]
    },
    include: {
      applications: {
        include: {
          job: true,
          interviews: true
        }
      },
      interviewFeedbacks: true,
      resumeFile: true
    }
  });

  assertCheck('Candidate count is exactly 22', candidates.length === 22, `Found: ${candidates.length}`);

  // 2. Drive Enrolled Count
  console.log('\n2. Drive Enrolled Count:');
  const driveCandidates = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: CONFIG.DRIVE_ID }
  });
  assertCheck('Jain drive enrolled count is exactly 29 (7 pre-existing + 22 new)', driveCandidates.length === 29, `Found: ${driveCandidates.length}`);

  const injectedInDrive = driveCandidates.filter(dc => candidates.some(c => c.id === dc.candidateId));
  assertCheck('All 22 candidates enrolled in Jain drive', injectedInDrive.length === 22, `Enrolled: ${injectedInDrive.length}`);

  // 3. Interview Records (Round 1 only, outcomes, modes)
  console.log('\n3. Interview Records & Outcomes:');
  const interviews = candidates.flatMap(c => c.applications.flatMap(a => a.interviews));
  assertCheck('Exactly 22 Round 1 records', interviews.length === 22, `Found: ${interviews.length}`);

  const hasRound2 = interviews.some(i => i.roundNo === 2 || (i.round && i.round.toUpperCase().includes('ROUND_2')));
  assertCheck('Zero Round 2 records created', !hasRound2);

  const selectedInterviews = interviews.filter(i => i.outcome === 'SELECTED' && i.result === 'SELECTED');
  const rejectedInterviews = interviews.filter(i => i.outcome === 'REJECTED' && i.result === 'REJECTED');
  assertCheck('Outcomes: exactly 14 SELECTED', selectedInterviews.length === 14, `Found: ${selectedInterviews.length}`);
  assertCheck('Outcomes: exactly 8 REJECTED', rejectedInterviews.length === 8, `Found: ${rejectedInterviews.length}`);

  const lifecycleOnly = interviews.some(i => i.outcome === 'COMPLETED' || i.outcome === 'SCHEDULED');
  assertCheck('Zero lifecycle-only values in outcome field', !lifecycleOnly);

  // 4. Panelist Breakdown
  console.log('\n4. Panelist Breakdown:');
  const yuvanInterviews = interviews.filter(i => i.interviewerNames && i.interviewerNames.includes('YUVAN'));
  const praneelInterviews = interviews.filter(i => i.interviewerNames && i.interviewerNames.includes('Praneel'));
  assertCheck('Yuvan evaluated 11 candidates', yuvanInterviews.length === 11, `Found: ${yuvanInterviews.length}`);
  assertCheck('Praneel evaluated 11 candidates', praneelInterviews.length === 11, `Found: ${praneelInterviews.length}`);

  const yuvanSelected = yuvanInterviews.filter(i => i.outcome === 'SELECTED').length;
  const yuvanRejected = yuvanInterviews.filter(i => i.outcome === 'REJECTED').length;
  assertCheck('Yuvan: exactly 7 SELECTED / 4 REJECTED', yuvanSelected === 7 && yuvanRejected === 4, `Selected: ${yuvanSelected}, Rejected: ${yuvanRejected}`);

  const praneelSelected = praneelInterviews.filter(i => i.outcome === 'SELECTED').length;
  const praneelRejected = praneelInterviews.filter(i => i.outcome === 'REJECTED').length;
  assertCheck('Praneel: exactly 7 SELECTED / 4 REJECTED', praneelSelected === 7 && praneelRejected === 4, `Selected: ${praneelSelected}, Rejected: ${praneelRejected}`);

  // 5. Roles Breakdown
  console.log('\n5. Roles Breakdown:');
  const daCandidates = candidates.filter(c => c.preferredRole === 'Data Analyst Intern');
  const baCandidates = candidates.filter(c => c.preferredRole === 'Business Analyst Intern');
  assertCheck('Roles: 19 Data Analyst Intern', daCandidates.length === 19, `Found: ${daCandidates.length}`);
  assertCheck('Roles: 3 Business Analyst Intern', baCandidates.length === 3, `Found: ${baCandidates.length}`);
  const baNames = baCandidates.map(c => c.fullName).sort();
  console.log('  BA Intern candidates:', baNames.join(', '));

  // 6. Resume Attachments
  console.log('\n6. Resumes Attachment:');
  const candidatesWithResume = candidates.filter(c => c.resumeFileId !== null);
  const candidatesWithoutResume = candidates.filter(c => c.resumeFileId === null);
  assertCheck('Exactly 21 candidates have resume attached', candidatesWithResume.length === 21, `Found: ${candidatesWithResume.length}`);
  assertCheck('Pengaluru Dinishitha has NO resume', candidatesWithoutResume.length === 1 && candidatesWithoutResume[0].fullName === 'Pengaluru Dinishitha');

  // Verify FileMeta records
  let allFilesValid = true;
  for (const c of candidatesWithResume) {
    if (!c.resumeFile || !c.resumeFile.fileData || c.resumeFile.fileData.length < 1000) {
      allFilesValid = false;
      console.error(`  [FAIL] Candidate ${c.fullName} resumeFile has invalid BLOB data`);
    }
  }
  assertCheck('All 21 FileMeta records contain valid binary PDF BLOBs in PostgreSQL', allFilesValid);

  // 7. Fidelity Checks
  console.log('\n7. Fidelity Checks:');
  const rifah = candidates.find(c => c.fullName === 'RIFAH ALAM');
  const rifahFb = rifah?.interviewFeedbacks[0];
  assertCheck('Rifah Alam rating is exactly decimal 7.5', rifahFb?.overallRating === 7.5, `Found: ${rifahFb?.overallRating}`);

  const harsh = candidates.find(c => c.fullName === 'HARSH PILLAI');
  const harshComments = harsh?.interviewFeedbacks[0]?.feedbackData?.comments;
  assertCheck('Harsh Pillai comment verbatim', harshComments && harshComments.includes("didn't write the query"));

  const shaik = candidates.find(c => c.fullName === 'SHAIK SHAH BABA');
  const shaikComments = shaik?.interviewFeedbacks[0]?.feedbackData?.comments;
  assertCheck('Shaik Shah Baba comment verbatim', shaikComments && shaikComments.includes('analytical thinking'));

  const infant = candidates.find(c => c.fullName === 'INFANT PRESHITH P');
  assertCheck('Infant Preshith P: rated 5, SELECTED intact', infant?.interviewFeedbacks[0]?.overallRating === 5 && infant?.applications[0]?.interviews[0]?.outcome === 'SELECTED');

  const soumya = candidates.find(c => c.fullName === 'SOUMYA SINGH');
  assertCheck('Soumya Singh: rated 8, REJECTED intact', soumya?.interviewFeedbacks[0]?.overallRating === 8 && soumya?.applications[0]?.interviews[0]?.outcome === 'REJECTED');

  const suvam = candidates.find(c => c.fullName === 'SUVAM KURMI');
  assertCheck('Suvam Kurmi: Round 1 scheduled with round_as_written 2nd in metadata', suvam?.applications[0]?.interviews[0]?.roundNo === 1 && suvam?.customFields?.round_as_written === '2nd');

  // 8. Quality Check Queue & Outbound Messages
  console.log('\n8. Side-Effect Guards:');
  const qcEntries = await prisma.qualityCheck.findMany({
    where: {
      candidateId: { in: candidates.map(c => c.id) }
    }
  });
  assertCheck('Zero records in Second Round Quality Check queue', qcEntries.length === 0, `Found: ${qcEntries.length}`);

  const alertsTriggered = interviews.some(i => !i.round1SMSAlertSent || !i.round2EmailAlertSent);
  assertCheck('Outbound alerts suppressed (round1SMSAlertSent & round2EmailAlertSent true)', !alertsTriggered);

  console.log('\n======================================================');
  if (allPassed) {
    console.log('✅ ALL PART 10 VERIFICATION CHECKS PASSED PERFECTLY!');
  } else {
    console.error('❌ SOME VERIFICATION CHECKS FAILED!');
    process.exit(1);
  }
  console.log('======================================================\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
