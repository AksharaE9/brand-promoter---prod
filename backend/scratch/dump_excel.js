const XLSX = require('xlsx');
const fs = require('fs');

function dumpUniqueValues(filePath) {
  if (!fs.existsSync(filePath)) return;
  const workbook = XLSX.readFile(filePath);
  console.log(`Excel File: ${filePath}`);
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (rows.length === 0) continue;
    const keys = Object.keys(rows[0]);
    console.log(`Sheet: ${sheetName}`);
    for (const key of keys) {
      const vals = new Set();
      for (const row of rows) {
        if (row[key] !== undefined && row[key] !== null) {
          vals.add(String(row[key]).trim());
        }
      }
      console.log(`  Col [${key}]: distinct values count = ${vals.size}`);
      if (vals.size < 10) {
        console.log(`    Values:`, Array.from(vals));
      }
    }
  }
}

const files = [
  'd:/ats new/interview_schedule_converted.xlsx',
  'd:/ats new/Error_Candidates_Formatted.xlsx',
  'd:/ats new/error_columns_only.xlsx'
];
for (const f of files) {
  dumpUniqueValues(f);
}
