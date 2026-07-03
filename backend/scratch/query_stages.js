const prisma = require('../src/config/db');

async function run() {
  try {
    const stages = await prisma.pipelineStage.findMany();
    console.log('All Pipeline Stages in Database:', stages.map(s => ({ id: s.id, name: s.name, jobId: s.jobId })));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
