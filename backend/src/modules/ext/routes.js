'use strict';

/**
 * backend/src/modules/ext/routes.js
 *
 * Dedicated router for /api/v1/ext/*
 */

const express = require('express');
const prisma = require('../../config/db');
const { ApiError, asyncHandler } = require('../../utils/errors');
const { streamDbFile } = require('../../utils/dbStorage');
const {
  extFeatureFlag,
  extSecurityAndCors,
  extAuth,
  requireScope,
  extRateLimiter,
  extMetricsTracker,
} = require('./middleware');
const {
  cleanString,
  formatDateIso,
  normalizeOutcome,
  encodeCursor,
  decodeCursor,
  toCandidateDto,
  toInterviewDto,
  toDriveDto,
  toJobDto,
  toTeamMemberDto,
} = require('./dtos');
const { verifySignedResumeToken } = require('./apiKeyService');
const { getOpenApiSpec } = require('./openapi');

const router = express.Router();

// Apply global External API pipeline: feature flag check, security headers, metrics
router.use(extFeatureFlag);
router.use(extSecurityAndCors);
router.use(extMetricsTracker);

// ── Public Liveness & Spec ──────────────────────────────────────────────────

// GET /api/v1/ext/health
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/ext/openapi.json
router.get('/openapi.json', (req, res) => {
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const baseUrl = `${proto}://${host}`;
  res.json(getOpenApiSpec(baseUrl));
});

// ── Resume Download (Uses Signed Token, requires no Bearer if signed) ────────
router.get('/resumes/:signedToken', asyncHandler(async (req, res) => {
  const { fileMetaId, candidateId } = verifySignedResumeToken(req.params.signedToken);

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, fullName: true, resumeFileId: true, isDeleted: true }
  });

  if (!candidate || candidate.isDeleted || candidate.resumeFileId !== fileMetaId) {
    throw new ApiError(404, 'Resume file not found for candidate', 'NOT_FOUND');
  }

  const fileMeta = await prisma.fileMeta.findUnique({
    where: { id: fileMetaId },
    select: { id: true, mimeType: true, originalName: true, fileData: true }
  });

  if (!fileMeta || !fileMeta.fileData) {
    throw new ApiError(404, 'Resume binary data not found', 'NOT_FOUND');
  }

  const filename = fileMeta.originalName || `${candidate.fullName.replace(/\s+/g, '_')}_resume.jpg`;
  res.setHeader('Content-Type', fileMeta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  streamDbFile(fileMeta.fileData, res);
}));

// ── Authenticated Endpoints ─────────────────────────────────────────────────
router.use(extAuth);
router.use(extRateLimiter);

// GET /api/v1/ext/me
router.get('/me', (req, res) => {
  res.json({
    data: {
      keyId: req.apiClient.keyId,
      name: req.apiClient.name,
      prefix: req.apiClient.prefix,
      scopes: req.apiClient.scopes,
      environment: req.apiClient.environment,
      rateLimitPerMinute: req.apiClient.rateLimitPerMinute,
    },
    meta: {
      requestId: req.id,
    }
  });
});

// GET /api/v1/ext/candidates
router.get('/candidates', requireScope('candidates:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;
  const hasPii = req.apiClient.scopes.includes('candidates:read:pii');

  const limitParam = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);

  const where = {
    organizationId: orgId,
    isDeleted: false,
  };

  if (req.query.status) where.status = req.query.status;
  if (req.query.jobId) where.preferredRole = req.query.jobId;
  if (req.query.course) where.course = { contains: req.query.course, mode: 'insensitive' };

  if (req.query.createdFrom || req.query.createdTo) {
    where.createdAt = {};
    if (req.query.createdFrom) where.createdAt.gte = new Date(req.query.createdFrom);
    if (req.query.createdTo) where.createdAt.lte = new Date(req.query.createdTo);
  }

  if (req.query.updatedSince) {
    where.updatedAt = { gte: new Date(req.query.updatedSince) };
  }

  // Filter by driveId via college drive candidates
  if (req.query.driveId) {
    const driveCands = await prisma.collegeDriveCandidate.findMany({
      where: { driveId: req.query.driveId },
      select: { candidateId: true }
    });
    const candIds = driveCands.map(dc => dc.candidateId);
    where.id = { in: candIds };
  }

  // Keyset cursor handling
  const cursorData = decodeCursor(req.query.cursor);
  if (cursorData) {
    where.OR = [
      { updatedAt: { lt: cursorData.updatedAt } },
      {
        updatedAt: cursorData.updatedAt,
        id: { lt: cursorData.id }
      }
    ];
  }

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const baseUrl = `${proto}://${host}`;

  // Fetch limit + 1 to detect hasMore
  const candidates = await prisma.candidate.findMany({
    where,
    orderBy: [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit + 1,
  });

  const hasMore = candidates.length > limit;
  const returnRows = hasMore ? candidates.slice(0, limit) : candidates;

  const lastItem = returnRows[returnRows.length - 1];
  const nextCursor = (hasMore && lastItem) ? encodeCursor(lastItem.updatedAt, lastItem.id) : null;

  const data = returnRows.map(c => toCandidateDto(c, hasPii, baseUrl));

  res.json({
    data,
    page: {
      nextCursor,
      limit,
      hasMore,
    },
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/candidates/:id
router.get('/candidates/:id', requireScope('candidates:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;
  const hasPii = req.apiClient.scopes.includes('candidates:read:pii');

  const candidate = await prisma.candidate.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId,
      isDeleted: false,
    },
    include: {
      applications: {
        include: {
          interviews: true,
        }
      }
    }
  });

  if (!candidate) {
    throw new ApiError(404, 'Candidate not found', 'NOT_FOUND');
  }

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const baseUrl = `${proto}://${host}`;

  res.json({
    data: toCandidateDto(candidate, hasPii, baseUrl),
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/candidates/:id/interviews
router.get('/candidates/:id/interviews', requireScope('interviews:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;

  const candidate = await prisma.candidate.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId,
      isDeleted: false,
    },
    select: { id: true }
  });

  if (!candidate) {
    throw new ApiError(404, 'Candidate not found', 'NOT_FOUND');
  }

  const interviews = await prisma.interview.findMany({
    where: {
      candidateId: req.params.id,
      organizationId: orgId,
    },
    orderBy: { roundNo: 'asc' },
  });

  res.json({
    data: interviews.map(toInterviewDto),
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/interviews
router.get('/interviews', requireScope('interviews:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;

  const limitParam = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);

  const where = {
    organizationId: orgId,
  };

  if (req.query.outcome) {
    where.outcome = req.query.outcome.toUpperCase();
  }
  if (req.query.round) {
    where.roundNo = parseInt(req.query.round, 10);
  }

  // Date filters in IST: from / to e.g. 2026-10-27
  if (req.query.from || req.query.to) {
    where.scheduledStart = {};
    if (req.query.from) {
      // IST is UTC+05:30 -> start of day is 00:00 IST = previous day 18:30 UTC
      const fromDate = new Date(`${req.query.from}T00:00:00+05:30`);
      where.scheduledStart.gte = fromDate;
    }
    if (req.query.to) {
      const toDate = new Date(`${req.query.to}T23:59:59.999+05:30`);
      where.scheduledStart.lte = toDate;
    }
  }

  if (req.query.updatedSince) {
    where.updatedAt = { gte: new Date(req.query.updatedSince) };
  }

  // Keyset pagination
  const cursorData = decodeCursor(req.query.cursor);
  if (cursorData) {
    where.OR = [
      { updatedAt: { lt: cursorData.updatedAt } },
      {
        updatedAt: cursorData.updatedAt,
        id: { lt: cursorData.id }
      }
    ];
  }

  const interviews = await prisma.interview.findMany({
    where,
    orderBy: [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit + 1,
  });

  const hasMore = interviews.length > limit;
  const returnRows = hasMore ? interviews.slice(0, limit) : interviews;

  const lastItem = returnRows[returnRows.length - 1];
  const nextCursor = (hasMore && lastItem) ? encodeCursor(lastItem.updatedAt, lastItem.id) : null;

  res.json({
    data: returnRows.map(toInterviewDto),
    page: {
      nextCursor,
      limit,
      hasMore,
    },
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/drives
router.get('/drives', requireScope('drives:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;

  const drives = await prisma.collegeDrive.findMany({
    where: {
      organizationId: orgId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Fetch college names and candidate counts per drive
  const collegeIds = Array.from(new Set(drives.map(d => d.collegeId)));
  const colleges = await prisma.college.findMany({
    where: { id: { in: collegeIds } }
  });
  const collegeMap = new Map(colleges.map(c => [c.id, c]));

  // Aggregate candidate counts per drive
  const driveCandidates = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: { in: drives.map(d => d.id) } },
    select: { driveId: true, candidateId: true }
  });

  const candIds = Array.from(new Set(driveCandidates.map(dc => dc.candidateId)));
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: candIds } },
    select: { id: true, status: true }
  });
  const candidateStatusMap = new Map(candidates.map(c => [c.id, c.status]));

  const driveStats = new Map();
  driveCandidates.forEach(dc => {
    let stat = driveStats.get(dc.driveId);
    if (!stat) {
      stat = { totalEnrolled: 0, selected: 0, rejected: 0, onHold: 0 };
      driveStats.set(dc.driveId, stat);
    }
    stat.totalEnrolled++;
    const st = candidateStatusMap.get(dc.candidateId);
    if (st === 'INTERVIEWING' || st === 'OFFER_SENT' || st === 'JOINED') stat.selected++;
    else if (st === 'REJECTED') stat.rejected++;
    else if (st === 'ON_HOLD') stat.onHold++;
  });

  const data = drives.map(d => {
    d.college = collegeMap.get(d.collegeId);
    return toDriveDto(d, driveStats.get(d.id) || {});
  });

  res.json({
    data,
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/drives/:id/candidates
router.get('/drives/:id/candidates', requireScope('drives:read'), requireScope('candidates:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;
  const hasPii = req.apiClient.scopes.includes('candidates:read:pii');

  const drive = await prisma.collegeDrive.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId,
      isDeleted: false,
    }
  });

  if (!drive) throw new ApiError(404, 'Drive not found', 'NOT_FOUND');

  const driveCands = await prisma.collegeDriveCandidate.findMany({
    where: { driveId: drive.id },
    select: { candidateId: true }
  });

  const candidateIds = driveCands.map(dc => dc.candidateId);
  const candidates = await prisma.candidate.findMany({
    where: {
      id: { in: candidateIds },
      organizationId: orgId,
      isDeleted: false,
    },
    orderBy: { fullName: 'asc' },
  });

  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const baseUrl = `${proto}://${host}`;

  res.json({
    data: candidates.map(c => toCandidateDto(c, hasPii, baseUrl)),
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/jobs
router.get('/jobs', requireScope('jobs:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;

  const jobs = await prisma.job.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    data: jobs.map(toJobDto),
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/team-members
router.get('/team-members', requireScope('team:read'), asyncHandler(async (req, res) => {
  const { getTelecallingMembers } = require('../scheduling/telecallingMemberService');
  const members = await getTelecallingMembers({
    includeInactive: false,
    includeDeleted: false,
  });

  res.json({
    data: members.map(toTeamMemberDto),
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/stats/summary
router.get('/stats/summary', requireScope('stats:read'), asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;

  const [totalCandidates, candidateStatuses, interviewOutcomes, activeDrives, activeJobs] = await Promise.all([
    prisma.candidate.count({ where: { organizationId: orgId, isDeleted: false } }),
    prisma.candidate.groupBy({
      by: ['status'],
      where: { organizationId: orgId, isDeleted: false },
      _count: { id: true }
    }),
    prisma.interview.groupBy({
      by: ['outcome'],
      where: { organizationId: orgId },
      _count: { id: true }
    }),
    prisma.collegeDrive.count({ where: { organizationId: orgId, isDeleted: false } }),
    prisma.job.count({ where: { organizationId: orgId, isActive: true } }),
  ]);

  const statusMap = {};
  candidateStatuses.forEach(s => {
    statusMap[s.status] = s._count.id;
  });

  const outcomeMap = {};
  interviewOutcomes.forEach(o => {
    if (o.outcome) outcomeMap[o.outcome] = o._count.id;
  });

  res.json({
    data: {
      candidates: {
        total: totalCandidates,
        byStatus: statusMap,
      },
      interviews: {
        byOutcome: outcomeMap,
      },
      drives: {
        activeCount: activeDrives,
      },
      jobs: {
        activeCount: activeJobs,
      },
    },
    meta: {
      requestId: req.id,
    }
  });
}));

// GET /api/v1/ext/changes?since=<iso-date>&resource=<name>
router.get('/changes', asyncHandler(async (req, res) => {
  const orgId = req.apiClient.orgId;
  const sinceStr = req.query.since;
  if (!sinceStr) throw new ApiError(400, 'Query parameter "since" (ISO 8601 timestamp) is required', 'INVALID_PARAMETER');

  const since = new Date(sinceStr);
  if (isNaN(since.getTime())) throw new ApiError(400, 'Invalid "since" timestamp format', 'INVALID_PARAMETER');

  const until = new Date();
  const resource = req.query.resource ? String(req.query.resource).toLowerCase() : null;

  const changes = [];

  // 1. Candidate changes (requires candidates:read)
  if ((!resource || resource === 'candidates') && req.apiClient.scopes.includes('candidates:read')) {
    const candChanges = await prisma.candidate.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: since, lte: until }
      },
      select: { id: true, createdAt: true, updatedAt: true, isDeleted: true },
      take: 200,
    });
    candChanges.forEach(c => {
      const action = c.isDeleted ? 'DELETED' : (c.createdAt >= since ? 'CREATED' : 'UPDATED');
      changes.push({
        resource: 'candidates',
        id: c.id,
        action,
        updatedAt: formatDateIso(c.updatedAt),
      });
    });
  }

  // 2. Interview changes (requires interviews:read)
  if ((!resource || resource === 'interviews') && req.apiClient.scopes.includes('interviews:read')) {
    const intvChanges = await prisma.interview.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: since, lte: until }
      },
      select: { id: true, createdAt: true, updatedAt: true },
      take: 200,
    });
    intvChanges.forEach(i => {
      const action = i.createdAt >= since ? 'CREATED' : 'UPDATED';
      changes.push({
        resource: 'interviews',
        id: i.id,
        action,
        updatedAt: formatDateIso(i.updatedAt),
      });
    });
  }

  // 3. Drive changes (requires drives:read)
  if ((!resource || resource === 'drives') && req.apiClient.scopes.includes('drives:read')) {
    const driveChanges = await prisma.collegeDrive.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: since, lte: until }
      },
      select: { id: true, createdAt: true, updatedAt: true, isDeleted: true },
      take: 100,
    });
    driveChanges.forEach(d => {
      const action = d.isDeleted ? 'DELETED' : (d.createdAt >= since ? 'CREATED' : 'UPDATED');
      changes.push({
        resource: 'drives',
        id: d.id,
        action,
        updatedAt: formatDateIso(d.updatedAt),
      });
    });
  }

  // 4. Job changes (requires jobs:read)
  if ((!resource || resource === 'jobs') && req.apiClient.scopes.includes('jobs:read')) {
    const jobChanges = await prisma.job.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: since, lte: until }
      },
      select: { id: true, createdAt: true, updatedAt: true, isActive: true },
      take: 100,
    });
    jobChanges.forEach(j => {
      const action = !j.isActive ? 'DELETED' : (j.createdAt >= since ? 'CREATED' : 'UPDATED');
      changes.push({
        resource: 'jobs',
        id: j.id,
        action,
        updatedAt: formatDateIso(j.updatedAt),
      });
    });
  }

  res.json({
    data: {
      since: since.toISOString(),
      until: until.toISOString(),
      changes,
    },
    meta: {
      requestId: req.id,
    }
  });
}));

module.exports = router;
