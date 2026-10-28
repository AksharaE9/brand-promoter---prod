'use strict';

const { perfContextStorage, recordRouteMetric } = require('../utils/perfContext');

/**
 * Server-Timing Middleware
 * Injects Server-Timing response headers for authorized users or debug sessions
 * behind the PERF_SERVER_TIMING flag.
 */
function serverTimingMiddleware(req, res, next) {
  const isEnabled = process.env.PERF_SERVER_TIMING === 'true';
  const start = process.hrtime.bigint();

  const ctx = {
    start,
    dbCount: 0,
    dbDuration: 0,
    authDuration: 0,
    serializeDuration: 0,
  };

  req.perfCtx = ctx;

  perfContextStorage.run(ctx, () => {
    // Intercept res.writeHead or res.end to calculate timings before flush
    const origEnd = res.end;
    let bytesSent = 0;

    res.end = function (chunk, encoding, callback) {
      if (chunk) {
        bytesSent += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
      }

      const totalMs = Number(process.hrtime.bigint() - start) / 1e6;

      // Check if user is admin or request has debug secret
      const isPrivileged = req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'ADMIN' || req.headers['x-perf-debug'] === process.env.LOADTEST_BYPASS_SECRET;

      if (isEnabled && isPrivileged && !res.headersSent) {
        const parts = [
          `total;dur=${totalMs.toFixed(2)}`,
          `db;dur=${ctx.dbDuration.toFixed(2)}`,
          `db-count;desc="${ctx.dbCount}"`,
        ];
        if (ctx.authDuration > 0) {
          parts.push(`auth;dur=${ctx.authDuration.toFixed(2)}`);
        }
        if (ctx.serializeDuration > 0) {
          parts.push(`serialize;dur=${ctx.serializeDuration.toFixed(2)}`);
        }
        res.setHeader('Server-Timing', parts.join(', '));
      }

      // Record in bounded in-memory metrics ring buffer
      const routePath = req.baseUrl ? `${req.baseUrl}${req.route?.path || req.path}` : (req.route?.path || req.path);
      recordRouteMetric(routePath, req.method, res.statusCode, totalMs, bytesSent);

      return origEnd.call(this, chunk, encoding, callback);
    };

    next();
  });
}

module.exports = serverTimingMiddleware;
