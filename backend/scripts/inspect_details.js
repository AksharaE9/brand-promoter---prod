'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const dbUrl = process.env.RENDER_DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

async function main() {
  console.log('--- USERS ---');
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true, isActive: true }
  });
  console.log(users);

  console.log('--- JOBS ---');
  const jobs = await prisma.job.findMany({
    select: { id: true, title: true, isActive: true, department: true, openingsCount: true }
  });
  console.log(jobs);

  console.log('--- COLLEGES ---');
  const colleges = await prisma.college.findMany();
  console.log(colleges);

  console.log('--- BGS / VINAY / PRANEEL SEARCH ---');
  const bgsColleges = colleges.filter(c => /bgs/i.test(c.name));
  console.log('BGS Colleges:', bgsColleges);

  // Check interviews by Vinay Shetty or Praneel
  const vinayUser = users.find(u => /vinay/i.test(u.fullName));
  const praneelUser = users.find(u => /praneel/i.test(u.fullName));
  console.log('Vinay User:', vinayUser);
  console.log('Praneel User:', praneelUser);

  // Check names with specific focus requested by prompt:
  // Amrutha, Vaishnavi, Nisarga, Swati, Divya S B, Raksha G, Sneha S, Priyanka, Arvind
  const focusNames = ['Amrutha', 'Vaishnavi', 'Nisarga', 'Swati', 'Divya S B', 'Raksha G', 'Sneha S', 'Priyanka', 'Arvind'];
  for (const fn of focusNames) {
    const found = await prisma.candidate.findMany({
      where: {
        fullName: { contains: fn, mode: 'insensitive' }
      },
      select: { id: true, fullName: true, phone: true, email: true, college: true, preferredRole: true, status: true, createdAt: true }
    });
    console.log(`Search for "${fn}":`, found);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
