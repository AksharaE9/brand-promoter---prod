// qa/get_real_admin.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  const users = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true, email: true, role: true, organizationId: true },
    take: 3
  });
  console.log('Real super admins:', JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
