// qa/diagnose_parity_and_chunks.js
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');
const { signAccessToken } = require('../backend/src/utils/jwt');

async function main() {
  console.log('=== PART 1: DIAGNOSTIC & PARITY CHECKS ===');
  
  // 1. Database URL info (masked)
  const dbUrl = process.env.DATABASE_URL || '';
  const maskedDb = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log('Local/Configured DATABASE_URL:', maskedDb);
  
  // 2. Count match scores in DB
  const matchScoresCount = await prisma.matchScore.count();
  const primaryScoresCount = await prisma.matchScore.count({ where: { isPrimary: true } });
  const uniqueCandidatesWithScores = await prisma.matchScore.groupBy({
    by: ['candidateId'],
    _count: { id: true }
  });
  console.log(`MatchScore rows: ${matchScoresCount}, Primary: ${primaryScoresCount}, Unique candidates: ${uniqueCandidatesWithScores.length}`);

  // 3. Admin user for API tokens
  const adminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isDeleted: false },
    select: { id: true, email: true, role: true, organizationId: true }
  });
  console.log('Admin user found:', adminUser);

  if (adminUser) {
    const token = signAccessToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: adminUser.organizationId
    });
    console.log('Generated token for admin testing.');

    // 4. Test production backend API with token
    const prodBase = 'https://brandpromoter-backend.onrender.com';
    const localBase = 'http://localhost:4000';

    async function fetchCandidateList(baseUrl, label) {
      try {
        const res = await fetch(`${baseUrl}/api/candidates?limit=10&page=1`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const status = res.status;
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        console.log(`\n--- ${label} (${baseUrl}) ---`);
        console.log(`Status: ${status}`);
        if (json && json.data) {
          console.log(`Candidates count returned: ${json.data.length}`);
          const sample = json.data[0];
          console.log('First candidate fields:', Object.keys(sample));
          console.log('Sample candidate matchSummary:', sample.matchSummary);
          console.log('Sample candidate matchScore:', sample.matchScore);
          console.log('Sample candidate raw matchScores:', sample.matchScores);
          
          // Look for Sanjana Desai or Manoj Kumar R specifically
          const sanjana = json.data.find(c => c.name && c.name.toLowerCase().includes('sanjana'));
          if (sanjana) {
            console.log('Sanjana Desai in list:', {
              id: sanjana.id,
              name: sanjana.name,
              primaryRole: sanjana.primaryRole,
              company: sanjana.company,
              joiningDate: sanjana.joiningDate,
              matchSummary: sanjana.matchSummary
            });
          }
        } else {
          console.log('Response body:', text.slice(0, 300));
        }
      } catch (err) {
        console.error(`Error querying ${label}:`, err.message);
      }
    }

    await fetchCandidateList(localBase, 'LOCAL BACKEND');
    await fetchCandidateList(prodBase, 'PRODUCTION RENDER BACKEND');

    // 5. Test specific candidate query for Sanjana Desai on both
    const sanjanaDb = await prisma.candidate.findFirst({
      where: { fullName: { contains: 'Sanjana Desai', mode: 'insensitive' } },
      select: { id: true, fullName: true, preferredRole: true }
    });
    console.log('\nSanjana Desai in DB:', sanjanaDb);

    if (sanjanaDb) {
      async function fetchCandidateDetail(baseUrl, label) {
        try {
          const res = await fetch(`${baseUrl}/api/candidates/${sanjanaDb.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const json = await res.json();
          console.log(`\n${label} detail for ${sanjanaDb.id}:`);
          console.log('Status:', res.status);
          console.log('matchSummary:', json.data?.matchSummary);
          console.log('primaryMatchScore:', json.data?.primaryMatchScore);
        } catch (e) {
          console.error(`Detail error ${label}:`, e.message);
        }
      }
      await fetchCandidateDetail(localBase, 'LOCAL BACKEND');
      await fetchCandidateDetail(prodBase, 'PRODUCTION RENDER BACKEND');
    }
  }

  // 6. Check candidates with "INVALID DATE" or joining badge in DB
  console.log('\n=== PART 3: DIAGNOSIS FOR "JOINING: INVALID DATE" ===');
  const bsVkCandidates = await prisma.candidate.findMany({
    where: {
      preferredRole: { contains: 'Data Analyst', mode: 'insensitive' },
      OR: [
        { fullName: { startsWith: 'B', mode: 'insensitive' } },
        { fullName: { startsWith: 'V', mode: 'insensitive' } }
      ]
    },
    take: 20
  });
  console.log('BS / VK candidates count:', bsVkCandidates.length);
  for (const c of bsVkCandidates) {
    const dateFields = {};
    for (const [k, v] of Object.entries(c)) {
      if (/join|date|doj|offer/i.test(k) || (typeof v === 'string' && /join|date/i.test(v))) {
        dateFields[k] = v;
      }
    }
    console.log(`Candidate: ${c.fullName} (${c.preferredRole}) ->`, dateFields);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
