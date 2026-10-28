'use strict';

const { getEventLoopMetrics } = require('../utils/perfContext');
const l1 = require('../utils/l1Cache');

// Critical paths that must NEVER be shed
const CRITICAL_PATHS = [
  '/api/auth',
  '/api/candidates/',
  '/api/scheduling',
  '/api/interviews',
  '/api/interview-feedback',
  '/api/sse',
  '/api/health',
];

/**
 * Load Shedding Middleware (Track 8)
 * Under PERF_LOAD_SHEDDING, sheds non-critical GET requests when event loop lag > 250ms
 * or RSS memory > 420MB to prevent 502 Bad Gateway and container OOM crashes.
 */
function loadSheddingMiddleware(req, res, next) {
  if (process.env.PERF_LOAD_SHEDDING !== 'true') {
    return next();
  }

  // Only shed GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Never shed critical paths
  const isCritical = CRITICAL_PATHS.some(p => req.originalUrl?.startsWith(p) || req.path?.startsWith(p));
  if (isCritical) {
    return next();
  }

  const metrics = getEventLoopMetrics();
  const isOverloaded = metrics.p99LagMs > 250 || metrics.rssMb > 420;

  if (isOverloaded) {
    console.warn(`[LOAD_SHEDDING] Overload detected (p99Lag=${metrics.p99LagMs}ms, RSS=${metrics.rssMb}MB). Shedding ${req.method} ${req.originalUrl}`);

    // Attempt to serve from L1 cache if available
    const orgId = req.user?.organizationId || 'defaultOrg';
    const cacheKey = `dashboard:summary:${orgId}`;
    const cachedData = l1.get(cacheKey);

    if (cachedData && req.path.includes('/dashboard')) {
      res.setHeader('X-Load-Shed', 'served-from-stale-cache');
      return res.json({ success: true, data: cachedData, warning: 'Server busy; served from cache.' });
    }

    res.setHeader('Retry-After', '5');
    return res.status(503).json({
      success: false,
      isBusy: true,
      retryAfter: 5,
      message: 'Server is currently experiencing high load. Please retry in a few seconds.',
    });
  }

  next();
}

/**
 * Concurrency limiter for heavy endpoints (bulk upload, exports, parsing)
 * Limits parallel execution to MAX_HEAVY_CONCURRENT (default 2)
 */
let heavyActive = 0;
const MAX_HEAVY = parseInt(process.env.MAX_HEAVY_CONCURRENT, 10) || 2;

function heavyEndpointConcurrency(req, res, next) {
  if (process.env.PERF_CONCURRENCY_LIMITER !== 'true') {
    return next();
  }

  if (heavyActive >= MAX_HEAVY) {
    console.warn(`[HeavyConcurrency] Rejected heavy operation: ${req.method} ${req.originalUrl} (${heavyActive}/${MAX_HEAVY} active)`);
    res.setHeader('Retry-After', '3');
    return res.status(503).json({
      success: false,
      isBusy: true,
      retryAfter: 3,
      message: 'A heavy export or upload is already running. Please wait a few seconds and try again.',
    });
  }

  heavyActive++;
  const release = () => {
    heavyActive = Math.max(0, heavyActive - 1);
  };
  res.on('finish', release);
  res.on('close', release);

  next();
}

/**
 * Request timeout middleware (25s) to free resources from hanging requests
 */
function requestTimeout(timeoutMs = 25000) {
  return (req, res, next) => {
    // SSE streams must never timeout
    if (req.headers.accept === 'text/event-stream' || req.path?.includes('/stream')) {
      return next();
    }

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.warn(`[TIMEOUT] Request timed out after ${timeoutMs}ms: ${req.method} ${req.originalUrl}`);
        res.status(504).json({
          success: false,
          message: 'Request timed out waiting for server response.',
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

module.exports = {
  loadSheddingMiddleware,
  heavyEndpointConcurrency,
  requestTimeout,
};
