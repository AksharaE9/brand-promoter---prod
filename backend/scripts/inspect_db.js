require('dotenv').config();
const { db } = require('../src/config/firebase');

async function run() {
  const cands = await db.collection('candidates').get();
  const cOrgs = new Set(cands.docs.map(d => d.data().organizationId || 'undefined'));
  console.log(`Candidates: total=${cands.size}, orgs=`, [...cOrgs]);

  const apps = await db.collection('applications').get();
  const aOrgs = new Set(apps.docs.map(d => d.data().organizationId || 'undefined'));
  console.log(`Applications: total=${apps.size}, orgs=`, [...aOrgs]);

  const users = await db.collection('users').get();
  const uOrgs = new Set(users.docs.map(d => d.data().organizationId || 'undefined'));
  console.log(`Users: total=${users.size}, orgs=`, [...uOrgs]);

  const interviews = await db.collection('interviews').get();
  const iOrgs = new Set(interviews.docs.map(d => d.data().organizationId || 'undefined'));
  console.log(`Interviews: total=${interviews.size}, orgs=`, [...iOrgs]);

  process.exit(0);
}

run().catch(console.error);
