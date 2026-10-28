// qa/inspect_indexes.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  console.log('=== 1. EXISTING INDEXES ON INTERVIEW_FEEDBACKS & CANDIDATES ===');
  const indexes = await prisma.$queryRaw`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE tablename IN ('interview_feedbacks', 'candidates', 'interviews')
    ORDER BY tablename, indexname;
  `;
  console.table(indexes.map(i => ({ Table: i.tablename, Index: i.indexname })));

  console.log('\n=== 2. UNUSED INDEXES (idx_scan = 0) ===');
  const unused = await prisma.$queryRaw`
    SELECT
      relname AS table_name,
      indexrelname AS index_name,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND relname IN ('candidates', 'interviews', 'applications', 'interview_feedbacks')
    ORDER BY relname, indexrelname;
  `;
  console.table(unused);

  console.log('\n=== 3. EXPLAIN Q06 (BEFORE OPTIMIZATION) ===');
  const planQ06 = await prisma.$queryRawUnsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT "selectionStatus", AVG("overallRating") as avg_rating, COUNT(*) as count
    FROM interview_feedbacks
    GROUP BY "selectionStatus";
  `);
  console.log(planQ06.map(r => r['QUERY PLAN']).join('\n'));

  console.log('\n=== 4. EXPLAIN Q02 (BEFORE OPTIMIZATION) ===');
  const planQ02 = await prisma.$queryRawUnsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, "fullName", college, course
    FROM candidates
    WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false AND college ILIKE '%Jain%'
    LIMIT 50;
  `);
  console.log(planQ02.map(r => r['QUERY PLAN']).join('\n'));

  await prisma.$disconnect();
}

main().catch(console.error);
