const prisma = require('../src/config/db');

const ORG_ID = 'defaultOrg';
const ADMIN_USER_ID = '73783a2b-0045-431c-9b71-75aeab0b6840';

// Match function for spellings, typos, and fuzzy matching
function matchInterviewer(rawName, dbUsers) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name || name === 'super admin') return null;

  // 1. Exact or substring match in DB
  let matched = dbUsers.find(u => {
    const uName = u.fullName.toLowerCase();
    return uName === name || uName.includes(name) || name.includes(uName);
  });
  if (matched) return matched.id;

  // 2. Typos & Spellings mapping
  if (name.includes('jagrithi') || name.includes('jagrthi') || name.includes('jagirithi') || name.includes('jagriti')) {
    if (name.includes('sarda')) {
      return 'XPf8glsE3KJOIbSPnhTw'; // Jagriti Sarda
    }
    return 'ACXdW05iuSlbNR1G1C8z'; // Jagrithi
  }
  if (name.includes('sreesha') || name.includes('shreesha')) {
    return 'hjIRMiXUAwCKouzK9zJ8'; // Shreesha
  }
  if (name.includes('swathi') || name.includes('swati')) {
    return 'cmr4fq4uu0008nb2t9iy3df5n'; // Swati Desai
  }
  if (name.includes('mahumati') || name.includes('madhumai') || name.includes('madhumati')) {
    return 'xcwSAYvjqcLlfgknxqSp'; // Madhumati
  }
  if (name.includes('kehav') || name.includes('keshav')) {
    return 'lu3MwrR0TIgD68AT5Ju4'; // Keshav
  }
  if (name.includes('godavri') || name.includes('godavari')) {
    return 'pdB3COd1M7rmQQhlgxvO'; // Godavari DK
  }
  if (name.includes('abhnitha') || name.includes('abhinita') || name.includes('abhintha') || name.includes('abhinitha')) {
    return 'TOES1cIUcdAarE9NvWkt'; // Abhinita
  }
  if (name.includes('ananth') || name.includes('ananath')) {
    return 'XwJ3ravlMaZteWtm5xG7'; // Ananth Charan
  }
  if (name.includes('suhas')) {
    return 'cmr3fjxu10008li2rnwo9il5k'; // Suhas Krishna
  }
  if (name.includes('yuvan')) {
    return 're56ljEGsGX6xyVRsB9N'; // YUVAN MELWIN MJ
  }
  if (name.includes('ambika')) {
    return 'cmr4icmif000sqt2srj9fzweq'; // Ambika Hegde
  }
  if (name.includes('pavan')) {
    return 'CXr6ovApgCBnhlubdp1W'; // Pavan Admin
  }
  if (name.includes('ujwal')) {
    return 'rtkG387NSA3tNEEOMuOY'; // Ujwal
  }
  if (name.includes('vinay')) {
    return 'cYEZblWdN7gubrQvLgYj'; // Vinay Shetty
  }
  if (name.includes('sanchi')) {
    return 'uBjeprsho1onUAwgpL6E'; // Sanchi Petkar
  }

  return null;
}

async function fixInterviewers() {
  const dbUsers = await prisma.user.findMany({
    where: { organizationId: ORG_ID, isDeleted: false }
  });

  // Get interviews created in the last hour
  const interviews = await prisma.interview.findMany({
    where: {
      organizationId: ORG_ID,
      createdById: ADMIN_USER_ID,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
    }
  });

  console.log(`Analyzing ${interviews.length} scheduled interviews...`);

  let fixCount = 0;

  for (const iv of interviews) {
    const rawNamesStr = iv.interviewerNames || '';
    if (!rawNamesStr) continue;

    // Split by delimiters
    const tokens = rawNamesStr.split(/,|\/|&|-|\bwith\b|\band\b/i).map(s => s.trim()).filter(Boolean);
    const resolvedIds = [];

    tokens.forEach(tok => {
      const matchId = matchInterviewer(tok, dbUsers);
      if (matchId) {
        resolvedIds.push(matchId);
      }
    });

    // If no unique members could be resolved, fall back to Admin
    if (resolvedIds.length === 0) {
      resolvedIds.push(ADMIN_USER_ID);
    }

    // Compare with current interviewerIds
    let currentIds = [];
    try {
      currentIds = typeof iv.interviewerIds === 'string' ? JSON.parse(iv.interviewerIds) : iv.interviewerIds;
    } catch (_) {}
    if (!Array.isArray(currentIds)) currentIds = [];

    const isDifferent = resolvedIds.length !== currentIds.length || 
                        resolvedIds.some((id, idx) => id !== currentIds[idx]);

    if (isDifferent) {
      const currentNames = currentIds.map(id => dbUsers.find(u => u.id === id)?.fullName || 'Admin').join(', ');
      const newNames = resolvedIds.map(id => dbUsers.find(u => u.id === id)?.fullName || 'Admin').join(', ');
      
      console.log(`[Interview ID: ${iv.id}] Candidate: "${iv.candidateName}" | Round: ${iv.roundNo}`);
      console.log(`  Original String: "${rawNamesStr}"`);
      console.log(`  Mapped from: [${currentNames}] -> to: [${newNames}]`);

      await prisma.interview.update({
        where: { id: iv.id },
        data: {
          interviewerIds: resolvedIds
        }
      });
      fixCount++;
    }
  }

  console.log(`\nSuccessfully corrected interviewer mappings for ${fixCount} interviews.`);
}

fixInterviewers()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
