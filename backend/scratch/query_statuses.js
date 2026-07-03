const { db } = require('../../src/config/firebase');

async function run() {
  const cands = await db.collection('candidates').get();
  const candStatuses = {};
  cands.forEach(doc => {
    const status = doc.data().status || 'undefined';
    candStatuses[status] = (candStatuses[status] || 0) + 1;
  });
  console.log('Firebase Candidate Statuses:', candStatuses);

  const apps = await db.collection('applications').get();
  const appStatuses = {};
  apps.forEach(doc => {
    const status = doc.data().status || 'undefined';
    appStatuses[status] = (appStatuses[status] || 0) + 1;
  });
  console.log('Firebase Application Statuses:', appStatuses);

  const interviews = await db.collection('interviews').get();
  const intResults = {};
  const intStatuses = {};
  interviews.forEach(doc => {
    const res = doc.data().result || 'undefined';
    const status = doc.data().status || 'undefined';
    intResults[res] = (intResults[res] || 0) + 1;
    intStatuses[status] = (intStatuses[status] || 0) + 1;
  });
  console.log('Firebase Interview Results:', intResults);
  console.log('Firebase Interview Statuses:', intStatuses);

  process.exit(0);
}

run().catch(console.error);
