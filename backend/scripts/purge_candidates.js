const { db } = require("../src/config/firebase");

async function purgeData() {
  console.log("🚀 Starting data purge via Firebase Bridge...");

  const collections = ["candidates", "applications", "interviews", "interviewFeedbacks", "pipelineEvents", "fileMetas"];

  for (const collectionName of collections) {
    console.log(`Checking ${collectionName}...`);
    const snapshot = await db.collection(collectionName).get();
    
    if (snapshot.empty) {
      console.log(`- ${collectionName}: Already empty`);
      continue;
    }

    console.log(`- ${collectionName}: Found ${snapshot.size} documents. Deleting...`);
    
    // The bridge might not support full batch for Web SDK perfectly, 
    // so we delete individually if batch commit is a no-op in bridge.
    // But our bridge.collection().doc().delete() works.
    
    for (const doc of snapshot.docs) {
      await db.collection(collectionName).doc(doc.id).delete();
    }

    console.log(`- ${collectionName}: Purge complete.`);
  }

  console.log("✅ All requested data purged!");
  process.exit(0);
}

purgeData().catch(err => {
  console.error("❌ Purge failed:", err);
  process.exit(1);
});
