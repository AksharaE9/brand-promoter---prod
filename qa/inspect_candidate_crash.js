const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkCand() {
  const c = await prisma.candidate.findUnique({
    where: { id: 'cmte8fv0d00biktn7fsl4f1f4' },
    include: { matchScores: true }
  });
  console.log('Candidate:', c?.fullName, c?.preferredRole);
  console.log('MatchScores count:', c?.matchScores?.length);
  if (c?.matchScores?.length) {
    for (const ms of c.matchScores) {
      console.log('--- Score ID:', ms.id, 'primary:', ms.isPrimary, 'rating:', ms.ratingOutOf10);
      console.log('matchedRequirements:', JSON.stringify(ms.matchedRequirements, null, 2));
      console.log('missingMustHaves:', JSON.stringify(ms.missingMustHaves, null, 2));
      console.log('competencyScores:', JSON.stringify(ms.competencyScores, null, 2));
      console.log('subScores:', JSON.stringify(ms.subScores, null, 2));
      console.log('flags:', JSON.stringify(ms.flags, null, 2));
      console.log('scorerVersion:', ms.scorerVersion, 'parserVersion:', ms.parserVersion, 'createdAt:', ms.createdAt);
    }
  }
  await prisma.$disconnect();
}
checkCand().catch(console.error);
