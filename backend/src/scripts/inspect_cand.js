'use strict';

const prisma = require('../config/db');

async function inspect() {
  const c = await prisma.candidate.findUnique({
    where: { id: 'cmtoqzdce01t1ijlsmtdjpyk0' },
  });
  console.log('Candidate cmtoqzdce01t1ijlsmtdjpyk0:', c);

  const apps = await prisma.application.findMany({
    where: { candidateId: 'cmtoqzdce01t1ijlsmtdjpyk0' },
    include: { interviews: true, pipelineEvents: true }
  });
  console.log('Applications for this candidate:', JSON.stringify(apps, null, 2));

  await prisma.$disconnect();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
