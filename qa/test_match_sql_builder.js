const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function testSqlBuilder() {
  const orgId = 'defaultOrg';
  const limit = 48;
  const whereClauses = ['c."organizationId" = $1', 'c."isDeleted" = false'];
  const params = [orgId];

  // Test with status
  params.push('ACTIVE');
  const pIdx = params.length;
  whereClauses.push(`(c.status = $${pIdx} OR EXISTS (SELECT 1 FROM applications a WHERE a."candidateId" = c.id AND a.status = $${pIdx} AND a."isDeleted" = false))`);

  const sql = `
    SELECT c.id, c."fullName", ms.rating_out_of_10 as rating
    FROM candidates c
    LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
    LIMIT ${limit + 1};
  `;

  console.log('SQL:', sql);
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  console.log('Fetched rows:', rows.length);
  await prisma.$disconnect();
}
testSqlBuilder().catch(console.error);
