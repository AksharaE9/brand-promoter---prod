'use strict';

/**
 * Middleware to monitor the size of JSON responses and log a warning if they exceed 1MB.
 */
module.exports = (req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    try {
      if (body) {
        const jsonString = JSON.stringify(body);
        const sizeBytes = jsonString.length;
        if (sizeBytes > 1024 * 1024) {
          console.warn(`[PERFORMANCE WARNING] Outbound response size exceeded 1MB: ${sizeBytes} bytes for ${req.method} ${req.originalUrl}`);
        }
      }
    } catch (err) {
      // Prevent logging failures from affecting client response
    }
    return originalJson.call(this, body);
  };
  next();
};
