'use strict';
const l1 = require('../utils/l1Cache');
const jwt = require('jsonwebtoken');

// Routes eligible for deduplication — GET only, idempotent
const DEDUP_ROUTES = [
  '/api/dashboard',
  '/api/analytics',
  '/api/candidates',
  '/api/interviews',
  '/api/scheduling',
  '/api/jobs',
  '/api/team',
];

// In-flight response listeners map for concurrent request coalescing
const inFlightRequests = new Map(); // key -> Array<{ res, originalJson }>

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

  // 1. Check L1 cache
  const cached = l1.get(key);
  if (cached !== null) {
    res.setHeader('X-Dedup-Cache', 'HIT');
    return res.json(cached);
  }

  // 2. Coalesce concurrent identical in-flight requests
  if (inFlightRequests.has(key)) {
    inFlightRequests.get(key).push(res);
    return;
  }

  inFlightRequests.set(key, []);

  // Override res.json to capture response and notify any in-flight waiters
  const originalJson = res.json;
  res.json = function(body) {
    if (res.statusCode === 200 && body && body.success) {
      l1.set(key, body, 3000); // 3 seconds TTL
    }

    const waiters = inFlightRequests.get(key) || [];
    inFlightRequests.delete(key);

    // Send response to the original requester
    const result = originalJson.call(this, body);

    // Send the identical response to all coalesced waiting requests
    for (const waiterRes of waiters) {
      if (!waiterRes.headersSent) {
        waiterRes.setHeader('X-Dedup-Coalesced', 'HIT');
        waiterRes.json(body);
      }
    }

    return result;
  };

  next();
}

module.exports = dedupMiddleware;
