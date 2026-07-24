'use strict';

const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { auth, requireRoles } = require('../middleware/auth');
const { ApiError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const sse = require('../utils/sse');

// Enforce authentication globally on this router
router.use(auth);

// GET /api/candidates/:candidateId/internal-reports
router.get('/:candidateId/internal-reports', requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { candidateId } = req.params;
 
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId }
    });
 
    if (!candidate) {
      return next(new ApiError(404, 'Candidate not found'));
    }
 
    const reports = await prisma.candidateInternalReport.findMany({
      where: { candidateId },
      include: {
        submittedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      }
    });
 
    res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  }
});

// POST /api/candidates/:candidateId/internal-reports
router.post('/:candidateId/internal-reports', requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || content.trim() === '') {
      return next(new ApiError(400, 'Report content is required'));
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId }
    });

    if (!candidate) {
      return next(new ApiError(404, 'Candidate not found'));
    }

    const report = await prisma.candidateInternalReport.create({
      data: {
        candidateId,
        content: content.trim(),
        submittedById: req.user.id
      },
      include: {
        submittedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    // Log the audit event (excluding content itself for security/sensitivity)
    logAudit({
      actorUserId: req.user.id,
      action: 'internal_report_submitted',
      entityType: 'CANDIDATE',
      entityId: candidateId,
      entityName: candidate.fullName,
      subjectType: 'candidate',
      subjectId: candidateId,
      subjectName: candidate.fullName,
      newData: { reportId: report.id, contentLength: content.trim().length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      organizationId: req.user.organizationId || 'defaultOrg',
    });

    // Invalidate client scheduling queries
    const orgId = req.user.organizationId || 'defaultOrg';
    const inv = require('../utils/cacheInvalidation');
    await inv.candidate(orgId, candidateId);

    // Broadcast update via SSE
    sse.broadcastToOrg(orgId, 'CANDIDATE_INTERNAL_REPORT_ADDED', {
      candidateId,
      reportId: report.id,
      submittedBy: req.user.fullName
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
