'use strict';

const prisma = require('../config/db');

async function getBaselines() {
  console.log('=== PHASE 0 / PHASE 6 BASELINE RECORD COUNTS ===');
  const userCount = await prisma.user.count();
  const candidateCount = await prisma.candidate.count({ where: { isDeleted: false } });
  const interviewCount = await prisma.interview.count();
  const applicationCount = await prisma.application.count();
  const collegeDriveCount = await prisma.collegeDrive.count();
  const collegeDriveCandidateCount = await prisma.collegeDriveCandidate.count();

  console.log(JSON.stringify({
    userCount,
    candidateCount,
    interviewCount,
    applicationCount,
    collegeDriveCount,
    collegeDriveCandidateCount,
  }, null, 2));

  // Check admin user
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@ats.local' },
    select: { id: true, email: true, role: true, organizationId: true }
  });
  console.log('Admin user:', adminUser);

  await prisma.$disconnect();
}

getBaselines().catch(err => {
  console.error('Baseline check error:', err);
  process.exit(1);
});
