'use strict';

const crypto = require('crypto');
const prisma = require('../../config/db');
const { resolveCandidateRole } = require('./roleResolver');
const { extractResumeText } = require('./textExtractor');
const { extractStructuredResume } = require('./structuredExtractor');
const { scoreAllRoles } = require('./scorer');

const CONCURRENCY = parseInt(process.env.PARSER_CONCURRENCY || '2', 10);
const JOB_TIMEOUT_MS = 90000; // 90 seconds
const MAX_ATTEMPTS = 3;
const RSS_MEMORY_CAP_BYTES = 400 * 1024 * 1024; // 400MB memory guard

let isWorkerRunning = false;
let activeJobCount = 0;
let workerInterval = null;

function isFeatureEnabled() {
  return process.env.RESUME_PARSING_ENABLED === 'true';
}

/**
 * Enqueues a parse job for a candidate if their role resolves to an active JD.
 *
 * @param {{ candidateId: string, fileMetaId?: string, force?: boolean }} params
 * @returns {Promise<object>} The created or existing ResumeParseJob record
 */
async function enqueueParseJob({ candidateId, fileMetaId, force = false }) {
  if (!isFeatureEnabled() && !force) {
    return { status: 'DISABLED', message: 'RESUME_PARSING_ENABLED is false' };
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      applications: { include: { job: true } },
      resumeFile: true
    }
  });

  if (!candidate || candidate.isDeleted) {
    return { status: 'SKIPPED', message: 'Candidate not found or deleted' };
  }

  // 1. Role Resolution Check
  const resolution = await resolveCandidateRole(candidate, candidate.organizationId);
  if (resolution.status === 'EXCLUDED' || resolution.status === 'SKIPPED_NO_JD') {
    // Record skipped status without enqueuing heavy job
    const job = await prisma.resumeParseJob.create({
      data: {
        candidateId,
        fileMetaId: fileMetaId || candidate.resumeFileId,
        status: resolution.status,
        lastError: resolution.reason,
        completedAt: new Date()
      }
    });
    return job;
  }

  const effectiveFileMetaId = fileMetaId || candidate.resumeFileId;
  if (!effectiveFileMetaId) {
    const job = await prisma.resumeParseJob.create({
      data: {
        candidateId,
        status: 'UNSUPPORTED_FORMAT',
        lastError: 'No resume file attached to candidate',
        completedAt: new Date()
      }
    });
    return job;
  }

  // Idempotency key: candidateId + fileMetaId + jdVersion
  const jdVersionId = resolution.jdVersion?.id || 'v1';
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${candidateId}:${effectiveFileMetaId}:${jdVersionId}:1.0.0`)
    .digest('hex');

  // Check if job with this idempotency key already completed
  const existingJob = await prisma.resumeParseJob.findUnique({
    where: { idempotencyKey }
  });

  if (existingJob && !force) {
    if (existingJob.status === 'COMPLETED' || existingJob.status === 'RUNNING') {
      return existingJob;
    }
  }

  const job = await prisma.resumeParseJob.upsert({
    where: { idempotencyKey },
    create: {
      candidateId,
      fileMetaId: effectiveFileMetaId,
      idempotencyKey,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS
    },
    update: {
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
      updatedAt: new Date()
    }
  });

  // Trigger worker tick non-blockingly
  setImmediate(() => processNextJobs());

  return job;
}

/**
 * Worker tick: pulls up to CONCURRENCY jobs and executes them.
 */
async function processNextJobs() {
  if (!isWorkerRunning) return;
  if (activeJobCount >= CONCURRENCY) return;

  // Memory guard: if RSS exceeds 400MB, pause pulling new jobs
  const rss = process.memoryUsage().rss;
  if (rss > RSS_MEMORY_CAP_BYTES) {
    console.warn(`[ParseWorker] RSS memory (${(rss / 1024 / 1024).toFixed(1)}MB) exceeds 400MB threshold. Pausing worker tick.`);
    return;
  }

  const availableSlots = CONCURRENCY - activeJobCount;
  if (availableSlots <= 0) return;

  // Claim next queued jobs
  const jobsToProcess = await prisma.resumeParseJob.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: availableSlots
  });

  for (const job of jobsToProcess) {
    activeJobCount++;
    executeJob(job.id).finally(() => {
      activeJobCount = Math.max(0, activeJobCount - 1);
      setImmediate(() => processNextJobs());
    });
  }
}

/**
 * Executes a single parse job.
 *
 * @param {string} jobId
 */
async function executeJob(jobId) {
  const startTime = Date.now();

  const job = await prisma.resumeParseJob.findUnique({
    where: { id: jobId },
    include: {
      candidate: {
        include: {
          applications: { include: { job: true } },
          resumeFile: true
        }
      }
    }
  });

  if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') return;

  // Mark RUNNING
  await prisma.resumeParseJob.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      attempts: { increment: 1 },
      startedAt: new Date()
    }
  });

  try {
    const candidate = job.candidate;
    if (!candidate) throw new Error('Candidate not found');

    // 1. Resolve Role to JD
    const resolution = await resolveCandidateRole(candidate, candidate.organizationId);
    if (resolution.status === 'EXCLUDED' || resolution.status === 'SKIPPED_NO_JD') {
      await prisma.resumeParseJob.update({
        where: { id: jobId },
        data: {
          status: resolution.status,
          lastError: resolution.reason,
          durationMs: Date.now() - startTime,
          completedAt: new Date()
        }
      });
      return;
    }

    // 2. Fetch File from PostgreSQL FileMeta
    const fileMetaId = job.fileMetaId || candidate.resumeFileId;
    if (!fileMetaId) {
      await prisma.resumeParseJob.update({
        where: { id: jobId },
        data: {
          status: 'UNSUPPORTED_FORMAT',
          lastError: 'No resumeFileId present on candidate',
          durationMs: Date.now() - startTime,
          completedAt: new Date()
        }
      });
      return;
    }

    const fileMeta = await prisma.fileMeta.findUnique({
      where: { id: fileMetaId }
    });

    if (!fileMeta || !fileMeta.fileData || fileMeta.fileData.length === 0) {
      await prisma.resumeParseJob.update({
        where: { id: jobId },
        data: {
          status: 'UNSUPPORTED_FORMAT',
          lastError: `File data not found in FileMeta [${fileMetaId}]`,
          durationMs: Date.now() - startTime,
          completedAt: new Date()
        }
      });
      return;
    }

    // 3. Extract Text from PDF / DOCX
    const fileBuffer = Buffer.isBuffer(fileMeta.fileData) ? fileMeta.fileData : Buffer.from(fileMeta.fileData);
    const extractResult = await extractResumeText(fileBuffer, fileMeta.originalName);
    if (!extractResult.success) {
      const isUnsupported = extractResult.extractionPath === 'unsupported' || (extractResult.error && extractResult.error.includes('Unsupported')) || (extractResult.error && extractResult.error.includes('Legacy .doc'));
      
      // Part 2.2: Write parsed_resumes with extraction_status = 'unsupported_format' and errorMessage
      await prisma.parsedResume.upsert({
        where: { candidateId: candidate.id },
        create: {
          candidateId: candidate.id,
          fileMetaId: fileMeta.id,
          fileHash: extractResult.sha256 || 'unsupported',
          parserVersion: '1.0.0',
          contact: { name: candidate.fullName, emails: candidate.email !== 'N/A' ? [candidate.email] : [], phones: candidate.phone ? [candidate.phone] : [] },
          education: [],
          experience: [],
          projects: [],
          leadership: [],
          skills: { raw: [], normalised: [] },
          achievements: [],
          certifications: [],
          languages: [],
          summary: '',
          derived: { totalExperienceMonths: 0, highestDegree: null, graduationYear: null },
          meta: { extraction_status: 'unsupported_format', errorMessage: extractResult.error },
          rawText: ''
        },
        update: {
          fileMetaId: fileMeta.id,
          fileHash: extractResult.sha256 || 'unsupported',
          meta: { extraction_status: 'unsupported_format', errorMessage: extractResult.error },
          updatedAt: new Date()
        }
      });

      // Terminal failure in resume_parse_jobs
      await prisma.resumeParseJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          attempts: MAX_ATTEMPTS,
          lastError: extractResult.error || 'Unsupported file format',
          durationMs: Date.now() - startTime,
          completedAt: new Date()
        }
      });
      return;
    }

    // 4. Structured Extraction
    const structured = await extractStructuredResume(extractResult.text, {
      defaultName: candidate.fullName,
      defaultEmail: candidate.email !== 'N/A' ? candidate.email : undefined,
      defaultPhone: candidate.phone || undefined,
      pages: extractResult.pages,
      extractionPath: extractResult.extractionPath,
      warnings: extractResult.warnings
    });

    // 5. Store ParsedResume row
    await prisma.parsedResume.upsert({
      where: { candidateId: candidate.id },
      create: {
        candidateId: candidate.id,
        fileMetaId: fileMeta.id,
        fileHash: extractResult.sha256,
        parserVersion: '1.0.0',
        contact: structured.contact,
        education: structured.education,
        experience: structured.experience,
        projects: structured.projects,
        leadership: structured.leadership,
        skills: structured.skills,
        achievements: structured.achievements,
        certifications: structured.certifications,
        languages: structured.languages,
        summary: structured.summary,
        derived: structured.derived,
        meta: structured.meta,
        rawText: structured.rawText
      },
      update: {
        fileMetaId: fileMeta.id,
        fileHash: extractResult.sha256,
        parserVersion: '1.0.0',
        contact: structured.contact,
        education: structured.education,
        experience: structured.experience,
        projects: structured.projects,
        leadership: structured.leadership,
        skills: structured.skills,
        achievements: structured.achievements,
        certifications: structured.certifications,
        languages: structured.languages,
        summary: structured.summary,
        derived: structured.derived,
        meta: structured.meta,
        rawText: structured.rawText,
        updatedAt: new Date()
      }
    });

    // 6. Score against Primary JD + Cross-role fit across the other active JDs
    const scoring = await scoreAllRoles(structured, resolution.jd.id, candidate.organizationId);

    // 7. Store MatchScore rows
    for (const s of scoring.allScores) {
      await prisma.matchScore.upsert({
        where: {
          candidateId_jdId_jdVersionId: {
            candidateId: candidate.id,
            jdId: s.jdId,
            jdVersionId: s.jdVersionId
          }
        },
        create: {
          candidateId: candidate.id,
          jdId: s.jdId,
          jdVersionId: s.jdVersionId,
          parserVersion: '1.0.0',
          scorerVersion: '1.0.0',
          overall: s.overall,
          ratingOutOf10: s.ratingOutOf10,
          band: s.band,
          subScores: s.subScores,
          matchedRequirements: s.matchedRequirements,
          missingMustHaves: s.missingMustHaves,
          flags: s.flags,
          explanation: s.explanation,
          isPrimary: s.isPrimary,
          computedAt: new Date()
        },
        update: {
          parserVersion: '1.0.0',
          scorerVersion: '1.0.0',
          overall: s.overall,
          ratingOutOf10: s.ratingOutOf10,
          band: s.band,
          subScores: s.subScores,
          matchedRequirements: s.matchedRequirements,
          missingMustHaves: s.missingMustHaves,
          flags: s.flags,
          explanation: s.explanation,
          isPrimary: s.isPrimary,
          computedAt: new Date()
        }
      });
    }

    // 8. Mark Job COMPLETED
    await prisma.resumeParseJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        lastError: null,
        durationMs: Date.now() - startTime,
        completedAt: new Date()
      }
    });
  } catch (err) {
    const isTerminal = (job.attempts + 1) >= MAX_ATTEMPTS;
    await prisma.resumeParseJob.update({
      where: { id: jobId },
      data: {
        status: isTerminal ? 'FAILED' : 'QUEUED',
        lastError: err.message,
        durationMs: Date.now() - startTime,
        completedAt: isTerminal ? new Date() : null
      }
    });
    console.error(`[ParseWorker] Job ${jobId} error (attempt ${job.attempts + 1}/${MAX_ATTEMPTS}):`, err.message);
  }
}

/**
 * Crash Recovery Reaper: re-queues abandoned RUNNING jobs at a capped rate (5 per minute).
 */
async function reapAbandonedJobs() {
  const staleThreshold = new Date(Date.now() - JOB_TIMEOUT_MS);
  const staleJobs = await prisma.resumeParseJob.findMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: staleThreshold }
    },
    take: 5
  });

  for (const job of staleJobs) {
    if (job.attempts >= MAX_ATTEMPTS) {
      await prisma.resumeParseJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          lastError: 'Job timed out and exceeded max attempts',
          completedAt: new Date()
        }
      });
    } else {
      await prisma.resumeParseJob.update({
        where: { id: job.id },
        data: {
          status: 'QUEUED',
          lastError: 'Job recovered after system restart or timeout'
        }
      });
    }
  }
}

/**
 * Starts the background worker loop.
 */
function startParseWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  console.log(`[ParseWorker] Started background worker (concurrency: ${CONCURRENCY})`);

  // Initial reaper run
  reapAbandonedJobs().catch(err => console.error('[ParseWorker] Reaper error:', err.message));

  // Run periodic loop every 3 seconds
  workerInterval = setInterval(() => {
    processNextJobs().catch(err => console.error('[ParseWorker] Loop error:', err.message));
    // Run reaper every 60 seconds
    if (Date.now() % 60000 < 3500) {
      reapAbandonedJobs().catch(err => console.error('[ParseWorker] Reaper error:', err.message));
    }
  }, 3000);
}

function stopParseWorker() {
  isWorkerRunning = false;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

module.exports = {
  enqueueParseJob,
  startParseWorker,
  stopParseWorker,
  executeJob,
  isFeatureEnabled
};
