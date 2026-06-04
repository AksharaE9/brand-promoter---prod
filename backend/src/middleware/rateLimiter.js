'use strict';
const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../utils/redisClient');

function createLimiter(windowMs, max, prefix) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    validate: false,
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `ratelimit:${prefix}:`,
    }),
    keyGenerator: (req) => {
      const clientIpOrOrg = (req.user?.organizationId || req.ip || 'unknown').replace(/:/g, '_');
      const userId = (req.user?.id || 'anon').replace(/:/g, '_');
      return `${clientIpOrOrg}__${userId}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    },
  });
}

module.exports = {
  authLimiter:      createLimiter(15 * 60_000, 20,   'auth'),
  apiLimiter:       createLimiter(60 * 1000,   200,  'api'),
  uploadLimiter:    createLimiter(60 * 60_000, 10,   'upload'),
  analyticsLimiter: createLimiter(60 * 1000,   30,   'analytics'),
  exportLimiter:    createLimiter(60 * 60_000, 5,    'export'),
};
