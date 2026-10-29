const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkAymanFahd() {
  const cands = await prisma.candidate.findMany({
    where: { fullName: { contains: 'Ayman', mode: 'insensitive' } },
    include: {
      resumeParseJobs: { orderBy: { createdAt: 'desc' } },
      matchScores: true,
      resumeFile: { select: { id: true, storageKey: true, sizeBytes: true } }
    }
  });

  console.log(`Found ${cands.length} candidates matching Ayman:`);
  for (const c of cands) {
    console.log(`Candidate: ${c.id} | ${c.fullName} | ${c.preferredRole} | Status: ${c.status}`);
    console.log(`  Resume file:`, c.resumeFile);
    console.log(`  Resume links:`, c.resumeLinkOriginal, c.resumeLinkDownload);
    console.log(`  Parse jobs (${c.resumeParseJobs.length}):`);
    for (const j of c.resumeParseJobs) {
      console.log(`    Job ${j.id}: status=${j.status}, stage=${j.stage}, attempts=${j.attempts}, error=${j.lastError}, created=${j.createdAt.toISOString()}`);
    }
  }

  // Also check all QUEUED or RUNNING parse jobs older than 10 minutes
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
  const stuckJobs = await prisma.resumeParseJob.findMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: tenMinsAgo }
    }
  });
  console.log(`\nStuck parse jobs (> 10m): ${stuckJobs.length}`);

  await prisma.$disconnect();
}

checkAymanFahd().catch(console.error);
