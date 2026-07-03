const prisma = require('../src/config/db');

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      status: true,
      isActive: true,
      isDeleted: true
    }
  });
  console.log('Current users in DB:', JSON.stringify(users, null, 2));
}

main().catch(err => {
  console.error(err);
}).finally(() => {
  prisma.$disconnect();
});
