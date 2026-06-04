'use strict';
const SLOW_THRESHOLD_MS = 300;

function timingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    
    try {
      res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
    } catch { /* headers already sent */ }

    if (ms > SLOW_THRESHOLD_MS) {
      console.warn(
        `[SLOW API] ${req.method} ${req.originalUrl} — ${ms.toFixed(0)}ms` +
        ` | status:${res.statusCode}` +
        ` | org:${req.user?.organizationId || 'unauthenticated'}`
      );
    }
  });

  next();
}

module.exports = { timingMiddleware };
