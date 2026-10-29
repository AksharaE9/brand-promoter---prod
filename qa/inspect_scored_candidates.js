// qa/inspect_scored_candidates.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function main() {
  const primaryScores = await prisma.matchScore.findMany({
    where: { isPrimary: true },
    include: {
      candidate: {
        select: {
          id: true,
          fullName: true,
          preferredRole: true,
          updatedAt: true,
          createdAt: true,
          isDeleted: true
        }
      },
      jobDescription: { select: { title: true } }
    },
    orderBy: { candidate: { updatedAt: 'desc' } }
  });

  console.log(`Found ${primaryScores.length} primary match scores.`);
  console.log('Top 15 scored candidates by candidate updatedAt:');
  for (const s of primaryScores.slice(0, 15)) {
    console.log(`- ${s.candidate?.fullName} (${s.candidate?.preferredRole}) | JD: ${s.jobDescription?.title} | Rating: ${s.ratingOutOf10}/10 | updatedAt: ${s.candidate?.updatedAt?.toISOString()}`);
  }

  console.log('\nBottom 5 scored candidates:');
  for (const s of primaryScores.slice(-5)) {
    console.log(`- ${s.candidate?.fullName} (${s.candidate?.preferredRole}) | JD: ${s.jobDescription?.title} | Rating: ${s.ratingOutOf10}/10 | updatedAt: ${s.candidate?.updatedAt?.toISOString()}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
