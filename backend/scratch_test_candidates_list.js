const prisma = require('./src/config/db');

async function checkList(status) {
  const where = {
    organizationId: 'defaultOrg',
    isDeleted: false
  };
  if (status && status !== 'All') {
    where.status = status;
  }
  const count = await prisma.candidate.count({ where });
  console.log(`Status filter: ${status || 'All'} => count: ${count}`);
}

async function main() {
  await checkList('All');
  await checkList('ACTIVE');
  await checkList('OFFER_SENT');
  await checkList('JOINED');
  await checkList('REJECTED');
  process.exit(0);
}

main().catch(console.error);
