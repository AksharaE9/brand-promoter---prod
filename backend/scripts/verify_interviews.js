const XLSX = require("xlsx");
const { db } = require("../src/config/firebase");

async function verify() {
  console.log("Fetching live data from Firestore...");
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map(doc => ({ id: doc.id, name: doc.data().fullName }));

  const jobsSnap = await db.collection("jobs").get();
  const jobs = jobsSnap.docs.map(doc => ({ id: doc.id, title: doc.data().title }));

  const candidatesSnap = await db.collection("candidates").get();
  const candidates = candidatesSnap.docs.map(doc => ({
    id: doc.id,
    fullName: doc.data().fullName,
    phone: doc.data().phone,
    email: doc.data().email
  }));

  const appsSnap = await db.collection("applications").get();
  const apps = appsSnap.docs.map(doc => ({
    id: doc.id,
    candidateId: doc.data().candidateId,
    jobId: doc.data().jobId
  }));

  const interviewsSnap = await db.collection("interviews").get();
  const interviews = interviewsSnap.docs.map(doc => ({
    id: doc.id,
    applicationId: doc.data().applicationId,
    interviewerIds: doc.data().interviewerIds,
    scheduledStart: doc.data().scheduledStart,
    mode: doc.data().mode,
    roundNo: doc.data().roundNo,
    round: doc.data().round
  }));

  console.log(`Loaded ${candidates.length} candidates, ${apps.length} applications, and ${interviews.length} interviews.\n`);

  // Load Excel
  const excelFilePath = "d:/ats new/interview_schedule_converted.xlsx";
  const wb = XLSX.readFile(excelFilePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  let verifiedCount = 0;
  let mismatchCount = 0;
  const discrepancies = [];

  // Helper matching functions
  function findCandidate(row) {
    const excelName = String(row["Candidate Name"] || "").trim().toLowerCase();
    const excelEmail = String(row["Candidate Email"] || "").trim().toLowerCase();
    const excelPhone = String(row["Candidate Phone"] || "").replace(/\D/g, "");

    if (excelPhone.length >= 10) {
      const match = candidates.find(c => {
        const dbPhoneClean = String(c.phone || "").replace(/\D/g, "");
        return dbPhoneClean.slice(-10) === excelPhone.slice(-10);
      });
      if (match) return match;
    }
    if (excelEmail && excelEmail !== "n/a") {
      const match = candidates.find(c => String(c.email || "").toLowerCase().trim() === excelEmail);
      if (match) return match;
    }
    if (excelName) {
      const match = candidates.find(c => String(c.fullName || "").toLowerCase().trim() === excelName);
      if (match) return match;
    }
    return null;
  }

  function findJob(excelRole) {
    const cleanRole = String(excelRole || "").toLowerCase().trim();
    if (!cleanRole) return jobs[0];
    let matched = jobs.find(j => j.title.toLowerCase().trim() === cleanRole);
    if (matched) return matched;
    matched = jobs.find(j => j.title.toLowerCase().includes(cleanRole) || cleanRole.includes(j.title.toLowerCase()));
    if (matched) return matched;
    if (cleanRole.includes("sme")) return jobs.find(j => j.title.toLowerCase().includes("sme")) || jobs[0];
    if (cleanRole.includes("bde")) return jobs.find(j => j.title.toLowerCase().includes("bde")) || jobs[0];
    if (cleanRole.includes("marketing") || cleanRole.includes("sales")) return jobs.find(j => j.title.toLowerCase().includes("marketing") || j.title.toLowerCase().includes("sales")) || jobs[0];
    if (cleanRole.includes("hr")) return jobs.find(j => j.title.toLowerCase().includes("hr")) || jobs[0];
    return jobs[0];
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 2;
    const candidateName = row["Candidate Name"];

    const candidate = findCandidate(row);
    if (!candidate) {
      mismatchCount++;
      discrepancies.push({ row: rowIndex, name: candidateName, issue: "Candidate not found in DB" });
      continue;
    }

    const job = findJob(row["Job Role"]);
    
    // Find application
    const app = apps.find(a => a.candidateId === candidate.id && a.jobId === job.id);
    if (!app) {
      mismatchCount++;
      discrepancies.push({ row: rowIndex, name: candidateName, issue: `Application for job "${job.title}" missing in DB` });
      continue;
    }

    // Resolve Interviewer
    const excelInterviewer = String(row["Interviewers"] || "Hiring Team Interviewer").trim().toLowerCase();
    const interviewer = users.find(u => u.name.toLowerCase().includes(excelInterviewer));
    if (!interviewer) {
      mismatchCount++;
      discrepancies.push({ row: rowIndex, name: candidateName, issue: `Interviewer "${row["Interviewers"]}" not found in DB` });
      continue;
    }

    // Parse round
    let roundNo = 1;
    const rawRound = String(row["Interview Round"] || "").trim();
    if (rawRound.toLowerCase().includes("final")) {
      roundNo = 99;
    } else {
      const numMatch = rawRound.match(/\d+/);
      if (numMatch) roundNo = parseInt(numMatch[0]);
    }

    // Parse Mode
    let mode = "ONLINE";
    const rawMode = String(row["Meeting Mode"] || "").toUpperCase().trim();
    if (rawMode.includes("PERSON") || rawMode.includes("IN_PERSON") || rawMode.includes("IN PERSON")) {
      mode = "IN_PERSON";
    } else if (rawMode.includes("PHONE") || rawMode.includes("CALL")) {
      mode = "PHONE";
    } else if (rawMode.includes("DRIVE")) {
      mode = "DRIVE";
    }

    // Parse Date
    let scheduledStart = new Date(row["Start Date & Time"]);
    const expectedTimeISO = isNaN(scheduledStart.getTime()) ? null : scheduledStart.toISOString();

    // Look for matching interview
    const matchedInterviews = interviews.filter(iv => iv.applicationId === app.id);
    const exactInterview = matchedInterviews.find(iv => {
      // Allow +/- 5 minutes time variance
      const timeDiff = Math.abs(new Date(iv.scheduledStart).getTime() - scheduledStart.getTime());
      const maxDiffMs = 5 * 60 * 1000;
      
      return (
        iv.interviewerIds.includes(interviewer.id) &&
        iv.roundNo === roundNo &&
        iv.mode === mode &&
        timeDiff <= maxDiffMs
      );
    });

    if (exactInterview) {
      verifiedCount++;
    } else {
      mismatchCount++;
      discrepancies.push({
        row: rowIndex,
        name: candidateName,
        issue: `No interview scheduled matching Mode: ${mode}, Round: ${roundNo}, Interviewer: ${interviewer.name}, Time: ${row["Start Date & Time"]}`
      });
    }
  }

  console.log("==========================================");
  console.log("       VERIFICATION CROSS-CHECK REPORT");
  console.log("==========================================");
  console.log(`Total Excel Rows Checked: ${rows.length}`);
  console.log(`Verified Mapped Perfectly: ${verifiedCount}`);
  console.log(`Discrepancies / Mismatches: ${mismatchCount}`);
  console.log("==========================================\n");

  if (discrepancies.length > 0) {
    console.log("❌ DISCREPANCIES DETECTED:");
    console.table(discrepancies);
  } else {
    console.log("✅ SUCCESS: Every single row in the Excel sheet matches a scheduled interview in the database exactly!");
  }
}

verify().catch(console.error);
