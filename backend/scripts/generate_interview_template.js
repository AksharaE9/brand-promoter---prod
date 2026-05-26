const XLSX = require("xlsx");
const path = require("path");

const data = [
  {
    "Candidate Name": "John Doe",
    "Candidate Email": "john.doe@example.com",
    "Candidate Phone": "9876543210",
    "Job Role": "Software Engineer",
    "Interview Round": "Round 1",
    "Meeting Mode": "Online Meeting",
    "Interviewers": "Alice Smith, Bob Jones",
    "Start Date & Time": "2026-06-01 10:00 AM",
    "Meeting Link": "https://meet.google.com/abc-defg-hij",
    "Zoho Link": "https://meeting.zoho.com/meeting/register?id=123456789"
  },
  {
    "Candidate Name": "Jane Smith",
    "Candidate Email": "jane.smith@example.com",
    "Candidate Phone": "9123456780",
    "Job Role": "Product Manager",
    "Interview Round": "Round 2",
    "Meeting Mode": "Online Meeting",
    "Interviewers": "Charlie Brown",
    "Start Date & Time": "2026-06-02 02:30 PM",
    "Meeting Link": "https://zoom.us/j/987654321",
    "Zoho Link": ""
  },
  {
    "Candidate Name": "Alex Johnson",
    "Candidate Email": "alex.johnson@example.com",
    "Candidate Phone": "8765432109",
    "Job Role": "UX Designer",
    "Interview Round": "Final Round",
    "Meeting Mode": "In Person",
    "Interviewers": "Dave Wilson, Eva Green",
    "Start Date & Time": "2026-06-03 11:00 AM",
    "Meeting Link": "",
    "Zoho Link": ""
  }
];

const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Interview Schedule");

// Paths for output files
const xlsxPath = "d:/ats new/interview_schedule_template.xlsx";
const csvPath = "d:/ats new/interview_schedule_template.csv";

// Write XLSX
XLSX.writeFile(wb, xlsxPath);
console.log(`Successfully generated Interview Excel template: ${xlsxPath}`);

// Write CSV
const csvContent = XLSX.utils.sheet_to_csv(ws);
const fs = require("fs");
fs.writeFileSync(csvPath, csvContent, "utf8");
console.log(`Successfully generated Interview CSV template: ${csvPath}`);
