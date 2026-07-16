const XLSX = require('xlsx');
const fs = require('fs');
const prisma = require('../src/config/db');

const filePath = 'C:\\Users\\jishn\\Downloads\\Candidates_Round1_Round2.xlsx';
const ORG_ID = 'defaultOrg';
const ADMIN_USER_ID = '73783a2b-0045-431c-9b71-75aeab0b6840';

// Main job mappings
const JOB_MAPPINGS = {
  sme: 'ONBppBoG0e4bd0uhgL3n', // SME Intern
  hr: 'u6TuiYofk7loeuTdGWop',  // HR Intern
  ops: '8YJC6csbthsGsQQpWGqt', // Ops Intern
  default: 'ak4Y6kMrlo3tsLdPMy0h' // BDE
};

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
  if (!val) return new Date();
  
  const dateStr = String(val);
  let parsedDate = null;
  const match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    let hours = 0;
    let minutes = 0;
    if (match[4]) {
      hours = parseInt(match[4], 10);
      minutes = parseInt(match[5], 10);
      const ampm = match[6];
      if (ampm) {
        if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
      }
    }
    parsedDate = new Date(year, month, day, hours, minutes);
  }
  
  if (parsedDate && !isNaN(parsedDate.getTime())) {
    return parsedDate;
  }
  
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

  // Fetch all active users and jobs once for reference
  const dbUsers = await prisma.user.findMany({
    where: { organizationId: ORG_ID, isDeleted: false }
  });
  const dbJobs = await prisma.job.findMany({
    where: { organizationId: ORG_ID }
  });

  const workbook = XLSX.readFile(filePath, { cellDates: true });

  let totalProcessed = 0;
  let totalScheduled = 0;
  let totalSkippedDuplicates = 0;
  let totalErrors = 0;
  let appsCreatedCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    console.log(`\n=== Processing Sheet: "${sheetName}" (${rows.length} rows) ===`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      totalProcessed++;

      const name = String(row['Candidate Name'] || '').trim();
      const email = String(row['Candidate Email'] || '').trim().toLowerCase();
      const phoneRaw = String(row['Candidate Phone'] || '').trim();
      const phone = phoneRaw.replace(/\D/g, "");
      const jobRole = String(row['Job Role'] || '').trim();
      const roundStr = String(row['Interview Round'] || '').trim();
      const modeStr = String(row['Meeting Mode'] || '').trim();
      const interviewerNamesStr = String(row['Interviewers'] || '').trim();
      const startDateVal = row['Start Date & Time'];
      const meetingLink = String(row['Meeting Link'] || '').trim();
      const zohoLink = String(row['Zoho Link'] || '').trim();

      if (!name || (!phone && !email)) {
        console.log(`[Row ${rowNum}] Skipping: Missing Candidate Name, Phone, or Email.`);
        totalErrors++;
        continue;
      }

      // 1. Find Candidate in DB
      const candidate = await prisma.candidate.findFirst({
        where: {
          OR: [
            { phone: phone || undefined },
            { email: email || undefined }
          ],
          organizationId: ORG_ID,
          isDeleted: false
        }
      });

      if (!candidate) {
        console.log(`[Row ${rowNum}] Skipped: Candidate "${name}" not found in database.`);
        totalErrors++;
        continue;
      }

      // 2. Resolve Job
      const jobId = resolveJobId(jobRole);
      const job = dbJobs.find(j => j.id === jobId);
      const jobTitle = job ? job.title : jobRole;

      // 3. Find or Create Application
      let app = await prisma.application.findUnique({
        where: {
          candidateId_jobId: {
            candidateId: candidate.id,
            jobId: jobId
          }
        }
      });

      if (!app) {
        try {
          app = await prisma.application.create({
            data: {
              candidateId: candidate.id,
              jobId: jobId,
              status: 'IN_PIPELINE',
              organizationId: ORG_ID,
              isDeleted: false
            }
          });
          appsCreatedCount++;
          console.log(`[Row ${rowNum}] Created missing application for "${name}" (Job: "${jobTitle}").`);
        } catch (appErr) {
          console.error(`[Row ${rowNum}] Failed to create application:`, appErr.message);
          totalErrors++;
          continue;
        }
      }

      // 4. Resolve Interviewers
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

      // 5. Check Duplicate Round Interview
      const roundNo = roundStr === 'Round 2' ? 2 : 1;
      const existingInterview = await prisma.interview.findFirst({
        where: {
          applicationId: app.id,
          roundNo,
          status: { not: 'CANCELLED' }
        }
      });

      if (existingInterview) {
        console.log(`[Row ${rowNum}] Skipped: Interview for Round ${roundNo} already exists for "${name}".`);
        totalSkippedDuplicates++;
        continue;
      }

      // 6. Schedule Interview
      try {
        const scheduledStart = parseDate(startDateVal);
        await prisma.interview.create({
          data: {
            application: { connect: { id: app.id } },
            candidateId: candidate.id,
            candidateName: candidate.fullName,
            jobId,
            jobTitle,
            roundNo,
            round: roundStr || `Round ${roundNo}`,
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
        console.log(`[Row ${rowNum}] Successfully scheduled Round ${roundNo} for "${name}" on ${scheduledStart.toISOString()}`);
      } catch (intErr) {
        console.error(`[Row ${rowNum}] Failed to schedule interview:`, intErr.message);
        totalErrors++;
      }
    }
  }

  console.log(`\n=== Scheduling Summary ===`);
  console.log(`Total Rows Evaluated: ${totalProcessed}`);
  console.log(`Applications Created: ${appsCreatedCount}`);
  console.log(`Successfully Scheduled: ${totalScheduled}`);
  console.log(`Skipped Duplicates: ${totalSkippedDuplicates}`);
  console.log(`Errors/Validation Skips: ${totalErrors}`);
}

runScheduling()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
