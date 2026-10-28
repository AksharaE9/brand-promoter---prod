'use strict';

const prisma = require('../../config/db');

/**
 * Computes sub-scores and overall match score for a parsed resume against a Job Description Version.
 *
 * All numbers are deterministic, reproducible, and explainable.
 *
 * @param {object} parsedResume - Structured resume object
 * @param {object} jdVersion - JobDescriptionVersion record with structuredRequirements & weights
 * @param {string} [jdTitle='']
 * @returns {{
 *   overall: number,
 *   ratingOutOf10: number,
 *   band: 'Strong' | 'Good' | 'Partial' | 'Weak',
 *   subScores: {
 *     educationFit: number,
 *     experienceFit: number,
 *     roleSkills: number,
 *     communicationLeadership: number,
 *     semanticRelevance: number,
 *     careerInterest: number
 *   },
 *   matchedRequirements: Array<{ skill: string, category: string, evidence: string, strength: 'high' | 'medium' }>,
 *   missingMustHaves: Array<{ skill: string, category: string }>,
 *   flags: string[],
 *   explanation: string
 * }}
 */
function scoreResumeAgainstJd(parsedResume, jdVersion, jdTitle = '') {
  const reqs = jdVersion.structuredRequirements || {};
  const weights = jdVersion.weights || {
    education: 15,
    experience: 25,
    skills: 25,
    communicationLeadership: 15,
    semantic: 10,
    careerInterest: 10,
    locationAvailability: 0
  };

  const flags = [];
  const matchedRequirements = [];
  const missingMustHaves = [];

  const rawTextLower = (parsedResume.rawText || '').toLowerCase();
  const summaryLower = (parsedResume.summary || '').toLowerCase();
  const expLower = Array.isArray(parsedResume.experience)
    ? parsedResume.experience.map(e => (e.bullets || []).join(' ') + ' ' + (e.title || '')).join(' ').toLowerCase()
    : '';
  const leadLower = Array.isArray(parsedResume.leadership)
    ? parsedResume.leadership.map(l => (l.evidence || []).join(' ') + ' ' + (l.role || '')).join(' ').toLowerCase()
    : '';

  // ───────────────────────────────────────────
  // 1. Education Fit (0–100)
  // ───────────────────────────────────────────
  let educationScore = 50; // Default partial credit for non-business degree
  const targetDegrees = (reqs.education?.degrees || ['BBA', 'BCom', 'MBA', 'BMS', 'BBM', 'MCom']).map(d => d.toLowerCase());
  const eduList = Array.isArray(parsedResume.education) ? parsedResume.education : [];

  let hasBusinessDegree = false;
  let isFresherOrFinalYear = true;

  if (eduList.length > 0) {
    for (const edu of eduList) {
      const degLower = (edu.degree || edu.degreeNormalised || '').toLowerCase();
      if (edu.isBusiness || targetDegrees.some(td => degLower.includes(td))) {
        hasBusinessDegree = true;
        break;
      }
    }

    if (hasBusinessDegree) {
      educationScore = 100;
    } else {
      // Partial credit for engineering / technical degrees (BE, BTech, BCA)
      educationScore = reqs.education?.min_credit_other_degree || 50;
    }

    isFresherOrFinalYear = eduList.some(e => e.status === 'pursuing' || (e.endYear && e.endYear >= 2025));
  } else {
    // If no explicit education section, default to partial credit
    educationScore = 50;
  }

  if (!isFresherOrFinalYear && parsedResume.derived?.totalExperienceMonths > 12) {
    flags.push('NOT_FINAL_YEAR_OR_FRESHER');
    educationScore = Math.max(30, educationScore - 15);
  }

  // ───────────────────────────────────────────
  // 2. Relevant Experience (0–100)
  // ───────────────────────────────────────────
  let experienceScore = 40; // baseline for entry-level / intern
  const derived = parsedResume.derived || {};
  const isOpsRole = jdTitle.toLowerCase().includes('operations') || jdTitle.toLowerCase().includes('ops');
  const isSalesRole = jdTitle.toLowerCase().includes('bde') || jdTitle.toLowerCase().includes('sales') || jdTitle.toLowerCase().includes('marketing');

  if (isSalesRole) {
    if (derived.customerFacingMonths >= 6) {
      experienceScore = 95;
    } else if (derived.customerFacingMonths > 0) {
      experienceScore = 75;
    } else if (derived.totalExperienceMonths > 0) {
      experienceScore = 60;
    } else {
      // Fresher with no internships
      experienceScore = 45;
    }
  } else if (isOpsRole) {
    if (derived.operationsMonths >= 6) {
      experienceScore = 95;
    } else if (derived.operationsMonths > 0) {
      experienceScore = 75;
    } else if (derived.totalExperienceMonths > 0) {
      experienceScore = 60;
    } else {
      experienceScore = 45;
    }
  }

  if (derived.overExperiencedForIntern) {
    flags.push('OVER_EXPERIENCED_FOR_INTERN');
  }

  // ───────────────────────────────────────────
  // 3. Role Skills (0–100)
  // ───────────────────────────────────────────
  const mustHaves = reqs.must_have || [];
  const niceToHaves = reqs.nice_to_have || [];
  const skillsList = parsedResume.skills?.normalised || [];

  let matchedMustCount = 0;
  let matchedNiceCount = 0;

  for (const mh of mustHaves) {
    const skillNorm = mh.skill.toLowerCase();
    // Check if skill is in experience/leadership bullets (high evidence) or skills section
    let evidenceSnippet = '';
    let strength = 'medium';

    if (expLower.includes(skillNorm) || leadLower.includes(skillNorm)) {
      strength = 'high';
      evidenceSnippet = `Demonstrated in practical experience / leadership`;
      matchedMustCount++;
      matchedRequirements.push({
        skill: mh.skill,
        category: mh.category || 'must_have',
        evidence: evidenceSnippet,
        strength
      });
    } else if (skillsList.some(s => s.toLowerCase().includes(skillNorm)) || rawTextLower.includes(skillNorm)) {
      strength = 'medium';
      evidenceSnippet = `Found in skills profile / resume text`;
      matchedMustCount++;
      matchedRequirements.push({
        skill: mh.skill,
        category: mh.category || 'must_have',
        evidence: evidenceSnippet,
        strength
      });
    } else {
      missingMustHaves.push({
        skill: mh.skill,
        category: mh.category || 'must_have'
      });
    }
  }

  for (const nh of niceToHaves) {
    const skillNorm = nh.skill.toLowerCase();
    if (expLower.includes(skillNorm) || leadLower.includes(skillNorm)) {
      matchedNiceCount++;
      matchedRequirements.push({
        skill: nh.skill,
        category: nh.category || 'nice_to_have',
        evidence: `Demonstrated in practical experience`,
        strength: 'high'
      });
    } else if (skillsList.some(s => s.toLowerCase().includes(skillNorm)) || rawTextLower.includes(skillNorm)) {
      matchedNiceCount++;
      matchedRequirements.push({
        skill: nh.skill,
        category: nh.category || 'nice_to_have',
        evidence: `Listed in skills section`,
        strength: 'medium'
      });
    }
  }

  const mustShare = mustHaves.length > 0 ? (matchedMustCount / mustHaves.length) : 1;
  const niceShare = niceToHaves.length > 0 ? (matchedNiceCount / niceToHaves.length) : 1;
  const roleSkillsScore = Math.round((mustShare * 70) + (niceShare * 30));

  // ───────────────────────────────────────────
  // 4. Communication & Leadership Evidence (0–100)
  // ───────────────────────────────────────────
  const leadershipItems = Array.isArray(parsedResume.leadership) ? parsedResume.leadership : [];
  let commScore = 40; // baseline

  if (leadershipItems.length >= 3) {
    commScore = 95;
  } else if (leadershipItems.length === 2) {
    commScore = 80;
  } else if (leadershipItems.length === 1) {
    commScore = 65;
  } else if (rawTextLower.includes('presentation') || rawTextLower.includes('debate') || rawTextLower.includes('event')) {
    commScore = 55;
  }

  // ───────────────────────────────────────────
  // 5. Semantic Relevance (0–100)
  // ───────────────────────────────────────────
  // Measure keyword & responsibility overlap against JD core
  const jdKeywords = (reqs.core || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4);

  let semanticMatches = 0;
  for (const kw of jdKeywords) {
    if (rawTextLower.includes(kw)) semanticMatches++;
  }
  const semanticRatio = jdKeywords.length > 0 ? (semanticMatches / jdKeywords.length) : 0.5;
  const semanticRelevanceScore = Math.min(100, Math.round(30 + (semanticRatio * 70)));

  // ───────────────────────────────────────────
  // 6. Career-Interest Alignment (0–100)
  // ───────────────────────────────────────────
  let careerInterestScore = 60; // neutral default
  const technicalKeywords = ['software engineer', 'full stack', 'developer', 'python developer', 'react developer', 'java developer', 'data analyst', 'machine learning'];
  const isTechProfile = technicalKeywords.some(tk => summaryLower.includes(tk) || expLower.includes(tk));

  if (isTechProfile) {
    flags.push('TECHNICAL_PROFILE');
    careerInterestScore = 35; // Lower alignment for purely technical developer objectives
  }

  if (isSalesRole && (summaryLower.includes('sales') || summaryLower.includes('marketing') || summaryLower.includes('business development') || summaryLower.includes('bde'))) {
    careerInterestScore = 95;
  } else if (isOpsRole && (summaryLower.includes('operations') || summaryLower.includes('process') || summaryLower.includes('coordination') || summaryLower.includes('logistics'))) {
    careerInterestScore = 95;
  }

  // ───────────────────────────────────────────
  // Overall Weighted Score
  // ───────────────────────────────────────────
  const subScores = {
    educationFit: educationScore,
    experienceFit: experienceScore,
    roleSkills: roleSkillsScore,
    communicationLeadership: commScore,
    semanticRelevance: semanticRelevanceScore,
    careerInterest: careerInterestScore
  };

  const totalWeight =
    (weights.education || 15) +
    (weights.experience || 25) +
    (weights.skills || 25) +
    (weights.communicationLeadership || 15) +
    (weights.semantic || 10) +
    (weights.careerInterest || 10);

  const weightedSum =
    (educationScore * (weights.education || 15)) +
    (experienceScore * (weights.experience || 25)) +
    (roleSkillsScore * (weights.skills || 25)) +
    (commScore * (weights.communicationLeadership || 15)) +
    (semanticRelevanceScore * (weights.semantic || 10)) +
    (careerInterestScore * (weights.careerInterest || 10));

  const overall = Math.min(100, Math.max(0, Math.round(weightedSum / Math.max(1, totalWeight))));
  const ratingOutOf10 = parseFloat((overall / 10).toFixed(1));

  let band = 'Weak';
  if (overall >= 80) band = 'Strong';
  else if (overall >= 65) band = 'Good';
  else if (overall >= 50) band = 'Partial';

  // Plain-English explanation
  const mustHaveStatus = missingMustHaves.length === 0
    ? 'All core must-have competencies matched.'
    : `Missing ${missingMustHaves.length} must-have signal(s): ${missingMustHaves.map(m => m.skill).join(', ')}.`;

  const explanation = `${band} fit (${overall}/100) for ${jdTitle}. Education score: ${educationScore}/100 (${hasBusinessDegree ? 'Business degree' : 'Non-business / partial credit'}). ${mustHaveStatus} Demonstrated ${leadershipItems.length} leadership / communication signal(s).`;

  return {
    overall,
    ratingOutOf10,
    band,
    subScores,
    matchedRequirements,
    missingMustHaves,
    flags,
    explanation
  };
}

/**
 * Evaluates a candidate across ALL active JDs (primary + cross-role fit).
 *
 * @param {object} parsedResume
 * @param {string} primaryJdId
 * @param {string} [orgId='defaultOrg']
 * @returns {Promise<{
 *   primaryScore: object,
 *   allScores: Array<{ jdId: string, jdTitle: string, isPrimary: boolean, score: object }>,
 *   bestFitRole: { jdId: string, jdTitle: string, scoreDiff: number } | null
 * }>}
 */
async function scoreAllRoles(parsedResume, primaryJdId, orgId = 'defaultOrg') {
  const { getCachedActiveJds } = require('./roleResolver');
  const activeJds = await getCachedActiveJds(orgId);

  const allScores = [];
  let primaryScore = null;

  for (const jd of activeJds) {
    if (jd.versions.length === 0) continue;
    const version = jd.versions[0];
    const scoreResult = scoreResumeAgainstJd(parsedResume, version, jd.title);
    const isPrimary = jd.id === primaryJdId;

    const entry = {
      jdId: jd.id,
      jdTitle: jd.title,
      jdVersionId: version.id,
      isPrimary,
      ...scoreResult
    };

    allScores.push(entry);
    if (isPrimary) primaryScore = entry;
  }

  // Fallback if primary wasn't in activeJds
  if (!primaryScore && allScores.length > 0) {
    primaryScore = allScores[0];
  }

  // Cross-role "Best-fit role": highlight if another JD scores >= 10 points higher
  let bestFitRole = null;
  if (primaryScore) {
    for (const other of allScores) {
      if (other.jdId !== primaryScore.jdId && other.overall >= primaryScore.overall + 10) {
        if (!bestFitRole || other.overall > bestFitRole.overall) {
          bestFitRole = {
            jdId: other.jdId,
            jdTitle: other.jdTitle,
            overall: other.overall,
            scoreDiff: other.overall - primaryScore.overall
          };
        }
      }
    }
  }

  return {
    primaryScore,
    allScores,
    bestFitRole
  };
}

module.exports = {
  scoreResumeAgainstJd,
  scoreAllRoles
};
