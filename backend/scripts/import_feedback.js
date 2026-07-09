const XLSX = require('xlsx');
const fs = require('fs');
const prisma = require('../src/config/db');

const filePath = 'C:\\Users\\jishn\\Downloads\\Round1_Round2_Feedback_Form.xlsx';
const ORG_ID = 'defaultOrg';
const ADMIN_USER_ID = '73783a2b-0045-431c-9b71-75aeab0b6840';

// Manual spelling/typo overrides for candidate names
const MANUAL_NAME_MAPPINGS = {
  'abhineet srivastava': 'Abhineet Shrivastav'
};

function findCandidate(sheetName, dbCandidates) {
  let normName = String(sheetName || '').trim().toLowerCase();
  if (!normName) return null;

  if (MANUAL_NAME_MAPPINGS[normName]) {
    normName = MANUAL_NAME_MAPPINGS[normName].toLowerCase();
  }
  
  // 1. Exact match
  let matched = dbCandidates.find(c => c.fullName.toLowerCase() === normName);
  if (matched) return matched;

  // 2. Exact match ignoring spaces
  const cleanSheetName = normName.replace(/\s+/g, '');
  matched = dbCandidates.find(c => c.fullName.toLowerCase().replace(/\s+/g, '') === cleanSheetName);
  if (matched) return matched;

  // 3. Exact match replacing w with v
  const vSheetName = cleanSheetName.replace(/w/g, 'v');
  matched = dbCandidates.find(c => c.fullName.toLowerCase().replace(/\s+/g, '').replace(/w/g, 'v') === vSheetName);
  if (matched) return matched;

  // 4. StartsWith / Includes match
  matched = dbCandidates.find(c => {
    const dbNorm = c.fullName.toLowerCase();
    return dbNorm.startsWith(normName) || normName.startsWith(dbNorm) || dbNorm.includes(normName) || normName.includes(dbNorm);
  });
  if (matched) return matched;

  // 5. Fuzzy sub-parts
  const parts = normName.split(/\s+/).filter(p => p.length > 2);
  if (parts.length > 0) {
    matched = dbCandidates.find(c => {
      const dbNorm = c.fullName.toLowerCase();
      return parts.every(p => dbNorm.includes(p));
    });
    if (matched) return matched;
  }

  return null;
}

function normalizeRecommendation(rec) {
  const r = String(rec || '').trim().toLowerCase();
  if (r.includes('select')) return 'SELECTED';
  if (r.includes('reject')) return 'REJECTED';
  if (r.includes('hold')) return 'HOLD';
  if (r.includes('join') || r.includes('no show')) return 'DID_NOT_JOIN';
  if (r.includes('reschedule')) return 'PENDING'; // kept as pending/scheduled to allow reschedule
  return 'PENDING';
}

async function runImport() {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Excel file not found at ${filePath}`);
    process.exit(1);
  }

  // Fetch all candidates once for mapping
  const dbCandidates = await prisma.candidate.findMany({
    where: { organizationId: ORG_ID, isDeleted: false }
  });

  const workbook = XLSX.readFile(filePath);

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const roundNo = sheetName.includes('Round 2') ? 2 : 1;
    console.log(`\n=== Processing Sheet: "${sheetName}" (Round ${roundNo}) ===`);

    for (let i = 0; i < rows.length; i += 16) {
      const candidateName = String(rows[i] ? rows[i][4] : '').trim();
      if (!candidateName || candidateName === 'Candidate Name') continue;
      totalProcessed++;

      // 1. Find Candidate
      const candidate = findCandidate(candidateName, dbCandidates);
      if (!candidate) {
        console.error(`[Row ${i + 1}] Error: Candidate "${candidateName}" not found in DB.`);
        totalErrors++;
        continue;
      }

      // 2. Extract Recommendation and Overall Summary
      const rawRec = rows[i + 6] ? String(rows[i + 6][4]).trim() : '';
      const summary = rows[i + 11] ? String(rows[i + 11][4]).trim() : '';

      // 3. Find Interview Record
      const interview = await prisma.interview.findFirst({
        where: {
          candidateId: candidate.id,
          roundNo,
          status: { not: 'CANCELLED' }
        }
      });

      if (!interview) {
        console.warn(`[Row ${i + 1}] Warning: No scheduled Round ${roundNo} interview found for "${candidate.fullName}".`);
        totalErrors++;
        continue;
      }

      // 4. Construct Feedback JSON
      const feedbackEntry = {
        id: `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        submittedBy: ADMIN_USER_ID,
        submittedAt: new Date().toISOString(),
        ratings: {
          technical: 0,
          communication: 0,
          culture: 0
        },
        recommendation: rawRec || 'PENDING',
        strengths: "",
        concerns: "",
        notes: summary || ""
      };

      const normRec = normalizeRecommendation(rawRec);
      const isReschedule = normRec === 'PENDING' && rawRec.toLowerCase().includes('reschedule');

      // 5. Update Database Record
      try {
        await prisma.interview.update({
          where: { id: interview.id },
          data: {
            status: isReschedule ? 'SCHEDULED' : 'COMPLETED',
            result: normRec,
            outcome: normRec,
            outcomeSetAt: new Date(),
            feedback: [feedbackEntry],
            updatedAt: new Date()
          }
        });
        totalUpdated++;
        console.log(`[Row ${i + 1}] Updated Round ${roundNo} feedback for "${candidate.fullName}" (Outcome: ${normRec})`);
      } catch (err) {
        console.error(`[Row ${i + 1}] Failed to update interview for "${candidate.fullName}":`, err.message);
        totalErrors++;
      }
    }
  }

  console.log(`\n=== Feedback Import Summary ===`);
  console.log(`Total Forms Evaluated: ${totalProcessed}`);
  console.log(`Successfully Updated: ${totalUpdated}`);
  console.log(`Errors/Validation Skips: ${totalErrors}`);
}

runImport()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
