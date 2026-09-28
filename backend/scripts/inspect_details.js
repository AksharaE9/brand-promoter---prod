'use strict';
const prisma = require('../src/config/db');

async function run() {
  const cands = await prisma.candidate.findMany({
    where: {
      OR: [
        { fullName: { contains: 'Balaji', mode: 'insensitive' } },
        { fullName: { contains: 'Pooja', mode: 'insensitive' } },
        { fullName: { contains: 'Shashank', mode: 'insensitive' } },
        { fullName: { contains: 'Nithin', mode: 'insensitive' } },
        { fullName: { contains: 'Aishwarya', mode: 'insensitive' } }
      ]
    },
    select: { id: true, fullName: true, email: true, phone: true, college: true, preferredRole: true, source: true, createdAt: true, status: true }
  });
  console.log('Matched Candidates in DB:');
  console.log(JSON.stringify(cands, null, 2));

  const colleges = await prisma.college.findMany();
  console.log('\nColleges:');
  console.log(colleges);

  const drives = await prisma.collegeDrive.findMany();
  console.log('\nCollege Drives:');
  console.log(drives);

  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true }
  });
  console.log('\nUsers:');
  console.log(users);

  const jobs = await prisma.job.findMany();
  console.log('\nJobs:');
  console.log(jobs.map(j => ({ id: j.id, title: j.title, dept: j.department, active: j.isActive })));

  await prisma.$disconnect();
}
run().catch(console.error);
