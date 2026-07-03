const prisma = require('../src/config/db');

async function main() {
  try {
    console.log('Running CREATE INDEX idx_candidates_org_created...');
    // Set a statement timeout of 5 seconds
    await prisma.$executeRawUnsafe('SET statement_timeout = 5000');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_candidates_org_created
      ON candidates ("organizationId", "isDeleted", "createdAt" DESC)
    `);
    console.log('Success!');
  } catch (err) {
    console.error('Failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
