// backend/scratch/test_candidate_patch.js
const prisma = require('../src/config/db');

const baseUrl = 'http://localhost:4000/api';

async function testPatch() {
  console.log('Authenticating with backend API...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@ats.local',
      password: 'ChangeMe@123'
    })
  });
  
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login failed:', loginData);
    process.exit(1);
  }
  
  const token = loginData.data.token;
  console.log('Login successful. Token obtained.');
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  
  // Find a candidate to test patch on
  const candidate = await prisma.candidate.findFirst({
    where: { isDeleted: false }
  });
  
  if (!candidate) {
    console.error('No candidate found to test PATCH on.');
    process.exit(1);
  }
  
  console.log(`Found candidate: "${candidate.fullName}" (ID: ${candidate.id})`);
  
  const patchPayload = {
    fullName: candidate.fullName + ' Edited',
    email: candidate.email,
    phone: candidate.phone,
    company: 'Akshara Enterprises',
    category: 'College'
  };
  
  console.log('Sending PATCH request with payload:', patchPayload);
  const patchRes = await fetch(`${baseUrl}/candidates/${candidate.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patchPayload)
  });
  
  const patchData = await patchRes.json();
  console.log('PATCH Status:', patchRes.status);
  console.log('PATCH Response:', JSON.stringify(patchData, null, 2));
}

testPatch()
  .catch(err => console.error('Error:', err))
  .finally(() => prisma.$disconnect());
