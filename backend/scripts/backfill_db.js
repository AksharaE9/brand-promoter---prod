require('dotenv').config();
const { db } = require('../src/config/firebase');

async function backfillCollection(collectionName) {
  console.log(`Backfilling ${collectionName}...`);
  const snap = await db.collection(collectionName).get();
  console.log(`Found ${snap.size} documents in ${collectionName}`);
  
  let updatedCount = 0;
  
  // Use batch updates to avoid individual network round trips
  let batch = db.batch();
  let count = 0;
  
  for (const doc of snap.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const updatePayload = {};
    
    if (data.organizationId === undefined) {
      updatePayload.organizationId = 'defaultOrg';
      needsUpdate = true;
    }
    if (data.isDeleted === undefined) {
      updatePayload.isDeleted = false;
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      batch.update(doc.ref, updatePayload);
      updatedCount++;
      count++;
      
      if (count >= 200) {
        await batch.commit();
        batch = db.batch();
        count = 0;
        console.log(`Committed batch of 200 for ${collectionName}...`);
      }
    }
  }
  
  if (count > 0) {
    await batch.commit();
    console.log(`Committed final batch for ${collectionName}.`);
  }
  
  console.log(`Backfill completed for ${collectionName}. Updated ${updatedCount} documents.\n`);
}

async function run() {
  await backfillCollection('candidates');
  await backfillCollection('applications');
  await backfillCollection('users');
  await backfillCollection('interviews');
  console.log('Database backfill process completed successfully.');
  process.exit(0);
}

run().catch(console.error);
