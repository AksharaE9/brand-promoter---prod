const admin = require("firebase-admin");
const path = require("path");

// Try to find service account
let serviceAccount;
try {
  serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : require(path.join(__dirname, "../backend/src/config/serviceAccountKey.json"));
} catch (e) {
  console.error("❌ Could not find serviceAccountKey.json in backend/src/config/");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function purgeData() {
  console.log("🚀 Starting data purge...");

  const collections = ["candidates", "applications", "interviews", "interviewFeedbacks", "pipelineEvents", "fileMetas"];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) {
      console.log(`- ${collectionName}: Already empty`);
      continue;
    }

    // Firestore batch limit is 500
    const chunks = [];
    for (let i = 0; i < snapshot.docs.length; i += 500) {
      chunks.push(snapshot.docs.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    console.log(`- ${collectionName}: Deleted ${snapshot.size} documents`);
  }

  console.log("✅ Purge complete!");
}

purgeData().catch(console.error);
