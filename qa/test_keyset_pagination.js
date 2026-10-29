// qa/test_keyset_pagination.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id) return parsed;
  } catch (_) {}

  // Fallback for legacy timestamp_id format
  const parts = cursorStr.split('_');
  if (parts.length === 2) {
    const timeNum = parseInt(parts[0], 10);
    if (!isNaN(timeNum)) {
      return { t: new Date(timeNum).toISOString(), id: parts[1] };
    }
  }
  return null;
}

async function testMatchScoreKeyset() {
  console.log('--- TESTING MATCH SCORE KEYSET SORT (SQL) ---');
  const orgId = 'defaultOrg';
  const limit = 48;
  
  // Page 1
  const query1 = `
    SELECT c.id, c."fullName", c."preferredRole", ms.rating_out_of_10 as rating
    FROM candidates c
    LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
    WHERE c."organizationId" = $1 AND c."isDeleted" = false
    ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
    LIMIT $2;
  `;
  const page1 = await prisma.$queryRawUnsafe(query1, orgId, limit);
  console.log(`Page 1 count: ${page1.length}`);
  console.log('Top 5 page 1:');
  for (const r of page1.slice(0, 5)) {
    console.log(`  ${r.fullName} (${r.preferredRole}) -> Rating: ${r.rating}`);
  }
  console.log('Bottom 3 page 1:');
  for (const r of page1.slice(-3)) {
    console.log(`  ${r.fullName} (${r.preferredRole}) -> Rating: ${r.rating}`);
  }

  // Page 2 using keyset
  const last = page1[page1.length - 1];
  const cursorObj = { rating: last.rating, id: last.id };
  const cursorStr = encodeCursor(cursorObj);
  console.log('\nCursor for Page 2:', cursorStr, cursorObj);

  let query2;
  let params2;
  if (cursorObj.rating !== null && cursorObj.rating !== undefined) {
    query2 = `
      SELECT c.id, c."fullName", c."preferredRole", ms.rating_out_of_10 as rating
      FROM candidates c
      LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
      WHERE c."organizationId" = $1 AND c."isDeleted" = false
        AND (
          ms.rating_out_of_10 < $2
          OR (ms.rating_out_of_10 = $2 AND c.id < $3)
          OR ms.rating_out_of_10 IS NULL
        )
      ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
      LIMIT $4;
    `;
    params2 = [orgId, cursorObj.rating, cursorObj.id, limit];
  } else {
    query2 = `
      SELECT c.id, c."fullName", c."preferredRole", ms.rating_out_of_10 as rating
      FROM candidates c
      LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
      WHERE c."organizationId" = $1 AND c."isDeleted" = false
        AND ms.rating_out_of_10 IS NULL
        AND c.id < $2
      ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
      LIMIT $3;
    `;
    params2 = [orgId, cursorObj.id, limit];
  }

  const page2 = await prisma.$queryRawUnsafe(query2, ...params2);
  console.log(`Page 2 count: ${page2.length}`);
  console.log('Top 5 page 2:');
  for (const r of page2.slice(0, 5)) {
    console.log(`  ${r.fullName} (${r.preferredRole}) -> Rating: ${r.rating}`);
  }

  // Check overlap
  const p1Ids = new Set(page1.map(x => x.id));
  const overlaps = page2.filter(x => p1Ids.has(x.id));
  console.log('Overlaps between page 1 and page 2:', overlaps.length);
}

async function main() {
  await testMatchScoreKeyset();
  await prisma.$disconnect();
}

main().catch(console.error);
