'use strict';

/**
 * resumeHealthCheck.js
 *
 * Lightweight, bounded background health check for candidate resumes.
 * Periodically samples a small batch of candidate resume references to detect any
 * storage anomalies proactively without placing memory or CPU pressure on the instance.
 */

const prisma = require('../config/db');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Run every 6 hours
const SAMPLE_SIZE = 25;                       // Bounded sample size to protect 512MB RAM

async function sampleResumeHealthCheck() {
  try {
    const candidates = await prisma.candidate.findMany({
      where: {
        isDeleted: false,
        OR: [
          { resumeFileId: { not: null } },
          { resumeLinkOriginal: { not: null } },
          { resumeLinkDownload: { not: null } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        resumeFileId: true,
        resumeLinkOriginal: true,
        resumeLinkDownload: true,
        customFields: true,
        resumeFile: {
          select: {
            id: true,
            storageKey: true,
            sizeBytes: true,
            mimeType: true,
          },
        },
      },
      take: SAMPLE_SIZE,
      orderBy: { updatedAt: 'desc' },
    });

    if (candidates.length === 0) return;

    let validCount = 0;
    let missingFlaggedCount = 0;
    let anomalyCount = 0;

    for (const c of candidates) {
      const isMissing = c.customFields && typeof c.customFields === 'object' && String(c.customFields.resumeStatus).toUpperCase() === 'MISSING';
      if (isMissing) {
        missingFlaggedCount++;
        continue;
      }

      if (c.resumeFile) {
        const key = c.resumeFile.storageKey || '';
        if (key.startsWith('db://') || (c.resumeFile.sizeBytes && c.resumeFile.sizeBytes > 0)) {
          validCount++;
        } else {
          anomalyCount++;
          console.warn(`[ResumeHealthCheck] Anomaly detected for candidate ${c.id} (${c.fullName}): invalid storageKey ${key}`);
        }
      } else if (c.resumeLinkOriginal || c.resumeLinkDownload) {
        const link = c.resumeLinkOriginal || c.resumeLinkDownload;
        if (link.startsWith('http://') || link.startsWith('https://')) {
          validCount++;
        } else {
          anomalyCount++;
          console.warn(`[ResumeHealthCheck] Anomaly detected for candidate ${c.id} (${c.fullName}): non-http link ${link}`);
        }
      }
    }

    console.log(`[ResumeHealthCheck] Sample check complete: ${SAMPLE_SIZE} sampled | ${validCount} OK | ${missingFlaggedCount} Flagged Missing | ${anomalyCount} Anomalies`);
  } catch (err) {
    console.warn('[ResumeHealthCheck] Periodic sample check failed (non-fatal):', err.message);
  }
}

function startResumeHealthCheck() {
  // Delay initial check by 2 minutes to let the app finish booting
  setTimeout(() => {
    sampleResumeHealthCheck();
    setInterval(sampleResumeHealthCheck, CHECK_INTERVAL_MS);
  }, 120000);
}

module.exports = {
  sampleResumeHealthCheck,
  startResumeHealthCheck,
};
