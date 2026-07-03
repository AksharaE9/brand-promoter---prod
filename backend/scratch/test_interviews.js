'use strict';
const prisma = require('../src/config/db');
const { buildInterviewListQuery } = require('../src/modules/interviews/queryBuilder');
const { populateInterviewRelations } = require('../src/modules/interviews/relationPopulator');
const { mergeDirtyQueue } = require('../src/modules/interviews/dirtyQueueMerger');

async function test() {
  try {
    console.log("1. Building query params...");
    const { queryParams, limit } = await buildInterviewListQuery({
      orgId: "defaultOrg",
      limit: 10,
    });
    console.log("QueryParams:", JSON.stringify(queryParams, null, 2));

    console.log("2. Running findMany...");
    const docs = await prisma.interview.findMany(queryParams);
    console.log(`Fetched ${docs.length} rounds.`);

    console.log("3. Merging with dirty queue...");
    const withDirty = await mergeDirtyQueue(docs, "defaultOrg");
    console.log(`Rounds after dirty queue merge: ${withDirty.length}`);

    console.log("4. Populating relations...");
    const populated = await populateInterviewRelations(withDirty);
    console.log(`Populated ${populated.length} rounds.`);
    if (populated.length > 0) {
      console.log("First populated round example:", JSON.stringify(populated[0], null, 2));
    }
    
    console.log("✅ All tests passed successfully!");
  } catch (err) {
    console.error("❌ Test failed with error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
