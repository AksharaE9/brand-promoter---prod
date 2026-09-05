'use strict';

const prisma = require('../config/db');

async function cleanAll() {
  // Find all test candidates
  const testCands = await prisma.candidate.findMany({
    where: {
      OR: [
        { fullName: { contains: 'ZZTEST' } },
        { email: { contains: 'zztest' } },
        { phone: { startsWith: '+919999' } },
        { phoneNormalized: { startsWith: '9999' } },
        { phone: '1.42E+10' },
        { phoneNormalized: '14200000000' },
      ]
    },
    select: { id: true }
  });
  const candIds = testCands.map(c => c.id);

  // Find all applications
  const testApps = await prisma.application.findMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
        { candidate: { fullName: { contains: 'ZZTEST' } } }
      ]
    },
    select: { id: true }
  });
  const appIds = testApps.map(a => a.id);

  // 1. Delete interviews linked to candidates OR applications
  await prisma.interview.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
        ...(appIds.length > 0 ? [{ applicationId: { in: appIds } }] : []),
        { candidateName: { contains: 'ZZTEST' } },
      ]
    }
  });

  // 2. Delete feedbacks
  await prisma.interviewFeedback.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
      ]
    }
  });

  // 3. Delete drive candidates
  await prisma.collegeDriveCandidate.deleteMany({
    where: {
      OR: [
        { fullName: { contains: 'ZZTEST' } },
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
      ]
    }
  });

  // 4. Delete pipeline events
  if (appIds.length > 0) {
    await prisma.pipelineEvent.deleteMany({
      where: { applicationId: { in: appIds } }
    }).catch(() => {});
  }

  // 5. Delete applications
  await prisma.application.deleteMany({
    where: {
      OR: [
        ...(appIds.length > 0 ? [{ id: { in: appIds } }] : []),
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
      ]
    }
  });

  // 6. Delete candidates
  await prisma.candidate.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ id: { in: candIds } }] : []),
        { fullName: { contains: 'ZZTEST' } },
        { email: { contains: 'zztest' } },
      ]
    }
  });

  // 7. Delete auto-created jobs
  await prisma.job.deleteMany({
    where: {
      OR: [
        { title: { contains: 'ZZTEST' } },
        { source: 'BULK_IMPORT_AUTO' }
      ]
    }
  }).catch(() => {});

  const finalCounts = {
    userCount: await prisma.user.count(),
    candidateCount: await prisma.candidate.count({ where: { isDeleted: false } }),
    interviewCount: await prisma.interview.count(),
    interviewFeedbackCount: await prisma.interviewFeedback.count(),
    applicationCount: await prisma.application.count(),
    collegeDriveCandidateCount: await prisma.collegeDriveCandidate.count(),
  };
  console.log('[CLEAN DATABASE COUNTS]', JSON.stringify(finalCounts, null, 2));

  await prisma.$disconnect();
}

cleanAll().catch(err => {
  console.error('cleanAll error:', err);
  process.exit(1);
});
