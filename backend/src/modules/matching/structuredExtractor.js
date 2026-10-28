'use strict';

const { normalizeText, segmentResume } = require('./cleaner');
const prisma = require('../../config/db');

let cachedTaxonomies = null;
let taxonomiesFetchedAt = 0;
async function getCachedTaxonomies() {
  if (cachedTaxonomies && (Date.now() - taxonomiesFetchedAt) < 60000) {
    return cachedTaxonomies;
  }
  cachedTaxonomies = await prisma.skillsTaxonomy.findMany();
  taxonomiesFetchedAt = Date.now();
  return cachedTaxonomies;
}

// Indian phone regex: +91, 0, or raw 10 digits starting with 6-9
const INDIAN_PHONE_REGEX = /(?:(?:\+91|91|0)[\s-]?)?([6-9]\d{4}[\s-]?\d{5})\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const LINKEDIN_REGEX = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|profile)\/([a-zA-Z0-9_-]+)/gi;
const GITHUB_REGEX = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)/gi;
const CGPA_REGEX = /\b(?:cgpa|gpa|percentage|aggregate)[\s:]*([0-9]{1,2}(?:\.[0-9]{1,2})?)(?:\s*(?:\/|out of)\s*10|%|\b)/gi;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/g;
const GRAD_RANGE_REGEX = /\b(20\d{2})\s*(?:-|–|to)\s*(20\d{2}|present|ongoing|current)\b/gi;

const DEGREE_PATTERNS = [
  { key: 'MBA', regex: /\b(mba|m\.b\.a|master of business administration)\b/i, isBusiness: true },
  { key: 'BBA', regex: /\b(bba|b\.b\.a|bachelor of business administration)\b/i, isBusiness: true },
  { key: 'BCom', regex: /\b(bcom|b\.com|bachelor of commerce)\b/i, isBusiness: true },
  { key: 'MCom', regex: /\b(mcom|m\.com|master of commerce)\b/i, isBusiness: true },
  { key: 'BBM', regex: /\b(bbm|b\.b\.m|bachelor of business management)\b/i, isBusiness: true },
  { key: 'BMS', regex: /\b(bms|b\.m\.s|bachelor of management studies)\b/i, isBusiness: true },
  { key: 'BTech', regex: /\b(b\.?tech|bachelor of technology)\b/i, isBusiness: false },
  { key: 'BE', regex: /\b(b\.?e\.?|bachelor of engineering)\b/i, isBusiness: false },
  { key: 'BCA', regex: /\b(bca|b\.c\.a|bachelor of computer applications)\b/i, isBusiness: false },
  { key: 'MCA', regex: /\b(mca|m\.c\.a|master of computer applications)\b/i, isBusiness: false },
  { key: 'BSc', regex: /\b(bsc|b\.sc|bachelor of science)\b/i, isBusiness: false },
  { key: 'BA', regex: /\b(b\.a\.?|bachelor of arts)\b/i, isBusiness: false },
];

/**
 * Redacts contact details (email, phone) before text is passed externally.
 *
 * @param {string} text
 * @returns {string}
 */
function redactPii(text) {
  if (!text) return '';
  return text
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(INDIAN_PHONE_REGEX, '[PHONE_REDACTED]');
}

/**
 * Extracts structured candidate data deterministically from raw resume text.
 *
 * @param {string} rawText
 * @param {object} [options={}]
 * @returns {Promise<{
 *   contact: object,
 *   education: Array,
 *   experience: Array,
 *   projects: Array,
 *   leadership: Array,
 *   skills: { raw: string[], normalised: string[] },
 *   achievements: Array,
 *   certifications: Array,
 *   languages: Array,
 *   summary: string,
 *   derived: object,
 *   meta: object
 * }>}
 */
async function extractStructuredResume(rawText, options = {}) {
  const { rawText: cleanText, sections } = segmentResume(rawText);

  // 1. Contact Details
  const emails = [...new Set((cleanText.match(EMAIL_REGEX) || []).map(e => e.toLowerCase()))];
  const phones = [];
  let phoneMatch;
  const phoneRe = new RegExp(INDIAN_PHONE_REGEX);
  while ((phoneMatch = phoneRe.exec(cleanText)) !== null) {
    const rawDigits = phoneMatch[1].replace(/[\s-]/g, '');
    if (rawDigits.length === 10) {
      phones.push(`+91${rawDigits}`);
    }
  }
  const uniquePhones = [...new Set(phones)];

  const linkedinMatches = [...cleanText.matchAll(LINKEDIN_REGEX)].map(m => m[0]);
  const githubMatches = [...cleanText.matchAll(GITHUB_REGEX)].map(m => m[0]);

  // Extract name from header section
  let name = '';
  const headerLines = sections.header.split('\n').filter(Boolean);
  for (const line of headerLines) {
    const trimmed = line.trim();
    // Skip if line has email, phone, url, or is obviously a title/heading
    if (
      !EMAIL_REGEX.test(trimmed) &&
      !INDIAN_PHONE_REGEX.test(trimmed) &&
      !trimmed.includes('http') &&
      !trimmed.includes('@') &&
      trimmed.length >= 3 &&
      trimmed.length <= 40 &&
      /^[A-Za-z\s.'-]+$/.test(trimmed)
    ) {
      name = trimmed;
      break;
    }
  }

  // 2. Education
  const education = [];
  const eduText = sections.education || '';
  const eduLines = eduText.split('\n').filter(Boolean);

  let currentEdu = null;
  for (const deg of DEGREE_PATTERNS) {
    if (deg.regex.test(eduText) || deg.regex.test(cleanText)) {
      // Find graduation year or range
      let startYear = null;
      let endYear = null;
      let status = 'completed';

      const rangeMatch = GRAD_RANGE_REGEX.exec(eduText);
      if (rangeMatch) {
        startYear = parseInt(rangeMatch[1], 10);
        if (/present|ongoing|current/i.test(rangeMatch[2])) {
          status = 'pursuing';
          endYear = startYear + (deg.key === 'MBA' || deg.key === 'MCA' ? 2 : 3);
        } else {
          endYear = parseInt(rangeMatch[2], 10);
          if (endYear >= 2026) status = 'pursuing';
        }
      } else {
        const years = eduText.match(YEAR_REGEX) || [];
        if (years.length > 0) {
          endYear = parseInt(years[years.length - 1], 10);
          if (endYear >= 2026) status = 'pursuing';
        }
      }

      // Check for CGPA
      let score = null;
      const scoreMatch = CGPA_REGEX.exec(eduText);
      if (scoreMatch) {
        score = parseFloat(scoreMatch[1]);
      }

      education.push({
        degree: deg.key,
        degreeNormalised: deg.key,
        isBusiness: deg.isBusiness,
        field: deg.isBusiness ? 'Commerce / Management' : 'Technical / General',
        institution: '',
        startYear,
        endYear,
        expectedGraduation: endYear ? String(endYear) : null,
        status,
        score
      });
      break; // Pick primary degree
    }
  }

  // 3. Experience & Internships
  const experience = [];
  const expText = sections.experience || '';
  const expLines = expText.split('\n').filter(Boolean);

  const functionKeywords = {
    sales: ['sales', 'bde', 'client', 'revenue', 'quota', 'cold call', 'lead', 'pitch', 'closing'],
    marketing: ['marketing', 'campaign', 'promotion', 'branding', 'market research', 'social media', 'survey', 'ambassador'],
    telecalling: ['telecalling', 'telesales', 'cold calling', 'calling', 'telecaller', 'telemarketing'],
    retail: ['retail', 'shop floor', 'counter', 'store sales', 'kiosk'],
    field: ['field', 'door-to-door', 'customer visits', 'on-ground', 'fieldwork'],
    operations: ['operations', 'coordination', 'logistics', 'inventory', 'vendor', 'supply chain', 'reporting', 'process improvement', 'mis', 'excel'],
    admin: ['admin', 'documentation', 'filing', 'scheduling', 'records']
  };

  let totalCustomerFacing = false;
  let totalExperienceMonths = 0;
  let customerFacingMonths = 0;
  let operationsMonths = 0;

  if (expLines.length > 0) {
    const bullets = expLines.filter(l => l.startsWith('-') || l.length > 20);
    const assignedTags = new Set();

    for (const bullet of bullets) {
      const lower = bullet.toLowerCase();
      for (const [tag, kws] of Object.entries(functionKeywords)) {
        if (kws.some(kw => lower.includes(kw))) {
          assignedTags.add(tag);
        }
      }
    }

    const isCustFacing = ['sales', 'marketing', 'telecalling', 'retail', 'field'].some(t => assignedTags.has(t));
    if (isCustFacing) totalCustomerFacing = true;

    // Estimate duration: default ~3-6 months per distinct internship mentioned
    const internshipMatches = (expText.match(/intern(ship)?/gi) || []).length;
    const estMonths = Math.max(3, Math.min(24, Math.max(1, internshipMatches) * 3));
    totalExperienceMonths = estMonths;
    if (isCustFacing) customerFacingMonths = estMonths;
    if (assignedTags.has('operations')) operationsMonths = estMonths;

    experience.push({
      title: 'Intern / Associate',
      organisation: '',
      type: 'internship',
      customerFacing: isCustFacing,
      functionTags: Array.from(assignedTags),
      durationMonths: estMonths,
      bullets: bullets.slice(0, 10)
    });
  }

  // 4. Leadership & Extra-Curricular Signals
  const leadership = [];
  const leadText = `${sections.leadership}\n${sections.other}`;
  const leadLines = leadText.split('\n').filter(Boolean);

  const signalPatterns = [
    { name: 'Event Coordinator / Organiser', pattern: /event|fest|organis|coordinat|annual/i },
    { name: 'Presentations & Public Speaking', pattern: /present|seminar|public\s+speak|conference/i },
    { name: 'Club / Committee Member', pattern: /club|committee|core\s+team|student\s+body|representative/i },
    { name: 'Debate / MUN / Elocution', pattern: /debate|mun|model\s+united|elocution|oratory/i },
    { name: 'Volunteering & Social Outreach', pattern: /volunteer|social|ngo|fundrais|sponsorship/i },
    { name: 'Team Lead / Class Representative', pattern: /lead|class\s+rep|cr|head|mentor/i }
  ];

  for (const sig of signalPatterns) {
    const matchingBullets = leadLines.filter(l => sig.pattern.test(l));
    if (matchingBullets.length > 0) {
      leadership.push({
        role: sig.name,
        evidence: matchingBullets.slice(0, 3).map(b => b.replace(/^[-*•\s]+/, '').trim())
      });
    }
  }

  // 5. Skills Taxonomy Mapping (cached for 60s)
  const taxonomies = await getCachedTaxonomies();
  const matchedTaxonomyTerms = [];
  const rawSkillsFound = [];

  const combinedSearchText = cleanText.toLowerCase();

  for (const tax of taxonomies) {
    const synonyms = Array.isArray(tax.synonyms) ? tax.synonyms : [];
    const allTerms = [tax.term.toLowerCase(), tax.normalizedTerm, ...synonyms.map(s => s.toLowerCase())];

    for (const term of allTerms) {
      if (term.length >= 3 && combinedSearchText.includes(term)) {
        matchedTaxonomyTerms.push(tax.term);
        rawSkillsFound.push(term);
        break;
      }
    }
  }

  // 6. Summary / Objective
  const summary = (sections.summary || sections.header || '').split('\n').slice(0, 5).join(' ').trim();

  // 7. Derived Metrics
  const currentYear = 2026;
  const isFinalYearOrFresher = education.some(e => e.status === 'pursuing' || (e.endYear && e.endYear >= currentYear - 1));
  const overExperiencedForIntern = totalExperienceMonths > 24;

  const derived = {
    totalExperienceMonths,
    customerFacingMonths,
    operationsMonths,
    internshipCount: experience.length,
    isFinalYearOrFresher,
    overExperiencedForIntern
  };

  const meta = {
    pages: options.pages || 1,
    extractionPath: options.extractionPath || 'text',
    textChars: cleanText.length,
    parserVersion: '1.0.0',
    warnings: options.warnings || []
  };

  return {
    contact: {
      name: name || options.defaultName || '',
      emails: emails.length > 0 ? emails : (options.defaultEmail ? [options.defaultEmail] : []),
      phones: uniquePhones.length > 0 ? uniquePhones : (options.defaultPhone ? [options.defaultPhone] : []),
      linkedin: linkedinMatches[0] || null,
      github: githubMatches[0] || null,
      portfolio: null
    },
    education,
    experience,
    projects: [],
    leadership,
    skills: {
      raw: [...new Set(rawSkillsFound)],
      normalised: [...new Set(matchedTaxonomyTerms)]
    },
    achievements: [],
    certifications: [],
    languages: [],
    summary: summary.slice(0, 500),
    derived,
    meta,
    rawText: cleanText
  };
}

module.exports = {
  extractStructuredResume,
  redactPii
};
