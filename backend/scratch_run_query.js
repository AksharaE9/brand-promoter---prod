const prisma = require('./src/config/db');

async function main() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true
      }
    });
    console.log('All Users:');
    console.table(users);

    const candidatesCount = await prisma.candidate.groupBy({
      by: ['organizationId'],
      _count: {
        id: true
      }
    });
    console.log('Candidates count by organizationId:');
    console.table(candidatesCount);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
