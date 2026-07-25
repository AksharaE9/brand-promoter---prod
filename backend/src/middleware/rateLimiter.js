'use strict';
const { rateLimit, MemoryStore } = require('express-rate-limit');

/**
 * rateLimiter.js — In-Memory Rate Limiters
 * ─────────────────────────────────────────────────────────────────────────
 * Configures rate limiters using express-rate-limit's in-memory store.
 * Completely eliminates rate-limit-redis to optimize performance and remove
 * external network Redis dependencies.
 * ─────────────────────────────────────────────────────────────────────────
 */
function createLimiter(windowMs, max, prefix) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    validate: false,
    store: new MemoryStore(),
    keyGenerator: (req) => {
      const clientIpOrOrg = (req.user?.organizationId || req.ip || 'unknown').replace(/:/g, '_');
      const userId = (req.user?.id || 'anon').replace(/:/g, '_');
      return `${clientIpOrOrg}__${userId}__${prefix}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    },
  });
}

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many requests. Please slow down and try again shortly.' });
  },
});

const heavyEndpointLimiter = rateLimit({
  windowMs: 60_000,
  max: 10, // bulk upload, export, and search-heavy endpoints get a stricter cap
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  handler: (req, res) => {
    res.status(429).json({ message: 'Too many requests on this endpoint. Please slow down and try again shortly.' });
  },
});

module.exports = {
  authLimiter:      createLimiter(15 * 60_000, 20,   'auth'),
  apiLimiter:       createLimiter(60 * 1000,   200,  'api'),
  uploadLimiter:    createLimiter(60 * 60_000, 10,   'upload'),
  analyticsLimiter: createLimiter(60 * 1000,   30,   'analytics'),
  exportLimiter:    createLimiter(60 * 60_000, 5,    'export'),
  globalLimiter,
  heavyEndpointLimiter,
};
