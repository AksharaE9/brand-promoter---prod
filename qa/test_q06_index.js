// qa/test_q06_index.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  console.log('Testing Index for Q06...');
  
  // Create composite index concurrently
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedbacks_status_rating 
    ON interview_feedbacks ("selectionStatus", "overallRating");
  `);
  console.log('Index created successfully.');

  const plan = await prisma.$queryRawUnsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT "selectionStatus", AVG("overallRating") as avg_rating, COUNT(*) as count
    FROM interview_feedbacks
    GROUP BY "selectionStatus";
  `);
  console.log('\nEXPLAIN PLAN WITH INDEX:');
  console.log(plan.map(r => r['QUERY PLAN']).join('\n'));

  await prisma.$disconnect();
}

main().catch(console.error);
