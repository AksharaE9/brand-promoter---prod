'use strict';
const redis = require('../utils/redisClient');
const jwt = require('jsonwebtoken');

// Routes eligible for deduplication — GET only, idempotent
const DEDUP_ROUTES = [
  '/api/dashboard',
  '/api/analytics',
  '/api/candidates',
  '/api/jobs',
  '/api/team',
];

function dedupMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  const shouldDedup = DEDUP_ROUTES.some(r => req.path.startsWith(r));
  if (!shouldDedup) return next();

  let userKey = 'anon';
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7).trim();
      const decoded = jwt.decode(token);
      if (decoded && decoded.userId) {
        userKey = decoded.userId;
      }
    } catch (_) {}
  }

  const key = `dedup:${userKey}:${req.method}:${req.originalUrl}`;

  redis.get(key).then(cached => {
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return res.json(data);
      } catch { /* fall through */ }
    }

    // Override res.json to capture response and store it
    const originalJson = res.json;
    res.json = function(body) {
      if (res.statusCode === 200 && body && body.success) {
        redis.setex(key, 3, JSON.stringify(body)).catch(() => {});
      }
      return originalJson.call(this, body);
    };

    next();
  }).catch(() => next());
}

module.exports = dedupMiddleware;
