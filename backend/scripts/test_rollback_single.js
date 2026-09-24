'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.RENDER_DATABASE_URL || 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require' } }
});

async function testSingleRollback() {
  console.log('=== TESTING ROLLBACK ON A SINGLE RECORD ===');
  
  // 1. Create a dummy test candidate stamped with BGS_COLLEGE_DRIVE_IMPORT_TEST
  const TEST_SOURCE = 'BGS_COLLEGE_DRIVE_IMPORT_TEST';
  const testCand = await prisma.$transaction(async (tx) => {
    const c = await tx.candidate.create({
      data: {
        fullName: 'Test Rollback Candidate',
        email: 'N/A',
        phone: null,
        college: 'BGS College Test',
        source: TEST_SOURCE,
        status: 'ACTIVE'
      }
    });

    const app = await tx.application.create({
      data: {
        candidateId: c.id,
        jobId: 'cmrnjjhvp0092lg2ry71l2zkt', // DA Intern
        status: 'IN_PIPELINE'
      }
    });

    const intv = await tx.interview.create({
      data: {
        candidateId: c.id,
        applicationId: app.id,
        roundNo: 1,
        status: 'COMPLETED',
        notes: JSON.stringify({ source: TEST_SOURCE })
      }
    });

    const fb = await tx.interviewFeedback.create({
      data: {
        candidateId: c.id,
        round: 'ROUND_1',
        selectionStatus: 'SELECTED',
        overallRating: 8,
        feedbackData: { name: 'Test Rollback Candidate' }
      }
    });

    return { c, app, intv, fb };
  });

  console.log(`Created test candidate: ${testCand.c.id}`);

  // Verify created
  const found = await prisma.candidate.findUnique({ where: { id: testCand.c.id } });
  if (!found) throw new Error('Failed to create test candidate');
  console.log('Verified test candidate exists in DB.');

  // Rollback test record
  await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.deleteMany({ where: { candidateId: testCand.c.id } });
    await tx.interview.deleteMany({ where: { candidateId: testCand.c.id } });
    await tx.application.deleteMany({ where: { candidateId: testCand.c.id } });
    await tx.candidate.delete({ where: { id: testCand.c.id } });
  });

  // Verify deleted
  const deleted = await prisma.candidate.findUnique({ where: { id: testCand.c.id } });
  if (deleted) throw new Error('Failed to delete test candidate on rollback');
  console.log('✅ Rollback successfully verified: test candidate removed cleanly.');
}

testSingleRollback().catch(console.error).finally(() => prisma.$disconnect());
