const fs = require('fs');
const path = require('path');
const prisma = require('../backend/src/config/db');

async function main() {
  const report = {};

  // 1. NMIT
  const nmitDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'Nitte', mode: 'insensitive' } }
  });
  const nmitCdc = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: nmitDrive.id }
  });
  const nmitCandIds = nmitCdc.map(c => c.candidateId);
  const nmitCands = await prisma.candidate.findMany({
    where: { id: { in: nmitCandIds } }
  });
  const nmitInts = await prisma.interview.findMany({
    where: { candidateId: { in: nmitCandIds } },
    orderBy: { roundNo: 'asc' }
  });
  const nmitFbs = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: nmitCandIds } }
  });

  report.nmit = {
    drive: nmitDrive,
    totalCdc: nmitCdc.length,
    candidates: nmitCands.map(c => {
      const ints = nmitInts.filter(i => i.candidateId === c.id);
      const fbs = nmitFbs.filter(f => f.candidateId === c.id);
      return {
        id: c.id,
        name: c.fullName,
        phone: c.phone,
        email: c.email,
        source: c.source,
        interviews: ints.map(i => ({ roundNo: i.roundNo, round: i.round, status: i.status, outcome: i.outcome, rating: i.rating, notes: i.notes, updatedAt: i.updatedAt })),
        feedbacks: fbs.map(f => ({ round: f.round, selectionStatus: f.selectionStatus, rating: f.overallRating }))
      };
    })
  };

  // 2. Jain
  const jainDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'JAIN', mode: 'insensitive' } }
  });
  const jainCdc = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: jainDrive.id }
  });
  const jainCandIds = jainCdc.map(c => c.candidateId);
  const jainCands = await prisma.candidate.findMany({
    where: { id: { in: jainCandIds } }
  });
  const jainInts = await prisma.interview.findMany({
    where: { candidateId: { in: jainCandIds } },
    orderBy: { roundNo: 'asc' }
  });
  const jainFbs = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: jainCandIds } }
  });

  report.jain = {
    drive: jainDrive,
    totalCdc: jainCdc.length,
    candidates: jainCands.map(c => {
      const ints = jainInts.filter(i => i.candidateId === c.id);
      const fbs = jainFbs.filter(f => f.candidateId === c.id);
      return {
        id: c.id,
        name: c.fullName,
        phone: c.phone,
        email: c.email,
        source: c.source,
        createdAt: c.createdAt,
        interviews: ints.map(i => ({ roundNo: i.roundNo, round: i.round, status: i.status, outcome: i.outcome, rating: i.rating, notes: i.notes, updatedAt: i.updatedAt })),
        feedbacks: fbs.map(f => ({ round: f.round, selectionStatus: f.selectionStatus, rating: f.overallRating }))
      };
    })
  };

  // 3. MVJ Soumya Badiger & all MVJ
  const mvjDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'MVJ', mode: 'insensitive' } }
  });
  const mvjCdc = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: mvjDrive.id }
  });
  const mvjCandIds = mvjCdc.map(c => c.candidateId);
  const mvjCands = await prisma.candidate.findMany({
    where: { id: { in: mvjCandIds } }
  });
  const mvjInts = await prisma.interview.findMany({
    where: { candidateId: { in: mvjCandIds } },
    orderBy: { roundNo: 'asc' }
  });
  const mvjFbs = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: mvjCandIds } }
  });
  report.mvj = {
    drive: mvjDrive,
    totalCdc: mvjCdc.length,
    candidates: mvjCands.map(c => {
      const ints = mvjInts.filter(i => i.candidateId === c.id);
      const fbs = mvjFbs.filter(f => f.candidateId === c.id);
      return {
        id: c.id,
        name: c.fullName,
        phone: c.phone,
        email: c.email,
        source: c.source,
        interviews: ints.map(i => ({ roundNo: i.roundNo, round: i.round, status: i.status, outcome: i.outcome, rating: i.rating, notes: i.notes, updatedAt: i.updatedAt })),
        feedbacks: fbs.map(f => ({ round: f.round, selectionStatus: f.selectionStatus, rating: f.overallRating }))
      };
    })
  };

  // 4. BGS
  const bgsDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'BGS', mode: 'insensitive' } }
  });
  const bgsCdc = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: bgsDrive.id }
  });
  const bgsCandIds = bgsCdc.map(c => c.candidateId);
  const bgsCands = await prisma.candidate.findMany({
    where: { id: { in: bgsCandIds } }
  });
  const bgsInts = await prisma.interview.findMany({
    where: { candidateId: { in: bgsCandIds } },
    orderBy: { roundNo: 'asc' }
  });
  const bgsFbs = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: bgsCandIds } }
  });
  report.bgs = {
    drive: bgsDrive,
    totalCdc: bgsCdc.length,
    candidates: bgsCands.map(c => {
      const ints = bgsInts.filter(i => i.candidateId === c.id);
      const fbs = bgsFbs.filter(f => f.candidateId === c.id);
      return {
        id: c.id,
        name: c.fullName,
        phone: c.phone,
        email: c.email,
        interviews: ints.map(i => ({ roundNo: i.roundNo, round: i.round, status: i.status, outcome: i.outcome, rating: i.rating, notes: i.notes })),
        feedbacks: fbs.map(f => ({ round: f.round, selectionStatus: f.selectionStatus, rating: f.overallRating }))
      };
    })
  };

  // 5. Gopalan
  const gopalanDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'Gopalan', mode: 'insensitive' } }
  });
  const gopalanCdc = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: gopalanDrive.id }
  });
  const gopalanCandIds = gopalanCdc.map(c => c.candidateId);
  const gopalanCands = await prisma.candidate.findMany({
    where: { id: { in: gopalanCandIds } }
  });
  const gopalanInts = await prisma.interview.findMany({
    where: { candidateId: { in: gopalanCandIds } },
    orderBy: { roundNo: 'asc' }
  });
  const gopalanFbs = await prisma.interviewFeedback.findMany({
    where: { candidateId: { in: gopalanCandIds } }
  });
  report.gopalan = {
    drive: gopalanDrive,
    totalCdc: gopalanCdc.length,
    candidates: gopalanCands.map(c => {
      const ints = gopalanInts.filter(i => i.candidateId === c.id);
      const fbs = gopalanFbs.filter(f => f.candidateId === c.id);
      return {
        id: c.id,
        name: c.fullName,
        phone: c.phone,
        email: c.email,
        interviews: ints.map(i => ({ roundNo: i.roundNo, round: i.round, status: i.status, outcome: i.outcome, rating: i.rating, notes: i.notes })),
        feedbacks: fbs.map(f => ({ round: f.round, selectionStatus: f.selectionStatus, rating: f.overallRating }))
      };
    })
  };

  const outPath = path.join(__dirname, 'reports', 'drive_investigation_results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Investigation report saved successfully to ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
