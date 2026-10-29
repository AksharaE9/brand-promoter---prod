const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function runExplain() {
  const query = `
    EXPLAIN ANALYZE
    SELECT id, "fullName", "preferredRole", "location", "company", "phone", "offerDecision", "doj", "status", "createdAt", "updatedAt"
    FROM candidates
    WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false
    ORDER BY "updatedAt" DESC, id DESC
    LIMIT 49;
  `;
  const result = await prisma.$queryRawUnsafe(query);
  console.log('EXPLAIN ANALYZE for default keyset sort:');
  console.log(result.map(r => r['QUERY PLAN']).join('\n'));

  const queryMatch = `
    EXPLAIN ANALYZE
    SELECT c.id, c."fullName", ms.rating_out_of_10 as rating
    FROM candidates c
    LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
    WHERE c."organizationId" = 'defaultOrg' AND c."isDeleted" = false
    ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
    LIMIT 49;
  `;
  const resultMatch = await prisma.$queryRawUnsafe(queryMatch);
  console.log('\nEXPLAIN ANALYZE for match score keyset sort:');
  console.log(resultMatch.map(r => r['QUERY PLAN']).join('\n'));

  await prisma.$disconnect();
}
runExplain().catch(console.error);
