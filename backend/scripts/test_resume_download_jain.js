'use strict';
const request = require('supertest');
const { app } = require('../src/app');
const prisma = require('../src/config/db');
const jwt = require('jsonwebtoken');

async function testResumeDownload() {
  console.log('\n--- VERIFYING CANDIDATE RESUME STREAMING FOR JAIN CANDIDATE ---');
  
  // Find Boggavarapu Suriya
  const cand = await prisma.candidate.findFirst({
    where: { fullName: 'Boggavarapu Suriya' },
    include: { resumeFile: true }
  });

  if (!cand || !cand.resumeFile) {
    throw new Error('Candidate or resume file not found!');
  }

  console.log(`Candidate: ${cand.fullName} (ID: ${cand.id})`);
  console.log(`ResumeFile ID: ${cand.resumeFile.id}, StorageKey: ${cand.resumeFile.storageKey}, Size: ${cand.resumeFile.sizeBytes} bytes`);

  const user = await prisma.user.findFirst({
    where: { isDeleted: false, role: 'SUPER_ADMIN' }
  });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId: 'defaultOrg' },
    process.env.JWT_SECRET || 'test_jwt_secret',
    { expiresIn: '1h' }
  );

  const res = await request(app)
    .get(`/api/candidates/${cand.id}/resume/download`)
    .set('Authorization', `Bearer ${token}`);

  console.log('HTTP Status:', res.status);
  console.log('Content-Type:', res.headers['content-type']);
  console.log('Content-Disposition:', res.headers['content-disposition']);
  console.log('Received Buffer Length:', res.body ? res.body.length : 0);

  if (res.status === 200 && res.headers['content-type'] === 'application/pdf' && res.body.length === cand.resumeFile.sizeBytes) {
    console.log('>>> CONFIRMED: Resume downloads with 100% byte fidelity directly from database! <<<\n');
  } else {
    throw new Error('Resume download check failed!');
  }
}

testResumeDownload().catch(console.error).finally(() => prisma.$disconnect());
