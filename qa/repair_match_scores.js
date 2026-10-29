const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

function canonicalizeMatchItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const text = item.trim();
    if (!text) return null;
    return {
      label: text,
      skill: text,
      category: 'general',
      evidence: '',
      strength: 'medium',
    };
  }
  if (typeof item === 'object') {
    const label = String(item.label || item.skill || item.requirement || item.name || '').trim();
    if (!label) return null;
    return {
      label,
      skill: label,
      category: String(item.category || 'general').trim(),
      evidence: String(item.evidence || '').trim(),
      strength: String(item.strength || 'medium').trim(),
      ...(item.weight !== undefined ? { weight: Number(item.weight) } : {}),
    };
  }
  return null;
}

function canonicalizeList(arr) {
  if (!arr || !Array.isArray(arr)) return [];
  return arr.map(canonicalizeMatchItem).filter(Boolean);
}

async function repairScores(dryRun = true) {
  console.log(`=== MATCH SCORE CANONICAL REPAIR (mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}) ===\n`);

  const scores = await prisma.matchScore.findMany({
    select: {
      id: true,
      candidateId: true,
      matchedRequirements: true,
      missingMustHaves: true,
      flags: true,
      subScores: true,
    }
  });

  console.log(`Total MatchScore rows in DB: ${scores.length}`);

  let needsRepairCount = 0;
  const updates = [];

  for (const s of scores) {
    const origMatched = Array.isArray(s.matchedRequirements) ? s.matchedRequirements : [];
    const origMissing = Array.isArray(s.missingMustHaves) ? s.missingMustHaves : [];

    // Check if any item lacks 'label'
    const matchedNeedsRepair = origMatched.some(item => typeof item === 'string' || !item.label);
    const missingNeedsRepair = origMissing.some(item => typeof item === 'string' || !item.label);

    if (matchedNeedsRepair || missingNeedsRepair) {
      needsRepairCount++;
      const repairedMatched = canonicalizeList(origMatched);
      const repairedMissing = canonicalizeList(origMissing);

      updates.push({
        id: s.id,
        matchedRequirements: repairedMatched,
        missingMustHaves: repairedMissing,
      });
    }
  }

  console.log(`Rows requiring canonical repair: ${needsRepairCount} / ${scores.length}`);

  if (updates.length > 0) {
    console.log('\nSample before & after for first updated row:');
    const sample = updates[0];
    const original = scores.find(s => s.id === sample.id);
    console.log('Original missingMustHaves (sample):', JSON.stringify(original?.missingMustHaves?.slice(0, 2)));
    console.log('Repaired missingMustHaves (sample):', JSON.stringify(sample.missingMustHaves.slice(0, 2)));
  }

  if (!dryRun) {
    console.log(`\nExecuting database updates for ${updates.length} rows...`);
    let updatedCount = 0;
    for (const u of updates) {
      await prisma.matchScore.update({
        where: { id: u.id },
        data: {
          matchedRequirements: u.matchedRequirements,
          missingMustHaves: u.missingMustHaves,
        }
      });
      updatedCount++;
    }
    console.log(`Successfully updated ${updatedCount} rows in production database.`);
  } else {
    console.log('\nDRY-RUN complete. No records modified. Run with --execute to apply.');
  }

  await prisma.$disconnect();
}

const isExecute = process.argv.includes('--execute');
repairScores(!isExecute).catch(console.error);
