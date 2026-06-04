const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { db } = require("../src/config/firebase");

// Check flags
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const liveMode = args.includes("--live");

if (!dryRun && !liveMode) {
  console.error("Error: Please specify either --dry-run or --live");
  console.log("Usage:");
  console.log("  node scripts/process_interviews.js --dry-run");
  console.log("  node scripts/process_interviews.js --live");
  process.exit(1);
}

console.log(`Starting interview processor in ${dryRun ? "DRY-RUN" : "LIVE"} mode...\n`);

async function run() {
  // 1. Fetch system users
  console.log("Fetching users from Firestore...");
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().fullName,
    role: doc.data().role
  }));
  console.log(`Loaded ${users.length} users.`);

  // 2. Fetch jobs
  console.log("Fetching jobs from Firestore...");
  const jobsSnap = await db.collection("jobs").get();
  const jobs = jobsSnap.docs.map(doc => ({
    id: doc.id,
    title: doc.data().title
  }));
  console.log(`Loaded ${jobs.length} jobs.`);

  // 3. Fetch candidates (to build in-memory map for fast deduplication & lookup)
  console.log("Fetching candidates from Firestore for in-memory lookup...");
  const candidatesSnap = await db.collection("candidates").get();
  const candidates = candidatesSnap.docs.map(doc => ({
    id: doc.id,
    fullName: doc.data().fullName,
    phone: doc.data().phone,
    email: doc.data().email
  }));
  console.log(`Loaded ${candidates.length} candidates.\n`);

  // Helper function to match candidate
  function findCandidate(row) {
    const excelName = String(row["Candidate Name"] || "").trim().toLowerCase();
    const excelEmail = String(row["Candidate Email"] || "").trim().toLowerCase();
    const excelPhone = String(row["Candidate Phone"] || "").replace(/\D/g, "");

    // Prioritize phone lookup (last 10 digits to bypass any +91 or country code variance)
    if (excelPhone.length >= 10) {
      const match = candidates.find(c => {
        const dbPhoneClean = String(c.phone || "").replace(/\D/g, "");
        return dbPhoneClean.slice(-10) === excelPhone.slice(-10);
      });
      if (match) return match;
    }

    // Secondary lookup by email
    if (excelEmail && excelEmail !== "n/a") {
      const match = candidates.find(c => String(c.email || "").toLowerCase().trim() === excelEmail);
      if (match) return match;
    }

    // Tertiary lookup by name
    if (excelName) {
      const match = candidates.find(c => String(c.fullName || "").toLowerCase().trim() === excelName);
      if (match) return match;
    }

    return null;
  }

  // Helper function to match job role
  function findJob(excelRole) {
    const cleanRole = String(excelRole || "").toLowerCase().trim();
    if (!cleanRole) return jobs[0] || { id: "N/A", title: "General" };

    // Direct match
    let matched = jobs.find(j => j.title.toLowerCase().trim() === cleanRole);
    if (matched) return matched;

    // Contains match
    matched = jobs.find(j => j.title.toLowerCase().includes(cleanRole) || cleanRole.includes(j.title.toLowerCase()));
    if (matched) return matched;

    // Fallbacks
    if (cleanRole.includes("sme")) {
      return jobs.find(j => j.title.toLowerCase().includes("sme")) || jobs[0];
    }
    if (cleanRole.includes("bde")) {
      return jobs.find(j => j.title.toLowerCase().includes("bde")) || jobs[0];
    }
    if (cleanRole.includes("marketing") || cleanRole.includes("sales")) {
      return jobs.find(j => j.title.toLowerCase().includes("marketing") || j.title.toLowerCase().includes("sales")) || jobs[0];
    }
    if (cleanRole.includes("hr")) {
      return jobs.find(j => j.title.toLowerCase().includes("hr")) || jobs[0];
    }

    return jobs[0] || { id: "N/A", title: "General" };
  }

  // Helper function to match/create interviewer
  async function resolveInterviewer(name) {
    const cleanName = String(name || "Hiring Team Interviewer").trim().toLowerCase();
    
    // Find system user
    let user = users.find(u => u.name.toLowerCase().includes(cleanName));
    if (user) return user.id;

    // If live mode and user doesn't exist, create them
    if (liveMode) {
      const newName = String(name || "Hiring Team Interviewer").trim();
      console.log(`[RESOLVER] Creating new interviewer user in Firestore: "${newName}"`);
      const newInterviewerRef = await db.collection("users").add({
        fullName: newName,
        email: `${newName.replace(/\s+/g, ".").toLowerCase()}@ats.local`,
        role: "INTERVIEWER",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        organizationId: "defaultOrg"
      });
      
      const newInterviewer = {
        id: newInterviewerRef.id,
        name: newName,
        role: "INTERVIEWER"
      };
      users.push(newInterviewer);
      return newInterviewer.id;
    }

    // In dry-run mode, simulate
    return `mock-id-for-${name.replace(/\s+/g, "")}`;
  }

  const excelFilePath = "d:/ats new/interview_schedule_converted.xlsx";
  console.log(`Reading Excel file: ${excelFilePath}`);
  const wb = XLSX.readFile(excelFilePath);
  const firstSheetName = wb.SheetNames.at(0);
  const sheetsMap = new Map(Object.entries(wb.Sheets));
  const sheet = sheetsMap.get(firstSheetName);
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`Found ${rows.length} rows to process.\n`);

  const missingCandidates = [];
  const scheduledInterviews = [];
  let successfulSchedulesCount = 0;

  for (const [i, row] of rows.entries()) {
    const rowIndex = i + 2; // Row number in Excel file (2-indexed)
    const candidateName = row["Candidate Name"] || "Unknown";
    const candidateEmail = row["Candidate Email"] || "";
    const candidatePhone = row["Candidate Phone"] || "";
    
    // Find candidate
    const candidate = findCandidate(row);
    if (!candidate) {
      missingCandidates.push({
        row: rowIndex,
        name: candidateName,
        email: candidateEmail,
        phone: candidatePhone
      });
      continue;
    }

    // Resolve Job ID
    const job = findJob(row["Job Role"]);
    
    // Resolve Interviewer
    const interviewerName = row["Interviewers"] || "Hiring Team Interviewer";
    const interviewerId = await resolveInterviewer(interviewerName);

    // Resolve/Parse date
    let scheduledStart = new Date();
    if (row["Start Date & Time"]) {
      scheduledStart = new Date(row["Start Date & Time"]);
      if (isNaN(scheduledStart.getTime())) {
        console.warn(`[WARNING] Row ${rowIndex}: Invalid date format "${row["Start Date & Time"]}". Defaulting to current date.`);
        scheduledStart = new Date();
      }
    }
    
    const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000); // 1 hour duration

    // Resolve Meeting Mode
    let mode = "ONLINE";
    const rawMode = String(row["Meeting Mode"] || "").toUpperCase().trim();
    if (rawMode.includes("PERSON") || rawMode.includes("IN_PERSON") || rawMode.includes("IN PERSON")) {
      mode = "IN_PERSON";
    } else if (rawMode.includes("PHONE") || rawMode.includes("CALL")) {
      mode = "PHONE";
    } else if (rawMode.includes("DRIVE")) {
      mode = "DRIVE";
    }

    // Resolve Round
    let roundNo = 1;
    let roundName = "Round 1";
    const rawRound = String(row["Interview Round"] || "").trim();
    if (rawRound.toLowerCase().includes("final")) {
      roundNo = 99;
      roundName = "Final Round";
    } else {
      const numMatch = rawRound.match(/\d+/);
      if (numMatch) {
        roundNo = parseInt(numMatch[0]);
        roundName = `Round ${roundNo}`;
      }
    }

    // Dry Run or Live mode scheduling
    if (liveMode) {
      try {
        // Find existing application or create new one
        const appSnap = await db.collection("applications")
          .where("candidateId", "==", candidate.id)
          .where("jobId", "==", job.id)
          .limit(1)
          .get();
        
        let applicationId;
        if (!appSnap.empty) {
          applicationId = appSnap.docs[0].id;
        } else {
          const newAppRef = await db.collection("applications").add({
            candidateId: candidate.id,
            jobId: job.id,
            status: "IN_PIPELINE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          applicationId = newAppRef.id;
        }

        // Schedule Interview
        const interviewData = {
          applicationId,
          interviewerIds: [interviewerId],
          scheduledStart: scheduledStart.toISOString(),
          scheduledEnd: scheduledEnd.toISOString(),
          mode,
          roundNo,
          round: roundName,
          meetingLink: row["Meeting Link"] || "",
          zohoLink: row["Zoho Link"] || "",
          createdById: "73783a2b-0045-431c-9b71-75aeab0b6840", // Default Admin ID
          createdAt: new Date().toISOString(),
          status: "SCHEDULED"
        };
        
        await db.collection("interviews").add(interviewData);
        successfulSchedulesCount++;
      } catch (err) {
        console.error(`[ERROR] Row ${rowIndex}: Failed to schedule interview - ${err.message}`);
      }
    } else {
      // Dry-Run log
      scheduledInterviews.push({
        row: rowIndex,
        candidateName: candidate.fullName,
        candidateId: candidate.id,
        jobRole: job.title,
        jobId: job.id,
        interviewer: interviewerName,
        interviewerId,
        round: roundName,
        mode,
        time: scheduledStart.toISOString()
      });
      successfulSchedulesCount++;
    }
  }

  // --- REPORTING ---
  console.log("\n==========================================");
  console.log("            PROCESSING REPORT");
  console.log("==========================================");
  console.log(`Total rows processed: ${rows.length}`);
  console.log(`Successfully mapped/scheduled: ${successfulSchedulesCount}`);
  console.log(`Missing Candidates (Not found in DB): ${missingCandidates.length}`);
  console.log("==========================================\n");

  if (missingCandidates.length > 0) {
    console.log("❌ MISSING CANDIDATES REPORT:");
    console.log("Please check these rows - they must be created first before scheduling.");
    console.table(missingCandidates);
  } else {
    console.log("✅ All candidates from the Excel sheet were successfully found in the database!");
  }

  if (dryRun && scheduledInterviews.length > 0) {
    console.log("\n🔍 SAMPLE SCHEDULED INTERVIEWS (DRY RUN LOG):");
    console.table(scheduledInterviews.slice(0, 10));
    if (scheduledInterviews.length > 10) {
      console.log(`... and ${scheduledInterviews.length - 10} more interviews mapped.`);
    }
  }

  if (liveMode) {
    console.log(`\n🎉 Successfully scheduled ${successfulSchedulesCount} interviews in the database!`);
    try {
      const redis = require("../src/utils/redisClient");
      const keys = await redis.keys("scheduling:rounds:list:*");
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Redis] Invalidated ${keys.length} list cache keys.`);
      }
      await redis.quit();
    } catch (redisErr) {
      console.error("[Redis] Failed to invalidate cache keys:", redisErr.message);
    }
  }
}

run().catch(console.error);
