const { db } = require('../src/config/firebase');

const bcrypt = require('bcryptjs');

async function sync() {
  console.log('🔄 Syncing Test Credentials...');
  const pass = 'password123';
  const hash = await bcrypt.hash(pass, 10);
  
  const snap = await db.collection('users').where('email', '==', 'interviewer@ats.local').get();
  if (snap.empty) {
    console.log('  ⚠️ User not found. Creating test user...');
    await db.collection('users').add({
      email: 'interviewer@ats.local',
      passwordHash: hash,
      fullName: 'Test Interviewer',
      role: 'INTERVIEWER',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    });
  } else {
    console.log('  ✅ User found. Updating password...');
    await db.collection('users').doc(snap.docs[0].id).update({ passwordHash: hash, status: 'ACTIVE' });

  }
  console.log('🎊 Credentials Synced. System Ready.');
  process.exit();
}

sync();
