// qa/inspect_joining_dates.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function main() {
  console.log('=== INSPECTING ALL CANDIDATE DOJ / JOINING DATES ===');
  
  // Find all distinct non-null doj values in database
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
      doj: true,
      createdAt: true
    }
  });

  console.log(`Candidates with non-null doj: ${candidatesWithDoj.length}`);
  const dojCounts = {};
  const invalidDojCandidates = [];

  for (const c of candidatesWithDoj) {
    const raw = String(c.doj).trim();
    dojCounts[raw] = (dojCounts[raw] || 0) + 1;

    // Check if raw parses to a valid Date
    const parsed = new Date(raw);
    const isNaN = Number.isNaN(parsed.getTime());
    if (isNaN || raw === '-' || raw.toLowerCase() === 'na' || raw.toLowerCase() === 'immediate' || raw.toLowerCase() === 'october') {
      invalidDojCandidates.push({
        id: c.id,
        name: c.fullName,
        role: c.preferredRole,
        status: c.status,
        offerDecision: c.offerDecision,
        rawDoj: raw,
        isNaN
      });
    }
  }

  console.log('\n--- DISTINCT RAW DOJ VALUES & COUNTS ---');
  console.log(JSON.stringify(dojCounts, null, 2));

  console.log(`\n--- CANDIDATES WITH UNPARSEABLE OR BAD DOJ (Total: ${invalidDojCandidates.length}) ---`);
  console.log(JSON.stringify(invalidDojCandidates.slice(0, 30), null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
