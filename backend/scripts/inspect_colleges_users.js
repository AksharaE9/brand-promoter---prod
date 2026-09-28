'use strict';
const prisma = require('../src/config/db');

async function run() {
  const colleges = await prisma.college.findMany();
  console.log('=== COLLEGES (' + colleges.length + ') ===');
  colleges.forEach(c => console.log(c.id + ' | ' + c.name + ' | ' + (c.location || '')));

  const drives = await prisma.collegeDrive.findMany();
  console.log('\n=== COLLEGE DRIVES (' + drives.length + ') ===');
  drives.forEach(d => console.log(d.id + ' | ' + d.title + ' | collegeId: ' + d.collegeId + ' | dateFrom: ' + d.dateFrom));

  const daJob = await prisma.job.findFirst({
    where: { title: { equals: 'Data Analyst Intern', mode: 'insensitive' }, isActive: true }
  });
  console.log('\n=== DATA ANALYST INTERN JOB ===', daJob);

  const baJob = await prisma.job.findFirst({
    where: { title: { equals: 'Business Analyst Intern', mode: 'insensitive' }, isActive: true }
  });
  console.log('=== BUSINESS ANALYST INTERN JOB ===', baJob);

  await prisma.$disconnect();
}
run().catch(console.error);
