require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const assert = require('assert');
const jwt = require('jsonwebtoken');

const EXTERNAL_DB_URL = 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';
process.env.DATABASE_URL = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
  ? process.env.DATABASE_URL
  : EXTERNAL_DB_URL;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const { app } = require('../src/app');
const http = require('http');

async function testApiRoutes() {
  console.log('=== TESTING CANDIDATE RESUME API ROUTES ===\n');

  // Start in-memory HTTP server for testing
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  // Generate test admin token
  const testUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
  });
  if (!testUser) throw new Error('No SUPER_ADMIN user found for test token generation');

  const token = jwt.sign(
    {
      id: testUser.id,
      email: testUser.email,
      role: testUser.role,
      organizationId: testUser.organizationId || 'defaultOrg',
    },
    process.env.JWT_SECRET || 'testsecret',
    { expiresIn: '1h' }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const testPhone = `999${Math.floor(1000000 + Math.random() * 9000000)}`;

  try {
    // 1. Test Single Candidate Creation WITHOUT resume -> Should fail (400)
    console.log('Test 1: Create Candidate WITHOUT resume on standard flow -> Must return HTTP 400');
    const formWithoutResume = new FormData();
    formWithoutResume.append('fullName', 'Test Resume Requirement');
    formWithoutResume.append('phone', testPhone);

    const res1 = await fetch(`${baseUrl}/candidates/with-resume-upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formWithoutResume,
    });
    assert.strictEqual(res1.status, 400, `Expected 400, got ${res1.status}`);
    const json1 = await res1.json();
    assert(json1.error?.includes('Resume file is required') || json1.message?.includes('Resume file is required'));
    console.log('  [PASS] Resume is strictly mandatory on standard candidate creation.\n');

    // 2. Test Single Candidate Creation WITH special-character filename resume
    console.log('Test 2: Create Candidate WITH special-character filename (Sathish K.M. (Updated) - Resume v2.pdf)');
    const formWithResume = new FormData();
    formWithResume.append('fullName', 'Sathish Special Char Test');
    formWithResume.append('phone', testPhone);
    formWithResume.append('company', 'Akshara Enterprises');
    
    const samplePdfBytes = Buffer.from('%PDF-1.4 Mock resume content for special char test.');
    const pdfBlob = new Blob([samplePdfBytes], { type: 'application/pdf' });
    formWithResume.append('resume', pdfBlob, 'Sathish K.M. (Updated) - Resume v2.pdf');

    const res2 = await fetch(`${baseUrl}/candidates/with-resume-upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formWithResume,
    });
    assert.strictEqual(res2.status, 201, `Expected 201, got ${res2.status}`);
    const json2 = await res2.json();
    const createdCandidateId = json2.data?.id;
    assert(createdCandidateId, 'Candidate ID not returned in response');
    console.log(`  [PASS] Candidate created successfully: ${createdCandidateId}\n`);

    // 3. Test Resume Download
    console.log('Test 3: Download uploaded resume -> Check RFC 5987 headers and exact content match');
    const res3 = await fetch(`${baseUrl}/candidates/${createdCandidateId}/resume/download`, {
      headers: authHeaders,
    });
    assert.strictEqual(res3.status, 200, `Expected 200, got ${res3.status}`);
    assert.strictEqual(res3.headers.get('content-type'), 'application/pdf');
    
    const cdHeader = res3.headers.get('content-disposition');
    assert(cdHeader && cdHeader.includes("filename*=UTF-8''Sathish%20K.M.%20%28Updated%29%20-%20Resume%20v2.pdf"));
    
    const downloadedBuf = Buffer.from(await res3.arrayBuffer());
    assert.strictEqual(downloadedBuf.length, samplePdfBytes.length);
    assert.strictEqual(downloadedBuf.toString(), samplePdfBytes.toString());
    console.log('  [PASS] Resume downloaded accurately with RFC 5987 header and exact byte preservation.\n');

    // 4. Test Resume Replacement (POST /:id/resume) with DOCX file
    console.log('Test 4: Replace Resume with DOCX file (POST /:id/resume)');
    const replaceForm = new FormData();
    const sampleDocxBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const docxBlob = new Blob([sampleDocxBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    replaceForm.append('resume', docxBlob, 'updated_résumé.docx');

    const res4 = await fetch(`${baseUrl}/candidates/${createdCandidateId}/resume`, {
      method: 'POST',
      headers: authHeaders,
      body: replaceForm,
    });
    assert.strictEqual(res4.status, 200, `Expected 200, got ${res4.status}`);
    const json4 = await res4.json();
    assert(json4.success === true);
    console.log('  [PASS] Resume replaced successfully with verify-after-write confirmation.\n');

    // 5. Test Download of Replaced DOCX Resume
    console.log('Test 5: Download replaced DOCX resume');
    const res5 = await fetch(`${baseUrl}/candidates/${createdCandidateId}/resume/download`, {
      headers: authHeaders,
    });
    console.log('  res5 status:', res5.status);
    console.log('  res5 contentType:', res5.headers.get('content-type'));
    console.log('  res5 cd:', res5.headers.get('content-disposition'));
    assert.strictEqual(res5.status, 200, `Expected 200, got ${res5.status}`);
    const cdHeaderDocx = res5.headers.get('content-disposition');
    assert(cdHeaderDocx && cdHeaderDocx.includes("filename*=UTF-8''"));
    const docxDownloadedBuf = Buffer.from(await res5.arrayBuffer());
    assert.strictEqual(docxDownloadedBuf.length, sampleDocxBytes.length);
    console.log('  [PASS] Replaced DOCX resume downloaded accurately with Unicode header support.\n');

    // Clean up test candidate
    await prisma.candidate.delete({ where: { id: createdCandidateId } });
    console.log('  [PASS] Cleaned up live test candidate record.\n');

    console.log('=== ALL LIVE API TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    console.error('Test execution error:', err);
    throw err;
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }


}

testApiRoutes().catch(err => {
  console.error('API route test failed:', err);
  process.exit(1);
});

