'use strict';
/**
 * inject_bgs_college_round2.js
 *
 * Safe, idempotent, transaction-wrapped script to inject Round 2 outcomes
 * for BGS College drive into ATS:
 * - Attaches Round 2 to existing BGS College Round 1 candidates
 * - Preserves existing Round 1 interviews, ratings, comments, panelists untouched
 * - Records Round 2 Interview & InterviewFeedback with outcome = 'SELECTED'
 * - Rating: NULL (never 0), Comments: NULL/empty
 * - DOJ preserved as text ('1st October', '5th October', 'Immediate')
 * - Suppresses all side-effects: no emails/SMS, no QC queue triggers, no user creation
 * - Implements Part 10 guards (round-attachment guard, interview-date guard, reconciliation assertions, count assertions)
 * - Supports --dry-run and --rollback
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

const IMPORT_SOURCE_TAG = 'BGS_COLLEGE_FINAL_R2_IMPORT';

// ─────────────────────────────────────────────
// CONFIGURATION & INPUTS (Part 1)
// ─────────────────────────────────────────────
// Note: R2_INTERVIEW_DATE must be configured explicitly before live execution.
// Default interview date if provided or placeholder check:
const CONFIG = {
  R2_INTERVIEW_DATE: process.env.R2_INTERVIEW_DATE || null, // e.g., '2026-10-01'
  R2_INTERVIEW_TIME: process.env.R2_INTERVIEW_TIME || '15:30', // IST default
  FILE_PATH: process.env.BGS_R2_FILE || path.join('C:', 'Users', 'ASUS', 'Downloads', 'BGS College_Final.xlsx'),
  ALLOW_CORRECT_NAMES: true, // Auto-correct minor typos like "chai l jain" -> "Chavi L Jain"
  DRY_RUN: process.argv.includes('--dry-run'),
  ROLLBACK: process.argv.includes('--rollback'),
  INCLUDE_RACHANA: process.argv.includes('--include-rachana'), // default false
};

const KNOWN_NAME_ALIASES = {
  'nisarga b': 'nisarga',
  'chavi l jain': 'chai l jain',
  'theertha varshini': 'theertha varshini d'
};

const NAME_CORRECTIONS = {
  'chai l jain': 'Chavi L Jain',
  'nisarga': 'Nisarga B',
  'theertha varshini d': 'Theertha Varshini'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PART 10 GUARDS
// ─────────────────────────────────────────────

function validateDateInputs(dateStr, timeStr) {
  if (!dateStr || dateStr.includes('<FILL IN') || dateStr === 'PLACEHOLDER') {
    return { valid: false, reason: 'R2_INTERVIEW_DATE is not provided or is a placeholder.' };
  }
  const parsed = new Date(`${dateStr}T${timeStr || '15:30'}:00+05:30`);
  if (isNaN(parsed.getTime())) {
    return { valid: false, reason: `Invalid date/time format: ${dateStr} ${timeStr}` };
  }
  return { valid: true, date: parsed };
}

function assertNeverUseDOJAsInterviewDate(rawRow, targetField) {
  const dojValue = rawRow['Date of Joining'] || rawRow['doj'] || rawRow['DOJ'];
  if (targetField === dojValue) {
    throw new Error(`[GUARD 10.2 VIOLATION] Interview date was derived from Date of Joining column ("${dojValue}"). Import aborted.`);
  }
}

// ─────────────────────────────────────────────
// MAIN IMPORT / DRY-RUN RUNNER
// ─────────────────────────────────────────────

async function main() {
  console.log('================================================================');
  console.log(' ATS BGS COLLEGE ROUND 2 IMPORT SCRIPT');
  console.log(' Mode:', CONFIG.ROLLBACK ? 'ROLLBACK' : CONFIG.DRY_RUN ? 'DRY-RUN (NO WRITES)' : 'LIVE EXECUTION');
  console.log('================================================================\n');

  // 1. Rollback Mode
  if (CONFIG.ROLLBACK) {
    console.log('Initiating Rollback for source:', IMPORT_SOURCE_TAG);
    const deletedFeedbacks = await prisma.interviewFeedback.deleteMany({
      where: {
        feedbackData: {
          path: ['importSource'],
          equals: IMPORT_SOURCE_TAG
        }
      }
    });
    console.log(`Deleted ${deletedFeedbacks.count} Round 2 InterviewFeedback records.`);

    const deletedInterviews = await prisma.interview.deleteMany({
      where: {
        notes: {
          contains: IMPORT_SOURCE_TAG
        }
      }
    });
    console.log(`Deleted ${deletedInterviews.count} Round 2 Interview records.`);
    console.log('Rollback complete.');
    return;
  }

  // 2. Read Source File
  console.log(`Reading source file: ${CONFIG.FILE_PATH}`);
  const wb = xlsx.readFile(CONFIG.FILE_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Loaded ${rawRows.length} rows from sheet "${wb.SheetNames[0]}".\n`);

  if (rawRows.length !== 12) {
    console.warn(`[WARNING] Expected exactly 12 rows, found ${rawRows.length}.`);
  }

  // 3. Check live database state for BGS Round 1
  const bgsCollege = await prisma.college.findFirst({
    where: { name: { contains: 'BGS', mode: 'insensitive' } }
  });
  if (!bgsCollege) {
    throw new Error('[FATAL] BGS College record not found in database. Aborting.');
  }

  const bgsDrive = await prisma.collegeDrive.findFirst({
    where: { collegeId: bgsCollege.id, isDeleted: false }
  });
  if (!bgsDrive) {
    throw new Error('[FATAL] BGS College Drive record not found in database. Aborting.');
  }

  const bgsCandidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { college: { contains: 'BGS', mode: 'insensitive' } },
        { source: 'BGS_COLLEGE_DRIVE_IMPORT' }
      ],
      isDeleted: false
    },
    include: {
      applications: {
        include: {
          interviews: true
        }
      },
      interviewFeedbacks: true
    }
  });

  const initialCandidateCount = bgsCandidates.length;
  console.log(`Live DB BGS Candidates count: ${initialCandidateCount} (Drive ID: ${bgsDrive.id})`);

  if (initialCandidateCount === 0) {
    throw new Error('[BRANCH B] BGS Round 1 was never injected. Stop. Do not inject Round 2 without Round 1.');
  }

  // 4. Resolve interviewers from DB
  const subramanyaUser = await prisma.user.findFirst({
    where: { fullName: { contains: 'Subramanya', mode: 'insensitive' }, isActive: true }
  });
  const ananthUser = await prisma.user.findFirst({
    where: { fullName: { contains: 'Ananth Charan', mode: 'insensitive' }, isActive: true }
  }) || await prisma.user.findFirst({
    where: { fullName: { contains: 'Ananth', mode: 'insensitive' } }
  });

  console.log('Interviewer mappings:');
  console.log(`  - Subramanya -> User ID: ${subramanyaUser ? subramanyaUser.id : 'NONE (Store as text)'}`);
  console.log(`  - Ananth     -> User ID: ${ananthUser ? ananthUser.id : 'NONE (Store as text)'}`);
  console.log(`  - Jeevan     -> User ID: NONE (No account in DB, store as text "Jeevan" without account creation)\n`);

  // 5. Reconciliation & Matching per row
  console.log('=== ROW MATCHING & RECONCILIATION PREVIEW ===');
  const matchedPlan = [];
  let exactMatchCount = 0;
  let fuzzyMatchCount = 0;
  let noMatchCount = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rawName = String(row['Name of the candidate'] || row.Name || Object.values(row)[0]).trim();
    const role = String(row['Role'] || '').trim();
    const interviewer = String(row['Interviewer'] || '').trim();
    const result = String(row['Result'] || '').trim().toUpperCase();
    const doj = String(row['Date of Joining'] || '').trim();

    // Guard: Check DOJ column
    assertNeverUseDOJAsInterviewDate(row, CONFIG.R2_INTERVIEW_DATE);

    // Matching logic
    const norm = rawName.toLowerCase().replace(/\s+/g, ' ');
    let matchedCand = bgsCandidates.find(c => c.fullName.trim().toLowerCase().replace(/\s+/g, ' ') === norm);
    let matchType = 'EXACT';

    if (!matchedCand) {
      const aliasTarget = KNOWN_NAME_ALIASES[norm];
      if (aliasTarget) {
        matchedCand = bgsCandidates.find(c => c.fullName.trim().toLowerCase().replace(/\s+/g, ' ') === aliasTarget);
        if (matchedCand) matchType = 'FUZZY (KNOWN ALIAS)';
      }
    }

    if (matchedCand) {
      if (matchType === 'EXACT') exactMatchCount++;
      else fuzzyMatchCount++;

      // Verify Round 1 state
      const r1Fb = matchedCand.interviewFeedbacks.find(f => f.round === 'ROUND_1');
      const r1Int = (matchedCand.applications[0]?.interviews || []).find(intv => intv.roundNo === 1 || intv.round === 'Round 1');
      const r2ExistingInt = (matchedCand.applications[0]?.interviews || []).find(intv => intv.roundNo === 2 || intv.round === 'Round 2');
      const r2ExistingFb = matchedCand.interviewFeedbacks.find(f => f.round === 'ROUND_2');

      matchedPlan.push({
        rowIndex: i + 1,
        sourceName: rawName,
        matchType,
        matchedCandidateId: matchedCand.id,
        matchedCandidateName: matchedCand.fullName,
        candidateRole: matchedCand.preferredRole,
        sheetRole: role,
        interviewer,
        result,
        doj,
        r1Outcome: r1Int?.outcome || r1Fb?.selectionStatus || 'N/A',
        r1Rating: r1Fb?.overallRating ?? 'N/A',
        r1Panelist: r1Int?.interviewerNames || 'N/A',
        r2Exists: !!(r2ExistingInt || r2ExistingFb),
        appId: matchedCand.applications[0]?.id
      });
    } else {
      noMatchCount++;
      matchedPlan.push({
        rowIndex: i + 1,
        sourceName: rawName,
        matchType: 'NO MATCH',
        matchedCandidateId: null,
        sheetRole: role,
        interviewer,
        result,
        doj,
        action: 'FLAGGED / SKIP (Default: create nothing for Rachana S)'
      });
    }
  }

  console.table(matchedPlan.map(p => ({
    Row: p.rowIndex,
    'Sheet Name': p.sourceName,
    'Match Type': p.matchType,
    'Matched Candidate': p.matchedCandidateName || 'NONE',
    'Candidate ID': p.matchedCandidateId || 'N/A',
    'R1 Status': p.r1Outcome || 'N/A',
    'R1 Rating': p.r1Rating ?? 'N/A',
    'R2 Interviewer': p.interviewer,
    'R2 Outcome': p.result,
    'R2 DOJ': p.doj,
    'R2 Exists?': p.r2Exists ? 'YES' : 'NO'
  })));

  console.log(`\nMatch Summary: Exact=${exactMatchCount}, Fuzzy=${fuzzyMatchCount}, No Match=${noMatchCount} (Total=${rawRows.length})`);

  // If dry run, print summary and return
  if (CONFIG.DRY_RUN) {
    console.log('\n[DRY-RUN] Verification of proposed operations complete. No records modified.');
    return;
  }

  // Guard 10.2: Validate interview date for live execution
  const dateCheck = validateDateInputs(CONFIG.R2_INTERVIEW_DATE, CONFIG.R2_INTERVIEW_TIME);
  if (!dateCheck.valid) {
    console.error(`\n[GUARD 10.2 TRIGGERED] Cannot proceed with live write: ${dateCheck.reason}`);
    console.error('Please pass R2_INTERVIEW_DATE=YYYY-MM-DD to execute live writes.');
    return;
  }

  const scheduledStartDate = dateCheck.date;
  console.log(`\nProceeding with live injection at scheduledStart = ${scheduledStartDate.toISOString()} (IST: ${scheduledStartDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const item of matchedPlan) {
    if (item.matchType === 'NO MATCH') {
      console.log(`[SKIP ROW ${item.rowIndex}] "${item.sourceName}" — No match in Round 1 list. Held per specification.`);
      skippedCount++;
      continue;
    }

    if (item.r2Exists) {
      console.log(`[IDEMPOTENT SKIP ROW ${item.rowIndex}] Candidate "${item.matchedCandidateName}" already has Round 2.`);
      skippedCount++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Resolve panelist user if matched
        let panelistId = null;
        if (item.interviewer.toLowerCase().includes('subramanya') && subramanyaUser) {
          panelistId = subramanyaUser.id;
        } else if (item.interviewer.toLowerCase().includes('ananth') && ananthUser) {
          panelistId = ananthUser.id;
        }

        // 2. Optional: name correction on candidate if typo
        if (CONFIG.ALLOW_CORRECT_NAMES) {
          const normName = item.matchedCandidateName.toLowerCase().trim();
          const corrected = NAME_CORRECTIONS[normName];
          if (corrected && corrected !== item.matchedCandidateName) {
            console.log(`[NAME CORRECTION] Updating candidate ${item.matchedCandidateId} name: "${item.matchedCandidateName}" -> "${corrected}"`);
            await tx.candidate.update({
              where: { id: item.matchedCandidateId },
              data: { fullName: corrected }
            });
          }
        }

        // 3. Create Round 2 Interview
        const notesObj = {
          importSource: IMPORT_SOURCE_TAG,
          rawInterviewer: item.interviewer,
          rawDOJ: item.doj,
          rawResult: item.result,
          importedAt: new Date().toISOString()
        };

        const interview = await tx.interview.create({
          data: {
            candidateId: item.matchedCandidateId,
            candidateName: item.matchedCandidateName,
            applicationId: item.appId,
            jobTitle: item.candidateRole,
            roundNo: 2,
            round: 'Round 2',
            scheduledStart: scheduledStartDate,
            durationMinutes: 60,
            mode: 'DRIVE',
            status: 'COMPLETED',
            result: item.result,
            outcome: item.result,
            outcomeSetAt: scheduledStartDate,
            createdById: panelistId || '73783a2b-0045-431c-9b71-75aeab0b6840',
            interviewerIds: panelistId ? [panelistId] : [],
            interviewerNames: item.interviewer,
            notes: JSON.stringify(notesObj)
          }
        });

        // 4. Create Round 2 InterviewFeedback
        const feedbackData = {
          name: item.matchedCandidateName,
          roundNumber: 'Round 2',
          panelists: item.interviewer,
          role: item.candidateRole,
          college: 'BGS College',
          overallRating: null,
          doj: item.doj,
          selectionStatus: item.result,
          comments: null,
          importSource: IMPORT_SOURCE_TAG
        };

        await tx.interviewFeedback.create({
          data: {
            candidateId: item.matchedCandidateId,
            round: 'ROUND_2',
            submittedById: panelistId,
            templateVersion: 1,
            feedbackData: feedbackData,
            selectionStatus: item.result,
            overallRating: null, // Guard 4.3: NULL, never 0
            pendingLink: false
          }
        });

        // 5. Update candidate's doj field if specified in sheet
        if (item.doj) {
          await tx.candidate.update({
            where: { id: item.matchedCandidateId },
            data: { doj: item.doj }
          });
        }
      });

      console.log(`[SUCCESS ROW ${item.rowIndex}] Created Round 2 for "${item.matchedCandidateName}" (${item.matchedCandidateId})`);
      createdCount++;
    } catch (err) {
      console.error(`[ERROR ROW ${item.rowIndex}] Failed to inject Round 2 for "${item.matchedCandidateName}":`, err.message);
      errorCount++;
    }

    // Gentle sleep to respect 512MB Render instance
    await sleep(200);
  }

  console.log('\n================================================================');
  console.log(' EXECUTION SUMMARY');
  console.log(` Created: ${createdCount} | Skipped: ${skippedCount} | Updated: ${updatedCount} | Errors: ${errorCount} | Total: ${createdCount + skippedCount + updatedCount + errorCount}`);
  console.log('================================================================\n');

  // Guard 10.4: Candidate Count Assertion
  const finalCandidateCount = await prisma.candidate.count({
    where: {
      OR: [
        { college: { contains: 'BGS', mode: 'insensitive' } },
        { source: 'BGS_COLLEGE_DRIVE_IMPORT' }
      ],
      isDeleted: false
    }
  });
  console.log(`[GUARD 10.4 CHECK] Candidate count before: ${initialCandidateCount} | Candidate count after: ${finalCandidateCount}`);
  if (finalCandidateCount !== initialCandidateCount) {
    console.error(`[GUARD 10.4 FAILED] Candidate count changed from ${initialCandidateCount} to ${finalCandidateCount}! Duplicates were created!`);
  } else {
    console.log('✅ Candidate count is invariant (no duplicate candidates created).');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
