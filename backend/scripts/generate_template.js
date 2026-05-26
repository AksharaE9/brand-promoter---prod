const XLSX = require("xlsx");
const path = require("path");

const data = [
  {
    "Full Name": "John Doe",
    "Email": "john.doe@example.com",
    "Phone": "9876543210",
    "Current Company": "Tech Solutions",
    "Experience Years": 3.5,
    "Source": "LinkedIn"
  },
  {
    "Full Name": "Jane Smith",
    "Email": "jane.smith@example.com",
    "Phone": "9123456780",
    "Current Company": "Initech",
    "Experience Years": 5.0,
    "Source": "Referral"
  },
  {
    "Full Name": "Alex Johnson",
    "Email": "alex.johnson@example.com",
    "Phone": "8765432109",
    "Current Company": "Innovate LLC",
    "Experience Years": 2.0,
    "Source": "Direct"
  }
];

const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Candidates");

// Paths for output files
const xlsxPath = "d:/ats new/candidate_template.xlsx";
const csvPath = "d:/ats new/candidate_template.csv";

// Write XLSX
XLSX.writeFile(wb, xlsxPath);
console.log(`Successfully generated Excel template: ${xlsxPath}`);

// Write CSV
const csvContent = XLSX.utils.sheet_to_csv(ws);
const fs = require("fs");
fs.writeFileSync(csvPath, csvContent, "utf8");
console.log(`Successfully generated CSV template: ${csvPath}`);
