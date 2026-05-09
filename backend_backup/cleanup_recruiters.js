const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recruiters = await prisma.user.findMany({
    where: { role: 'RECRUITER' },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Found ${recruiters.length} recruiters.`);
  
  if (recruiters.length <= 3) {
    console.log("Already 3 or fewer recruiters. Skipping deletion.");
    return;
  }

  const toDelete = recruiters.slice(3);
  console.log(`Deleting ${toDelete.length} recruiters...`);

  for (const user of toDelete) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Deleted: ${user.fullName} (${user.email})`);
    } catch (err) {
      console.error(`Failed to delete ${user.fullName}: ${err.message}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
