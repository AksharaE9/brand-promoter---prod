const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

function checkExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File does not exist: ${filePath}`);
    return;
  }
  const workbook = XLSX.readFile(filePath);
  console.log(`Excel File: ${path.basename(filePath)}`);
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`  Sheet: ${sheetName} => ${rows.length} rows`);
    if (rows.length > 0) {
      console.log('  Sample keys:', Object.keys(rows[0]));
    }
  }
  console.log('---');
}

checkExcel('d:/ats new/Error_Candidates_Formatted.xlsx');
checkExcel('d:/ats new/candidate_template.xlsx');
checkExcel('d:/ats new/error_columns_only.xlsx');
checkExcel('d:/ats new/interview_schedule_converted.xlsx');
checkExcel('d:/ats new/interview_schedule_template.xlsx');
