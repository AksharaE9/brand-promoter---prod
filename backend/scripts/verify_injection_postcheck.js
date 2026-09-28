'use strict';
const prisma = require('../src/config/db');

async function runPostCheck() {
  console.log('\n======================================================');
  console.log('PART 8 — POST-INJECTION VERIFICATION');
  console.log('======================================================\n');

  // 1. Total injected candidates
  const candidates = await prisma.candidate.findMany({
    where: { source: 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT', isDeleted: false },
    include: {
      applications: true,
      interviewFeedbacks: true,
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Total Injected Candidates in DB: ${candidates.length}`);

  // Count by status
  const statusCounts = {};
  candidates.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  });
  console.log('Candidate Status Breakdown:', statusCounts);

  // 2. Interviews count and rounds
  const candidateIds = candidates.map(c => c.id);
  const interviews = await prisma.interview.findMany({
    where: { candidateId: { in: candidateIds } }
  });

  console.log(`Total Interviews created: ${interviews.length}`);
  const roundCounts = {};
  const outcomeCounts = {};
  interviews.forEach(i => {
    roundCounts[i.round] = (roundCounts[i.round] || 0) + 1;
    outcomeCounts[i.outcome] = (outcomeCounts[i.outcome] || 0) + 1;
  });
  console.log('Interview Rounds Breakdown:', roundCounts);
  console.log('Interview Outcomes Breakdown:', outcomeCounts);

  // 3. College Drive Enrollment
  const drive = await prisma.collegeDrive.findFirst({
    where: { title: 'Cambridge College Campus Recruitment Drive' }
  });
  const enrolledCount = await prisma.collegeDriveCandidate.count({
    where: { driveId: drive.id }
  });
  console.log(`\nCollege Drive "${drive.title}" (ID: ${drive.id}) Enrolled Students: ${enrolledCount}`);

  // 4. Joint Panelists Check (Serials #11-#15)
  console.log('\n--- JOINT PANELIST CHECK (Serials 11–15) ---');
  const jointCandidates = candidates.filter(c => {
    const s = c.customFields?.source_serial;
    return s >= 11 && s <= 15;
  });
  for (const c of jointCandidates) {
    const iv = interviews.find(i => i.candidateId === c.id);
    const pIds = Array.isArray(iv.interviewerIds) ? iv.interviewerIds : JSON.parse(iv.interviewerIds || '[]');
    console.log(`#${c.customFields?.source_serial} ${c.fullName} -> Panelist IDs Count: ${pIds.length}, Names: "${iv.interviewerNames}"`);
  }

  // 5. Roles Check (34 DA, 1 BA)
  const roleCounts = {};
  candidates.forEach(c => {
    roleCounts[c.preferredRole] = (roleCounts[c.preferredRole] || 0) + 1;
  });
  console.log('\nRoles Breakdown:', roleCounts);
  const baCand = candidates.find(c => c.preferredRole === 'Business Analyst Intern');
  console.log(`Business Analyst Intern Candidate: #${baCand.customFields?.source_serial} ${baCand.fullName} (Job ID: ${baCand.applications[0]?.jobId})`);

  // 6. Quality Checks Gate Check
  const qcEntries = await prisma.qualityCheck.findMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`\nQuality Checks Queue entries created for these candidates: ${qcEntries.length} (Expected: 0)`);

  // 7. Full Table Output
  console.log('\n--- FINAL INJECTION TABLE OF ALL 35 CANDIDATES ---');
  const summaryTable = candidates.map(c => {
    const iv = interviews.find(i => i.candidateId === c.id);
    const fb = c.interviewFeedbacks[0];
    return {
      serial: c.customFields?.source_serial,
      name: c.fullName,
      candidateId: c.id,
      role: c.preferredRole,
      status: iv?.outcome || c.status,
      rating: fb?.overallRating !== null && fb?.overallRating !== undefined ? fb.overallRating : 'BLANK',
      unverifiedRating: c.customFields?.rating_unverified ? 'YES' : 'NO',
      panelists: iv?.interviewerNames,
      needsContact: c.customFields?.needs_contact_details ? 'YES' : 'NO'
    };
  });
  summaryTable.sort((a, b) => a.serial - b.serial);
  console.table(summaryTable);

  await prisma.$disconnect();
}

runPostCheck().catch(console.error);
