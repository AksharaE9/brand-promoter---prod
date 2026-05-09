require('dotenv').config();
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./firebase-admin.json');

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

async function main() {
  const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
  const users = snap.docs.map(d => {
    const u = d.data();
    return { id: d.id, email: u.email, fullName: u.fullName, role: u.role, status: u.status };
  });
  console.log('\n=== USERS IN FIRESTORE ===');
  console.table(users);
}

main().catch(console.error);
