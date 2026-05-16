const { db } = require('../src/config/firebase');

async function run() {
  const dummyNames = ["christ", "jain", "nite", "pesss"];
  console.log("Searching for dummy colleges...");
  
  const snapshot = await db.collection("colleges").get();
  
  let deletedCount = 0;
  for (const doc of snapshot.docs) {
    const data = typeof doc.data === 'function' ? doc.data() : doc.data;
    if (data && data.name && dummyNames.includes(data.name.toLowerCase())) {
      console.log(`Deleting college: ${data.name} (ID: ${doc.id})`);
      await db.collection("colleges").doc(doc.id).delete();
      deletedCount++;
    }
  }
  
  console.log(`Deleted ${deletedCount} dummy colleges.`);
  process.exit(0);
}

run().catch(console.error);
