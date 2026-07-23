'use strict';

let activeRequests = 0;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT, 10) || 15;

function concurrencyLimiter(req, res, next) {
  // Bypass long-lived Server-Sent Events (SSE) connections so they don't block the concurrency pool
  const isSse = req.headers.accept === 'text/event-stream' || req.path?.endsWith('/stream');
  if (isSse) {
    return next();
  }

  if (activeRequests >= MAX_CONCURRENT) {
    console.warn(`[Concurrency] Rejected request: ${req.method} ${req.originalUrl} (Active: ${activeRequests} / ${MAX_CONCURRENT})`);
    res.set('Retry-After', '2');
    return res.status(503).json({
      success: false,
      message: 'The server is experiencing high traffic right now — please try again in a moment.',
    });
  }

  activeRequests++;

  const decrement = () => {
    activeRequests = Math.max(0, activeRequests - 1);
  };

  res.on('finish', decrement);
  res.on('close', decrement);

  next();
}

// Export the active request count for test introspection
function getActiveRequestCount() {
  return activeRequests;
}

module.exports = {
  concurrencyLimiter,
  getActiveRequestCount,
};
