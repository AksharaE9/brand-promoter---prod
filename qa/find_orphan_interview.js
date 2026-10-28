const prisma = require('../backend/src/config/db');

async function main() {
  const allInterviews = await prisma.interview.findMany({
    select: { id: true, candidateId: true, candidateName: true, status: true, round: true, createdAt: true }
  });

  console.log(`Total interviews: ${allInterviews.length}`);

  const candIds = [...new Set(allInterviews.map(i => i.candidateId).filter(Boolean))];
  const existingCands = await prisma.candidate.findMany({
    where: { id: { in: candIds } },
    select: { id: true }
  });
  const existingSet = new Set(existingCands.map(c => c.id));

  const orphans = allInterviews.filter(i => i.candidateId && !existingSet.has(i.candidateId));
  console.log(`Found ${orphans.length} orphan interview(s):`);
  console.log(JSON.stringify(orphans, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
