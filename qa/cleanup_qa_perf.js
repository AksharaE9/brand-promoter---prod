// qa/cleanup_qa_perf.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  const tagged = await prisma.candidate.findMany({
    where: { fullName: { startsWith: 'QA_PERF_' } },
    select: { id: true, fullName: true }
  });
  console.log('Tagged QA_PERF_ candidates found:', tagged.length);
  if (tagged.length > 0) {
    const deleted = await prisma.candidate.deleteMany({
      where: { fullName: { startsWith: 'QA_PERF_' } }
    });
    console.log('Cleaned up tagged candidates:', deleted.count);
  } else {
    console.log('Zero QA_PERF_ candidates present in database. Clean!');
  }
  await prisma.$disconnect();
}

main().catch(console.error);
