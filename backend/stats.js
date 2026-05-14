require('dotenv').config();
const { db } = require('./src/config/firebase');

async function getStats() {
  try {
    const [users, candidates, applications, interviews, auditLogs] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('candidates').count().get(),
      db.collection('applications').count().get(),
      db.collection('interviews').count().get(),
      db.collection('auditLogs').count().get()
    ]);

    console.log('--- DATABASE STATS ---');
    console.log(`Users: ${users.data().count}`);
    console.log(`Candidates: ${candidates.data().count}`);
    console.log(`Applications: ${applications.data().count}`);
    console.log(`Interviews: ${interviews.data().count}`);
    console.log(`Audit Logs: ${auditLogs.data().count}`);
    console.log('----------------------');
  } catch (error) {
    console.error('Error fetching stats:', error);
  } finally {
    process.exit(0);
  }
}

getStats();
