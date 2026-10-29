const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function sweep() {
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
  const res = await prisma.resumeParseJob.updateMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: tenMinsAgo }
    },
    data: {
      status: 'FAILED',
      lastError: 'Job timed out after sitting in queue > 10 minutes',
      completedAt: new Date()
    }
  });
  console.log('Swept stuck jobs:', res.count);
  await prisma.$disconnect();
}
sweep().catch(console.error);
