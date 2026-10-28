'use strict';

/**
 * backend/src/modules/settings/apiKeyAdminRoutes.js
 *
 * Internal admin endpoints for creating, listing, rotating, and revoking API keys.
 * Protected by session JWT auth and ADMIN/SUPER_ADMIN roles.
 */

const express = require('express');
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { asyncHandler, ApiError } = require('../../utils/errors');
const {
  generateApiKey,
  revokeApiKey,
  rotateApiKey,
  flushUsageAggregation,
} = require('../ext/apiKeyService');

const router = express.Router();

router.use(auth);
router.use(requireRoles('ADMIN', 'SUPER_ADMIN'));

// GET /api/settings/api-keys — List all API keys for tenant
router.get('/', asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || 'defaultOrg';

  const keys = await prisma.apiKey.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      environment: true,
      rateLimitPerMinute: true,
      expiresAt: true,
      createdById: true,
      createdAt: true,
      lastUsedAt: true,
      lastUsedIp: true,
      revokedAt: true,
      revokeReason: true,
    }
  });

  const now = new Date();
  const formatted = keys.map(k => {
    let status = 'ACTIVE';
    if (k.revokedAt) status = 'REVOKED';
    else if (k.expiresAt && new Date(k.expiresAt) < now) status = 'EXPIRED';

    return {
      ...k,
      status,
    };
  });

  res.json({ success: true, data: formatted });
}));

// POST /api/settings/api-keys — Create an API key
router.post('/', asyncHandler(async (req, res) => {
  const { name, scopes, environment, expiresInDays, allowedIps, rateLimitPerMinute } = req.body;
  const orgId = req.user.organizationId || 'defaultOrg';
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;

  const result = await generateApiKey({
    name,
    scopes,
    environment,
    expiresInDays,
    allowedIps,
    rateLimitPerMinute,
    createdById: req.user.id,
    orgId,
    ip: clientIp,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
}));

// POST /api/settings/api-keys/:id/revoke — Revoke an API key
router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;

  const updated = await revokeApiKey(
    req.params.id,
    req.user.id,
    reason || 'Revoked by administrator via Settings',
    clientIp
  );

  res.json({
    success: true,
    message: 'API key revoked successfully',
    data: updated,
  });
}));

// POST /api/settings/api-keys/:id/rotate — Rotate an API key with grace period
router.post('/:id/rotate', asyncHandler(async (req, res) => {
  const gracePeriodHours = parseInt(req.body.gracePeriodHours, 10) || 24;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;

  const result = await rotateApiKey(req.params.id, req.user.id, { gracePeriodHours }, clientIp);

  res.json({
    success: true,
    message: `API key rotated. The old key will expire in ${gracePeriodHours} hours.`,
    data: result,
  });
}));

// GET /api/settings/api-keys/:id/usage — Daily usage metrics
router.get('/:id/usage', asyncHandler(async (req, res) => {
  // Flush any in-memory aggregated usage first so latest requests are visible
  await flushUsageAggregation().catch(() => {});

  const usage = await prisma.apiKeyUsageDaily.findMany({
    where: { apiKeyId: req.params.id },
    orderBy: { date: 'desc' },
    take: 30,
  });

  res.json({
    success: true,
    data: usage,
  });
}));

// GET /api/settings/api-keys/:id/audit — Audit event log
router.get('/:id/audit', asyncHandler(async (req, res) => {
  const events = await prisma.apiKeyAuditEvent.findMany({
    where: { apiKeyId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    success: true,
    data: events,
  });
}));

module.exports = router;
