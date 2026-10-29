// qa/repair_joining_dates.js
/**
 * Data Repair Script: Candidate Joining Dates (DOJ)
 * Cleanses placeholders ('-', 'NA', 'Immediate', etc.) and converts parseable dates
 * to standard ISO YYYY-MM-DD format. Sets unparseable values to NULL.
 *
 * Usage:
 *   node qa/repair_joining_dates.js --dry-run
 *   node qa/repair_joining_dates.js --execute
 */
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

// Placeholders that must strictly become NULL
const PLACEHOLDERS = new Set([
  '-', '--', 'na', 'n/a', 'none', 'null', 'nil',
  'immediate', 'immediately', 'immediate joining',
  'october', 'november', 'december',
  'within a week or two', 'for next week', '1st week of november',
  'after 11th november'
]);

function parseDojValue(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  
  if (PLACEHOLDERS.has(lower)) return null;

  // Handle standard ISO or YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Handle "5th Oct", "28th Sept", "15th Oct", "20th Oct", "1st Nov" (assume 2026)
  const ordinalMatch = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(oct|sept?|nov|dec|jan|feb|mar|apr|may|jun|jul|aug)/i);
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1], 10);
    const monthStr = ordinalMatch[2].toLowerCase();
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
    };
    const mm = months[monthStr];
    if (mm) {
      const dd = String(day).padStart(2, '0');
      return `2026-${mm}-${dd}`;
    }
  }

  // Handle "November 1", "Nov 1"
  const monthDayMatch = trimmed.match(/^(nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|october|november|december)\s+(\d{1,2})$/i);
  if (monthDayMatch) {
    const monthStr = monthDayMatch[1].slice(0, 3).toLowerCase();
    const day = parseInt(monthDayMatch[2], 10);
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const mm = months[monthStr];
    if (mm) {
      return `2026-${mm}-${String(day).padStart(2, '0')}`;
    }
  }

  // General Date parse attempt: only accept if year is between 2024 and 2027
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const year = d.getFullYear();
    if (year >= 2024 && year <= 2027) {
      return d.toISOString().split('T')[0];
    }
  }

  return null;
}

async function run() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== RUNNING JOINING DATE REPAIR (Mode: ${isExecute ? 'EXECUTE' : 'DRY-RUN'}) ===\n`);

  const candidatesWithDoj = await prisma.candidate.findMany({
    where: {
      doj: { not: null },
      isDeleted: false
    },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      status: true,
      offerDecision: true,
      doj: true
    }
  });

  console.log(`Total candidates with non-null doj: ${candidatesWithDoj.length}`);
  let nullifiedCount = 0;
  let normalizedCount = 0;
  let unchangedCount = 0;

  const plannedUpdates = [];

  for (const c of candidatesWithDoj) {
    const original = c.doj;
    const cleaned = parseDojValue(original);

    if (cleaned === null) {
      nullifiedCount++;
      plannedUpdates.push({ id: c.id, name: c.fullName, original, updated: null, action: 'NULLIFY' });
    } else if (cleaned !== original) {
      normalizedCount++;
      plannedUpdates.push({ id: c.id, name: c.fullName, original, updated: cleaned, action: 'NORMALIZE' });
    } else {
      unchangedCount++;
    }
  }

  console.log(`Planned Actions:`);
  console.log(`- Nullify unparseable / survey placeholders: ${nullifiedCount}`);
  console.log(`- Normalize parseable dates to YYYY-MM-DD: ${normalizedCount}`);
  console.log(`- Keep already standard dates unchanged: ${unchangedCount}`);

  console.log('\nSample planned updates:');
  for (const p of plannedUpdates.slice(0, 20)) {
    console.log(`  [${p.action}] "${p.name}": "${p.original}" -> ${p.updated === null ? 'NULL' : `"${p.updated}"`}`);
  }

  if (isExecute) {
    console.log('\nExecuting updates in database...');
    let applied = 0;
    for (const p of plannedUpdates) {
      await prisma.candidate.update({
        where: { id: p.id },
        data: { doj: p.updated }
      });
      applied++;
    }
    console.log(`Successfully applied ${applied} candidate doj repairs!`);
  } else {
    console.log('\nDRY-RUN completed. Run with --execute to apply changes to database.');
  }

  await prisma.$disconnect();
}

run().catch(console.error);
