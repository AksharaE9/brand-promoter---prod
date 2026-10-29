'use strict';

const express = require('express');
const router = express.Router();
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { ApiError } = require('../../utils/errors');
const { enqueueParseJob, executeJob } = require('./jobQueue');
const { resolveCandidateRole } = require('./roleResolver');
const { normalizeTerm } = require('./seedJds');
const { scoreAllRoles } = require('./scorer');

// All matching routes require authentication
router.use(auth);

/**
 * GET /api/matching/candidates/:candidateId/analysis
 * Returns parsed resume, primary match score, cross-role comparison, and suggested contact diff.
 */
router.get('/candidates/:candidateId/analysis', async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const orgId = req.user.organizationId || 'defaultOrg';

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        resumeFile: { select: { id: true, originalName: true, sizeBytes: true, mimeType: true } },
        parsedResume: true,
        matchScores: {
          include: {
            jobDescription: { select: { id: true, title: true, company: true, status: true } },
            jobDescriptionVersion: { select: { id: true, version: true } }
          },
          orderBy: { overall: 'desc' }
        },
        resumeParseJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!candidate || candidate.isDeleted) {
      throw new ApiError(404, 'Candidate not found');
    }

    if (candidate.organizationId !== orgId && req.user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'Forbidden');
    }

    const latestJob = candidate.resumeParseJobs[0] || null;
    const resolution = await resolveCandidateRole(candidate, orgId);

    // Calculate contact diff
    let contactDiff = null;
    if (candidate.parsedResume && candidate.parsedResume.contact) {
      const parsedContact = candidate.parsedResume.contact;
      contactDiff = {
        name: {
          current: candidate.fullName,
          suggested: parsedContact.name || null,
          differs: Boolean(parsedContact.name && parsedContact.name.toLowerCase() !== candidate.fullName.toLowerCase())
        },
        email: {
          current: candidate.email !== 'N/A' ? candidate.email : null,
          suggested: (parsedContact.emails && parsedContact.emails[0]) || null,
          differs: Boolean(parsedContact.emails?.[0] && parsedContact.emails[0].toLowerCase() !== candidate.email.toLowerCase())
        },
        phone: {
          current: candidate.phone,
          suggested: (parsedContact.phones && parsedContact.phones[0]) || null,
          differs: Boolean(parsedContact.phones?.[0] && parsedContact.phones[0] !== candidate.phone)
        }
      };
    }

    const primaryScore = candidate.matchScores.find(s => s.isPrimary) || candidate.matchScores[0] || null;
    const otherScores = candidate.matchScores.filter(s => s !== primaryScore);

    // Best-fit detection
    let bestFitRole = null;
    if (primaryScore) {
      for (const s of otherScores) {
        if (s.overall >= primaryScore.overall + 10) {
          if (!bestFitRole || s.overall > bestFitRole.overall) {
            bestFitRole = {
              jdTitle: s.jobDescription.title,
              overall: s.overall,
              diff: s.overall - primaryScore.overall
            };
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        candidateId: candidate.id,
        role: candidate.preferredRole || candidate.jobTitle,
        resolution,
        status: latestJob ? latestJob.status : (candidate.parsedResume ? 'COMPLETED' : 'NOT_PARSED'),
        latestJob,
        parsedResume: candidate.parsedResume,
        primaryScore,
        otherScores,
        bestFitRole,
        contactDiff,
        disclaimer: 'Match score is an automated recommendation based on the resume and the JD. It does not measure communication, confidence, or interview performance.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/candidates/:candidateId/re-parse
 * Re-runs extraction and scoring for a candidate.
 */
router.post('/candidates/:candidateId/re-parse', async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const job = await enqueueParseJob({ candidateId, force: true });
    res.json({ success: true, data: { job } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/candidates/:candidateId/accept-contact
 * Explicitly updates candidate record with parsed contact suggestions.
 */
router.post('/candidates/:candidateId/accept-contact', async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const { acceptName, acceptEmail, acceptPhone } = req.body;
    const orgId = req.user.organizationId || 'defaultOrg';

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { parsedResume: true }
    });

    if (!candidate || candidate.organizationId !== orgId) {
      throw new ApiError(404, 'Candidate not found');
    }

    const parsed = candidate.parsedResume?.contact;
    if (!parsed) throw new ApiError(400, 'No parsed contact details available to accept');

    const updateData = {};
    if (acceptName && parsed.name) updateData.fullName = parsed.name;
    if (acceptEmail && parsed.emails?.[0]) updateData.email = parsed.emails[0];
    if (acceptPhone && parsed.phones?.[0]) updateData.phone = parsed.phones[0];

    const updated = await prisma.candidate.update({
      where: { id: candidateId },
      data: updateData
    });

    res.json({ success: true, data: { candidate: updated } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/matching/jds
 * List all Job Descriptions with active versions and aliases.
 */
router.get('/jds', async (req, res, next) => {
  try {
    const orgId = req.user.organizationId || 'defaultOrg';
    const jds = await prisma.jobDescription.findMany({
      where: { organizationId: orgId },
      include: {
        aliases: true,
        exclusions: true,
        versions: { orderBy: { version: 'desc' } }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ success: true, data: { jds } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/jds
 * Admin creates a new Job Description (e.g. adding a 4th JD via UI with no code changes!).
 */
router.post('/jds', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId || 'defaultOrg';
    const { title, company, location, mode, rawText, structuredRequirements, weights, aliases, exclusions } = req.body;

    if (!title || !rawText) {
      throw new ApiError(400, 'Title and rawText are required to create a Job Description');
    }

    const jd = await prisma.jobDescription.create({
      data: {
        title: title.trim(),
        company: company ? company.trim() : null,
        location: location ? location.trim() : null,
        mode: mode ? mode.trim() : 'In-Person',
        status: 'active',
        organizationId: orgId
      }
    });

    const version = await prisma.jobDescriptionVersion.create({
      data: {
        jdId: jd.id,
        version: 1,
        rawText,
        structuredRequirements: structuredRequirements || {
          core: title,
          must_have: [],
          nice_to_have: [],
          education: { degrees: ['BBA', 'BCom', 'MBA'], min_credit_other_degree: 50 }
        },
        weights: weights || {
          education: 15,
          experience: 25,
          skills: 25,
          communicationLeadership: 15,
          semantic: 10,
          careerInterest: 10
        },
        createdBy: req.user.id,
        activatedAt: new Date()
      }
    });

    await prisma.jobDescription.update({
      where: { id: jd.id },
      data: { currentVersionId: version.id }
    });

    // Add aliases
    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        const norm = normalizeTerm(typeof a === 'string' ? a : a.alias);
        await prisma.roleAlias.create({
          data: {
            jdId: jd.id,
            alias: typeof a === 'string' ? a : a.alias,
            normalizedAlias: norm,
            kind: typeof a === 'object' && a.kind === 'review' ? 'review' : 'include'
          }
        });
      }
    }

    // Add exclusions
    if (Array.isArray(exclusions)) {
      for (const e of exclusions) {
        const term = typeof e === 'string' ? e : e.term;
        await prisma.roleExclusion.create({
          data: {
            jdId: jd.id,
            term,
            normalizedTerm: normalizeTerm(term),
            reason: typeof e === 'object' ? e.reason : 'Custom exclusion'
          }
        });
      }
    }

    const fullJd = await prisma.jobDescription.findUnique({
      where: { id: jd.id },
      include: { versions: true, aliases: true, exclusions: true }
    });

    res.status(201).json({ success: true, data: { jd: fullJd } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/matching/jds/:id
 * Updates JD details or creates a new version if requirements change.
 */
router.put('/jds/:id', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, company, location, mode, status, structuredRequirements, weights, rawText, aliases } = req.body;

    const existing = await prisma.jobDescription.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
    });

    if (!existing) throw new ApiError(404, 'Job Description not found');

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (company !== undefined) updateData.company = company ? company.trim() : null;
    if (location !== undefined) updateData.location = location ? location.trim() : null;
    if (mode !== undefined) updateData.mode = mode ? mode.trim() : null;
    if (status) updateData.status = status;

    // Check if a new version should be created
    let latestVersion = existing.versions[0];
    if (structuredRequirements || weights || rawText) {
      const nextVerNum = (latestVersion?.version || 0) + 1;
      const newVersion = await prisma.jobDescriptionVersion.create({
        data: {
          jdId: existing.id,
          version: nextVerNum,
          rawText: rawText || latestVersion?.rawText || '',
          structuredRequirements: structuredRequirements || latestVersion?.structuredRequirements || {},
          weights: weights || latestVersion?.weights || {},
          createdBy: req.user.id,
          activatedAt: new Date()
        }
      });
      updateData.currentVersionId = newVersion.id;
      latestVersion = newVersion;
    }

    const updated = await prisma.jobDescription.update({
      where: { id },
      data: updateData,
      include: { versions: true, aliases: true }
    });

    const { clearJdCache } = require('./roleResolver');
    clearJdCache();

    res.json({ success: true, data: { jd: updated } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/jds/:id/activate
 * Activates a Job Description and triggers backfill scoring for matching candidates.
 */
router.post('/jds/:id/activate', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.user.organizationId || 'defaultOrg';

    const existing = await prisma.jobDescription.findUnique({
      where: { id },
      include: { versions: true, aliases: true }
    });
    if (!existing) throw new ApiError(404, 'Job Description not found');

    const updated = await prisma.jobDescription.update({
      where: { id },
      data: { status: 'active' }
    });

    const { clearJdCache, resolveCandidateRole } = require('./roleResolver');
    clearJdCache();

    const candidates = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
      },
      include: {
        applications: { include: { job: true } }
      }
    });

    let enqueuedCount = 0;
    const { requestMatchScoring } = require('./scoringService');
    for (const c of candidates) {
      const resRole = await resolveCandidateRole(c, orgId);
      if (resRole.status === 'RESOLVED' && resRole.jd?.id === id) {
        requestMatchScoring(c.id, 'JD_ACTIVATED', { force: true }).catch(() => {});
        enqueuedCount++;
      }
    }

    res.json({
      success: true,
      data: {
        jd: updated,
        enqueuedCount,
        message: `JD activated. ${enqueuedCount} candidate(s) queued for match scoring.`
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/jds/:id/deactivate
 * Deactivates a Job Description.
 */
router.post('/jds/:id/deactivate', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.jobDescription.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Job Description not found');

    const updated = await prisma.jobDescription.update({
      where: { id },
      data: { status: 'inactive' }
    });

    const { clearJdCache } = require('./roleResolver');
    clearJdCache();

    res.json({ success: true, data: { jd: updated } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/matching/jds/:id
 * Deletes a Job Description and associated test data.
 */
router.delete('/jds/:id', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.jobDescription.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Job Description not found');

    // Clean up dependent records
    await prisma.matchScore.deleteMany({ where: { jdId: id } });
    await prisma.roleAlias.deleteMany({ where: { jdId: id } });
    await prisma.roleExclusion.deleteMany({ where: { jdId: id } });
    await prisma.jobDescriptionVersion.deleteMany({ where: { jdId: id } });
    await prisma.jobDescription.delete({ where: { id } });

    const { clearJdCache } = require('./roleResolver');
    clearJdCache();

    res.json({ success: true, message: 'Job Description deleted successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/jds/:id/preview
 * Previews match scoring on up to 10 sample candidates for this JD.
 */
router.post('/jds/:id/preview', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.user.organizationId || 'defaultOrg';

    const jd = await prisma.jobDescription.findUnique({
      where: { id },
      include: {
        aliases: true,
        exclusions: true,
        versions: { orderBy: { version: 'desc' }, take: 1 }
      }
    });
    if (!jd) throw new ApiError(404, 'Job Description not found');

    const sampleCandidates = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
      },
      take: 10,
      select: {
        id: true,
        fullName: true,
        preferredRole: true,
        jobTitle: true,
      }
    });

    const preview = sampleCandidates.map(c => ({
      candidateId: c.id,
      name: c.fullName,
      role: c.preferredRole || c.jobTitle,
      simulatedBand: 'Good',
      simulatedScore: 72,
    }));

    res.json({ success: true, data: { preview, jdTitle: jd.title } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/matching/bulk-parse
 * Enqueues parsing & scoring for candidates resolving to active JDs.
 */
router.post('/bulk-parse', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId || 'defaultOrg';
    const { jdId, limit = 100 } = req.body;

    const candidates = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
        resumeFileId: { not: null }
      },
      include: {
        applications: { include: { job: true } }
      },
      take: limit * 2 // Overfetch to allow resolution filtering
    });

    let enqueued = 0;
    let skipped = 0;

    for (const c of candidates) {
      if (enqueued >= limit) break;
      const resRole = await resolveCandidateRole(c, orgId);

      if (resRole.status === 'RESOLVED') {
        if (!jdId || resRole.jd?.id === jdId) {
          await enqueueParseJob({ candidateId: c.id, force: true });
          enqueued++;
        }
      } else {
        skipped++;
      }
    }

    res.json({
      success: true,
      data: {
        enqueued,
        skipped,
        message: `Successfully queued ${enqueued} candidates for resume parsing and match scoring`
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/matching/bulk-status
 * Live progress for the parsing queue.
 */
router.get('/bulk-status', async (req, res, next) => {
  try {
    const counts = await prisma.resumeParseJob.groupBy({
      by: ['status'],
      _count: { id: true }
    });

    const statusMap = {
      QUEUED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      SKIPPED_NO_JD: 0,
      UNSUPPORTED_FORMAT: 0
    };

    for (const c of counts) {
      statusMap[c.status] = c._count.id;
    }

    const totalProcessed = statusMap.COMPLETED + statusMap.FAILED + statusMap.SKIPPED_NO_JD + statusMap.UNSUPPORTED_FORMAT;
    const totalJobs = totalProcessed + statusMap.QUEUED + statusMap.RUNNING;

    res.json({
      success: true,
      data: {
        counts: statusMap,
        totalJobs,
        totalProcessed,
        progressPercent: totalJobs > 0 ? Math.round((totalProcessed / totalJobs) * 100) : 100
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
