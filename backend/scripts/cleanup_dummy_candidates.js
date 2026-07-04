// scripts/cleanup_dummy_candidates.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('🧹 DATABASE DUMMY CANDIDATES CLEANUP');
  console.log('------------------------------------');

  const count = await prisma.candidate.count({
    where: {
      OR: [
        { email: { endsWith: '@ats-perf-test.com' } },
        { fullName: { startsWith: 'Dummy Candidate' } }
      ]
    }
  });

  console.log(`🔍 Found ${count.toLocaleString()} dummy candidates to delete.`);

  if (count > 0) {
    const deleted = await prisma.candidate.deleteMany({
      where: {
        OR: [
          { email: { endsWith: '@ats-perf-test.com' } },
          { fullName: { startsWith: 'Dummy Candidate' } }
        ]
      }
    });
    console.log(`✅ Successfully deleted ${deleted.count.toLocaleString()} candidates!`);
  } else {
    console.log('✓ No dummy candidates found. Database is already clean.');
  }

  await prisma.$disconnect();
}

run().catch(console.error);
