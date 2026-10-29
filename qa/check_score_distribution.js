const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkScoreDistribution() {
  const scores = await prisma.matchScore.findMany({
    where: { isPrimary: true },
    include: {
      candidate: {
        select: {
          id: true,
          fullName: true,
          preferredRole: true,
          parsedResume: {
            select: {
              rawText: true,
              meta: true,
            }
          }
        }
      },
      jobDescription: { select: { title: true } }
    },
    orderBy: { overall: 'asc' }
  });

  console.log(`Total primary match scores: ${scores.length}\n`);

  const bandCounts = {};
  const roleCounts = {};

  for (const s of scores) {
    bandCounts[s.band] = (bandCounts[s.band] || 0) + 1;
    const role = s.jobDescription?.title || 'Unknown';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  console.log('--- Band Distribution ---');
  console.log(JSON.stringify(bandCounts, null, 2));

  console.log('\n--- Role Distribution ---');
  console.log(JSON.stringify(roleCounts, null, 2));

  console.log('\n--- 10 Lowest Scores & Text Lengths ---');
  for (const s of scores.slice(0, 10)) {
    const rawLen = s.candidate?.parsedResume?.rawText?.length || 0;
    const meta = s.candidate?.parsedResume?.meta;
    console.log(`Candidate: ${s.candidate?.fullName} (${s.candidate?.preferredRole})`);
    console.log(`  Rating: ${s.ratingOutOf10} (${s.overall}/100, Band: ${s.band}) | JD: ${s.jobDescription?.title}`);
    console.log(`  Raw Text Length: ${rawLen} chars | Meta: ${JSON.stringify(meta)}`);
    console.log(`  SubScores: ${JSON.stringify(s.subScores)}`);
  }

  // Check 5 Highest Scores
  console.log('\n--- 5 Highest Scores & Text Lengths ---');
  for (const s of scores.slice(-5).reverse()) {
    const rawLen = s.candidate?.parsedResume?.rawText?.length || 0;
    console.log(`Candidate: ${s.candidate?.fullName} (${s.candidate?.preferredRole})`);
    console.log(`  Rating: ${s.ratingOutOf10} (${s.overall}/100, Band: ${s.band}) | JD: ${s.jobDescription?.title} | TextLen: ${rawLen}`);
  }

  await prisma.$disconnect();
}

checkScoreDistribution().catch(console.error);
