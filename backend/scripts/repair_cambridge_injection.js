'use strict';
/**
 * repair_cambridge_injection.js
 * 
 * In-place correction script for Cambridge College Drive candidates.
 * Fixes:
 *  1. Defect 1: Interview selection outcome vs lifecycle status (set result & outcome = SELECTED/REJECTED/ON_HOLD)
 *  2. Defect 2: Scheduled interview date corrected to 2026-09-29T10:00:00.000Z (15:30 IST)
 *  3. Defect 3: Verifies & repairs feedback records, ensuring blank ratings remain null and #31 Pooja is REJECTED
 *  4. College Drive date corrected to 2026-09-29
 *  5. #21 Amrutha A Hegde panelist cleared to none (pending user decision)
 * 
 * Flags:
 *  --dry-run : Simulate and print before/after diff table without modifying the DB
 */

const prisma = require('../src/config/db');

const IMPORT_MARKER = 'CAMBRIDGE_COLLEGE_DRIVE_IMPORT';
const CORRECT_INTERVIEW_DATE = new Date('2026-09-29T10:00:00.000Z'); // 15:30 IST
const CORRECT_DRIVE_DATE_STR = '2026-09-29';

// Authoritative mapping from Part 2:
const AUTHORITATIVE_MAPPING = {
  // SELECTED (14)
  1:  { name: 'Aishwarya',                  status: 'SELECTED', rating: 7.5 },
  7:  { name: 'Kiran B N',                  status: 'SELECTED', rating: 7.5 },
  9:  { name: 'Prajwal Mirji',              status: 'SELECTED', rating: 8 },
  11: { name: 'Prarthana K P',              status: 'SELECTED', rating: 7 },
  12: { name: 'Shree Nayana',               status: 'SELECTED', rating: 7.5 },
  13: { name: 'Sangeetha',                  status: 'SELECTED', rating: 7.5 },
  16: { name: 'Madhavilatha Ramagouni',     status: 'SELECTED', rating: 7.5 },
  22: { name: 'R ullas',                    status: 'SELECTED', rating: 8 },
  23: { name: 'Soumya Ranjan Nayak',        status: 'SELECTED', rating: 9 },
  24: { name: 'anuvamshi BN',               status: 'SELECTED', rating: 9 },
  30: { name: 'Venashree',                  status: 'SELECTED', rating: null },
  32: { name: 'Shashank Kn',                status: 'SELECTED', rating: 8 },
  33: { name: 'Nithin',                     status: 'SELECTED', rating: 8 },
  34: { name: 'Sujith Kumar S',             status: 'SELECTED', rating: 8 },

  // REJECTED (19)
  2:  { name: 'Suhas B N',                  status: 'REJECTED', rating: 7.5 },
  3:  { name: 'Vybhavee S',                 status: 'REJECTED', rating: 7.5 },
  4:  { name: 'Yaschitha',                  status: 'REJECTED', rating: 7.5 },
  5:  { name: 'Gaganashree M V',            status: 'REJECTED', rating: 7.5 },
  6:  { name: 'B Bharat',                   status: 'REJECTED', rating: 7.5 },
  8:  { name: 'Lekhana N',                  status: 'REJECTED', rating: 7.5 },
  14: { name: 'Sinchana Dayanand Patgar',   status: 'REJECTED', rating: 7.5 },
  15: { name: 'Pramitha',                   status: 'REJECTED', rating: 7.5 },
  17: { name: 'Meghana Oleti',              status: 'REJECTED', rating: 7.5 },
  19: { name: 'Goddumarri nanda Kishore',   status: 'REJECTED', rating: 2 },
  20: { name: 'Ganesh',                     status: 'REJECTED', rating: 4 },
  25: { name: 'Ashritha Kanakairi',         status: 'REJECTED', rating: 6 },
  26: { name: 'Balaji',                     status: 'REJECTED', rating: 6 },
  27: { name: 'Soubhagyalaxmi Sanganaouda Patil', status: 'REJECTED', rating: 4 },
  28: { name: 'Shriya',                     status: 'REJECTED', rating: 3 },
  29: { name: 'Rekhashree D',               status: 'REJECTED', rating: 6 },
  31: { name: 'Pooja',                      status: 'REJECTED', rating: null },
  35: { name: 'Medha Dattta H',             status: 'REJECTED', rating: 4 },
  36: { name: 'Lubaa Farooqui',             status: 'REJECTED', rating: 4 },

  // ON_HOLD (2)
  10: { name: 'Mukund Jogi',                status: 'ON_HOLD', rating: null },
  21: { name: 'Amrutha A Hegde',            status: 'ON_HOLD', rating: null }
};

async function repair({ dryRun = false }) {
  console.log(`\n======================================================`);
  console.log(`CAMBRIDGE INJECTION REPAIR ${dryRun ? '(DRY RUN - NO DB CHANGES)' : '(LIVE REPAIR EXECUTION)'}`);
  console.log(`======================================================\n`);

  // 1. Fetch all candidates matching the import marker
  const candidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { source: IMPORT_MARKER },
        { customFields: { path: ['import_source'], equals: IMPORT_MARKER } }
      ]
    },
    include: {
      applications: {
        include: {
          interviews: true
        }
      },
      interviewFeedbacks: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Safety Check 1: Found ${candidates.length} candidate records carrying the Cambridge import marker.`);
  if (candidates.length !== 35) {
    throw new Error(`SAFETY ABORT: Expected exactly 35 Cambridge candidate records, but found ${candidates.length}!`);
  }

  // Check non-Cambridge records count to guarantee isolation
  const nonCambridgeCountBefore = await prisma.candidate.count({
    where: {
      NOT: {
        OR: [
          { source: IMPORT_MARKER },
          { customFields: { path: ['import_source'], equals: IMPORT_MARKER } }
        ]
      }
    }
  });
  console.log(`Safety Check 2: Found ${nonCambridgeCountBefore} non-Cambridge candidate records in DB (must remain untouched).\n`);

  const diffTable = [];
  let updatedCount = 0;

  for (const candidate of candidates) {
    const serial = candidate.customFields?.source_serial;
    if (!serial || !AUTHORITATIVE_MAPPING[serial]) {
      throw new Error(`SAFETY ABORT: Unrecognized candidate serial #${serial} (${candidate.fullName})!`);
    }

    const target = AUTHORITATIVE_MAPPING[serial];
    const app = candidate.applications[0];
    const iv = app?.interviews[0];
    const fb = candidate.interviewFeedbacks[0];

    if (!app || !iv || !fb) {
      throw new Error(`SAFETY ABORT: Candidate #${serial} (${candidate.fullName}) is missing Application, Interview, or InterviewFeedback record!`);
    }

    // Determine target field values
    const targetOutcome = target.status; // 'SELECTED' | 'REJECTED' | 'ON_HOLD'
    const targetCandidateStatus = targetOutcome === 'SELECTED' ? 'ACTIVE' : targetOutcome === 'REJECTED' ? 'REJECTED' : 'ON_HOLD';
    const targetAppStatus = targetOutcome === 'SELECTED' ? 'IN_PIPELINE' : targetOutcome === 'REJECTED' ? 'REJECTED' : 'ON_HOLD';
    const targetFeedbackStatus = targetOutcome; // 'SELECTED' | 'REJECTED' | 'ON_HOLD'
    const targetRating = target.rating; // number or null

    // Panelist correction for #21 (no panelist in source)
    const isSerial21 = serial === 21;
    const targetInterviewerIds = isSerial21 ? [] : iv.interviewerIds;
    const targetInterviewerNames = isSerial21 ? null : iv.interviewerNames;
    const targetFeedbackSubmitter = isSerial21 ? null : fb.submittedById;

    // Build diff entry
    diffTable.push({
      '#': serial,
      Name: candidate.fullName,
      'Old Cand Status': candidate.status,
      'New Cand Status': targetCandidateStatus,
      'Old IV Result': iv.result,
      'New IV Result': targetOutcome,
      'Old IV Outcome': iv.outcome,
      'New IV Outcome': targetOutcome,
      'Old IV Date': iv.scheduledStart ? iv.scheduledStart.toISOString().split('T')[0] : 'NULL',
      'New IV Date': '2026-09-29',
      'Old Rating': fb.overallRating,
      'New Rating': targetRating,
      'Old FB Status': fb.selectionStatus,
      'New FB Status': targetFeedbackStatus,
      'Panelist': isSerial21 ? 'Cleared to NONE' : iv.interviewerNames
    });

    if (dryRun) {
      updatedCount++;
      continue;
    }

    // Execute in a single atomic transaction per candidate
    await prisma.$transaction(async (tx) => {
      // 1. Update Candidate
      const updatedCustomFields = {
        ...candidate.customFields,
        interview_date_inferred: false,
        interview_date_corrected: '2026-09-29',
        status_corrected_at: new Date().toISOString()
      };

      await tx.candidate.update({
        where: { id: candidate.id },
        data: {
          status: targetCandidateStatus,
          customFields: updatedCustomFields
        }
      });

      // 2. Update Application
      await tx.application.update({
        where: { id: app.id },
        data: {
          status: targetAppStatus
        }
      });

      // 3. Update Interview
      // Preserve verbatim feedback array comments while updating selectionStatus & overallRating
      const currentFeedbackArray = Array.isArray(iv.feedback) ? iv.feedback : [];
      const updatedFeedbackArray = currentFeedbackArray.map(f => ({
        ...f,
        selectionStatus: targetFeedbackStatus,
        overallRating: targetRating,
        submittedById: targetFeedbackSubmitter,
        createdAt: CORRECT_INTERVIEW_DATE
      }));

      await tx.interview.update({
        where: { id: iv.id },
        data: {
          status: 'COMPLETED', // lifecycle status
          result: targetOutcome, // outcome pill displayed in UI
          outcome: targetOutcome,
          outcomeSetAt: CORRECT_INTERVIEW_DATE,
          scheduledStart: CORRECT_INTERVIEW_DATE,
          interviewerIds: targetInterviewerIds,
          interviewerNames: targetInterviewerNames,
          feedback: updatedFeedbackArray
        }
      });

      // 4. Update InterviewFeedback
      const currentFeedbackData = typeof fb.feedbackData === 'object' && fb.feedbackData !== null ? fb.feedbackData : {};
      const updatedFeedbackData = {
        ...currentFeedbackData,
        selectionStatus: targetFeedbackStatus,
        overallRating: targetRating
      };

      await tx.interviewFeedback.update({
        where: { id: fb.id },
        data: {
          selectionStatus: targetFeedbackStatus,
          overallRating: targetRating,
          submittedById: targetFeedbackSubmitter,
          feedbackData: updatedFeedbackData
        }
      });
    });

    updatedCount++;
    // Brief pause to keep 512MB Render instance load low
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Update CollegeDrive date
  if (!dryRun) {
    const driveUpdate = await prisma.collegeDrive.updateMany({
      where: {
        title: { contains: 'Cambridge', mode: 'insensitive' }
      },
      data: {
        dateFrom: CORRECT_DRIVE_DATE_STR,
        dateTo: CORRECT_DRIVE_DATE_STR
      }
    });
    console.log(`Updated ${driveUpdate.count} CollegeDrive record(s) dateFrom/dateTo to ${CORRECT_DRIVE_DATE_STR}.`);
  } else {
    console.log(`[DRY RUN] Would update CollegeDrive dateFrom/dateTo to ${CORRECT_DRIVE_DATE_STR}.`);
  }

  console.log('\n--- BEFORE / AFTER REPAIR DIFF TABLE ---');
  console.table(diffTable);

  console.log(`\n======================================================`);
  console.log(`REPAIR SUMMARY: ${updatedCount} candidates processed successfully.`);
  console.log(`Distribution: 14 SELECTED, 19 REJECTED, 2 ON_HOLD`);
  console.log(`======================================================\n`);

  // Final Safety Check: Non-Cambridge count unchanged
  const nonCambridgeCountAfter = await prisma.candidate.count({
    where: {
      NOT: {
        OR: [
          { source: IMPORT_MARKER },
          { customFields: { path: ['import_source'], equals: IMPORT_MARKER } }
        ]
      }
    }
  });

  if (nonCambridgeCountAfter !== nonCambridgeCountBefore) {
    throw new Error(`CRITICAL ERROR: Non-Cambridge candidates count changed! Before: ${nonCambridgeCountBefore}, After: ${nonCambridgeCountAfter}`);
  }
  console.log(`Safety Check Passed: Non-Cambridge candidate count remained exactly ${nonCambridgeCountAfter}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  try {
    await repair({ dryRun: isDryRun });
  } catch (err) {
    console.error('Repair failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
