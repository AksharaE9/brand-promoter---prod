const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function findCands() {
  const cands = await prisma.candidate.findMany({
    where: {
      OR: [
        { fullName: { contains: 'Sanjana', mode: 'insensitive' } },
        { fullName: { contains: 'Manoj', mode: 'insensitive' } },
      ]
    },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      matchScores: {
        select: { ratingOutOf10: true, overall: true, band: true, isPrimary: true }
      }
    }
  });
  console.log(JSON.stringify(cands, null, 2));
  await prisma.$disconnect();
}
findCands().catch(console.error);
