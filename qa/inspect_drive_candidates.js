const prisma = require('../backend/src/config/db');

async function main() {
  const drives = await prisma.collegeDrive.findMany({
    select: { id: true, title: true, dateFrom: true }
  });
  console.log('--- ALL COLLEGE DRIVES ---');
  console.table(drives);

  // Check NMIT candidates
  const nmitDrive = drives.find(d => d.title.toLowerCase().includes('nmit') || d.title.toLowerCase().includes('nitte'));
  if (nmitDrive) {
    const nmitCands = await prisma.candidate.findMany({
      where: { collegeDrives: { some: { driveId: nmitDrive.id } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        interviews: {
          select: { id: true, round: true, roundNumber: true, status: true, outcome: true, rating: true, notes: true, updatedAt: true }
        }
      }
    });
    console.log(`\n--- NMIT CANDIDATES (${nmitCands.length}) ---`);
    nmitCands.forEach((c, idx) => {
      console.log(`${idx + 1}. [${c.id}] ${c.fullName} | ${c.phone} | ${c.email}`);
      c.interviews.forEach(i => {
        console.log(`   -> Round ${i.roundNumber} (${i.round}) | status: ${i.status} | outcome: ${i.outcome} | rating: ${i.rating}`);
      });
    });
  }

  // Check Jain candidates
  const jainDrive = drives.find(d => d.title.toLowerCase().includes('jain'));
  if (jainDrive) {
    const jainCands = await prisma.candidate.findMany({
      where: { collegeDrives: { some: { driveId: jainDrive.id } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        interviews: {
          select: { id: true, round: true, roundNumber: true, status: true, outcome: true, rating: true, notes: true, updatedAt: true }
        }
      }
    });
    console.log(`\n--- JAIN CANDIDATES (${jainCands.length}) in drive ${jainDrive.title} [${jainDrive.id}] ---`);
    jainCands.forEach((c, idx) => {
      console.log(`${idx + 1}. [${c.id}] ${c.fullName} | ${c.phone} | ${c.email}`);
      c.interviews.forEach(i => {
        console.log(`   -> Round ${i.roundNumber} (${i.round}) | status: ${i.status} | outcome: ${i.outcome} | rating: ${i.rating}`);
      });
    });
  }

  // Check BGS candidates
  const bgsDrive = drives.find(d => d.title.toLowerCase().includes('bgs'));
  if (bgsDrive) {
    const bgsCands = await prisma.candidate.findMany({
      where: { collegeDrives: { some: { driveId: bgsDrive.id } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        interviews: {
          select: { id: true, round: true, roundNumber: true, status: true, outcome: true, rating: true, notes: true, updatedAt: true }
        }
      }
    });
    console.log(`\n--- BGS CANDIDATES (${bgsCands.length}) in drive ${bgsDrive.title} [${bgsDrive.id}] ---`);
    bgsCands.forEach((c, idx) => {
      console.log(`${idx + 1}. [${c.id}] ${c.fullName} | ${c.phone} | ${c.email}`);
      c.interviews.forEach(i => {
        console.log(`   -> Round ${i.roundNumber} (${i.round}) | status: ${i.status} | outcome: ${i.outcome} | rating: ${i.rating}`);
      });
    });
  }

  // Check Gopalan candidates
  const gopalanDrive = drives.find(d => d.title.toLowerCase().includes('gopalan'));
  if (gopalanDrive) {
    const gopalanCands = await prisma.candidate.findMany({
      where: { collegeDrives: { some: { driveId: gopalanDrive.id } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        interviews: {
          select: { id: true, round: true, roundNumber: true, status: true, outcome: true, rating: true, notes: true, updatedAt: true }
        }
      }
    });
    console.log(`\n--- GOPALAN CANDIDATES (${gopalanCands.length}) in drive ${gopalanDrive.title} [${gopalanDrive.id}] ---`);
    gopalanCands.forEach((c, idx) => {
      console.log(`${idx + 1}. [${c.id}] ${c.fullName} | ${c.phone} | ${c.email}`);
      c.interviews.forEach(i => {
        console.log(`   -> Round ${i.roundNumber} (${i.round}) | status: ${i.status} | outcome: ${i.outcome} | rating: ${i.rating}`);
      });
    });
  }

  // Check MVJ candidates
  const mvjDrive = drives.find(d => d.title.toLowerCase().includes('mvj'));
  if (mvjDrive) {
    const mvjCands = await prisma.candidate.findMany({
      where: { collegeDrives: { some: { driveId: mvjDrive.id } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        interviews: {
          select: { id: true, round: true, roundNumber: true, status: true, outcome: true, rating: true, notes: true, updatedAt: true }
        }
      }
    });
    console.log(`\n--- MVJ CANDIDATES (${mvjCands.length}) in drive ${mvjDrive.title} [${mvjDrive.id}] ---`);
    mvjCands.forEach((c, idx) => {
      console.log(`${idx + 1}. [${c.id}] ${c.fullName} | ${c.phone} | ${c.email}`);
      c.interviews.forEach(i => {
        console.log(`   -> Round ${i.roundNumber} (${i.round}) | status: ${i.status} | outcome: ${i.outcome} | rating: ${i.rating}`);
      });
    });
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
