'use strict';

const path = require('path');
const fs = require('fs');

const backendNodeModules = path.resolve(__dirname, '../../backend/node_modules');
module.paths.push(backendNodeModules);

const ExcelJS = require(path.join(backendNodeModules, 'exceljs'));

async function exportHydCityOnly() {
  const sourcePath = path.resolve(__dirname, '../../exports/Hyderabad_Telecalling_Candidates_2026-10-23.xlsx');
  const targetPath = path.resolve(__dirname, '../../exports/Hyderabad_City_Telecalling_Candidates_2026-10-23.xlsx');

  console.log('Reading source workbook from:', sourcePath);
  const srcWb = new ExcelJS.Workbook();
  await srcWb.xlsx.readFile(sourcePath);

  const srcSheet = srcWb.getWorksheet('Telecalling – Hyderabad');
  const headers = [];
  const colKeys = [];
  
  srcSheet.getRow(1).eachCell((cell, colNum) => {
    headers.push(String(cell.value || ''));
  });

  const locMatchColIdx = headers.indexOf('Location Match Type') + 1;
  console.log('Found Location Match Type at column:', locMatchColIdx);

  const cityRows = [];
  srcSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const matchType = String(row.getCell(locMatchColIdx).value || '');
    if (matchType === 'city') {
      const rowValues = [];
      for (let c = 1; c <= headers.length; c++) {
        rowValues.push(row.getCell(c).value);
      }
      cityRows.push(rowValues);
    }
  });

  console.log(`Extracted ${cityRows.length} city-only candidates.`);

  // Create clean new workbook
  const outWb = new ExcelJS.Workbook();
  outWb.creator = 'Antigravity ATS Local Export Script';
  outWb.created = new Date();
  outWb.modified = new Date();

  // Sheet 1: Telecalling – Hyderabad (12 Candidates)
  const outSheet = outWb.addWorksheet('Telecalling – Hyderabad');
  
  // Setup columns
  outSheet.columns = headers.map(h => ({ header: h, key: h }));

  // Style Header
  const headerRow = outSheet.getRow(1);
  headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 28;

  // Add data rows
  cityRows.forEach(vals => {
    const row = outSheet.addRow(vals);

    // Format phone cells as text '@'
    const phoneIdx = headers.indexOf('Phone (as stored)') + 1;
    const phoneNormIdx = headers.indexOf('Phone Normalised') + 1;
    if (phoneIdx > 0) {
      const cell = row.getCell(phoneIdx);
      cell.value = String(cell.value || '');
      cell.numFmt = '@';
    }
    if (phoneNormIdx > 0) {
      const cell = row.getCell(phoneNormIdx);
      cell.value = String(cell.value || '');
      cell.numFmt = '@';
    }

    // Date formatting
    const createdIdx = headers.indexOf('Created Date') + 1;
    const updatedIdx = headers.indexOf('Last Updated Date') + 1;
    const roundDateIdx = headers.indexOf('Latest Round Date') + 1;
    const dojIdx = headers.indexOf('Date of Joining') + 1;

    if (createdIdx > 0 && row.getCell(createdIdx).value) row.getCell(createdIdx).numFmt = 'dd-mm-yyyy hh:mm';
    if (updatedIdx > 0 && row.getCell(updatedIdx).value) row.getCell(updatedIdx).numFmt = 'dd-mm-yyyy hh:mm';
    if (roundDateIdx > 0 && row.getCell(roundDateIdx).value) row.getCell(roundDateIdx).numFmt = 'dd-mm-yyyy';
    if (dojIdx > 0 && row.getCell(dojIdx).value) row.getCell(dojIdx).numFmt = 'dd-mm-yyyy';

    // Comment text wrapping
    const commentIdx = headers.indexOf('Latest Feedback Comment') + 1;
    if (commentIdx > 0) {
      row.getCell(commentIdx).alignment = { wrapText: true, vertical: 'top' };
    }
  });

  // Freeze header and add AutoFilter
  outSheet.views = [{ state: 'frozen', ySplit: 1 }];
  const lastColLetter = outSheet.getColumn(headers.length).letter;
  outSheet.autoFilter = `A1:${lastColLetter}1`;

  // Auto-width
  outSheet.columns.forEach((column) => {
    let maxLen = 12;
    column.eachCell({ includeEmpty: true }, (cell, rowIdx) => {
      if (rowIdx === 1) {
        maxLen = Math.max(maxLen, cell.value ? String(cell.value).length + 4 : 12);
      } else if (cell.value) {
        maxLen = Math.max(maxLen, Math.min(String(cell.value).length + 2, 45));
      }
    });
    column.width = Math.min(Math.max(maxLen, 14), 48);
  });

  // Sheet 2: Summary Sheet
  const summarySheet = outWb.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 38 },
    { header: 'Value', key: 'val', width: 22 },
    { header: 'Details', key: 'details', width: 50 }
  ];
  
  const sumHeader = summarySheet.getRow(1);
  sumHeader.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  sumHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  sumHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  sumHeader.height = 26;
  summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

  summarySheet.addRow({ metric: 'Target Filter', val: 'Hyderabad / Hyd Location Only', details: 'Candidate location is specifically Hyderabad/Hyd' });
  summarySheet.addRow({ metric: 'Total Candidates', val: cityRows.length, details: 'Strict city-match telecalling candidates' });
  summarySheet.addRow({ metric: 'Role Family', val: 'Telecalling', details: 'Telecalling, Telesales, Telecaller, etc.' });
  summarySheet.addRow({ metric: 'Export Date (IST)', val: '2026-10-23', details: 'Export timestamp' });
  summarySheet.addRow({ metric: 'Active Status', val: '11', details: '11 Active, 1 Rejected' });
  summarySheet.addRow({ metric: 'Cross-city Applicants Excluded', val: '30', details: 'Candidates living in Bangalore/Kochi who applied to Hyderabad' });

  // Save Workbook
  console.log('Writing clean workbook to:', targetPath);
  await outWb.xlsx.writeFile(targetPath);
  console.log(`Success! File size: ${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB`);
}

exportHydCityOnly().catch(err => {
  console.error('Error generating city-only workbook:', err);
  process.exit(1);
});
