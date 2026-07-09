const XLSX = require('xlsx');
const fs = require('fs');
const prisma = require('../src/config/db');

const filePath = 'C:\\Users\\jishn\\Downloads\\Candidates_Formatted.xlsx';
const DEFAULT_COMPANY = 'Akshara Enterprises';
const ORG_ID = 'defaultOrg';
const ADMIN_USER_ID = '73783a2b-0045-431c-9b71-75aeab0b6840';

async function runImport() {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Excel file not found at ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading file: ${filePath}`);
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  console.log(`Total rows in Excel sheet: ${rows.length}`);

  let insertedCount = 0;
  let skippedExcelDuplicateCount = 0;
  let skippedDbDuplicateCount = 0;
  let invalidCount = 0;

  // Track unique phone/email combinations in this execution
  const processedPhones = new Set();
  const processedEmails = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const fullName = String(row['Full Name'] || '').trim();
    const emailRaw = String(row['Email'] || '').trim();
    const email = emailRaw.toLowerCase();
    const phoneRaw = String(row['Phone'] || '').trim();
    const phone = phoneRaw.replace(/\D/g, "");
    const location = String(row['Location'] || '').trim() || null;
    const role = String(row['Role'] || '').trim() || null;

    // Validation
    if (!fullName) {
      console.log(`[Row ${rowNum}] Skipping: Full Name is empty.`);
      invalidCount++;
      continue;
    }

    if (!phone) {
      console.log(`[Row ${rowNum}] Skipping candidate "${fullName}": Phone number is empty.`);
      invalidCount++;
      continue;
    }

    if (phone.length !== 10) {
      console.log(`[Row ${rowNum}] Skipping candidate "${fullName}": Invalid phone number "${phoneRaw}" (must be 10 digits).`);
      invalidCount++;
      continue;
    }

    const hasEmail = email && email !== 'n/a' && email !== 'na' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    // 1. Check duplicate within Excel
    if (processedPhones.has(phone)) {
      console.log(`[Row ${rowNum}] Skipping duplicate candidate "${fullName}": Phone ${phone} already seen in Excel sheet.`);
      skippedExcelDuplicateCount++;
      continue;
    }
    if (hasEmail && processedEmails.has(email)) {
      console.log(`[Row ${rowNum}] Skipping duplicate candidate "${fullName}": Email ${email} already seen in Excel sheet.`);
      skippedExcelDuplicateCount++;
      continue;
    }

    // 2. Check duplicate against Database
    // Try to find candidate with matching phone
    const existingByPhone = await prisma.candidate.findFirst({
      where: { phone, organizationId: ORG_ID, isDeleted: false }
    });

    if (existingByPhone) {
      console.log(`[Row ${rowNum}] Skipping candidate "${fullName}": Phone ${phone} matches existing candidate in DB ("${existingByPhone.fullName}").`);
      skippedDbDuplicateCount++;
      // Mark as processed so we don't query again
      processedPhones.add(phone);
      if (hasEmail) processedEmails.add(email);
      continue;
    }

    // Try to find candidate with matching email (if valid email provided)
    if (hasEmail) {
      const existingByEmail = await prisma.candidate.findFirst({
        where: { email, organizationId: ORG_ID, isDeleted: false }
      });

      if (existingByEmail) {
        console.log(`[Row ${rowNum}] Skipping candidate "${fullName}": Email ${email} matches existing candidate in DB ("${existingByEmail.fullName}").`);
        skippedDbDuplicateCount++;
        // Mark as processed
        processedPhones.add(phone);
        processedEmails.add(email);
        continue;
      }
    }

    // Candidate is unique. Let's create the record.
    try {
      await prisma.candidate.create({
        data: {
          fullName,
          email: hasEmail ? email : "N/A",
          phone,
          location,
          preferredRole: role,
          company: DEFAULT_COMPANY,
          organizationId: ORG_ID,
          createdById: ADMIN_USER_ID,
          status: 'ACTIVE',
          source: 'Excel Import',
          isDeleted: false
        }
      });

      insertedCount++;
      processedPhones.add(phone);
      if (hasEmail) processedEmails.add(email);
      console.log(`[Row ${rowNum}] Successfully imported candidate: "${fullName}" (${phone}${hasEmail ? ', ' + email : ''})`);
    } catch (err) {
      console.error(`[Row ${rowNum}] Database error inserting candidate "${fullName}":`, err.message);
      invalidCount++;
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`Total Rows Processed: ${rows.length}`);
  console.log(`Successfully Imported: ${insertedCount}`);
  console.log(`Skipped (Excel Duplicates): ${skippedExcelDuplicateCount}`);
  console.log(`Skipped (DB Duplicates): ${skippedDbDuplicateCount}`);
  console.log(`Skipped (Invalid/Validation Failures): ${invalidCount}`);
}

runImport()
  .catch(err => {
    console.error("Fatal import error:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
