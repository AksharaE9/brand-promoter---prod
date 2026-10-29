// qa/test_chunk_pagination_crawl.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function crawlAllChunks() {
  console.log('=== TESTING CHUNKED PAGINATION CRAWL ===');
  const orgId = 'defaultOrg';
  const totalDbCount = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false }
  });
  console.log('Total non-deleted candidates in DB:', totalDbCount);

  let cursor = null;
  const seenIds = new Set();
  const duplicates = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 100) {
    page++;
    const andConditions = [
      { organizationId: orgId },
      { isDeleted: false }
    ];

    if (cursor) {
      const parts = cursor.split('_');
      if (parts.length === 2) {
        const [timeStr, cursorId] = parts;
        const cursorTime = new Date(parseInt(timeStr, 10));
        andConditions.push({
          OR: [
            { updatedAt: { lt: cursorTime } },
            { updatedAt: cursorTime, id: { lt: cursorId } },
          ],
        });
      }
    }

    const limit = 50;
    const rawItems = await prisma.candidate.findMany({
      where: { AND: andConditions },
      take: limit + 1,
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'desc' },
      ],
      select: { id: true, fullName: true, updatedAt: true }
    });

    const pageHasMore = rawItems.length > limit;
    if (pageHasMore) {
      rawItems.pop();
    }

    for (const item of rawItems) {
      if (seenIds.has(item.id)) {
        duplicates.push(item.id);
      } else {
        seenIds.add(item.id);
      }
    }

    console.log(`Page ${page}: fetched ${rawItems.length} rows. Total unique seen so far: ${seenIds.size}`);

    if (pageHasMore && rawItems.length > 0) {
      const last = rawItems[rawItems.length - 1];
      cursor = `${last.updatedAt.getTime()}_${last.id}`;
    } else {
      hasMore = false;
    }
  }

  console.log('\n--- CRAWL RESULT ---');
  console.log(`Total in DB: ${totalDbCount}`);
  console.log(`Total unique IDs collected across all pages: ${seenIds.size}`);
  console.log(`Missing candidates: ${totalDbCount - seenIds.size}`);
  console.log(`Duplicate IDs: ${duplicates.length}`);

  await prisma.$disconnect();
}

crawlAllChunks().catch(console.error);
