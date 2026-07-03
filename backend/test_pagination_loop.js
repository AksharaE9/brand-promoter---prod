const { buildInterviewListQuery } = require('./src/modules/interviews/queryBuilder');
const prisma = require('./src/config/db');

async function run() {
  let cursor = null;
  let page = 1;
  let hasMore = true;

  console.log('Starting pagination loop simulation...');

  while (hasMore) {
    console.log(`\n--- Fetching Page ${page} (cursor: ${cursor}) ---`);
    try {
      const { queryParams, limit } = await buildInterviewListQuery({
        orgId: 'defaultOrg',
        limit: 20,
        cursor: cursor
      });

      const takeLimit = limit + 1;
      const dbQueryParams = {
        ...queryParams,
        take: takeLimit
      };

      const docs = await prisma.interview.findMany(dbQueryParams);
      console.log(`Fetched ${docs.length} records (takeLimit was ${takeLimit})`);

      const pageHasMore = docs.length > limit;
      const pageRounds = docs.slice(0, limit);
      
      const lastDoc = pageRounds[pageRounds.length - 1];
      const nextCursor = pageHasMore && lastDoc ? lastDoc.id : null;

      console.log(`Page ${page} results:`);
      console.log(`  hasMore: ${pageHasMore}`);
      console.log(`  nextCursor: ${nextCursor}`);
      console.log(`  lastDoc ID: ${lastDoc ? lastDoc.id : 'none'}`);
      if (lastDoc) {
        console.log(`  lastDoc scheduledStart: ${lastDoc.scheduledStart}`);
      }

      if (docs.length === 0) {
        console.log('Zero records fetched. Ending loop.');
        break;
      }

      if (nextCursor === cursor && cursor !== null) {
        console.error('ERROR: Loop detected! nextCursor is identical to current cursor!');
        break;
      }

      cursor = nextCursor;
      hasMore = pageHasMore;
      page++;

      if (page > 45) {
        console.log('Safety limit reached (45 pages). Ending loop.');
        break;
      }

    } catch (err) {
      console.error(`Error on page ${page}:`, err);
      break;
    }
  }
}

run();
