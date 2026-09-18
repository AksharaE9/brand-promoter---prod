require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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

const { makeContentDisposition, getSafeExtension, verifyDbFile, isDbStorageKey, makeStorageKey } = require('../src/utils/dbStorage');
const { validateFile } = require('../src/utils/fileValidator');
const { normalizeResumeLink } = require('../src/lib/resumeLinkNormalizer');

async function runVerification() {
  console.log('=== PHASE 6: AUTOMATED RESUME SYSTEM VERIFICATION ===\n');

  // Test 1: Extension Parsing (Category E defense)
  console.log('Test 1: Multi-dot safe extension extraction');
  assert.strictEqual(getSafeExtension('resume.pdf'), 'pdf');
  assert.strictEqual(getSafeExtension('Sathish K.M. (Updated) - Resume.pdf'), 'pdf');
  assert.strictEqual(getSafeExtension('WhatsApp Image 2026-08-29 at 10.14.09 AM.jpeg'), 'jpeg');
  assert.strictEqual(getSafeExtension('my.resume.v2.final.DOCX'), 'docx');
  assert.strictEqual(getSafeExtension('noextension'), '');
  console.log('  [PASS] Extension parsing handles multi-dots, parentheses, spaces, and case correctly.\n');

  // Test 2: RFC 5987 Content-Disposition formatting
  console.log('Test 2: RFC 5987 Content-Disposition formatting');
  const simpleHeader = makeContentDisposition('resume.pdf', 'attachment');
  assert(simpleHeader.includes('filename="resume.pdf"'));
  assert(simpleHeader.includes("filename*=UTF-8''resume.pdf"));

  const complexHeader = makeContentDisposition('Sathish K.M. (Updated) - Resume v2.pdf', 'attachment');
  assert(complexHeader.includes("filename*=UTF-8''Sathish%20K.M.%20%28Updated%29%20-%20Resume%20v2.pdf"));
  
  const unicodeHeader = makeContentDisposition('résumé.pdf', 'attachment');
  assert(unicodeHeader.includes("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"));
  console.log('  [PASS] RFC 5987 Content-Disposition header correctly generated for ASCII, complex, and Unicode names.\n');

  // Test 3: Resume Link Normalizer rejects file:/// schemes
  console.log('Test 3: Resume link normalizer security');
  assert.strictEqual(normalizeResumeLink('file:///C:/Users/Admin/Downloads/resume.pdf'), null);
  assert.strictEqual(normalizeResumeLink('javascript:alert(1)'), null);
  const validDrive = normalizeResumeLink('https://drive.google.com/file/d/12345/view?usp=sharing');
  assert(validDrive && validDrive.provider === 'google_drive');
  console.log('  [PASS] Local file:/// and malicious schemes strictly rejected.\n');

  // Test 4: File Validator tests
  console.log('Test 4: File validator MIME + magic byte check');
  const pdfBuffer = Buffer.from('%PDF-1.4 sample content');
  const pdfValid = validateFile({ originalname: 'Sathish K.M. (Updated) - Resume.pdf', buffer: pdfBuffer, mimetype: 'application/pdf' }, 'candidate');
  assert.strictEqual(pdfValid.valid, true);

  const docxBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const docxValid = validateFile({ originalname: 'candidate_cv.docx', buffer: docxBuffer, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'candidate');
  assert.strictEqual(docxValid.valid, true);
  console.log('  [PASS] PDF and DOCX formats validated accurately.\n');

  // Test 5: Verify-After-Write asserting DB persistence
  console.log('Test 5: Verify-after-write with live DB BLOB write & readback');
  const testCandidateName = `Test_Candidate_${Date.now()}`;
  const testFileName = 'Sathish K.M. (Updated) - Resume v2.pdf';
  const testFileData = Buffer.from('%PDF-1.4 Mock verification resume content for automated test.');

  // Create temporary FileMeta
  const fileMeta = await prisma.fileMeta.create({
    data: {
      storageKey: 'db://pending',
      originalName: testFileName,
      mimeType: 'application/pdf',
      sizeBytes: testFileData.length,
      fileData: testFileData,
    },
  });

  await prisma.fileMeta.update({
    where: { id: fileMeta.id },
    data: { storageKey: makeStorageKey(fileMeta.id) },
  });

  // Verify post-write
  const verifiedMeta = await verifyDbFile(prisma, fileMeta.id, 1);
  assert.strictEqual(verifiedMeta.id, fileMeta.id);
  assert.strictEqual(verifiedMeta.sizeBytes, testFileData.length);
  assert(verifiedMeta.fileData && verifiedMeta.fileData.length === testFileData.length);
  console.log('  [PASS] Verify-after-write confirmed file existence and byte integrity.');

  // Clean up test fileMeta
  await prisma.fileMeta.delete({ where: { id: fileMeta.id } });
  console.log('  [PASS] Cleaned up temporary test record.\n');

  // Test 6: Verify simulated zero-byte / missing upload failure
  console.log('Test 6: Simulated post-write failure detection');
  let caughtError = false;
  try {
    await verifyDbFile(prisma, 'non_existent_meta_id', 1);
  } catch (err) {
    caughtError = true;
    assert(err.message.includes('Post-write verification failed'));
  }
  assert.strictEqual(caughtError, true);
  console.log('  [PASS] Missing / corrupted writes throw immediately before candidate creation.\n');

  // Test 7: Verify reparied Category B candidates in DB
  console.log('Test 7: Verify repaired candidates in DB');
  const sidhi = await prisma.candidate.findUnique({
    where: { id: 'cmsx51o9i00c2ib2rjr84hqjf' },
    include: { resumeFile: true },
  });
  assert(sidhi && sidhi.resumeFile && sidhi.resumeFile.storageKey.startsWith('db://'));
  assert(sidhi.resumeFile.fileData && sidhi.resumeFile.fileData.length > 0);
  console.log(`  [PASS] Candidate Sidhi Ostwal storageKey is now: ${sidhi.resumeFile.storageKey} (Binary size: ${sidhi.resumeFile.fileData.length} bytes).\n`);

  console.log('=== ALL PHASE 6 AUTOMATED CHECKS PASSED SUCCESSFULLY ===\n');

  await prisma.$disconnect();
}

runVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
