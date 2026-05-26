const { db: firestore } = require("../config/firebase");

async function runBulkImport(sessionData, columnMapping, userId, organizationId, updateProgress) {
  const rows = sessionData.rows;
  
  const results = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const mappedCandidate = {};
    
    // Map columns
    Object.keys(columnMapping).forEach(rawCol => {
      const systemField = columnMapping[rawCol];
      if (systemField !== "ignore") {
        mappedCandidate[systemField] = String(rawRow[rawCol] || "").trim();
      }
    });

    const errors = [];
    
    // Validation
    if (!mappedCandidate.fullName) errors.push("fullName is required");
    if (mappedCandidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedCandidate.email)) {
      errors.push("Invalid email format");
    }

    if (!mappedCandidate.phone) {
      errors.push("Phone is required");
    } else {
      const phoneDigits = mappedCandidate.phone.replace(/\D/g, "");
      if (phoneDigits.length !== 10) {
        errors.push("Phone must be 10 digits");
      }
    }

    if (errors.length > 0) {
      results.failed++;
      results.errors.push({
        rowNumber: rawRow._rowIndex || (i + 2),
        rawData: rawRow,
        errors
      });
    } else {
      // Deduplication by phone
      const phoneDigits = mappedCandidate.phone.replace(/\D/g, "");
      const existingSnap = await firestore.collection("candidates")
        .where("phone", "==", phoneDigits)
        .limit(1)
        .get();
        
      if (!existingSnap.empty) {
        results.skipped++;
      } else {
        try {
          // Insertion
          await firestore.collection("candidates").add({
            collegeName: "N/A",
            graduationYear: "N/A",
            location: "N/A",
            area: "N/A",
            course: "N/A",
            jobId: "N/A",
            linkedinUrl: "N/A",
            currentCompany: "N/A",
            currentRole: "N/A",
            experienceYears: "N/A",
            skills: "N/A",
            notes: "N/A",
            drive: "N/A",
            email: mappedCandidate.email || "N/A",
            ...mappedCandidate,
            organizationId,
            source: "Bulk Import Wizard",
            createdById: userId,
            createdAt: new Date().toISOString(),
            status: "ACTIVE"
          });
          results.imported++;
        } catch (err) {
          results.failed++;
          results.errors.push({
            rowNumber: rawRow._rowIndex || (i + 2),
            rawData: rawRow,
            errors: ["Database insertion error: " + err.message]
          });
        }
      }
    }

    // Update progress
    const progress = Math.round(((i + 1) / rows.length) * 100);
    if (updateProgress) {
      updateProgress(progress);
    }
  }

  return results;
}

module.exports = { runBulkImport };
