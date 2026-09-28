'use strict';
const request = require('supertest');
const { app } = require('../src/app');
const prisma = require('../src/config/db');

async function testResumeValidation() {
  console.log('\n--- VERIFYING MANDATORY RESUME REQUIREMENT ON ALL CANDIDATES PATH ---');
  
  // Find an admin user for auth
  const user = await prisma.user.findFirst({
    where: { isDeleted: false, role: 'SUPER_ADMIN' }
  });

  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId: 'defaultOrg' },
    process.env.JWT_SECRET || 'test_jwt_secret',
    { expiresIn: '1h' }
  );

  // Attempt candidate creation without resume on /api/candidates
  const res = await request(app)
    .post('/api/candidates')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Test No Resume Candidate',
      phone: '9999900001',
      email: 'testnoresume@example.com',
      preferredRole: 'Data Analyst Intern'
    });

  console.log('Direct API POST /api/candidates status code:', res.status);
  console.log('Direct API POST /api/candidates response:', res.body);

  if (res.status === 400 && res.body.message && res.body.message.includes('Resume is required')) {
    console.log('>>> CONFIRMED: All Candidates endpoint correctly REJECTS resume-less candidate creation. <<<\n');
  } else {
    console.error('FAILED: Resume requirement did not trigger as expected!');
  }

  await prisma.$disconnect();
}

testResumeValidation().catch(console.error);
