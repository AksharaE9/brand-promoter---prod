'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.RENDER_DATABASE_URL || 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require' } }
});

async function main() {
  const candidates = await prisma.candidate.findMany({
    where: { source: 'BGS_COLLEGE_DRIVE_IMPORT', isDeleted: false },
    include: {
      applications: {
        include: { interviews: true }
      },
      interviewFeedbacks: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log('| # | Candidate Name | Source Sheet & Row | ATS Candidate ID | ATS Interview ID | Role | Panelist | Rating | Status | Follow-Up Notes |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');

  let idx = 1;
  for (const c of candidates) {
    const app = c.applications[0];
    const intv = app?.interviews[0];
    const fb = c.interviewFeedbacks[0];
    const meta = c.customFields || {};
    const notes = [];
    if (meta.needs_contact_details) notes.push('Missing Phone/Email');
    if (c.fullName === 'Sushmita TK') notes.push('Rating 8 (comment 7/10)');
    if (c.fullName === 'hitha Sh') notes.push('Rating 8 from comment; DOJ Nov/Dec note');
    
    console.log(`| ${idx++} | ${c.fullName} | ${meta.source_file || ''} (Row ${meta.source_row || ''}) | \`${c.id}\` | \`${intv?.id || 'N/A'}\` | ${c.preferredRole} | ${c.assignedRecruiterName} | ${fb?.overallRating ?? 'N/A'} | **${intv?.outcome || c.status}** | ${notes.join('; ') || 'Missing Phone/Email'} |`);
  }

  // Held records
  console.log(`| 42 | Santosh khul | Selected_BGS_College.xlsx (Row 22) | *HELD* | *HELD* | Data Analyst Intern | Praneel | 6 | **HELD** | Conflict with Rejected Row 18 |`);
  console.log(`| 43 | Santosh khul | Rejected_BGS_College.xlsx (Row 18) | *HELD* | *HELD* | Data Analyst Intern | Praneel | 2 | **HELD** | Conflict with Selected Row 22 |`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
