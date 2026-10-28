'use strict';

/**
 * backend/src/modules/ext/middleware.js
 *
 * Security, Auth, Scope, Rate-Limiting, and Metrics middleware for /api/v1/ext/*
 */

const { verifyApiKey, recordUsage } = require('./apiKeyService');
const { ApiError } = require('../../utils/errors');

// In-memory rate limiting bucket: keyId -> { count, resetAt }
const rateLimitBuckets = new Map();

/**
 * 1. Feature Flag: EXTERNAL_API_ENABLED
 * When false or unset, all /api/v1/ext/* calls return 404
 */
function extFeatureFlag(req, res, next) {
  const isEnabled = process.env.EXTERNAL_API_ENABLED === 'true';
  if (!isEnabled) {
    const requestId = req.id || req.headers['x-request-id'] || 'req_unknown';
    return res.status(404).json({
      success: false,
      code: 'ROUTE_NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        requestId,
      }
    });
  }
  next();
}

/**
 * 2. Security, CORS Disablement & HTTPS Enforcement
 * Server-to-server only: reject browser preflight and strip CORS headers
 */
function extSecurityAndCors(req, res, next) {
  // Strip any CORS response headers that upstream middleware might have attached
  res.removeHeader('Access-Control-Allow-Origin');
  res.removeHeader('Access-Control-Allow-Methods');
  res.removeHeader('Access-Control-Allow-Headers');
  res.removeHeader('Access-Control-Allow-Credentials');

  // Reject browser preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    return res.status(403).json({
      success: false,
      code: 'CORS_NOT_ALLOWED',
      message: 'The TalentOS External API is server-to-server only and does not allow browser cross-origin requests.',
      error: {
        code: 'CORS_NOT_ALLOWED',
        message: 'Browser requests are forbidden. Call this API from your backend application.',
        requestId: req.id,
      }
    });
  }

  // Reject plain HTTP in production
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    if (proto !== 'https') {
      return res.status(403).json({
        success: false,
        code: 'HTTPS_REQUIRED',
        message: 'The External API requires HTTPS. Unencrypted HTTP is prohibited.',
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'HTTPS is required for all external API requests.',
          requestId: req.id,
        }
      });
    }
  }

  next();
}

/**
 * 3. External API Key Authentication Middleware
 */
async function extAuth(req, res, next) {
  // Reject API key in query parameters explicitly
  if (req.query?.api_key || req.query?.key || req.query?.apiKey) {
    return next(new ApiError(400, 'API key must not be passed in query parameters. Use the Authorization header or X-API-Key header.', 'INVALID_PARAMETER'));
  }

  // Extract key
  let rawKey = null;
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.substring(7).trim();
  } else if (req.headers['x-api-key']) {
    rawKey = String(req.headers['x-api-key']).trim();
  }

  if (!rawKey) {
    return next(new ApiError(401, 'API key is required. Pass via "Authorization: Bearer <key>" or "X-API-Key: <key>"', 'API_KEY_MISSING'));
  }

  try {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
    const client = await verifyApiKey(rawKey, clientIp);

    // Explicitly set req.apiClient and ensure req.user is undefined
    req.apiClient = client;
    req.user = undefined;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Scope Authorization Middleware
 */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiClient) {
      return next(new ApiError(401, 'Authentication required', 'API_KEY_MISSING'));
    }

    const clientScopes = Array.isArray(req.apiClient.scopes) ? req.apiClient.scopes : [];
    if (!clientScopes.includes(scope)) {
      return next(new ApiError(403, `This endpoint requires the '${scope}' scope.`, 'API_KEY_INSUFFICIENT_SCOPE', {
        requiredScope: scope,
        grantedScopes: clientScopes,
      }));
    }

    next();
  };
}

/**
 * 5. Per-Key Token Bucket Rate Limiter
 */
function extRateLimiter(req, res, next) {
  if (!req.apiClient) return next();

  const keyId = req.apiClient.keyId;
  const limit = req.apiClient.rateLimitPerMinute || 60;
  const now = Date.now();
  const windowMs = 60 * 1000;

  let bucket = rateLimitBuckets.get(keyId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + windowMs };
    rateLimitBuckets.set(keyId, bucket);
  } else {
    bucket.count++;
  }

  const remaining = Math.max(0, limit - bucket.count);
  const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetSeconds);

  if (bucket.count > limit) {
    res.setHeader('Retry-After', resetSeconds);
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: `Rate limit of ${limit} requests per minute exceeded. Try again in ${resetSeconds} seconds.`,
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit of ${limit} requests per minute exceeded.`,
        requestId: req.id,
        retryAfter: resetSeconds,
      }
    });
  }

  next();
}

/**
 * 6. Usage and Latency Tracker
 */
function extMetricsTracker(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.apiClient && req.apiClient.keyId) {
      const durationNs = process.hrtime.bigint() - start;
      const latencyMs = Number(durationNs) / 1_000_000;
      const routePath = req.baseUrl + (req.route?.path || req.path);
      recordUsage(req.apiClient.keyId, routePath, res.statusCode, Math.round(latencyMs));
    }
  });

  next();
}

module.exports = {
  extFeatureFlag,
  extSecurityAndCors,
  extAuth,
  requireScope,
  extRateLimiter,
  extMetricsTracker,
};
