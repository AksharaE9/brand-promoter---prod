'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const prisma = require('../config/db');

// Import all processor entry points
const candidateProc = require('../jobs/bulkCandidateUpload.processor');
const joinedProc = require('../jobs/bulkJoinedCandidateUpload.processor');
const offerProc = require('../jobs/bulkOfferLetterUpload.processor');
const interviewProc = require('../jobs/bulkInterviewUpload.processor');
const feedbackProc = require('../jobs/bulkFeedbackUpload.processor');
const { getErrorReportPath } = require('../lib/bulkUploadErrorReport');

const TEMP_TEST_DIR = path.join(__dirname, '..', '..', 'uploads', 'test_audit');
if (!fs.existsSync(TEMP_TEST_DIR)) {
  fs.mkdirSync(TEMP_TEST_DIR, { recursive: true });
}

let baselineCounts = {};

async function cleanZztestRecords() {
  const zzCandidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { fullName: { contains: 'ZZTEST' } },
        { email: { contains: 'zztest' } },
        { phone: { startsWith: '+919999' } },
        { phoneNormalized: { startsWith: '9999' } },
        { phone: '1.42E+10' },
        { phoneNormalized: '14200000000' },
      ]
    },
    select: { id: true }
  });
  const candIds = zzCandidates.map(c => c.id);

  // 1. Delete all interviews linked to test candidates or test applications
  await prisma.interview.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
        { candidateName: { contains: 'ZZTEST' } },
      ]
    }
  });

  // 2. Delete feedbacks
  await prisma.interviewFeedback.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
      ]
    }
  });

  // 3. Delete drive candidates
  await prisma.collegeDriveCandidate.deleteMany({
    where: {
      OR: [
        { fullName: { contains: 'ZZTEST' } },
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
      ]
    }
  });

  // 4. Delete pipeline events
  const zzApps = await prisma.application.findMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
        { candidate: { fullName: { contains: 'ZZTEST' } } }
      ]
    },
    select: { id: true }
  });
  const appIds = zzApps.map(a => a.id);

  if (appIds.length > 0) {
    await prisma.pipelineEvent.deleteMany({
      where: { applicationId: { in: appIds } }
    }).catch(() => {});
  }

  // 5. Delete all applications
  await prisma.application.deleteMany({
    where: {
      OR: [
        ...(appIds.length > 0 ? [{ id: { in: appIds } }] : []),
        ...(candIds.length > 0 ? [{ candidateId: { in: candIds } }] : []),
        { candidate: { fullName: { contains: 'ZZTEST' } } }
      ]
    }
  });

  // 6. Delete candidates
  await prisma.candidate.deleteMany({
    where: {
      OR: [
        ...(candIds.length > 0 ? [{ id: { in: candIds } }] : []),
        { fullName: { contains: 'ZZTEST' } },
        { email: { contains: 'zztest' } }
      ]
    }
  });

  // 7. Delete auto-created jobs
  await prisma.job.deleteMany({
    where: {
      OR: [
        { title: { contains: 'ZZTEST' } },
        { source: 'BULK_IMPORT_AUTO' }
      ]
    }
  }).catch(() => {});

  // Clean temp files
  try {
    const files = fs.readdirSync(TEMP_TEST_DIR);
    for (const f of files) fs.unlinkSync(path.join(TEMP_TEST_DIR, f));
  } catch (_) {}
}

async function recordBaselines() {
  await cleanZztestRecords();
  baselineCounts = {
    userCount: await prisma.user.count(),
    candidateCount: await prisma.candidate.count({ where: { isDeleted: false } }),
    interviewCount: await prisma.interview.count(),
    interviewFeedbackCount: await prisma.interviewFeedback.count(),
    applicationCount: await prisma.application.count(),
    collegeDriveCandidateCount: await prisma.collegeDriveCandidate.count(),
  };
  console.log('[INITIAL CLEAN BASELINE]', JSON.stringify(baselineCounts, null, 2));
}

async function verifyAndCleanup() {
  console.log('\n--- Cleaning up ZZTEST records ---');
  await cleanZztestRecords();

  const currentCounts = {
    userCount: await prisma.user.count(),
    candidateCount: await prisma.candidate.count({ where: { isDeleted: false } }),
    interviewCount: await prisma.interview.count(),
    interviewFeedbackCount: await prisma.interviewFeedback.count(),
    applicationCount: await prisma.application.count(),
    collegeDriveCandidateCount: await prisma.collegeDriveCandidate.count(),
  };

  let clean = true;
  for (const k of Object.keys(baselineCounts)) {
    if (baselineCounts[k] !== currentCounts[k]) {
      console.error(`[MISMATCH] Baseline count for ${k} was ${baselineCounts[k]}, now ${currentCounts[k]}`);
      clean = false;
    }
  }
  if (clean) {
    console.log('✅ Baseline restored cleanly.');
  }
  return clean;
}

/**
 * Generates test sheets for 50 rows or 100 rows.
 */
async function generateTestFile(pathType, totalRows, format = 'xlsx', prefix = '') {
  const filePath = path.join(TEMP_TEST_DIR, `zztest_${prefix}${pathType}_${totalRows}_${Date.now()}.${format}`);
  
  const validCount = totalRows === 50 ? 35 : 70;
  const dupCount = totalRows === 50 ? 8 : 15;
  const errCount = totalRows === 50 ? 7 : 15;

  const rows = [];

  // Generate valid rows
  for (let i = 1; i <= validCount; i++) {
    const pad = String(i).padStart(4, '0');
    let phoneStr = `+9199991${pad}`;
    // Test scientific notation on row 1
    if (i === 1) {
      phoneStr = '1.42E+10';
    }

    if (pathType === 'candidates' || pathType === 'drives') {
      rows.push({
        'Name': `ZZTEST Candidate ${pad}`,
        'Role': 'Software Engineer',
        'e-mail': `zztest_cand_${pad}@example.com`,
        'phone number': phoneStr,
        'resume link': pathType === 'drives' ? '' : `https://drive.google.com/file/d/zztest_${pad}/view`,
        'college': 'ZZTEST Institute of Tech',
        'location': 'Bangalore',
        'course': 'B.Tech CSE',
      });
    } else if (pathType === 'joined') {
      rows.push({
        'Name': `ZZTEST Joined ${pad}`,
        'Phone Number': phoneStr,
        'E-Mail': `zztest_joined_${pad}@example.com`,
        'Role': 'Senior Developer',
        'Joining Date': '2026-08-01',
        'College': 'ZZTEST University',
        'Location': 'Mumbai',
      });
    } else if (pathType === 'offer') {
      rows.push({
        'Name': `ZZTEST Offer ${pad}`,
        'Phone Number': phoneStr,
        'E-Mail': `zztest_offer_${pad}@example.com`,
        'Role': 'Lead QA Engineer',
        'Offer Date': '2026-08-15',
        'Offer Decision': 'Accepted',
      });
    } else if (pathType === 'interviews') {
      rows.push({
        'Candidate Name': `ZZTEST IntCand ${pad}`,
        'Job Role': 'Software Engineer',
        'Phone Number': phoneStr,
        'Round': 'Round 1',
        'Meeting Mode': 'Online Meeting',
        'Start Date & Time': '31-07-2026 & 15:00',
        'Duration': '45',
        'Meeting Link': `https://meet.zoho.com/zztest-${pad}`,
        'Interviewers': 'ZZTEST Admin',
      });
    } else if (pathType === 'feedback') {
      rows.push({
        'Name': `ZZTEST FbCand ${pad}`,
        'Number': phoneStr,
        'Round Number': 'Round 1',
        'Panelists': 'ZZTEST Admin',
        'Role': 'Software Engineer',
        'Overall Rating': '8',
        'DOJ': '2026-08-01',
        'Timings': '10:00 AM',
        'Duration': '45 mins',
        'Selection Status': 'SELECTED',
        'Comments (Reason for Selection/Reject)': 'Strong technical skills',
      });
    }
  }

  // Generate in-sheet duplicates
  for (let d = 1; d <= dupCount; d++) {
    const targetIdx = (d % validCount) || 1;
    const padTarget = String(targetIdx).padStart(4, '0');
    const dupPad = String(1000 + d);
    let targetPhone = `+9199991${padTarget}`;
    if (targetIdx === 1) targetPhone = '1.42E+10';

    if (pathType === 'candidates' || pathType === 'drives') {
      rows.push({
        'Name': `ZZTEST DupCandidate ${dupPad}`,
        'Role': 'Software Engineer',
        'e-mail': `zztest_cand_${padTarget}@example.com`,
        'phone number': targetPhone,
        'resume link': `https://drive.google.com/file/d/dup_${dupPad}`,
        'college': 'ZZTEST Institute',
      });
    } else if (pathType === 'joined' || pathType === 'offer') {
      rows.push({
        'Name': `ZZTEST DupRecord ${dupPad}`,
        'Phone Number': targetPhone,
        'E-Mail': `zztest_dup_${dupPad}@example.com`,
        'Role': 'Developer',
      });
    } else if (pathType === 'interviews') {
      rows.push({
        'Candidate Name': `ZZTEST DupIntCand ${dupPad}`,
        'Job Role': 'Software Engineer',
        'Phone Number': targetPhone,
        'Round': 'Round 1',
        'Meeting Mode': 'Online Meeting',
        'Start Date & Time': '31-07-2026 & 15:00',
        'Duration': '45',
        'Meeting Link': `https://meet.zoho.com/dup-${dupPad}`,
      });
    } else if (pathType === 'feedback') {
      rows.push({
        'Name': `ZZTEST DupFbCand ${dupPad}`,
        'Number': targetPhone,
        'Round Number': 'Round 1',
        'Panelists': 'ZZTEST Admin',
        'Role': 'Software Engineer',
        'Overall Rating': '7',
        'DOJ': '2026-08-01',
        'Timings': '11:00 AM',
        'Duration': '30 mins',
        'Selection Status': 'ON_HOLD',
      });
    }
  }

  // Generate invalid rows
  const failureScenarios = [
    { desc: 'missing required name', patch: { 'Name': '', 'Candidate Name': '' } },
    { desc: 'missing required phone', patch: { 'phone number': '', 'Phone Number': '' } },
    { desc: 'malformed phone', patch: { 'phone number': 'invalid-phone-abc', 'Phone Number': 'invalid-phone-abc' } },
    { desc: 'malformed email', patch: { 'e-mail': 'not-an-email', 'E-Mail': 'not-an-email' } },
    { desc: 'invalid resume URL', patch: { 'resume link': 'not_a_valid_url' } },
    { desc: 'invalid round', patch: { 'Round': 'Round 99 Nonexistent', 'Round Number': 'Round 99 Nonexistent' } },
    { desc: 'invalid meeting mode', patch: { 'Meeting Mode': 'Telepathic' } },
    { desc: 'invalid date time', patch: { 'Start Date & Time': 'yesteryear 99:99' } },
    { desc: 'out of range duration', patch: { 'Duration': '99999' } },
    { desc: 'missing virtual link', patch: { 'Meeting Mode': 'Online Meeting', 'Meeting Link': '', 'Zoho Link': '' } },
    { desc: 'missing status/panelist', patch: { 'Panelists': '', 'Selection Status': '' } },
    { desc: 'malformed phone 2', patch: { 'phone number': '123', 'Phone Number': '123' } },
    { desc: 'missing name 2', patch: { 'Name': '', 'Candidate Name': '' } },
    { desc: 'malformed email 2', patch: { 'e-mail': 'bad@@domain..com', 'E-Mail': 'bad@@domain..com' } },
    { desc: 'missing required field role', patch: { 'Role': '', 'Job Role': '' } },
  ];

  for (let e = 0; e < errCount; e++) {
    const scenario = failureScenarios[e % failureScenarios.length];
    const padErr = String(2000 + e);
    const baseRow = {
      'Name': `ZZTEST ErrorCand ${padErr}`,
      'Candidate Name': `ZZTEST ErrorCand ${padErr}`,
      'Role': 'QA Tester',
      'Job Role': 'QA Tester',
      'jobRole': 'QA Tester',
      'e-mail': `zztest_err_${padErr}@example.com`,
      'E-Mail': `zztest_err_${padErr}@example.com`,
      'phone number': `+9199992${padErr}`,
      'Phone Number': `+9199992${padErr}`,
      'Number': `+9199992${padErr}`,
      'resume link': `https://drive.google.com/file/d/err_${padErr}`,
      'Round': 'Round 1',
      'Round Number': 'Round 1',
      'Meeting Mode': 'Online Meeting',
      'Start Date & Time': '31-07-2026 & 16:00',
      'Duration': '30',
      'Meeting Link': `https://meet.zoho.com/err-${padErr}`,
      'Panelists': 'ZZTEST Admin',
      'DOJ': '2026-08-01',
      'Timings': '10:00 AM',
      'Selection Status': 'REJECTED',
      'Overall Rating': '2',
      ...scenario.patch,
    };
    rows.push(baseRow);
  }

  if (rows.length !== totalRows) {
    throw new Error(`Generated rows count ${rows.length} does not match expected total ${totalRows}`);
  }

  // Write file
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    for (const r of rows) {
      ws.addRow(headers.map(h => r[h] !== undefined ? r[h] : ''));
    }
    await wb.xlsx.writeFile(filePath);
  } else {
    const headers = Object.keys(rows[0]);
    const csvContent = headers.join(',') + '\n' +
      rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
    fs.writeFileSync(filePath, csvContent, 'utf8');
  }

  return { filePath, expectedValid: validCount, expectedDuplicates: dupCount, expectedErrors: errCount };
}

async function runAudit() {
  await recordBaselines();

  const paths = [
    { name: 'All Candidates', type: 'candidates', proc: candidateProc.processCandidateUpload },
    { name: 'Joined Candidates', type: 'joined', proc: joinedProc.processJoinedCandidateUpload },
    { name: 'Offer Letter Candidates', type: 'offer', proc: offerProc.processOfferLetterUpload },
    { name: 'Interview Schedule', type: 'interviews', proc: interviewProc.processBulkInterviewUpload },
    { name: 'Interview Feedback', type: 'feedback', proc: feedbackProc.processBulkFeedbackUpload },
    { name: 'College Drives', type: 'drives', proc: (opts) => candidateProc.processCandidateUpload({ ...opts, driveId: 'test_drive_001', isDriveContext: true }) },
  ];

  const results = [];

  for (const p of paths) {
    console.log(`\n======================================================`);
    console.log(`AUDITING PATH: ${p.name}`);
    console.log(`======================================================`);

    for (const totalRows of [50, 100]) {
      console.log(`\n--- Testing ${totalRows}-row reconciliation for ${p.name} ---`);
      const { filePath, expectedValid, expectedDuplicates, expectedErrors } = await generateTestFile(p.type, totalRows, 'xlsx');

      const jobId = `audit_${p.type}_${totalRows}_${Date.now()}`;
      const startMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const startTime = Date.now();

      const jobData = {
        jobId,
        filePath,
        fileType: '.xlsx',
        uploadedBy: 'cmsehyvnd0000ijdsmvt4ifw3',
        userRole: 'SUPER_ADMIN',
        organizationId: 'defaultOrg',
        sourceFilename: path.basename(filePath),
      };

      const summary = await p.proc(jobData);
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const endMem = Math.round(process.memoryUsage().rss / 1024 / 1024);

      console.log(`Job summary:`, summary);
      console.log(`Duration: ${durationSec}s | Memory: ${startMem}MB -> ${endMem}MB (delta: ${endMem - startMem}MB)`);

      // 1. Reconciliation check
      const N_sheet = totalRows;
      const N_reported = summary.processed;
      const created = summary.created || 0;
      const updated = summary.updated || 0;
      const succeeded = summary.succeeded !== undefined ? summary.succeeded : (created + updated);
      const duplicates = summary.duplicates || 0;
      const failed = summary.failed || 0;

      const reconciled = (succeeded + duplicates + failed === N_sheet);
      console.log(`Accounting Check: ${succeeded} (succeeded: ${created} created, ${updated} updated) + ${duplicates} (duplicates) + ${failed} (failed) = ${succeeded + duplicates + failed} / ${N_sheet} -> ${reconciled ? 'PASS' : 'FAIL'}`);

      // 2. Check Database record creation for ZZTEST
      let dbCreatedCount = 0;
      if (p.type === 'candidates' || p.type === 'joined' || p.type === 'offer' || p.type === 'drives') {
        dbCreatedCount = await prisma.candidate.count({
          where: { fullName: { startsWith: 'ZZTEST' } }
        });
      } else if (p.type === 'interviews') {
        dbCreatedCount = await prisma.interview.count({
          where: { candidateName: { startsWith: 'ZZTEST' } }
        });
      } else if (p.type === 'feedback') {
        dbCreatedCount = await prisma.interviewFeedback.count({
          where: { candidate: { fullName: { startsWith: 'ZZTEST' } } }
        });
      }

      // 3. Error report check
      const reportPath = getErrorReportPath(jobId);
      let errorReportValid = false;
      let errorReportRowCount = 0;
      if (reportPath && fs.existsSync(reportPath)) {
        const reportWb = new ExcelJS.Workbook();
        await reportWb.xlsx.readFile(reportPath);
        const reportWs = reportWb.getWorksheet(1);
        errorReportRowCount = reportWs.rowCount - 1;
        errorReportValid = reportWs.rowCount > 1;
      }

      // 4. Idempotency test (generate duplicate sheet with same content and re-upload)
      console.log(`- Running Idempotency check for ${p.name}...`);
      const { filePath: reFilePath } = await generateTestFile(p.type, totalRows, 'xlsx', 're_');
      const reJobId = `re_${jobId}`;
      const reSummary = await p.proc({ ...jobData, filePath: reFilePath, jobId: reJobId });
      const reCreated = reSummary.created || 0;
      const isIdempotent = (reCreated === 0 || reSummary.duplicates >= expectedValid);
      console.log(`- Idempotency outcome: reCreated=${reCreated}, reDuplicates=${reSummary.duplicates} -> ${isIdempotent ? 'PASS' : 'FAIL'}`);

      results.push({
        path: p.name,
        rows: totalRows,
        N_sheet,
        N_reported,
        N_database: dbCreatedCount,
        created,
        duplicates,
        failed,
        reconciled,
        durationSec,
        memDeltaMb: endMem - startMem,
        errorReportRowCount,
        isIdempotent,
      });

      // Intermediate cleanup between tests
      await verifyAndCleanup();
    }
  }

  console.log('\n======================================================');
  console.log('FINAL AUDIT SUMMARY TABLE');
  console.log('======================================================');
  console.table(results);

  // Final cleanup and assertion
  const clean = await verifyAndCleanup();
  await prisma.$disconnect();

  if (!clean) {
    process.exit(1);
  }
}

runAudit().catch(async (err) => {
  console.error('[AUDIT FATAL ERROR]', err);
  await verifyAndCleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
