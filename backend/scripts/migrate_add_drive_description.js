'use strict';

const prisma = require('../src/config/db');

async function main() {
  console.log('Running migration to add description column to college_drives...');
  await prisma.$executeRawUnsafe('ALTER TABLE "college_drives" ADD COLUMN IF NOT EXISTS "description" TEXT;');
  
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'college_drives' AND column_name = 'description';
  `);
  console.log('Verified column in database:', cols);

  const existingDrives = await prisma.collegeDrive.findMany();
  console.log(`Verified ${existingDrives.length} existing drives intact. Sample drive:`, {
    id: existingDrives[0]?.id,
    title: existingDrives[0]?.title,
    description: existingDrives[0]?.description,
  });

  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
