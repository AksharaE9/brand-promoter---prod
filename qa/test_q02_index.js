// qa/test_q02_index.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  console.log('Testing Trigram GIN index for Q02...');
  
  // Create index concurrently
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_candidates_college_trgm 
    ON candidates USING gin (college gin_trgm_ops) 
    WHERE "isDeleted" = false;
  `);
  console.log('Index created successfully.');

  const plan = await prisma.$queryRawUnsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, "fullName", college, course
    FROM candidates
    WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false AND college ILIKE '%Jain%'
    LIMIT 50;
  `);
  console.log('\nEXPLAIN PLAN WITH INDEX:');
  console.log(plan.map(r => r['QUERY PLAN']).join('\n'));

  await prisma.$disconnect();
}

main().catch(console.error);
