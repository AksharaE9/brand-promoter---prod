'use strict';
/**
 * inject_cambridge_candidates.js
 * 
 * Idempotent, safe, and reversible injection script for Cambridge College Drive candidates.
 * 
 * Flags:
 *   --dry-run       : Simulate the import without committing changes to DB
 *   --rollback      : Remove all records created by this import marker
 *   --test-rollback : Insert 1 record, verify it, rollback, and verify clean state
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const prisma = require('../src/config/db');

/**
 * ARCHITECTURAL RULE: LIFECYCLE STATUS vs SELECTION OUTCOME
 * 
 * 1. `Interview.status` (e.g. 'COMPLETED', 'SCHEDULED', 'RESCHEDULED') tracks lifecycle state (whether the interview occurred).
 * 2. `Interview.result` and `Interview.outcome` (e.g. 'SELECTED', 'REJECTED', 'ON_HOLD', 'OFFER_LETTER') track the selection decision.
 * 3. Never infer interview date from other recruiter columns (such as DOJ). If interview date is missing, fail loudly and ask.
 */

const IMPORT_MARKER = 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT';
const DRIVE_DATE_STR = '2026-09-29';
const DRIVE_DATE = new Date('2026-09-29T10:00:00.000Z'); // 15:30 IST
const ORG_ID = 'defaultOrg';
const DEFAULT_COMPANY = 'Akshara Enterprises';

const FILES = {
  SELECTED: 'C:/Users/ASUS/Downloads/Cambridge_Selected.xlsx',
  REJECTED: 'C:/Users/ASUS/Downloads/Cambridge_Rejected.xlsx',
  ON_HOLD: 'C:/Users/ASUS/Downloads/Cambrige_OnHold.xlsx'
};

// Panelist map to DB User IDs
const PANELIST_MAP = {
  'Vinay Shetty': {
    ids: ['cYEZblWdN7gubrQvLgYj'],
    names: 'Vinay Shetty',
    primaryId: 'cYEZblWdN7gubrQvLgYj'
  },
  'Yuvan': {
    ids: ['re56ljEGsGX6xyVRsB9N'],
    names: 'Yuvan Melwin MJ',
    primaryId: 're56ljEGsGX6xyVRsB9N'
  },
  'Praneel': {
    ids: ['cmsh5at0900ddo52srakohs4b'],
    names: 'Praneel',
    primaryId: 'cmsh5at0900ddo52srakohs4b'
  },
  'Vinay Shetty & Praneel': {
    ids: ['cYEZblWdN7gubrQvLgYj', 'cmsh5at0900ddo52srakohs4b'],
    names: 'Vinay Shetty, Praneel',
    primaryId: 'cYEZblWdN7gubrQvLgYj'
  }
};

function normalizeText(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normalizeLocation(loc) {
  if (!loc) return null;
  const l = String(loc).trim();
  if (l.toLowerCase() === 'banaglore') return 'Bangalore';
  return l;
}

function parseDOJ(doj) {
  if (!doj) return null;
  const s = String(doj).trim().toLowerCase();
  if (s.includes('5th oct')) return '2026-10-05';
  return null;
}

function readAllCandidateRows() {
  const rows = [];
  for (const [listType, filePath] of Object.entries(FILES)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r || r.length === 0 || r[0] === undefined || r[0] === null || r[0] === '') continue;
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = r[idx] !== undefined ? r[idx] : null;
      });
      rowObj._list = listType;
      rows.push(rowObj);
    }
  }

  rows.sort((a, b) => Number(a['#']) - Number(b['#']));
  return rows;
}

async function rollbackImport() {
  console.log(`\n========================================`);
  console.log(`ROLLBACK: Removing records with source "${IMPORT_MARKER}"`);
  console.log(`========================================\n`);

  // Find all candidates with this source marker
  const candidates = await prisma.candidate.findMany({
    where: {
      organizationId: ORG_ID,
      OR: [
        { source: IMPORT_MARKER },
        { customFields: { path: ['import_source'], equals: IMPORT_MARKER } }
      ]
    },
    select: { id: true, fullName: true }
  });

  console.log(`Found ${candidates.length} candidates to remove.`);

  if (candidates.length === 0) {
    console.log('Nothing to rollback.');
    return;
  }

  const candidateIds = candidates.map(c => c.id);

  // 1. Remove CollegeDriveCandidates
  const deletedDriveCandidates = await prisma.collegeDriveCandidate.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedDriveCandidates.count} CollegeDriveCandidate records`);

  // 2. Remove InterviewFeedbacks
  const deletedFeedbacks = await prisma.interviewFeedback.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedFeedbacks.count} InterviewFeedback records`);

  // 3. Remove Interviews
  const deletedInterviews = await prisma.interview.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedInterviews.count} Interview records`);

  // 4. Remove Applications
  const deletedApps = await prisma.application.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedApps.count} Application records`);

  // 5. Remove Candidates
  const deletedCands = await prisma.candidate.deleteMany({
    where: { id: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedCands.count} Candidate records`);

  // Check if Cambridge Drive has 0 candidates left and clean up if empty
  const drive = await prisma.collegeDrive.findFirst({
    where: { title: 'Cambridge College Campus Recruitment Drive' }
  });
  if (drive) {
    const remainingInDrive = await prisma.collegeDriveCandidate.count({
      where: { driveId: drive.id }
    });
    if (remainingInDrive === 0) {
      await prisma.collegeDrive.delete({ where: { id: drive.id } });
      console.log(`- Deleted empty CollegeDrive: ${drive.title}`);
    }
  }

  console.log('\n[Rollback Complete] All injected records cleanly removed.\n');
}

async function runInjection({ dryRun = false, testSingle = false }) {
  console.log(`\n======================================================`);
  console.log(`CAMBRIDGE CANDIDATE INJECTION ${dryRun ? '(DRY RUN)' : '(LIVE EXECUTION)'}`);
  console.log(`======================================================\n`);

  const rawRows = readAllCandidateRows();
  console.log(`Parsed ${rawRows.length} rows from source files.`);

  // Load Job definitions
  const daJob = await prisma.job.findFirst({
    where: { title: { equals: 'Data Analyst Intern', mode: 'insensitive' }, isActive: true }
  });
  if (!daJob) throw new Error('Data Analyst Intern job not found in DB!');

  const baJob = await prisma.job.findFirst({
    where: { title: { equals: 'Business Analyst Intern', mode: 'insensitive' }, isActive: true }
  });
  if (!baJob) throw new Error('Business Analyst Intern job not found in DB!');

  console.log(`- Matched Data Analyst Intern Job ID: ${daJob.id}`);
  console.log(`- Matched Business Analyst Intern Job ID: ${baJob.id}`);

  // Find or Create Cambridge College
  let college = await prisma.college.findFirst({
    where: { name: { contains: 'Cambridge', mode: 'insensitive' } }
  });

  if (!college && !dryRun) {
    college = await prisma.college.create({
      data: {
        name: 'Cambridge College',
        location: 'Bangalore',
        area: 'KR Puram',
        role: 'Data Analyst Intern',
        course: 'BE / B.Tech',
        createdById: PANELIST_MAP['Vinay Shetty'].primaryId
      }
    });
    console.log(`- Created College: "${college.name}" (ID: ${college.id})`);
  } else if (college) {
    console.log(`- Reusing Existing College: "${college.name}" (ID: ${college.id})`);
  } else {
    console.log(`- [Dry Run] Would create College: "Cambridge College"`);
    college = { id: 'dry-run-college-id', name: 'Cambridge College' };
  }

  // Find or Create Cambridge College Drive
  let drive = await prisma.collegeDrive.findFirst({
    where: {
      collegeId: college.id,
      title: { contains: 'Cambridge', mode: 'insensitive' }
    }
  });

  if (!drive && !dryRun) {
    drive = await prisma.collegeDrive.create({
      data: {
        title: 'Cambridge College Campus Recruitment Drive',
        collegeId: college.id,
        dateFrom: DRIVE_DATE_STR,
        dateTo: DRIVE_DATE_STR,
        status: 'COMPLETED',
        description: 'Campus recruitment drive conducted at Cambridge College for Data Analyst Intern & Business Analyst Intern roles.',
        organizationId: ORG_ID,
        recruiters: [
          PANELIST_MAP['Vinay Shetty'].primaryId,
          PANELIST_MAP['Yuvan'].primaryId,
          PANELIST_MAP['Praneel'].primaryId
        ],
        linkedJobs: [daJob.id, baJob.id]
      }
    });
    console.log(`- Created College Drive: "${drive.title}" (ID: ${drive.id})`);
  } else if (drive) {
    console.log(`- Reusing Existing College Drive: "${drive.title}" (ID: ${drive.id})`);
  } else {
    console.log(`- [Dry Run] Would create College Drive: "Cambridge College Campus Recruitment Drive"`);
    drive = { id: 'dry-run-drive-id', title: 'Cambridge College Campus Recruitment Drive' };
  }

  const rowsToProcess = testSingle ? rawRows.slice(0, 1) : rawRows;
  console.log(`\nProcessing ${rowsToProcess.length} candidate(s)...`);

  const summary = {
    total: rowsToProcess.length,
    created: 0,
    skipped: 0,
    selected: 0,
    rejected: 0,
    onHold: 0,
    records: []
  };

  for (const row of rowsToProcess) {
    const serial = Number(row['#']);
    const rawName = normalizeText(row['Name']);
    const cleanName = rawName.replace(/[\*\s]+/g, ' ').trim();
    const hasAsterisk = rawName.includes('*');

    // Role mapping
    const rawRole = normalizeText(row['Role']);
    const isBA = rawRole.toLowerCase().includes('business analyst') || serial === 3;
    const targetJob = isBA ? baJob : daJob;
    const normalizedRole = isBA ? 'Business Analyst Intern' : 'Data Analyst Intern';

    // Panelist resolution
    let panelistKey = normalizeText(row['Panelist']);
    const panelistConfig = panelistKey ? (PANELIST_MAP[panelistKey] || PANELIST_MAP['Vinay Shetty']) : { ids: [], names: null, primaryId: null };

    // Status resolution based on Authoritative Source Mapping (Part 2):
    let finalStatus = 'REJECTED';
    let candidateStatus = 'REJECTED';
    let appStatus = 'REJECTED';

    if (row._list === 'SELECTED') {
      finalStatus = 'SELECTED';
      candidateStatus = 'ACTIVE';
      appStatus = 'IN_PIPELINE';
    } else if (row._list === 'ON_HOLD') {
      finalStatus = 'ON_HOLD';
      candidateStatus = 'ON_HOLD';
      appStatus = 'ON_HOLD';
    } else {
      finalStatus = 'REJECTED';
      candidateStatus = 'REJECTED';
      appStatus = 'REJECTED';
    }

    // Rating resolution (User decision: Import with 7.5, flag customFields.rating_unverified = true)
    const rawRating = row['Rating'];
    const isBlankRating = rawRating === null || rawRating === undefined || rawRating === '';
    const ratingValue = isBlankRating ? null : Number(rawRating);
    const isRatingUnverified = ratingValue === 7.5;

    // Idempotency key
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const importKey = `cambridge_2026-10-05_${serial}_${slug}`;

    // Notes and comments assembly
    const comments = normalizeText(row['Comments']);
    const otherNotes = normalizeText(row['Other Notes']);
    const timings = normalizeText(row['Timings']);
    const dojRaw = normalizeText(row['DOJ']);
    const family = normalizeText(row['Family']);
    const fromPlace = normalizeText(row['From (Place)']);
    const languages = normalizeText(row['Languages']);
    const experience = normalizeText(row['Professional Experience']);

    const fullInterviewNotes = [
      comments ? `[Comments] ${comments}` : null,
      otherNotes ? `[Other Notes] ${otherNotes}` : null,
      timings ? `[Timings] ${timings}` : null,
      dojRaw ? `[DOJ] ${dojRaw}` : null,
      family ? `[Family] ${family}` : null,
      fromPlace ? `[From] ${fromPlace}` : null,
      languages ? `[Languages] ${languages}` : null,
      experience ? `[Experience] ${experience}` : null,
    ].filter(Boolean).join('\n');

    const customFields = {
      import_source: IMPORT_MARKER,
      import_key: importKey,
      source_file: row._list,
      source_serial: serial,
      needs_contact_details: true,
      rating_unverified: isRatingUnverified,
      interview_date_inferred: true,
      has_trailing_asterisk: hasAsterisk,
      original_name: rawName,
      family: family || null,
      fromPlace: fromPlace || null,
      languages: languages || null,
      professionalExperience: experience || null,
      timings: timings || null,
      dojRaw: dojRaw || null,
      otherNotes: otherNotes || null,
      rawComments: comments || null,
    };

    if (dryRun) {
      console.log(`[DRY RUN] #${serial} ${cleanName} | Role: ${normalizedRole} | Status: ${finalStatus} | Rating: ${ratingValue} (unverified: ${isRatingUnverified}) | Panelist: ${panelistConfig.names}`);
      summary.created++;
      if (finalStatus === 'SELECTED') summary.selected++;
      else if (finalStatus === 'REJECTED') summary.rejected++;
      else summary.onHold++;
      continue;
    }

    // Check if candidate already exists by import_key
    const existingCandidate = await prisma.candidate.findFirst({
      where: {
        organizationId: ORG_ID,
        customFields: {
          path: ['import_key'],
          equals: importKey
        }
      }
    });

    if (existingCandidate) {
      console.log(`[SKIP] #${serial} ${cleanName} already imported (ID: ${existingCandidate.id})`);
      summary.skipped++;
      continue;
    }

    // Single Atomic Transaction per candidate
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Candidate
      const candidate = await tx.candidate.create({
        data: {
          fullName: cleanName,
          email: 'N/A',
          phone: '',
          course: normalizeText(row['Course']) || 'BE / B.Tech',
          graduationYear: normalizeText(row['Year']) || null,
          college: 'Cambridge College',
          preferredRole: normalizedRole,
          location: normalizeLocation(row['Location']) || 'Bangalore',
          area: normalizeText(row['Area']) || null,
          source: IMPORT_MARKER,
          status: candidateStatus,
          company: DEFAULT_COMPANY,
          doj: parseDOJ(dojRaw),
          organizationId: ORG_ID,
          createdById: panelistConfig.primaryId,
          customFields
        }
      });

      // 2. Create Application
      const application = await tx.application.create({
        data: {
          candidateId: candidate.id,
          jobId: targetJob.id,
          status: appStatus,
          organizationId: ORG_ID,
        }
      });

      // 3. Create Interview
      const interview = await tx.interview.create({
        data: {
          candidateId: candidate.id,
          candidateName: candidate.fullName,
          applicationId: application.id,
          jobId: targetJob.id,
          jobTitle: targetJob.title,
          roundNo: 1,
          round: 'ROUND_1',
          scheduledStart: DRIVE_DATE,
          durationMinutes: 45,
          mode: 'DRIVE',
          status: 'COMPLETED',
          result: finalStatus,
          outcome: finalStatus,
          outcomeSetAt: DRIVE_DATE,
          notes: fullInterviewNotes,
          interviewerIds: panelistConfig.ids,
          interviewerNames: panelistConfig.names,
          organizationId: ORG_ID,
          createdById: panelistConfig.primaryId,
          feedback: [
            {
              round: 'ROUND_1',
              selectionStatus: finalStatus,
              overallRating: ratingValue,
              comments: fullInterviewNotes,
              submittedById: panelistConfig.primaryId,
              createdAt: DRIVE_DATE
            }
          ]
        }
      });

      // 4. Create InterviewFeedback
      const feedback = await tx.interviewFeedback.create({
        data: {
          candidateId: candidate.id,
          round: 'ROUND_1',
          submittedById: panelistConfig.primaryId,
          templateVersion: 2,
          selectionStatus: finalStatus,
          overallRating: ratingValue,
          feedbackData: {
            round: 'ROUND_1',
            selectionStatus: finalStatus,
            overallRating: ratingValue,
            comments: comments || 'Campus recruitment evaluation',
            family,
            fromPlace,
            languages,
            professionalExperience: experience,
            timings,
            otherNotes,
            doj: dojRaw
          }
        }
      });

      // 5. Enroll in CollegeDriveCandidate
      const driveCandidate = await tx.collegeDriveCandidate.create({
        data: {
          driveId: drive.id,
          candidateId: candidate.id,
          fullName: candidate.fullName,
          email: null,
          phone: '',
          status: 'ADDED'
        }
      });

      return { candidate, application, interview, feedback, driveCandidate };
    });

    console.log(`[INJECTED] #${serial} ${cleanName} -> Candidate ID: ${result.candidate.id} | Status: ${finalStatus} | Role: ${normalizedRole}`);
    summary.created++;
    if (finalStatus === 'SELECTED') summary.selected++;
    else if (finalStatus === 'REJECTED') summary.rejected++;
    else summary.onHold++;

    summary.records.push({
      serial,
      name: cleanName,
      candidateId: result.candidate.id,
      role: normalizedRole,
      status: finalStatus,
      rating: ratingValue,
      panelists: panelistConfig.names
    });

    // Pause briefly to keep memory & connection pool smooth
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n======================================================`);
  console.log(`SUMMARY: Total Processed: ${summary.total} | Created: ${summary.created} | Skipped: ${summary.skipped}`);
  console.log(`Breakdown: ${summary.selected} SELECTED, ${summary.rejected} REJECTED, ${summary.onHold} ON_HOLD`);
  console.log(`======================================================\n`);

  // Post-import reconciliation assertion guard
  if (!dryRun && !testSingle) {
    if (summary.selected !== 14 || summary.rejected !== 19 || summary.onHold !== 2) {
      throw new Error(`RECONCILIATION FAILURE: Expected 14 SELECTED, 19 REJECTED, 2 ON_HOLD. Got ${summary.selected}/${summary.rejected}/${summary.onHold}`);
    }
    console.log('[Post-Import Reconciliation Check Passed] Distribution exactly matches 14/19/2.\n');
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const isRollback = args.includes('--rollback');
  const isDryRun = args.includes('--dry-run');
  const isTestRollback = args.includes('--test-rollback');

  try {
    if (isRollback) {
      await rollbackImport();
    } else if (isTestRollback) {
      console.log('\n--- TESTING ROLLBACK SAFETY ON 1 RECORD ---');
      await runInjection({ dryRun: false, testSingle: true });
      await rollbackImport();
      console.log('--- TEST ROLLBACK FINISHED CLEANLY ---\n');
    } else {
      await runInjection({ dryRun: isDryRun, testSingle: false });
    }
  } catch (err) {
    console.error('Execution failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
