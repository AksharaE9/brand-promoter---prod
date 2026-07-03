const XLSX = require('xlsx');
const fs = require('fs');

function inspectExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File does not exist: ${filePath}`);
    return;
  }
  const workbook = XLSX.readFile(filePath);
  console.log(`Excel File: ${filePath}`);
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`Sheet: ${sheetName} has ${rows.length} rows`);
    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      console.log('Keys:', keys);
      // Let's scan for any cell containing 'join' or 'interested' or 'not'
      const foundValues = new Set();
      for (const row of rows) {
        for (const key of keys) {
          const val = String(row[key]);
          if (val.toLowerCase().includes('join') || val.toLowerCase().includes('interest')) {
            foundValues.add(`${key}: ${val}`);
          }
        }
      }
      console.log('Found matching cell values:', Array.from(foundValues));
    }
  }
}

inspectExcel('d:/ats new/interview_schedule_converted.xlsx');
inspectExcel('d:/ats new/Error_Candidates_Formatted.xlsx');
inspectExcel('d:/ats new/error_columns_only.xlsx');
