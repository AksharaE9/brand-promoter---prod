'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.RENDER_DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

async function main() {
  const ids = [
    'cmrum2orm001zmt29ctitt7ri', // Rakshitha S
    'O6vr1Xk66E8Zs61Pp55s', // Vaishnavi
    'cmto8kcfl0008lno3xhsyc6md', // Nisarga (Horticulture)
    'FP10HnhqJTnsgTf3DH3Q', // Bindu shree R
    'cmudxvt9o004bn9rv9uiwv3qn', // Yashwanth Kumar
    'dMFJ1Wh1oyzQ3QHRp8BF', // Deekshitha K
  ];

  for (const id of ids) {
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        applications: {
          include: {
            job: true,
            interviews: true
          }
        },
        interviewFeedbacks: true
      }
    });
    console.log(`\n================ ID: ${id} ================`);
    console.log('Candidate:', {
      id: candidate.id,
      name: candidate.fullName,
      email: candidate.email,
      phone: candidate.phone,
      college: candidate.college,
      status: candidate.status,
      createdAt: candidate.createdAt
    });
    console.log('Applications:', JSON.stringify(candidate.applications, null, 2));
    console.log('Feedbacks:', JSON.stringify(candidate.interviewFeedbacks, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
