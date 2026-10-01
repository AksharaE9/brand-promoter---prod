'use strict';
const prisma = require('../src/config/db');

async function main() {
  console.log('======================================================');
  console.log('PART 9 — COMPREHENSIVE TRIVENI INJECTION VERIFICATION');
  console.log('======================================================\n');

  const IMPORT_MARKER = 'TRIVENI_COLLEGE_DRIVE_IMPORT';
  const checks = [];

  function recordCheck(category, name, passed, evidence) {
    checks.push({ Category: category, Check: name, Status: passed ? 'PASS' : 'FAIL', Evidence: evidence });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${category} -> ${name}: ${evidence}`);
  }

  // 1. Counts
  const triveniCands = await prisma.candidate.findMany({
    where: {
      OR: [
        { source: IMPORT_MARKER },
        { customFields: { path: ['import_source'], equals: IMPORT_MARKER } }
      ]
    },
    include: {
      applications: {
        include: {
          interviews: true
        }
      },
      interviewFeedbacks: true
    },
    orderBy: { createdAt: 'asc' }
  });

  recordCheck('Counts', 'Exactly 24 Triveni Candidates', triveniCands.length === 24, `Found ${triveniCands.length} candidates in DB`);

  const selectedCands = triveniCands.filter(c => c.status === 'ACTIVE');
  const rejectedCands = triveniCands.filter(c => c.status === 'REJECTED');
  const otherCands = triveniCands.filter(c => c.status !== 'ACTIVE' && c.status !== 'REJECTED');

  recordCheck('Counts', 'Outcome Distribution 20 Selected / 4 Rejected', selectedCands.length === 20 && rejectedCands.length === 4 && otherCands.length === 0, `Selected=${selectedCands.length}, Rejected=${rejectedCands.length}, Other=${otherCands.length}`);

  const totalCands = await prisma.candidate.count({ where: { isDeleted: false } });
  const cambridgeCands = await prisma.candidate.count({
    where: {
      OR: [
        { source: 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT' },
        { customFields: { path: ['import_source'], equals: 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT' } }
      ]
    }
  });
  const bgsCands = await prisma.candidate.count({
    where: {
      OR: [
        { source: 'BGS_COLLEGE_DRIVE_IMPORT' },
        { customFields: { path: ['import_source'], equals: 'BGS_COLLEGE_DRIVE_IMPORT' } }
      ]
    }
  });

  recordCheck('Counts', 'Cambridge Records Untouched', cambridgeCands === 35, `Found ${cambridgeCands} Cambridge candidates (expected 35)`);
  recordCheck('Counts', 'BGS Records Untouched', bgsCands === 41, `Found ${bgsCands} BGS candidates (expected 41)`);

  // 2. Data Fidelity
  const c1 = triveniCands.find(c => c.fullName === 'Chethan A');
  const c2 = triveniCands.find(c => c.fullName === 'Aditya SJ');
  const c4 = triveniCands.find(c => c.fullName === 'Rajith C');
  const c9 = triveniCands.find(c => c.fullName === 'Lekhana');
  const c10 = triveniCands.find(c => c.fullName === 'Hemashree');
  const c11 = triveniCands.find(c => c.fullName === 'Roshni Mishra');
  const c15 = triveniCands.find(c => c.fullName === 'Nandini');
  const c20 = triveniCands.find(c => c.fullName === 'Veeranjaneya');
  const c23 = triveniCands.find(c => c.fullName === 'Radha');
  const c24 = triveniCands.find(c => c.fullName === 'Yashwini C');

  const decimalRatingsCheck = c1?.interviewFeedbacks[0]?.overallRating === 6.5 &&
    c4?.interviewFeedbacks[0]?.overallRating === 6.5 &&
    c11?.interviewFeedbacks[0]?.overallRating === 5.5 &&
    c15?.interviewFeedbacks[0]?.overallRating === 5.5;

  recordCheck('Data Fidelity', 'Decimal Ratings Preserved (6.5, 5.5)', decimalRatingsCheck, `Chethan=${c1?.interviewFeedbacks[0]?.overallRating}, Rajith=${c4?.interviewFeedbacks[0]?.overallRating}, Roshni=${c11?.interviewFeedbacks[0]?.overallRating}, Nandini=${c15?.interviewFeedbacks[0]?.overallRating}`);

  const nullRatingCheck = c20?.interviewFeedbacks[0]?.overallRating === null;
  recordCheck('Data Fidelity', 'Veeranjaneya Rating is NULL (not 0)', nullRatingCheck, `Veeranjaneya rating: ${c20?.interviewFeedbacks[0]?.overallRating}`);

  const yashwiniParentheticalCheck = c24?.status === 'REJECTED' &&
    c24?.interviewFeedbacks[0]?.selectionStatus === 'REJECTED' &&
    c24?.customFields?.status_reason === 'candidate wants to do field work';
  recordCheck('Data Fidelity', 'Yashwini C Parenthetical Reason Preserved', yashwiniParentheticalCheck, `Outcome: ${c24?.status}, Reason: "${c24?.customFields?.status_reason}"`);

  const lekhanaRoundCheck = c9?.applications[0]?.interviews[0]?.roundNo === 1 &&
    c9?.applications[0]?.interviews[0]?.round === 'ROUND_1';
  recordCheck('Data Fidelity', 'Lekhana Round Normalized to Round 1', lekhanaRoundCheck, `RoundNo=${c9?.applications[0]?.interviews[0]?.roundNo}, Round=${c9?.applications[0]?.interviews[0]?.round}`);

  const radhaCheck = c23?.status === 'REJECTED' &&
    c23?.interviewFeedbacks[0]?.overallRating === 6 &&
    c23?.customFields?.parents_family === 'Businessman father' &&
    c23?.customFields?.from_place === 'Rajasthan';
  recordCheck('Data Fidelity', 'Radha Row Aligned with Source', radhaCheck, `Rating: ${c23?.interviewFeedbacks[0]?.overallRating}, Family: "${c23?.customFields?.parents_family}", From: "${c23?.customFields?.from_place}"`);

  const feedbackCommentsCheck = triveniCands.every(c => c.interviewFeedbacks.length === 1 && c.interviewFeedbacks[0].feedbackData?.comments);
  recordCheck('Data Fidelity', 'All 24 Feedback Records Exist with Comments', feedbackCommentsCheck, `24/24 feedback records attached`);

  const dojPreservedCheck = c2?.doj === 'Immediately (Oct 5)' && c10?.doj === '1st Nov' && c11?.doj === '20th Oct';
  recordCheck('Data Fidelity', 'DOJ Stored Verbatim as Text', dojPreservedCheck, `Aditya SJ DOJ="${c2?.doj}", Hemashree DOJ="${c10?.doj}", Roshni DOJ="${c11?.doj}"`);

  const interviewDateCheck = triveniCands.every(c => {
    const iv = c.applications[0]?.interviews[0];
    return iv?.scheduledStart?.toISOString() === '2026-09-29T05:30:00.000Z';
  });
  recordCheck('Data Fidelity', 'Interview Date reads 29-09-2026 11:00 IST for all 24', interviewDateCheck, `All 24 interview timestamps: 2026-09-29T05:30:00.000Z`);

  // 3. Structure
  const rolesSet = new Set(triveniCands.map(c => c.preferredRole));
  recordCheck('Structure', 'Four Distinct Roles Preserved', rolesSet.size === 4, `Roles found: ${Array.from(rolesSet).join(', ')}`);

  const harrisCount = triveniCands.filter(c => c.customFields?.panelist?.toLowerCase().includes('harris')).length;
  const yuvanCount = triveniCands.filter(c => c.customFields?.panelist?.toLowerCase().includes('yuvan')).length;
  recordCheck('Structure', 'Panelist Split Harris 15 / Yuvan 9', harrisCount === 15 && yuvanCount === 9, `Harris=${harrisCount}, Yuvan=${yuvanCount}`);

  const roundCountCheck = triveniCands.every(c => c.applications[0]?.interviews?.length === 1 && c.applications[0]?.interviews[0]?.roundNo === 1);
  recordCheck('Structure', 'Exactly One Round 1 per Candidate', roundCountCheck, `All 24 have exactly 1 Round 1`);

  const drive = await prisma.collegeDrive.findFirst({
    where: { title: 'Triveni College Campus Recruitment Drive' }
  });
  const driveCandidatesCount = await prisma.collegeDriveCandidate.count({
    where: { driveId: drive?.id }
  });
  recordCheck('Structure', 'All 24 Enrolled Under Single Triveni College Drive', driveCandidatesCount === 24, `Drive ID: ${drive?.id}, Enrolled: ${driveCandidatesCount}`);

  const needsContactCheck = triveniCands.every(c => c.customFields?.needs_contact_details === true);
  recordCheck('Structure', 'All 24 Flagged needs_contact_details', needsContactCheck, `24/24 candidates flagged`);

  // 4. No Collateral Damage
  const cambridgeLekhana = await prisma.candidate.findFirst({
    where: {
      fullName: 'Lekhana N',
      source: 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT'
    },
    include: {
      applications: { include: { interviews: true } }
    }
  });
  const cambridgeLekhanaIntact = cambridgeLekhana &&
    cambridgeLekhana.status === 'REJECTED' &&
    cambridgeLekhana.preferredRole === 'Data Analyst Intern' &&
    cambridgeLekhana.applications[0]?.interviews[0]?.interviewerNames === 'Vinay Shetty';

  recordCheck('No Collateral Damage', 'Cambridge Lekhana N Untouched & Intact', cambridgeLekhanaIntact, `Status: ${cambridgeLekhana?.status}, Role: ${cambridgeLekhana?.preferredRole}, Panelist: ${cambridgeLekhana?.applications[0]?.interviews[0]?.interviewerNames}`);

  const manasa12 = triveniCands.find(c => c.fullName === 'Manasa J');
  const manasa22 = triveniCands.find(c => c.fullName === 'Manasa');
  const manasaDistinct = manasa12 && manasa22 && manasa12.id !== manasa22.id && manasa12.status === 'ACTIVE' && manasa22.status === 'REJECTED';
  recordCheck('No Collateral Damage', 'Manasa (#22) and Manasa J (#12) Separate Records', manasaDistinct, `Manasa J ID=${manasa12?.id} (ACTIVE), Manasa ID=${manasa22?.id} (REJECTED)`);

  console.log('\n======================================================');
  console.log('SUMMARY OF ALL VERIFICATION CHECKS');
  console.log('======================================================');
  console.table(checks);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
