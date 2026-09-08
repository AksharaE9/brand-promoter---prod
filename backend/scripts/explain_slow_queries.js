// backend/scripts/explain_slow_queries.js
require('dotenv').config();
const prisma = require('../src/config/db');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🔍 EXPLAIN ANALYZE: COUNT & AGGREGATE QUERIES');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const user = await prisma.user.findFirst({
    where: { isActive: true, isDeleted: false },
  });
  const orgId = user?.organizationId || 'defaultOrg';

  // Count 1: Interview count with double join
  console.log('--- 1. Interview Count with Double Join ---');
  try {
    const plan1 = await prisma.$queryRawUnsafe(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT COUNT(*)
      FROM interviews i
      WHERE i."organizationId" = $1
        AND i."candidateId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM applications a
          JOIN candidates c ON c.id = a."candidateId"
          WHERE a.id = i."applicationId" AND c."isDeleted" = false
        );
    `, orgId);
    plan1.forEach(row => console.log(row['QUERY PLAN']));
  } catch (err) {
    console.error('Error in Count 1:', err.message);
  }

  // Count 2: Candidate Count with OR Subquery (OFFER_SENT)
  console.log('\n--- 2. Candidate Count with OR Subquery (OFFER_SENT) ---');
  try {
    const plan2 = await prisma.$queryRawUnsafe(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT COUNT(*)
      FROM candidates c
      WHERE c."organizationId" = $1 AND c."isDeleted" = false
        AND (c.status = 'OFFER_SENT' OR EXISTS (
          SELECT 1 FROM applications a
          WHERE a."candidateId" = c.id AND a.status = 'OFFER_SENT' AND a."isDeleted" = false
        ));
    `, orgId);
    plan2.forEach(row => console.log(row['QUERY PLAN']));
  } catch (err) {
    console.error('Error in Count 2:', err.message);
  }

  // Count 3: Dashboard parallel queries combined in SQL vs 9 separate Prisma calls
  console.log('\n--- 3. Single Unified Dashboard Stats Query ---');
  try {
    const plan3 = await prisma.$queryRawUnsafe(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT
        (SELECT COUNT(*) FROM candidates WHERE "organizationId" = $1 AND "isDeleted" = false) as candidates,
        (SELECT COUNT(*) FROM jobs WHERE "organizationId" = $1 AND "isActive" = true) as jobs,
        (SELECT COUNT(*) FROM users WHERE "organizationId" = $1 AND "isDeleted" = false AND status = 'ACTIVE') as users,
        (SELECT COUNT(*) FROM applications WHERE "organizationId" = $1 AND "isDeleted" = false) as applications;
    `, orgId);
    plan3.forEach(row => console.log(row['QUERY PLAN']));
  } catch (err) {
    console.error('Error in Unified Query:', err.message);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
