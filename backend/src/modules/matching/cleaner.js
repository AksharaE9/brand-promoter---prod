'use strict';

/**
 * cleaner.js
 * Normalizes Unicode, ligatures, bullets, hyphenation, and segments resume into sections.
 */

const SECTION_HEADERS = {
  summary: [
    /^(career\s+)?objective$/i,
    /^summary(\s+of\s+qualifications)?$/i,
    /^professional\s+summary$/i,
    /^profile$/i,
    /^about(\s+me)?$/i
  ],
  education: [
    /^education(al\s+qualifications|al\s+background)?$/i,
    /^academic(s|al)?(\s+qualifications|\s+details|\s+background)?$/i,
    /^qualifications$/i
  ],
  experience: [
    /^(work\s+)?experience$/i,
    /^employment(\s+history)?$/i,
    /^internships?(\s+experience)?$/i,
    /^professional\s+experience$/i,
    /^work\s+history$/i
  ],
  projects: [
    /^projects?(\s+undertaken)?$/i,
    /^academic\s+projects?$/i,
    /^key\s+projects?$/i
  ],
  skills: [
    /^skills?(\s+and\s+competencies|\s+and\s+abilities)?$/i,
    /^technical\s+skills?$/i,
    /^core\s+competencies$/i,
    /^areas\s+of\s+expertise$/i,
    /^key\s+skills?$/i
  ],
  leadership: [
    /^leadership(\s+roles?|\s+experience)?$/i,
    /^positions?\s+of\s+responsibility$/i,
    /^extra-?curricular(\s+activities)?$/i,
    /^co-?curricular(\s+activities)?$/i,
    /^clubs?(\s+and\s+committees)?$/i,
    /^volunteer(ing)?(\s+work|\s+experience)?$/i,
    /^activities$/i
  ],
  achievements: [
    /^achievements?(\s+and\s+awards)?$/i,
    /^awards?(\s+and\s+recognitions?)?$/i,
    /^honors?(\s+and\s+awards)?$/i,
    /^certifications?(\s+and\s+courses)?$/i,
    /^licenses?\s+&\s+certifications?$/i
  ],
  languages: [
    /^languages?(\s+known)?$/i
  ]
};

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // Replace common Unicode ligatures
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    // Standardize bullets
    .replace(/[\u2022\u2023\u25E6\u2043\u2219\u25CF\u25CB\u25AA\u25AB\u25BA\u2714\u2713]/g, '\n- ')
    // Em dash, en dash
    .replace(/[\u2013\u2014]/g, '-')
    // Curved quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Line-end hyphenation (e.g. coordi-\nnation -> coordination)
    .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
    // Multiple spaces
    .replace(/[ \t]+/g, ' ')
    // Clean up carriage returns
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Segments normalized resume text into structured sections.
 *
 * @param {string} rawText
 * @returns {{
 *   rawText: string,
 *   sections: {
 *     header: string,
 *     summary: string,
 *     education: string,
 *     experience: string,
 *     projects: string,
 *     skills: string,
 *     leadership: string,
 *     achievements: string,
 *     languages: string,
 *     other: string
 *   }
 * }}
 */
function segmentResume(rawText) {
  const clean = normalizeText(rawText);
  const lines = clean.split('\n');

  const sections = {
    header: '',
    summary: '',
    education: '',
    experience: '',
    projects: '',
    skills: '',
    leadership: '',
    achievements: '',
    languages: '',
    other: ''
  };

  let currentSection = 'header';
  const sectionContent = {
    header: [],
    summary: [],
    education: [],
    experience: [],
    projects: [],
    skills: [],
    leadership: [],
    achievements: [],
    languages: [],
    other: []
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line looks like a section header (usually <= 4 words, no terminal punctuation)
    const lineWords = line.split(/\s+/);
    if (lineWords.length <= 5 && !/[.?!,;]$/.test(line)) {
      const cleanHeader = line.replace(/^[-*#:•\d.]+\s*/, '').trim();

      let detectedSection = null;
      for (const [secKey, patterns] of Object.entries(SECTION_HEADERS)) {
        if (patterns.some(p => p.test(cleanHeader))) {
          detectedSection = secKey;
          break;
        }
      }

      if (detectedSection) {
        currentSection = detectedSection;
        continue;
      }
    }

    sectionContent[currentSection].push(line);
  }

  for (const [key, linesArr] of Object.entries(sectionContent)) {
    sections[key] = linesArr.join('\n');
  }

  return {
    rawText: clean,
    sections
  };
}

module.exports = {
  normalizeText,
  segmentResume
};
