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
    // Default to Hyderabad export if exists, else Bangalore export
    const hydDefault = path.resolve(__dirname, '../../exports/Hyderabad_Telecalling_Candidates_2026-10-23.xlsx');
    const blrDefault = path.resolve(__dirname, '../../exports/Bangalore_BD_FieldSales_Telecalling_Candidates_2026-10-22.xlsx');
    filePath = fs.existsSync(hydDefault) ? hydDefault : blrDefault;
  }

  console.log('Loading workbook from:', filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error('Workbook not found at path: ' + filePath);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const isHydWorkbook = filePath.includes('Hyderabad');

  console.log('\n--- 1. WORKSHEETS & ROW COUNTS ---');
  const expectedSheets = isHydWorkbook ? [
    'Summary',
    'Telecalling – Hyderabad',
    'Applications',
    'Needs Review',
    'Data Quality',
    'Match Rules'
  ] : [
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
          // Formula injection check: starts with =, +, -, @ and is not a phone number
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
  console.log(`Literal null/undefined/NaN occurrences: ${nullCount + undefinedCount + nanCount}`);
  console.log(`Unescaped formula injection occurrences: ${formulaInjectionCount}`);

  function getHeaderColMap(sheet) {
    const map = {};
    sheet.getRow(1).eachCell((cell, colNum) => {
      map[String(cell.value).trim()] = colNum;
    });
    return map;
  }

  console.log('\n--- 3. PHONE NUMBER FORMATTING CHECK ---');
  const mainSheetName = isHydWorkbook ? 'Telecalling – Hyderabad' : 'Candidates (All)';
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

  console.log('\n--- 5. KNOWN CASE AUDIT & RULES VERIFICATION ---');
  let secunderabadCount = 0;
  let jobLocationMatchCount = 0;
  let localityMatchCount = 0;
  let cityMatchCount = 0;
  let sindhExcluded = true;
  let telanganaInReviewCount = 0;
  let baDaFalsePositives = 0;
  let telecomFalsePositives = 0;

  mainSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const locType = String(row.getCell(mainHeaders['Location Match Type']).value || '');
    const locStored = String(row.getCell(mainHeaders['Location As Stored']).value || '').toLowerCase();
    const roleStored = String(row.getCell(mainHeaders['Role As Stored']).value || '').toLowerCase();

    if (locType === 'twin_city') secunderabadCount++;
    if (locType === 'job_location') jobLocationMatchCount++;
    if (locType === 'locality') localityMatchCount++;
    if (locType === 'city') cityMatchCount++;

    if (locStored.includes('sindh') || locStored.includes('pakistan')) {
      sindhExcluded = false;
      console.error(`ERROR: Sindh/Pakistan candidate found on main sheet row ${rowNum}!`);
    }

    if (
      (roleStored.includes('business analyst') || roleStored.includes('data analyst') || roleStored === 'ba' || roleStored === 'da') &&
      !roleStored.includes('tele') && !roleStored.includes('calling')
    ) {
      baDaFalsePositives++;
    }

    if (roleStored.includes('telecom') || roleStored.includes('television')) {
      telecomFalsePositives++;
    }
  });

  const reviewSheet = workbook.getWorksheet('Needs Review');
  if (reviewSheet) {
    const revHeaders = getHeaderColMap(reviewSheet);
    reviewSheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const locMatch = String(row.getCell(revHeaders['Location Match Type']).value || '');
      const revReason = String(row.getCell(revHeaders['Review Reason']).value || '');
      if (locMatch === 'review_outer_area' || revReason.toLowerCase().includes('telangana')) {
        telanganaInReviewCount++;
      }
    });
  }

  console.log(`- City name matches on main sheet: ${cityMatchCount}`);
  console.log(`- Twin city (Secunderabad) candidates included: ${secunderabadCount}`);
  console.log(`- Locality matches on main sheet: ${localityMatchCount}`);
  console.log(`- Job location matches (applied to Hyderabad job): ${jobLocationMatchCount}`);
  console.log(`- Hyderabad, Sindh/Pakistan properly excluded: ${sindhExcluded}`);
  console.log(`- Outer area / Telangana-only rows routed to Needs Review: ${telanganaInReviewCount}`);
  console.log(`- BA / DA false positives on main sheet: ${baDaFalsePositives}`);
  console.log(`- Telecom / TV false positives on main sheet: ${telecomFalsePositives}`);

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
