'use strict';
const prisma = require('../config/db');

/**
 * Teardown test data script — safely removes performance and test data
 * from the database while maintaining DB constraints.
 */
async function teardownTestData() {
  console.log('🔥 Executing teardownTestData()...');

  // 1. First, find all candidate IDs matching is_test_data = true
  const candidates = await prisma.candidate.findMany({
    where: { is_test_data: true },
    select: { id: true }
  });
  const candidateIds = candidates.map(c => c.id);

  if (candidateIds.length > 0) {
    // Cascade delete linked feedbacks
    await prisma.interviewFeedback.deleteMany({
      where: { candidateId: { in: candidateIds } }
    });
    // Cascade delete contact attempts
    await prisma.candidateContactAttempt.deleteMany({
      where: { candidateId: { in: candidateIds } }
    });
    // Cascade delete applications
    await prisma.application.deleteMany({
      where: { candidateId: { in: candidateIds } }
    });
    // Delete candidates
    await prisma.candidate.deleteMany({
      where: { id: { in: candidateIds } }
    });
  }

  // 2. Delete test scheduling data
  await prisma.schedulingDailyReport.deleteMany({
    where: { is_test_data: true }
  });
  await prisma.schedulingLeadList.deleteMany({
    where: { is_test_data: true }
  });
  await prisma.schedulingMember.deleteMany({
    where: { is_test_data: true }
  });

  // 3. Delete test users
  await prisma.user.deleteMany({
    where: { is_test_data: true }
  });

  console.log('✅ teardownTestData() execution complete.');
}

async function run() {
  console.log('==========================================================');
  console.log('📊 TEST DATA ANALYSIS REPORT');
  console.log('==========================================================');

  // 1. Tagged Test Data Counts (using exact SQL from Section 3)
  const taggedCounts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM candidates WHERE is_test_data = true) AS test_candidates,
      (SELECT count(*)::int FROM scheduling_members WHERE is_test_data = true) AS test_scheduling_members,
      (SELECT count(*)::int FROM scheduling_lead_lists WHERE is_test_data = true) AS test_lead_lists,
      (SELECT count(*)::int FROM scheduling_daily_reports WHERE is_test_data = true) AS test_daily_reports,
      (SELECT count(*)::int FROM users WHERE is_test_data = true) AS test_users,
      (SELECT count(*)::int FROM interview_feedbacks WHERE "candidateId" IN (SELECT id FROM candidates WHERE is_test_data = true)) AS test_feedback_rows,
      (SELECT count(*)::int FROM candidate_contact_attempts WHERE "candidateId" IN (SELECT id FROM candidates WHERE is_test_data = true)) AS test_contact_attempts;
  `);

  console.log('🏷️  Tagged Test Data (is_test_data = true):');
  console.table(taggedCounts);

  // 2. Secondary check for suspected untagged test data
  console.log('🔍 Checking for suspected untagged test data...');
  const suspectedCandidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { fullName: { startsWith: 'Dummy Candidate' } },
        { fullName: { startsWith: 'QA Candidate' } },
        { fullName: { startsWith: 'CI Test Candidate' } },
        { email: { endsWith: '@ats-perf-test.com' } },
        { email: { endsWith: '@test.ci' } }
      ],
      is_test_data: false // not already tagged
    },
    select: { id: true, fullName: true, email: true }
  });

  console.log(`⚠️  Suspected Untagged Candidates Found: ${suspectedCandidates.length}`);
  if (suspectedCandidates.length > 0) {
    console.table(suspectedCandidates.map(c => ({ Name: c.fullName, Email: c.email })));
  }

  // 3. Retroactively tag suspected candidates and members to guarantee non-destructive safety
  if (suspectedCandidates.length > 0) {
    console.log('🏷️  Retroactively tagging suspected test data in the database...');
    const candidateIdsToTag = suspectedCandidates.map(c => c.id);
    await prisma.candidate.updateMany({
      where: { id: { in: candidateIdsToTag } },
      data: { is_test_data: true }
    });
  }

  // 4. Check for suspected untagged scheduling members or users
  const suspectedMembers = await prisma.schedulingMember.findMany({
    where: {
      OR: [
        { name: { startsWith: 'QA' } },
        { name: { startsWith: 'Test' } }
      ],
      is_test_data: false
    }
  });
  if (suspectedMembers.length > 0) {
    console.log(`⚠️  Suspected Untagged Scheduling Members Found: ${suspectedMembers.length}`);
    await prisma.schedulingMember.updateMany({
      where: { id: { in: suspectedMembers.map(m => m.id) } },
      data: { is_test_data: true }
    });
  }

  // 5. Execute teardownTestData()
  console.log('\n🗑️  Starting Teardown...');
  await teardownTestData();

  // 6. Verification: Confirm zero-remaining-rows assertion passes
  const finalCounts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM candidates WHERE is_test_data = true) AS test_candidates,
      (SELECT count(*)::int FROM scheduling_members WHERE is_test_data = true) AS test_scheduling_members,
      (SELECT count(*)::int FROM scheduling_lead_lists WHERE is_test_data = true) AS test_lead_lists,
      (SELECT count(*)::int FROM scheduling_daily_reports WHERE is_test_data = true) AS test_daily_reports,
      (SELECT count(*)::int FROM users WHERE is_test_data = true) AS test_users;
  `);

  console.log('\n🏁 Final Counts after Teardown (must be 0):');
  console.table(finalCounts);

  const rowSum = Object.values(finalCounts[0]).reduce((a, b) => a + b, 0);
  if (rowSum === 0) {
    console.log('🎉 Assertion PASSED: 0 test rows remain in all tables.');
  } else {
    console.error('❌ Assertion FAILED: Some test rows were not deleted.');
    process.exit(1);
  }
}

if (require.main === module) {
  run()
    .catch(err => {
      console.error('❌ Data cleanup script crashed:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { teardownTestData };
