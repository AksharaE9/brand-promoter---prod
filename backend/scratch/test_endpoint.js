// scratch/test_endpoint.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('../src/utils/jwt');

const prisma = new PrismaClient();

async function run() {
  const user = await prisma.user.findFirst({
    where: { isActive: true, isDeleted: false },
    orderBy: { id: 'asc' }
  });

  const token = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId
  });

  console.log(`User: ${user.fullName}, Role: ${user.role}, OrgId: ${user.organizationId}`);

  const res = await fetch('http://localhost:4000/api/interviews?limit=50', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  console.log(`Status: ${res.status}`);
  const text = await res.text();
  console.log('Response:', text);

  await prisma.$disconnect();
}

run().catch(console.error);
