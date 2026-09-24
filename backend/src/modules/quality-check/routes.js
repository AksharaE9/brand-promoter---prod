'use strict';

const express = require('express');
const { auth, requireRoles } = require('../../middleware/auth');
const { asyncHandler } = require('../../utils/errors');
const qcService = require('./service');

const router = express.Router();

router.use(auth);

// GET /api/quality-checks - Queue listing (Pending / Hold / Decided)
router.get(
  '/',
  requireRoles('QUALITY_APPROVER', 'SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || 'defaultOrg';
    const { status, page, limit, search, dateGroup } = req.query;
    const result = await qcService.getQueue(orgId, {
      status,
      page,
      limit,
      search,
      dateGroup,
    });
    res.json({ success: true, ...result });
  }),
);

// GET /api/quality-checks/counts - Summary badge counts
router.get(
  '/counts',
  requireRoles('QUALITY_APPROVER', 'SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || 'defaultOrg';
    const counts = await qcService.getCounts(orgId);
    res.json({ success: true, counts });
  }),
);

// GET /api/quality-checks/:id - Detailed view for a quality check
router.get(
  '/:id',
  requireRoles('QUALITY_APPROVER', 'SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || 'defaultOrg';
    const { id } = req.params;
    const data = await qcService.getQualityCheckById(orgId, id);
    res.json({ success: true, data });
  }),
);

// POST /api/quality-checks/:id/decision - Take decision (Approve with CTC / Reject with reason / Hold with reason)
router.post(
  '/:id/decision',
  requireRoles('QUALITY_APPROVER', 'SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const orgId = req.user.organizationId || 'defaultOrg';
    const { id } = req.params;
    const { decision, ctcAmount, ctcCurrency, comments } = req.body;
    const result = await qcService.recordDecision(
      orgId,
      id,
      { decision, ctcAmount, ctcCurrency, comments },
      req.user,
    );
    res.json({ success: true, data: result });
  }),
);

module.exports = router;
