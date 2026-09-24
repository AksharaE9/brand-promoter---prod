'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.RENDER_DATABASE_URL || 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require' } }
});

async function main() {
  console.log('=== VERIFYING BGS COLLEGE INJECTION ===\n');

  // 1. Candidate counts
  const candidates = await prisma.candidate.findMany({
    where: { source: 'BGS_COLLEGE_DRIVE_IMPORT', isDeleted: false },
    include: {
      applications: {
        include: {
          job: true,
          interviews: true
        }
      },
      interviewFeedbacks: true
    }
  });

  console.log(`1. Injected Candidates count: ${candidates.length}`);
  if (candidates.length !== 41) throw new Error(`Expected 41 candidates, found ${candidates.length}`);

  const selectedCount = candidates.filter(c => c.status === 'ACTIVE').length;
  const rejectedCount = candidates.filter(c => c.status === 'REJECTED').length;
  console.log(`2. Status breakdown: Selected (ACTIVE)=${selectedCount}, Rejected=${rejectedCount}`);
  if (selectedCount !== 24 || rejectedCount !== 17) {
    throw new Error(`Expected 24 selected and 17 rejected, got ${selectedCount} selected and ${rejectedCount} rejected`);
  }

  // 3. Round 1 interviews check
  let allRoundsAreOne = true;
  let hasRound2 = false;
  let totalInterviews = 0;
  for (const c of candidates) {
    for (const app of c.applications) {
      totalInterviews += app.interviews.length;
      for (const intv of app.interviews) {
        if (intv.roundNo !== 1) allRoundsAreOne = false;
        if (intv.roundNo === 2 || /round 2/i.test(intv.round || '')) hasRound2 = true;
      }
    }
  }
  console.log(`3. Total Interviews: ${totalInterviews} across ${candidates.length} candidates. All Round 1: ${allRoundsAreOne}, Has Round 2: ${hasRound2}`);
  if (!allRoundsAreOne || hasRound2 || totalInterviews !== 41) {
    throw new Error('Interview rounds invariant violation!');
  }

  // 4. College Drive Check
  const bgsCollege = await prisma.college.findFirst({ where: { name: 'BGS College' } });
  console.log(`4. BGS College: ${bgsCollege?.name} (ID: ${bgsCollege?.id})`);

  const bgsDrive = await prisma.collegeDrive.findFirst({
    where: { collegeId: bgsCollege.id, isDeleted: false }
  });
  console.log(`5. BGS College Drive: "${bgsDrive?.title}" (ID: ${bgsDrive?.id})`);

  const driveCandidatesCount = await prisma.collegeDriveCandidate.count({
    where: { driveId: bgsDrive.id }
  });
  console.log(`6. College Drive enrolled candidate count: ${driveCandidatesCount}`);
  if (driveCandidatesCount !== 41) {
    throw new Error(`Expected 41 enrolled candidates in drive, got ${driveCandidatesCount}`);
  }

  // 5. Roles breakdown
  const daRoles = candidates.filter(c => c.preferredRole === 'Data Analyst Intern').length;
  const baRoles = candidates.filter(c => c.preferredRole === 'Business Analyst Intern').length;
  console.log(`7. Roles: Data Analyst Intern=${daRoles}, Business Analyst Intern=${baRoles}`);
  if (daRoles !== 38 || baRoles !== 3) {
    // 40 DA total in 43 list, minus 2 held Santosh khul = 38 DA, 3 BA
    throw new Error(`Role distribution unexpected: DA=${daRoles}, BA=${baRoles}`);
  }

  // 6. Spot-checks
  console.log('\n=== SPOT CHECKS (8 CANDIDATES) ===');
  const spotCheckNames = [
    'Shamitha Krishna A', // Selected, Vinay, DA
    'Rakshitha S',        // Selected, Vinay, DA
    'Theertha varshini D',// Selected, Vinay, BA
    'Vaishnavi',          // Selected, Praneel, DA
    'Sushmita TK',        // Selected, Praneel, DA (Rating 8)
    'hitha Sh',           // Selected, Praneel, DA (Rating 8)
    'Shubha D C',         // Rejected, Vinay, BA
    'PRATHIBHA KS'        // Rejected, Praneel, DA
  ];

  for (const name of spotCheckNames) {
    const c = candidates.find(cand => cand.fullName === name);
    if (!c) throw new Error(`Spot check candidate ${name} not found!`);
    const fb = c.interviewFeedbacks[0];
    const intv = c.applications[0]?.interviews[0];
    console.log(`\n- Candidate: ${c.fullName}`);
    console.log(`  Status: ${c.status} | Preferred Role: ${c.preferredRole}`);
    console.log(`  Assigned Recruiter: ${c.assignedRecruiterName}`);
    console.log(`  Rating: ${fb?.overallRating} | Outcome: ${intv?.outcome}`);
    console.log(`  Needs Contact Details: ${c.customFields?.needs_contact_details}`);
    console.log(`  Source Tag: ${c.source}`);
    console.log(`  DOJ: ${c.doj}`);
    console.log(`  Comment Preview: ${fb?.feedbackData?.comments?.substring(0, 100)}...`);
  }

  console.log('\n✅ ALL VERIFICATION INVARIANTS PASSED SUCCESSFULLY.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
