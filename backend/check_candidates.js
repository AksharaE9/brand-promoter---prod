const { db } = require('./src/config/firebase');

async function checkCandidate() {
  const snapshot = await db.collection('candidates').get();
  console.log(`Total candidates: ${snapshot.size}`);
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`Candidate: ${data.fullName} (ID: ${doc.id})`);
    console.log(`  Source: ${data.source || 'Direct Add'}`);
    console.log(`  resumeFileId: ${data.resumeFileId}`);
    
    if (data.resumeFileId) {
      const fileDoc = await db.collection('fileMetas').doc(data.resumeFileId).get();
      if (fileDoc.exists) {
        console.log(`  ✅ fileMeta found: ${JSON.stringify(fileDoc.data())}`);
      } else {
        console.log(`  ❌ fileMeta NOT found for ID: ${data.resumeFileId}`);
      }
    }
    console.log('---');
  }
  process.exit(0);
}

checkCandidate().catch(err => {
  console.error(err);
  process.exit(1);
});
