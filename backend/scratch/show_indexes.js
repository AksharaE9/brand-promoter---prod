const prisma = require('../src/config/db');

async function main() {
  try {
    const indexes = await prisma.$queryRawUnsafe('SHOW INDEX FROM candidates');
    console.table(indexes);
  } catch (err) {
    console.error('Prisma failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
