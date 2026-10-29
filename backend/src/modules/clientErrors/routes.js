'use strict';

const express = require('express');
const router = express.Router();
const { auth, requireRoles } = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiter: max 30 error reports per minute per IP
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many error reports. Please slow down.' }
});

// Ring buffer to keep the latest 200 client errors in memory (zero DB cost)
const MAX_ERRORS = 200;
const errorLogRingBuffer = [];

/**
 * POST /api/client-errors
 * Receives and logs unhandled frontend crashes.
 */
router.post('/', clientErrorLimiter, (req, res) => {
  const body = req.body || {};
  const message = String(body.message || 'Unknown client error').slice(0, 1000);
  const route = String(body.route || req.headers.referer || '').slice(0, 255);
  const build = String(body.build || body.buildHash || 'unknown').slice(0, 64);
  const candidateId = body.candidateId ? String(body.candidateId).slice(0, 64) : null;
  const scoreId = body.scoreId ? String(body.scoreId).slice(0, 64) : null;
  const userAgent = String(body.userAgent || req.headers['user-agent'] || '').slice(0, 500);
  const componentStack = body.componentStack ? String(body.componentStack).slice(0, 4096) : null;
  const stack = body.stack ? String(body.stack).slice(0, 4096) : null;
  const time = body.time || body.timestamp || new Date().toISOString();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const errorEntry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message,
    route,
    build,
    candidateId,
    scoreId,
    userAgent,
    componentStack,
    stack,
    time,
    clientIp
  };

  // Prepend to ring buffer and cap length
  errorLogRingBuffer.unshift(errorEntry);
  if (errorLogRingBuffer.length > MAX_ERRORS) {
    errorLogRingBuffer.pop();
  }

  console.warn(`[ClientError] [${build}] ${route} — ${message}${candidateId ? ` (cand: ${candidateId})` : ''}`);

  res.status(201).json({ success: true, logged: true });
});

/**
 * GET /api/client-errors
 * Admin view of recent client errors with aggregation.
 */
router.get('/', auth, requireRoles('SUPER_ADMIN', 'RECRUITER'), (req, res) => {
  const grouped = new Map();

  for (const err of errorLogRingBuffer) {
    const key = `${err.build}::${err.message}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        message: err.message,
        build: err.build,
        count: 0,
        firstSeen: err.time,
        lastSeen: err.time,
        sampleRoute: err.route,
        sampleStack: err.componentStack || err.stack,
        candidateIds: new Set(),
      });
    }
    const agg = grouped.get(key);
    agg.count += 1;
    agg.lastSeen = err.time;
    if (err.candidateId) agg.candidateIds.add(err.candidateId);
  }

  const summary = Array.from(grouped.values()).map(g => ({
    ...g,
    candidateIds: Array.from(g.candidateIds).slice(0, 5),
  }));

  res.json({
    success: true,
    totalLogged: errorLogRingBuffer.length,
    groupedSummary: summary,
    recentErrors: errorLogRingBuffer.slice(0, 50),
  });
});

module.exports = router;
