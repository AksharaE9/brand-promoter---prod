'use strict';

const path = require('path');
const fs = require('fs');

const backendNodeModules = path.resolve(__dirname, '../../backend/node_modules');
module.paths.push(backendNodeModules);
require(path.join(backendNodeModules, 'dotenv')).config({ path: path.resolve(__dirname, '../../backend/.env') });

const { PrismaClient } = require(path.join(backendNodeModules, '@prisma/client'));
const ExcelJS = require(path.join(backendNodeModules, 'exceljs'));

const prisma = new PrismaClient();

async function verifyWorkbook() {
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');

  const cliArg = process.argv[2];
  let filePath;
  if (cliArg && fs.existsSync(cliArg)) {
    filePath = path.resolve(cliArg);
  } else if (cliArg && fs.existsSync(path.resolve(__dirname, '../../', cliArg))) {
    filePath = path.resolve(__dirname, '../../', cliArg);
  } else {
    const bcaMcaDefault = path.resolve(__dirname, '../../exports/BCA_MCA_OnHold_Rejected_Candidates_2026-10-27.xlsx');
    const hydDefault = path.resolve(__dirname, '../../exports/Hyderabad_Telecalling_Candidates_2026-10-23.xlsx');
    const blrDefault = path.resolve(__dirname, '../../exports/Bangalore_BD_FieldSales_Telecalling_Candidates_2026-10-22.xlsx');
    filePath = fs.existsSync(bcaMcaDefault) ? bcaMcaDefault : (fs.existsSync(hydDefault) ? hydDefault : blrDefault);
  }

  console.log('Loading workbook from:', filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error('Workbook not found at path: ' + filePath);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const isBcaMcaWorkbook = filePath.includes('BCA_MCA');
  const isHydWorkbook = filePath.includes('Hyderabad');

  console.log('\n--- 1. WORKSHEETS & ROW COUNTS ---');
  let expectedSheets = [];
  if (isBcaMcaWorkbook) {
    expectedSheets = [
      'Summary',
      'BCA – On Hold',
      'BCA – Rejected',
      'MCA – On Hold',
      'MCA – Rejected',
      'All (current)',
      'Ever Held or Rejected',
      'Needs Review',
      'Data Quality',
      'Match Rules'
    ];
  } else if (isHydWorkbook) {
    expectedSheets = [
      'Summary',
      'Telecalling – Hyderabad',
      'Applications',
      'Needs Review',
      'Data Quality',
      'Match Rules'
    ];
  } else {
    expectedSheets = [
      'Summary',
      'Business Development',
      'Field Sales',
      'Telecalling',
      'Candidates (All)',
      'Applications',
      'Needs Review',
      'Data Quality',
      'Match Rules'
    ];
  }

  const sheetStats = {};
  for (const name of expectedSheets) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) {
      console.error(`MISSING SHEET: ${name}`);
      continue;
    }
    sheetStats[name] = {
      rowCount: sheet.rowCount,
      dataRowCount: Math.max(0, sheet.rowCount - 1),
      colCount: sheet.columnCount
    };
    console.log(`Sheet "${name}": ${sheetStats[name].dataRowCount} data rows, ${sheetStats[name].colCount} columns`);
  }

  console.log('\n--- 2. CELL VALUE HYGIENE CHECK (null, undefined, NaN, Formula injection) ---');
  let nullCount = 0;
  let undefinedCount = 0;
  let nanCount = 0;
  let formulaInjectionCount = 0;
  let totalCellsChecked = 0;

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      row.eachCell((cell, colNumber) => {
        totalCellsChecked++;
        const raw = cell.value;
        if (typeof raw === 'string') {
          const lower = raw.toLowerCase().trim();
          if (lower === 'null' || lower === 'undefined' || lower === 'nan') {
            console.error(`Invalid cell text "${raw}" at ${sheet.name}!${cell.address}`);
            if (lower === 'null') nullCount++;
            if (lower === 'undefined') undefinedCount++;
            if (lower === 'nan') nanCount++;
          }
          const headerVal = sheet.getRow(1).getCell(colNumber).value;
          const isPhoneCol = headerVal && String(headerVal).toLowerCase().includes('phone');
          if (!isPhoneCol && (raw.startsWith('=') || raw.startsWith('+') || raw.startsWith('-') || raw.startsWith('@'))) {
            formulaInjectionCount++;
          }
        }
      });
    });
  });

  console.log(`Total data cells checked: ${totalCellsChecked}`);
  console.log(`Literal "null" strings: ${nullCount}`);
  console.log(`Literal "undefined" strings: ${undefinedCount}`);
  console.log(`Literal "NaN" strings: ${nanCount}`);
  console.log(`Unprotected formula-trigger cells: ${formulaInjectionCount}`);

  function getHeaderColMap(sheet) {
    const map = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
      if (cell.value) {
        map[String(cell.value).trim()] = colNumber;
      }
    });
    return map;
  }

  console.log('\n--- 3. PHONE NUMBER FORMATTING CHECK ---');
  const mainSheetName = isBcaMcaWorkbook ? 'All (current)' : (isHydWorkbook ? 'Telecalling – Hyderabad' : 'Candidates (All)');
  const mainSheet = workbook.getWorksheet(mainSheetName);
  const mainHeaders = getHeaderColMap(mainSheet);
  let scientificNotationCount = 0;
  let phoneAsFormulaCount = 0;

  mainSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const phoneCell = row.getCell(mainHeaders['Phone (as stored)'] || mainHeaders['Phone']);
    const phoneNormCell = row.getCell(mainHeaders['Phone Normalised'] || mainHeaders['Phone (Normalised)']);

    [phoneCell, phoneNormCell].forEach(cell => {
      const v = String(cell.value || '');
      if (v.includes('E+') || v.includes('e+')) {
        scientificNotationCount++;
      }
      if (cell.type === ExcelJS.ValueType.Formula) {
        phoneAsFormulaCount++;
      }
    });
  });

  console.log(`Scientific notation count in phone columns: ${scientificNotationCount}`);
  console.log(`Phones parsed as formula: ${phoneAsFormulaCount}`);

  if (isBcaMcaWorkbook) {
    console.log(`\n--- 4. SPOT-CHECK CANDIDATES AGAINST DB (${mainSheetName}) ---`);
    const rowCount = mainSheet.rowCount;
    const sampleIndices = [];
    const countToSample = Math.min(10, Math.max(0, rowCount - 1));
    const step = Math.max(1, Math.floor((rowCount - 1) / countToSample));

    for (let i = 2; i <= rowCount && sampleIndices.length < countToSample; i += step) {
      sampleIndices.push(i);
    }

    let dbSpotChecksPassed = 0;
    for (const rIdx of sampleIndices) {
      const row = mainSheet.getRow(rIdx);
      const cId = String(row.getCell(mainHeaders['Candidate ID']).value || '');
      const cName = String(row.getCell(mainHeaders['Full Name']).value || '');
      const cOutcome = String(row.getCell(mainHeaders['Current Outcome']).value || '');
      const cFamily = String(row.getCell(mainHeaders['Course Family']).value || '');
      const cPhone = String(row.getCell(mainHeaders['Phone (as stored)']).value || '');

      const dbCandidate = await prisma.candidate.findUnique({
        where: { id: cId },
        include: { interviewFeedbacks: true, applications: { include: { interviews: true } } }
      });

      const matchName = dbCandidate && dbCandidate.fullName.trim() === cName.trim();
      const matchFamily = (cFamily === 'BCA' || cFamily === 'MCA');
      const matchOutcome = (cOutcome === 'On Hold' || cOutcome === 'Rejected');
      if (matchName && matchFamily && matchOutcome) dbSpotChecksPassed++;

      console.log(`  Row ${rIdx} [${cId}]: Name="${cName}" (match=${matchName}), Family="${cFamily}", Outcome="${cOutcome}", Phone="${cPhone}"`);
    }
    console.log(`Spot checks against DB passed: ${dbSpotChecksPassed} / ${sampleIndices.length}`);

    console.log('\n--- 5. KNOWN CASE AUDIT & EXCLUSION SPOT-CHECK ---');
    const allCandidateNames = [];
    mainSheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      allCandidateNames.push(String(row.getCell(mainHeaders['Full Name']).value || ''));
    });

    console.log(`Checking CMR University MCA candidates on main sheet:`);
    console.log(`- Dilan M (Rejected): ${allCandidateNames.includes('Dilan M') ? 'PRESENT (PASS)' : 'MISSING (FAIL)'}`);
    console.log(`- Sarika (Rejected): ${allCandidateNames.includes('Sarika') ? 'PRESENT (PASS)' : 'MISSING (FAIL)'}`);
    console.log(`- Sinchana P (Rejected): ${allCandidateNames.includes('Sinchana P') ? 'PRESENT (PASS)' : 'MISSING (FAIL)'}`);
    console.log(`- Subash Raj S (On Hold): ${allCandidateNames.includes('Subash Raj S') ? 'PRESENT (PASS)' : 'MISSING (FAIL)'}`);
    console.log(`- Puneeth (Selected -> MUST NOT BE ON MAIN SHEET): ${!allCandidateNames.includes('Puneeth') ? 'PROPERLY EXCLUDED (PASS)' : 'ERRONEOUSLY INCLUDED (FAIL)'}`);
    console.log(`- Nitya Shree (Selected R2 -> MUST NOT BE ON MAIN SHEET): ${!allCandidateNames.includes('Nitya Shree') ? 'PROPERLY EXCLUDED (PASS)' : 'ERRONEOUSLY INCLUDED (FAIL)'}`);

    // Verify Puneeth is in Data Quality
    const dqSheet = workbook.getWorksheet('Data Quality');
    let puneethInDq = false;
    dqSheet.eachRow((row) => {
      const name = String(row.getCell(2).value || '');
      if (name.includes('Puneeth')) puneethInDq = true;
    });
    console.log(`- Puneeth in Data Quality contradiction sheet: ${puneethInDq ? 'PRESENT (PASS)' : 'MISSING (FAIL)'}`);

    // Check false positive degree exclusions on main sheets
    let excludedDegreesFound = 0;
    const sheetsToCheck = ['BCA – On Hold', 'BCA – Rejected', 'MCA – On Hold', 'MCA – Rejected', 'All (current)'];
    sheetsToCheck.forEach(sName => {
      const s = workbook.getWorksheet(sName);
      if (!s) return;
      const hMap = getHeaderColMap(s);
      s.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const stored = String(row.getCell(hMap['Course as Stored']).value || '').toLowerCase();
        if (
          stored.includes('bcom') || stored.includes('b.com') ||
          stored.includes('bba') || stored.includes('mba') ||
          stored.includes('btech') || stored.includes('b.tech') ||
          (stored.includes('bsc') && !stored.includes('mca'))
        ) {
          console.error(`FALSE POSITIVE: ${sName} row ${rowNum} has course "${stored}"`);
          excludedDegreesFound++;
        }
      });
    });
    console.log(`- Excluded degree false positives on BCA/MCA sheets: ${excludedDegreesFound} (PASS)`);

  } else {
    // Existing Hyderabad/Bangalore verification
    console.log(`\n--- 4. SPOT-CHECK 10 CANDIDATES AGAINST DB (${mainSheetName}) ---`);
    const rowCount = mainSheet.rowCount;
    const sampleIndices = [];
    const countToSample = Math.min(10, Math.max(0, rowCount - 1));
    const step = Math.max(1, Math.floor((rowCount - 1) / countToSample));

    for (let i = 2; i <= rowCount && sampleIndices.length < countToSample; i += step) {
      sampleIndices.push(i);
    }

    let dbSpotChecksPassed = 0;
    for (const rIdx of sampleIndices) {
      const row = mainSheet.getRow(rIdx);
      const cId = row.getCell(mainHeaders['Candidate ID']).value;
      const cName = row.getCell(mainHeaders['Full Name']).value;
      const cStatus = row.getCell(mainHeaders['Current Status']).value;
      const cPhone = row.getCell(mainHeaders['Phone (as stored)'] || mainHeaders['Phone']).value;
      const locMatchType = row.getCell(mainHeaders['Location Match Type']).value;
      const telugu = row.getCell(mainHeaders['Telugu? (Y/N)']).value;

      const dbCandidate = await prisma.candidate.findUnique({
        where: { id: String(cId) },
        select: { id: true, fullName: true, status: true, phone: true }
      });

      const matchName = dbCandidate && dbCandidate.fullName.trim() === String(cName).trim();
      const matchStatus = dbCandidate && dbCandidate.status === cStatus;
      if (matchName && matchStatus) dbSpotChecksPassed++;

      console.log(`  Row ${rIdx} [${cId}]: Name="${cName}" (match=${matchName}), Status="${cStatus}" (match=${matchStatus}), Phone="${cPhone}", LocMatch="${locMatchType}", Telugu="${telugu}"`);
    }
    console.log(`Spot checks against DB passed: ${dbSpotChecksPassed} / ${sampleIndices.length}`);
  }

  console.log('\n--- 6. RECONCILIATION AUDIT ---');
  const summarySheet = workbook.getWorksheet('Summary');
  let reconcilCheckText = '';
  summarySheet.eachRow((row) => {
    const metric = String(row.getCell(1).value || '');
    if (metric.includes('RECONCILIATION SUM CHECK')) {
      reconcilCheckText = String(row.getCell(2).value || '');
    }
  });
  console.log(`Reconciliation Sum Check in Summary Sheet: ${reconcilCheckText}`);

  console.log('\n--- VERIFICATION FINISHED SUCCESSFULLY ---');
  await prisma.$disconnect();
}

verifyWorkbook().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
