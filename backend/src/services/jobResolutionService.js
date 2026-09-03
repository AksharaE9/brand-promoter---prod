'use strict';

const prisma = require('../config/db');

const DEFAULT_FUZZY_THRESHOLD = 0.90;
const MAX_AUTO_CREATE_JOBS_PER_IMPORT = 20;

/**
 * Calculates Levenshtein Distance between two strings.
 */
function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Calculates normalized Levenshtein Similarity (0.0 to 1.0).
 */
function levenshteinSimilarity(a, b) {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Normalizes job title for comparison:
 * - Lowercases and trims
 * - Replaces & with 'and'
 * - Standardizes common abbreviations (Sr./Senior, Jr./Junior, Dev/Developer, Intern/Internship, Ops/Operations, etc.)
 * - Strips punctuation and collapses whitespace
 */
function normalizeJobTitle(title) {
  let s = String(title || '').toLowerCase().trim();
  if (!s) return '';
  s = s.replace(/&/g, 'and');
  s = s.replace(/\b(sr|sr\.)\b/g, 'senior');
  s = s.replace(/\b(jr|jr\.)\b/g, 'junior');
  s = s.replace(/\b(dev|devs)\b/g, 'developer');
  s = s.replace(/\binternship\b/g, 'intern');
  s = s.replace(/\bops\b/g, 'operations');
  s = s.replace(/\bbde\b/g, 'business development executive');
  s = s.replace(/\bba\b/g, 'business analyst');
  s = s.replace(/\bhr\b/g, 'human resources');
  s = s.replace(/\bsme\b/g, 'subject matter expert');
  s = s.replace(/\btelesales\b/g, 'tele sales');
  s = s.replace(/[\/\-_.,()\s]+/g, ' ').trim();
  return s;
}

/**
 * Checks if a string is a blank or nonsense title.
 */
function isInvalidJobTitle(title) {
  const clean = String(title || '').trim().toLowerCase();
  if (!clean) return true;
  const nonsense = ['-', '--', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'etc', 'job'];
  return nonsense.includes(clean);
}

/**
 * Job Resolution Session class for managing job matching and auto-creation during a bulk import session.
 */
class JobResolutionSession {
  constructor(organizationId, createdById, options = {}) {
    this.organizationId = organizationId || 'defaultOrg';
    this.createdById = createdById || null;
    this.fuzzyThreshold = options.threshold || DEFAULT_FUZZY_THRESHOLD;
    this.maxAutoCreate = options.maxAutoCreate || MAX_AUTO_CREATE_JOBS_PER_IMPORT;
    
    this.activeJobs = [];
    this.autoCreatedJobsMap = new Map(); // normalizedTitle -> Job
    this.autoCreatedCount = 0;
    this.fuzzyMatches = []; // audit log of fuzzy matches applied
    this.autoCreatedList = []; // audit log of jobs created
    this.initialized = false;
  }

  /**
   * Initializes session by fetching existing active jobs for the organization.
   */
  async init() {
    this.activeJobs = await prisma.job.findMany({
      where: {
        organizationId: this.organizationId,
        isActive: true,
      },
    });
    this.initialized = true;
  }

  /**
   * Resolves a job title by exact, normalized, or fuzzy match.
   * If no match found, auto-creates the job posting (subject to safeguards).
   *
   * @param {string} rawTitle - Job title from import row
   * @param {string} [location] - Location from import row (optional)
   * @returns {Promise<{ job: object|null, matchType: string, similarity?: number, error?: string }>}
   */
  async resolveOrAutoCreate(rawTitle, location = null) {
    if (!this.initialized) {
      await this.init();
    }

    const trimmedTitle = String(rawTitle || '').trim();
    if (isInvalidJobTitle(trimmedTitle)) {
      return { job: null, matchType: 'INVALID_TITLE', error: `Invalid or blank job title "${rawTitle || ''}"` };
    }

    const normQuery = normalizeJobTitle(trimmedTitle);

    // Check if job was already auto-created in this session (Deduplication within single import)
    if (this.autoCreatedJobsMap.has(normQuery)) {
      const job = this.autoCreatedJobsMap.get(normQuery);
      return { job, matchType: 'SESSION_AUTO_CREATED', similarity: 1.0 };
    }

    // Level 1: Exact match (case-insensitive, trimmed)
    const exactMatch = this.activeJobs.find(j => String(j.title).trim().toLowerCase() === trimmedTitle.toLowerCase());
    if (exactMatch) {
      return { job: exactMatch, matchType: 'EXACT_MATCH', similarity: 1.0 };
    }

    // Level 2: Normalised match
    const normMatch = this.activeJobs.find(j => normalizeJobTitle(j.title) === normQuery);
    if (normMatch) {
      return { job: normMatch, matchType: 'NORMALISED_MATCH', similarity: 1.0 };
    }

    // Level 3: Fuzzy match
    let bestMatch = null;
    let bestSim = 0;

    for (const job of this.activeJobs) {
      const normJobTitle = normalizeJobTitle(job.title);
      const sim = levenshteinSimilarity(normQuery, normJobTitle);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = job;
      }
    }

    if (bestMatch && bestSim >= this.fuzzyThreshold) {
      const matchInfo = {
        job: bestMatch,
        matchType: 'FUZZY_MATCH',
        similarity: Math.round(bestSim * 100) / 100,
        matchedTitle: bestMatch.title,
        originalQuery: trimmedTitle,
      };
      this.fuzzyMatches.push(matchInfo);
      return matchInfo;
    }

    // No match found — Auto-create new Job Posting
    if (this.autoCreatedCount >= this.maxAutoCreate) {
      return {
        job: null,
        matchType: 'CAP_EXCEEDED',
        error: `Import exceeded maximum allowed auto-created jobs limit (${this.maxAutoCreate}). Please check your column mapping or create the job manually first.`,
      };
    }

    const formattedLocation = location && String(location).trim() ? String(location).trim() : null;

    // Validate createdById FK
    let validCreatedById = null;
    if (this.createdById) {
      try {
        const u = await prisma.user.findUnique({ where: { id: this.createdById }, select: { id: true } });
        if (u) validCreatedById = u.id;
      } catch (_) {}
    }

    // Create job posting in DB
    const newJob = await prisma.job.create({
      data: {
        title: trimmedTitle,
        location: formattedLocation,
        organizationId: this.organizationId,
        createdById: validCreatedById,
        source: 'BULK_IMPORT_AUTO',
        isActive: true,
      },
    });

    this.autoCreatedCount++;
    this.activeJobs.push(newJob);
    this.autoCreatedJobsMap.set(normQuery, newJob);
    this.autoCreatedList.push({ title: newJob.title, location: newJob.location || 'N/A', id: newJob.id });

    return {
      job: newJob,
      matchType: 'AUTO_CREATED',
      similarity: 1.0,
      isNew: true,
    };
  }

  /**
   * Returns audit summary of resolution session.
   */
  getSummary() {
    return {
      autoCreatedCount: this.autoCreatedCount,
      autoCreatedJobs: this.autoCreatedList,
      fuzzyMatches: this.fuzzyMatches,
    };
  }
}

module.exports = {
  JobResolutionSession,
  normalizeJobTitle,
  levenshteinSimilarity,
  DEFAULT_FUZZY_THRESHOLD,
  MAX_AUTO_CREATE_JOBS_PER_IMPORT,
};
