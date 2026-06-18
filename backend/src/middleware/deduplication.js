'use strict';
const l1 = require('../utils/l1Cache');
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

  const cached = l1.get(key);
  if (cached !== null) {
    return res.json(cached);
  }

  // Override res.json to capture response and store it
  const originalJson = res.json;
  res.json = function(body) {
    if (res.statusCode === 200 && body && body.success) {
      l1.set(key, body, 3000); // 3 seconds TTL
    }
    return originalJson.call(this, body);
  };

  next();
}

module.exports = dedupMiddleware;
