const XLSX = require('xlsx');
const fs = require('fs');
const prisma = require('../src/config/db');

const filePath = 'C:\\Users\\jishn\\Downloads\\round 2.xlsx';
const ORG_ID = 'defaultOrg';
const ADMIN_USER_ID = '73783a2b-0045-431c-9b71-75aeab0b6840';

// Manual name mapping to align with database spelling
const MANUAL_NAME_MAPPINGS = {
  'abhineet srivastava': 'Abhineet Shrivastav'
};

const JOB_MAPPINGS = {
  sme: 'ONBppBoG0e4bd0uhgL3n', // SME Intern
  hr: 'u6TuiYofk7loeuTdGWop',  // HR Intern
  ops: '8YJC6csbthsGsQQpWGqt', // Ops Intern
  default: 'ak4Y6kMrlo3tsLdPMy0h' // BDE
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

function resolveJobId(jobRole) {
  const role = String(jobRole || '').trim().toLowerCase();
  if (role.includes('sme')) return JOB_MAPPINGS.sme;
  if (role.includes('hr') || role.includes('learning')) return JOB_MAPPINGS.hr;
  if (role.includes('ops') || role.includes('operation')) return JOB_MAPPINGS.ops;
  return JOB_MAPPINGS.default;
}

function resolveMode(meetingMode) {
  const mode = String(meetingMode || '').trim().toLowerCase();
  if (mode.includes('online') || mode.includes('virtual')) return 'VIRTUAL';
  if (mode.includes('person') || mode.includes('in-person')) return 'IN_PERSON';
  if (mode.includes('phone')) return 'PHONE';
  return 'VIRTUAL';
}

function parseDate(val) {
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}

function matchInterviewer(rawName, dbUsers) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name || name === 'super admin') return null;

  // 1. Exact or substring match in DB
  let matched = dbUsers.find(u => {
    const uName = u.fullName.toLowerCase();
    return uName === name || uName.includes(name) || name.includes(uName);
  });
  if (matched) return matched.id;

  // 2. Typos & Spellings mapping
  if (name.includes('jagrithi') || name.includes('jagrthi') || name.includes('jagirithi') || name.includes('jagriti')) {
    if (name.includes('sarda')) {
      return 'XPf8glsE3KJOIbSPnhTw'; // Jagriti Sarda
    }
    return 'ACXdW05iuSlbNR1G1C8z'; // Jagrithi
  }
  if (name.includes('sreesha') || name.includes('shreesha')) {
    return 'hjIRMiXUAwCKouzK9zJ8'; // Shreesha
  }
  if (name.includes('swathi') || name.includes('swati')) {
    return 'cmr4fq4uu0008nb2t9iy3df5n'; // Swati Desai
  }
  if (name.includes('mahumati') || name.includes('madhumai') || name.includes('madhumati')) {
    return 'xcwSAYvjqcLlfgknxqSp'; // Madhumati
  }
  if (name.includes('kehav') || name.includes('keshav')) {
    return 'lu3MwrR0TIgD68AT5Ju4'; // Keshav
  }
  if (name.includes('godavri') || name.includes('godavari')) {
    return 'pdB3COd1M7rmQQhlgxvO'; // Godavari DK
  }
  if (name.includes('abhnitha') || name.includes('abhinita') || name.includes('abhintha') || name.includes('abhinitha')) {
    return 'TOES1cIUcdAarE9NvWkt'; // Abhinita
  }
  if (name.includes('ananth') || name.includes('ananath')) {
    return 'XwJ3ravlMaZteWtm5xG7'; // Ananth Charan
  }
  if (name.includes('suhas')) {
    return 'cmr3fjxu10008li2rnwo9il5k'; // Suhas Krishna
  }
  if (name.includes('yuvan')) {
    return 're56ljEGsGX6xyVRsB9N'; // YUVAN MELWIN MJ
  }
  if (name.includes('ambika')) {
    return 'cmr4icmif000sqt2srj9fzweq'; // Ambika Hegde
  }
  if (name.includes('pavan')) {
    return 'CXr6ovApgCBnhlubdp1W'; // Pavan Admin
  }
  if (name.includes('ujwal')) {
    return 'rtkG387NSA3tNEEOMuOY'; // Ujwal
  }
  if (name.includes('vinay')) {
    return 'cYEZblWdN7gubrQvLgYj'; // Vinay Shetty
  }
  if (name.includes('sanchi')) {
    return 'uBjeprsho1onUAwgpL6E'; // Sanchi Petkar
  }

  return null;
}

async function runScheduling() {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Excel file not found at ${filePath}`);
    process.exit(1);
  }

  const dbCandidates = await prisma.candidate.findMany({
    where: { organizationId: ORG_ID, isDeleted: false }
  });
  const dbUsers = await prisma.user.findMany({
    where: { organizationId: ORG_ID, isDeleted: false }
  });
  const dbJobs = await prisma.job.findMany({
    where: { organizationId: ORG_ID }
  });

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets['round 2'];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const invalidCandidates = [];
  let totalProcessed = 0;
  let totalScheduled = 0;
  let totalSkippedDuplicates = 0;

  console.log(`=== Scheduling Round 2 Interviews (${rows.length} rows) ===`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    totalProcessed++;

    const name = String(row['Candidate Name'] || '').trim();
    const email = String(row['Candidate Email'] || '').trim().toLowerCase();
    const phoneRaw = String(row['Candidate Phone'] || '').trim();
    const phone = phoneRaw.replace(/\D/g, "");
    const jobRole = String(row['Job Role'] || '').trim();
    const modeStr = String(row['Meeting Mode'] || '').trim();
    const interviewerNamesStr = String(row['Interviewers'] || '').trim();
    const startDateVal = row['Start Date & Time'];
    const meetingLink = String(row['Meeting Link'] || '').trim();
    const zohoLink = String(row['Zoho Link'] || '').trim();

    if (!name) {
      console.log(`[Row ${rowNum}] Skipped: Missing Candidate Name.`);
      invalidCandidates.push({ rowNum, name: 'Unknown', reason: 'Missing Candidate Name' });
      continue;
    }

    // 1. Find Candidate in DB
    const candidate = findCandidate(name, dbCandidates);
    if (!candidate) {
      console.log(`[Row ${rowNum}] Skipped: Candidate "${name}" not found in DB.`);
      invalidCandidates.push({ rowNum, name, reason: 'Candidate not found in database' });
      continue;
    }

    // 2. Resolve Job
    const jobId = resolveJobId(jobRole);
    const job = dbJobs.find(j => j.id === jobId);
    const jobTitle = job ? job.title : jobRole;

    // 3. Find Application
    const app = await prisma.application.findUnique({
      where: {
        candidateId_jobId: {
          candidateId: candidate.id,
          jobId: jobId
        }
      }
    });

    if (!app) {
      console.log(`[Row ${rowNum}] Skipped: Application not found for "${candidate.fullName}" (Job: "${jobTitle}").`);
      invalidCandidates.push({ rowNum, name: candidate.fullName, reason: 'Application record not found' });
      continue;
    }

    // 4. Check Duplicate Round 2
    const existingInterview = await prisma.interview.findFirst({
      where: {
        applicationId: app.id,
        roundNo: 2,
        status: { not: 'CANCELLED' }
      }
    });

    if (existingInterview) {
      console.log(`[Row ${rowNum}] Skipped: Round 2 interview already exists for "${candidate.fullName}".`);
      totalSkippedDuplicates++;
      continue;
    }

    // 5. Check for Round 1 Interview
    const round1Interview = await prisma.interview.findFirst({
      where: {
        candidateId: candidate.id,
        roundNo: 1,
        status: { not: 'CANCELLED' }
      }
    });

    if (!round1Interview) {
      console.log(`[Row ${rowNum}] Skipped: No Round 1 interview found for "${candidate.fullName}".`);
      invalidCandidates.push({ rowNum, name: candidate.fullName, reason: 'Round 1 interview not found in database' });
      continue;
    }

    // 6. Resolve Interviewers
    const interviewerIds = [];
    const interviewerNamesArray = interviewerNamesStr.split(/,|\/|&|-|\bwith\b|\band\b/i).map(s => s.trim()).filter(Boolean);
    
    interviewerNamesArray.forEach(intName => {
      const matchedId = matchInterviewer(intName, dbUsers);
      if (matchedId) {
        interviewerIds.push(matchedId);
      }
    });

    if (interviewerIds.length === 0) {
      interviewerIds.push(ADMIN_USER_ID);
    }

    // 7. Schedule Interview
    try {
      const scheduledStart = parseDate(startDateVal);
      await prisma.interview.create({
        data: {
          application: { connect: { id: app.id } },
          candidateId: candidate.id,
          candidateName: candidate.fullName,
          jobId,
          jobTitle,
          roundNo: 2,
          round: 'Round 2',
          scheduledStart,
          durationMinutes: 60,
          mode: resolveMode(modeStr),
          meetingLink,
          zohoLink,
          status: 'SCHEDULED',
          interviewerIds,
          interviewerNames: interviewerNamesStr || 'Super Admin',
          organizationId: ORG_ID,
          createdById: ADMIN_USER_ID
        }
      });

      totalScheduled++;
      console.log(`[Row ${rowNum}] Successfully scheduled Round 2 for "${candidate.fullName}" on ${scheduledStart.toISOString()}`);
    } catch (err) {
      console.error(`[Row ${rowNum}] Failed to schedule Round 2 for "${candidate.fullName}":`, err.message);
      invalidCandidates.push({ rowNum, name: candidate.fullName, reason: `DB Error: ${err.message}` });
    }
  }

  // Write invalid candidates report
  let reportText = `=== Round 2 Invalid/Skipped Candidates Report ===\nGenerated At: ${new Date().toISOString()}\n\n`;
  reportText += `Total Skipped/Invalid Rows: ${invalidCandidates.length}\n\n`;
  invalidCandidates.forEach(c => {
    reportText += `Row ${c.rowNum} | Candidate: "${c.name}" | Reason: ${c.reason}\n`;
  });

  fs.writeFileSync('scratch/round2_invalid_report.txt', reportText);

  console.log(`\n=== Round 2 Scheduling Summary ===`);
  console.log(`Total Rows Processed: ${totalProcessed}`);
  console.log(`Successfully Scheduled: ${totalScheduled}`);
  console.log(`Skipped Duplicates: ${totalSkippedDuplicates}`);
  console.log(`Skipped Invalid: ${invalidCandidates.length} (Saved to scratch/round2_invalid_report.txt)`);
}

runScheduling()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
