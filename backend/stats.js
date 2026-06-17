require('dotenv').config();
const prisma = require('./src/config/db');

async function getStats() {
  try {
    const [users, candidates, applications, interviews, auditLogs] = await Promise.all([
      prisma.user.count(),
      prisma.candidate.count(),
      prisma.application.count(),
      prisma.interview.count(),
      prisma.auditLog.count()
    ]);

    console.log('--- DATABASE STATS ---');
    console.log(`Users: ${users}`);
    console.log(`Candidates: ${candidates}`);
    console.log(`Applications: ${applications}`);
    console.log(`Interviews: ${interviews}`);
    console.log(`Audit Logs: ${auditLogs}`);
    console.log('----------------------');
  } catch (error) {
    console.error('Error fetching stats:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

getStats();
