const prisma = require('../src/config/db');

async function run() {
  try {
    const cands = await prisma.candidate.groupBy({
      by: ['status'],
      _count: { id: true }
    });
    console.log('Prisma Candidate Statuses:', cands);

    const apps = await prisma.application.groupBy({
      by: ['status'],
      _count: { id: true }
    });
    console.log('Prisma Application Statuses:', apps);

    const interviews = await prisma.interview.groupBy({
      by: ['status', 'result'],
      _count: { id: true }
    });
    console.log('Prisma Interviews status/result:', interviews);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
