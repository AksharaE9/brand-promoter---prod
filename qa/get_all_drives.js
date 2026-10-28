const prisma = require('../backend/src/config/db');

async function main() {
  const drives = await prisma.collegeDrive.findMany();
  console.log('=== ALL COLLEGE DRIVES IN DB ===');
  for (const d of drives) {
    const cdcCount = await prisma.collegeDriveCandidate.count({ where: { driveId: d.id } });
    console.log(`[${d.id}] "${d.title}" | Status: ${d.status} | DateFrom: ${d.dateFrom} | Candidates: ${cdcCount}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
