'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.RENDER_DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

async function main() {
  console.log('Connecting to DB via:', dbUrl.replace(/:[^:@]+@/, ':***@'));

  console.log('=== USERS ===');
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true, isActive: true }
  });
  console.log(JSON.stringify(users, null, 2));

  console.log('=== JOBS ===');
  const jobs = await prisma.job.findMany({
    select: { id: true, title: true, isActive: true, department: true, openingsCount: true }
  });
  console.log(JSON.stringify(jobs, null, 2));

  console.log('=== COLLEGES ===');
  const colleges = await prisma.college.findMany();
  console.log(JSON.stringify(colleges, null, 2));

  console.log('=== COLLEGE DRIVES ===');
  const drives = await prisma.collegeDrive.findMany();
  console.log(JSON.stringify(drives, null, 2));

  console.log('=== CANDIDATES COUNT ===');
  const totalCandidates = await prisma.candidate.count();
  const activeCandidates = await prisma.candidate.count({ where: { isDeleted: false } });
  console.log({ totalCandidates, activeCandidates });

  console.log('=== INTERVIEWS COUNT ===');
  const totalInterviews = await prisma.interview.count();
  console.log({ totalInterviews });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
