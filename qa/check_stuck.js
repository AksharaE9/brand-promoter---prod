const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function checkStuck() {
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await prisma.resumeParseJob.findMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: tenMinsAgo }
    }
  });
  console.log(JSON.stringify(stuck, null, 2));
  await prisma.$disconnect();
}
checkStuck().catch(console.error);
