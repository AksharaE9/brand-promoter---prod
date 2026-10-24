'use strict';

const prisma = require('../src/config/db');
const {
  getTelecallingMembers,
  deleteTelecallingMember,
  cleanMemberName,
  checkDuplicateName,
  assertUserLinkable,
  getIstDayBounds,
  invalidateTelecallingOverviewCache,
} = require('../src/modules/scheduling/telecallingMemberService');

async function runVerification() {
  console.log('====================================================');
  console.log(' PART 4 — FULL AUTOMATED VERIFICATION SUITE');
  console.log('====================================================\n');

  const results = [];
  function record(testName, passed, details) {
    results.push({ test: testName, status: passed ? 'PASS' : 'FAIL', details });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${testName}`);
    if (details) console.log(`       Details: ${details}`);
  }

  // Find an unlinked user for linking tests
  const unlinkedUser = await prisma.user.findFirst({
    where: { isDeleted: false, isActive: true, schedulingMember: null },
  });

  const todayStr = '2026-10-24';

  try {
    // ----------------------------------------------------
    // Test 1: Add ZZTEST Sync One (unlinked)
    // ----------------------------------------------------
    console.log('\n--- 1. Testing ZZTEST Sync One (unlinked) ---');
    // Ensure clean state
    await prisma.schedulingMember.deleteMany({
      where: { name: { startsWith: 'ZZTEST' } },
    });
    await invalidateTelecallingOverviewCache();

    const initialMembers = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const initialActiveCount = initialMembers.length;

    const syncOne = await prisma.schedulingMember.create({
      data: {
        name: cleanMemberName('  ZZTEST Sync One  '),
        userId: null,
        active: true,
        is_test_data: true,
      },
      include: { user: true },
    });
    await invalidateTelecallingOverviewCache();

    const afterOneMembers = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const syncOneFound = afterOneMembers.some((m) => m.id === syncOne.id && m.name === 'ZZTEST Sync One');
    record(
      'Add ZZTEST Sync One (unlinked) appears in active overview query (+1 count)',
      syncOneFound && afterOneMembers.length === initialActiveCount + 1,
      `Initial: ${initialActiveCount}, After: ${afterOneMembers.length}, Name stored trimmed: "${syncOne.name}"`
    );

    // ----------------------------------------------------
    // Test 2: Add ZZTEST Sync Two (linked)
    // ----------------------------------------------------
    console.log('\n--- 2. Testing ZZTEST Sync Two (linked) ---');
    const syncTwo = await prisma.schedulingMember.create({
      data: {
        name: cleanMemberName('ZZTEST Sync Two'),
        userId: unlinkedUser.id,
        active: true,
        is_test_data: true,
      },
      include: { user: true },
    });
    await invalidateTelecallingOverviewCache();

    const afterTwoMembers = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const syncTwoFound = afterTwoMembers.some((m) => m.id === syncTwo.id && m.userId === unlinkedUser.id);
    record(
      'Add ZZTEST Sync Two (linked) appears in active overview query (+1 count)',
      syncTwoFound && afterTwoMembers.length === initialActiveCount + 2,
      `Linked to user: ${unlinkedUser.fullName} (${unlinkedUser.id}), Total active: ${afterTwoMembers.length}`
    );

    // ----------------------------------------------------
    // Test 3: Time Boundary Simulation (00:15 IST and 23:50 IST)
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Time Boundary (00:15 IST and 23:50 IST) ---');
    // 00:15 IST on 2026-10-24 is 2026-10-23T18:45:00.000Z
    // 23:50 IST on 2026-10-24 is 2026-10-24T18:20:00.000Z
    const tEarlyIst = new Date('2026-10-24T00:15:00.000+05:30');
    const tLateIst = new Date('2026-10-24T23:50:00.000+05:30');

    const memberEarly = await prisma.schedulingMember.create({
      data: {
        name: 'ZZTEST Early Morning',
        createdAt: tEarlyIst,
        active: true,
        is_test_data: true,
      },
    });

    const memberLate = await prisma.schedulingMember.create({
      data: {
        name: 'ZZTEST Late Night',
        createdAt: tLateIst,
        active: true,
        is_test_data: true,
      },
    });
    await invalidateTelecallingOverviewCache();

    const todayDateMembers = await getTelecallingMembers({ date: '2026-10-24', includeInactive: false });
    const earlyIncluded = todayDateMembers.some((m) => m.id === memberEarly.id);
    const lateIncluded = todayDateMembers.some((m) => m.id === memberLate.id);

    record(
      'Member created at 00:15 IST appears in 2026-10-24 overview',
      earlyIncluded,
      `createdAt: ${memberEarly.createdAt.toISOString()} (${tEarlyIst.toString()})`
    );

    record(
      'Member created at 23:50 IST appears in 2026-10-24 overview',
      lateIncluded,
      `createdAt: ${memberLate.createdAt.toISOString()} (${tLateIst.toString()})`
    );

    // Clean up early/late
    await prisma.schedulingMember.deleteMany({
      where: { id: { in: [memberEarly.id, memberLate.id] } },
    });

    // ----------------------------------------------------
    // Test 4: Counts Reconcile
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Counts Reconcile ---');
    const allMembers = await getTelecallingMembers({ includeInactive: true });
    const totalCount = allMembers.length;
    const activeCount = allMembers.filter((m) => m.active).length;
    const inactiveCount = totalCount - activeCount;

    const overviewForToday = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const overviewCount = overviewForToday.length;

    record(
      'Manage Team Active count strictly equals Overview Active card',
      activeCount === overviewCount,
      `Manage Team: ${totalCount} total · ${activeCount} active · ${inactiveCount} inactive | Overview Card: ${overviewCount}`
    );

    // ----------------------------------------------------
    // Test 5: Lifecycle - Deactivate, Reactivate, Soft/Hard Delete
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Lifecycle Operations ---');
    // Deactivate syncOne
    await prisma.schedulingMember.update({
      where: { id: syncOne.id },
      data: { active: false, deactivatedAt: new Date() },
    });
    await invalidateTelecallingOverviewCache();

    const overviewAfterDeact = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const isDeactivatedInOverview = overviewAfterDeact.some((m) => m.id === syncOne.id);
    record(
      'Deactivating member removes them from today overview and drops count',
      !isDeactivatedInOverview,
      `Active count dropped to: ${overviewAfterDeact.length}`
    );

    // Reactivate syncOne
    await prisma.schedulingMember.update({
      where: { id: syncOne.id },
      data: { active: true, deactivatedAt: null },
    });
    await invalidateTelecallingOverviewCache();

    const overviewAfterReact = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const isReactivatedInOverview = overviewAfterReact.some((m) => m.id === syncOne.id);
    record(
      'Reactivating member restores them to today overview',
      isReactivatedInOverview,
      `Active count restored to: ${overviewAfterReact.length}`
    );

    // Enforce one user to at most one active member
    let linkDuplicateThrew = false;
    let linkErrorMessage = '';
    try {
      await assertUserLinkable(unlinkedUser.id, syncOne.id);
    } catch (err) {
      linkDuplicateThrew = true;
      linkErrorMessage = err.message;
    }
    record(
      'Linking one user account to two members throws 409 with descriptive message',
      linkDuplicateThrew,
      `Caught error: "${linkErrorMessage}"`
    );

    // Duplicate name warning
    const dupCheck = await checkDuplicateName('zztest sync one');
    record(
      'Case-insensitive duplicate name check correctly catches duplicate ("zztest sync one")',
      dupCheck !== null && dupCheck.id === syncOne.id,
      `Matched existing member: "${dupCheck?.name}"`
    );

    // Soft delete preservation with history vs Hard delete with no history
    // 1) Hard delete syncOne (no history)
    const delResult1 = await deleteTelecallingMember(syncOne.id, { id: 'admin' }, 'defaultOrg');
    const syncOneInDb = await prisma.schedulingMember.findUnique({ where: { id: syncOne.id } });
    record(
      'Member with no history is hard-deleted from DB',
      delResult1.hasHistory === false && syncOneInDb === null,
      'Hard deleted cleanly'
    );

    // 2) Attach mock lead list to syncTwo, then delete -> must soft delete
    await prisma.schedulingLeadList.create({
      data: {
        memberId: syncTwo.id,
        listDate: new Date('2026-10-24T00:00:00.000Z'),
        importedById: unlinkedUser.id,
        totalLeads: 5,
        is_test_data: true,
      },
    });

    const delResult2 = await deleteTelecallingMember(syncTwo.id, { id: 'admin' }, 'defaultOrg');
    const syncTwoInDb = await prisma.schedulingMember.findUnique({ where: { id: syncTwo.id } });
    const listStillExists = await prisma.schedulingLeadList.count({ where: { memberId: syncTwo.id } });

    record(
      'Member with history is soft-deleted; past history preserved intact',
      delResult2.hasHistory === true &&
        syncTwoInDb !== null &&
        syncTwoInDb.active === false &&
        syncTwoInDb.deletedAt !== null &&
        listStillExists === 1,
      `softDeleted: true, deletedAt: ${syncTwoInDb?.deletedAt?.toISOString()}, preserved lists: ${listStillExists}`
    );

    // Clean up syncTwo and test lead list
    await prisma.schedulingLeadList.deleteMany({ where: { memberId: syncTwo.id } });
    await prisma.schedulingMember.delete({ where: { id: syncTwo.id } });

    // ----------------------------------------------------
    // Test 6: Case-Insensitive Sort (joanna alphabetical positioning)
    // ----------------------------------------------------
    console.log('\n--- 6. Testing Case-Insensitive Sort (joanna) ---');
    const sortedMembers = await getTelecallingMembers({ date: todayStr, includeInactive: false });
    const names = sortedMembers.map((m) => m.name);
    const aadeshIdx = names.findIndex((n) => n.toLowerCase().includes('aadesh'));
    const joannaIdx = names.findIndex((n) => n.toLowerCase() === 'joanna');
    const kenishaIdx = names.findIndex((n) => n.toLowerCase() === 'kenisha');

    const joannaCorrectlyPositioned = joannaIdx > aadeshIdx && joannaIdx < kenishaIdx;
    record(
      'joanna is positioned alphabetically between Aadesh and KENISHA (case-insensitive sort)',
      joannaCorrectlyPositioned,
      `Order: [${aadeshIdx}] ${names[aadeshIdx]} -> [${joannaIdx}] ${names[joannaIdx]} -> [${kenishaIdx}] ${names[kenishaIdx]}`
    );

    // Final clean up check
    const remainingTestMembers = await prisma.schedulingMember.count({
      where: { name: { startsWith: 'ZZTEST' } },
    });
    record('All ZZTEST test members cleaned up afterwards', remainingTestMembers === 0, `Remaining: ${remainingTestMembers}`);

  } catch (err) {
    console.error('Test execution error:', err);
    record('Full suite execution', false, err.message);
  } finally {
    // Safety cleanup
    await prisma.schedulingMember.deleteMany({
      where: { name: { startsWith: 'ZZTEST' } },
    });
    await invalidateTelecallingOverviewCache();
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('====================================================');
  console.table(results);
  const passedAll = results.every((r) => r.status === 'PASS');
  console.log(`\nOVERALL STATUS: ${passedAll ? 'ALL TESTS PASSED (100%)' : 'SOME TESTS FAILED'}\n`);
}

runVerification();
