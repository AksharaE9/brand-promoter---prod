// qa/find_megha.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function main() {
  const meghas = await prisma.candidate.findMany({
    where: { fullName: { contains: 'Megha', mode: 'insensitive' } },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      resumeFileId: true,
      resumeLinkOriginal: true,
      resumeLinkDownload: true,
      matchScores: true,
      resumeParseJobs: true
    }
  });
  console.log('Megha candidate records:', JSON.stringify(meghas, null, 2));
  await prisma.$disconnect();
}
main().catch(console.error);
