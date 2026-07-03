const prisma = require('../src/config/db');

async function main() {
  try {
    const jobs = await prisma.$queryRawUnsafe("SHOW JOBS");
    console.table(jobs.map(j => ({
      id: j.id,
      type: j.job_type,
      description: j.description?.substring(0, 100),
      status: j.status,
      created: j.created,
      started: j.started
    })));
  } catch (err) {
    console.error('Prisma failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
