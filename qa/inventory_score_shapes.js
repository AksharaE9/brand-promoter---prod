const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function inventoryShapes() {
  const scores = await prisma.matchScore.findMany({
    select: {
      id: true,
      candidateId: true,
      jdId: true,
      isPrimary: true,
      overall: true,
      ratingOutOf10: true,
      band: true,
      matchedRequirements: true,
      missingMustHaves: true,
      subScores: true,
      flags: true,
      explanation: true,
      scorerVersion: true,
      parserVersion: true,
      computedAt: true,
    }
  });

  console.log(`Total MatchScore rows in DB: ${scores.length}\n`);

  function classifyArrayField(val) {
    if (val === null || val === undefined) return 'null/undefined';
    if (!Array.isArray(val)) return 'not_an_array';
    if (val.length === 0) return 'empty_array';
    
    let allStrings = true;
    let allSkillCategory = true;
    let allReqEvidence = true;
    let allLabel = true;

    for (const item of val) {
      if (typeof item === 'string') {
        allSkillCategory = false;
        allReqEvidence = false;
        allLabel = false;
      } else if (item && typeof item === 'object') {
        allStrings = false;
        if (!('skill' in item && 'category' in item)) allSkillCategory = false;
        if (!('requirement' in item && 'evidence' in item)) allReqEvidence = false;
        if (!('label' in item)) allLabel = false;
      } else {
        allStrings = false;
        allSkillCategory = false;
        allReqEvidence = false;
        allLabel = false;
      }
    }

    if (allStrings) return 'array_of_strings';
    if (allSkillCategory) return 'array_of_{skill,category}';
    if (allReqEvidence) return 'array_of_{requirement,evidence}';
    if (allLabel) return 'array_of_{label,...}';
    return 'mixed_or_other_object';
  }

  const matchedCounts = {};
  const missingCounts = {};
  const subScoreTypes = {};
  const flagsTypes = {};
  const versions = {};

  for (const s of scores) {
    const mShape = classifyArrayField(s.matchedRequirements);
    matchedCounts[mShape] = (matchedCounts[mShape] || 0) + 1;

    const misShape = classifyArrayField(s.missingMustHaves);
    missingCounts[misShape] = (missingCounts[misShape] || 0) + 1;

    const ssType = s.subScores === null ? 'null' : (typeof s.subScores === 'object' ? (Array.isArray(s.subScores) ? 'array' : 'object') : typeof s.subScores);
    subScoreTypes[ssType] = (subScoreTypes[ssType] || 0) + 1;

    const flType = s.flags === null ? 'null' : (Array.isArray(s.flags) ? 'array' : typeof s.flags);
    flagsTypes[flType] = (flagsTypes[flType] || 0) + 1;

    const vKey = `${s.scorerVersion || 'none'} | ${s.parserVersion || 'none'} | ${s.computedAt ? s.computedAt.toISOString().slice(0, 10) : 'none'}`;
    versions[vKey] = (versions[vKey] || 0) + 1;
  }

  console.log('--- matchedRequirements Shape Distribution ---');
  console.log(JSON.stringify(matchedCounts, null, 2));

  console.log('\n--- missingMustHaves Shape Distribution ---');
  console.log(JSON.stringify(missingCounts, null, 2));

  console.log('\n--- subScores Type Distribution ---');
  console.log(JSON.stringify(subScoreTypes, null, 2));

  console.log('\n--- flags Type Distribution ---');
  console.log(JSON.stringify(flagsTypes, null, 2));

  console.log('\n--- Versions & Date Breakdown ---');
  console.log(JSON.stringify(versions, null, 2));

  // Sample items
  console.log('\n--- Sample of matchedRequirements (non-empty) ---');
  const sampleM = scores.find(s => Array.isArray(s.matchedRequirements) && s.matchedRequirements.length > 0);
  console.log('Sample matchedRequirements:', JSON.stringify(sampleM?.matchedRequirements?.slice(0, 3)));

  console.log('\n--- Sample of missingMustHaves (non-empty) ---');
  const sampleMis = scores.find(s => Array.isArray(s.missingMustHaves) && s.missingMustHaves.length > 0);
  console.log('Sample missingMustHaves:', JSON.stringify(sampleMis?.missingMustHaves?.slice(0, 3)));

  await prisma.$disconnect();
}

inventoryShapes().catch(console.error);
