/**
 * Performance timing middleware.
 * Logs slow API responses and sets X-Response-Time header.
 */
function timingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1_000_000; // ms
    // Set header (may not apply if headers already sent, but harmless)
    try {
      res.setHeader('X-Response-Time', `${duration.toFixed(1)}ms`);
    } catch { /* headers already sent */ }

    if (duration > 500) {
      console.warn(`[SLOW API] ${req.method} ${req.path} took ${duration.toFixed(1)}ms`);
    }
  });

  next();
}

module.exports = { timingMiddleware };
