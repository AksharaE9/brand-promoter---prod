'use strict';
const prisma = require('../src/config/db');

async function run() {
  const cands = await prisma.candidate.findMany({
    where: {
      id: { in: ['ZKxQk0WYCL8vJkj3oNTg', 'cmtd0ajrx005dm9mz3s2b5l7x', 'cmrt7a5yg01fwmt2rupgdrg4w', 'cmrd2m6yi00qbng2sqvti5kpq', 'giEgjsQOLFdb6OyLG0i5'] }
    },
    include: {
      applications: true,
      interviewFeedbacks: true
    }
  });
  console.log(JSON.stringify(cands, null, 2));
  await prisma.$disconnect();
}
run().catch(console.error);
