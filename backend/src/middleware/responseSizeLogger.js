'use strict';

/**
 * Response size enforcement middleware.
 *
 * For list/array endpoints (/interviews, /candidates, /audit-logs, /scheduling):
 *   - Hard blocks responses exceeding MAX_RESPONSE_BYTES (500KB) by replacing the
 *     response with a 500 diagnostic. This is a secondary safety net independent of
 *     the per-endpoint page-size caps.
 *   - The loud failure (500 + diagnostic message) is intentional — it surfaces the
 *     problem immediately rather than silently building memory pressure until OOM.
 *
 * For all other endpoints:
 *   - Logs a warning when the response exceeds 1MB (passive monitoring only).
 *
 * Why this matters:
 *   Row-count limits alone don't protect against a single row being unexpectedly
 *   large (e.g., a future field addition, a join returning nested arrays, or a bug
 *   that reintroduces full object population). A byte-size ceiling catches this
 *   class of bug independently of row count.
 */

const MAX_RESPONSE_BYTES = 500 * 1024; // 500 KB — hard cap for list endpoints
const WARN_RESPONSE_BYTES = 1024 * 1024; // 1 MB — warn threshold for other endpoints

const LIST_ENDPOINT_PATTERNS = [
  '/api/interviews',
  '/api/candidates',
  '/api/audit-logs',
  '/api/scheduling',
];

function isListEndpoint(path) {
  return LIST_ENDPOINT_PATTERNS.some(prefix => path.startsWith(prefix));
}

module.exports = (req, res, next) => {
  const originalJson = res.json;

  res.json = function (body) {
    try {
      if (body) {
        const jsonString = JSON.stringify(body);
        const sizeBytes = jsonString.length;
        const path = req.originalUrl.split('?')[0];

        if (isListEndpoint(path) && Array.isArray(body?.data) && sizeBytes > MAX_RESPONSE_BYTES) {
          // Hard enforcement: replace response with diagnostic 500
          const kb = Math.round(sizeBytes / 1024);
          const capKb = Math.round(MAX_RESPONSE_BYTES / 1024);
          console.error(
            `[RESPONSE_SIZE_CAP] BLOCKED ${req.method} ${req.originalUrl} — ` +
            `${kb}KB exceeds ${capKb}KB cap. ` +
            `data.length=${body.data.length} rows. ` +
            `This indicates a fat-payload bug — check projection and page size.`
          );
          // Reset status and replace body with diagnostic
          res.status(500);
          return originalJson.call(this, {
            success: false,
            error: `Response payload (${kb}KB) exceeds the ${capKb}KB safety limit. ` +
              `The query returned unexpectedly large rows — reduce page size or trim the projection.`,
            _diagnostic: {
              sizeKb: kb,
              capKb,
              rows: body.data.length,
              endpoint: req.originalUrl,
            },
          });
        }

        if (sizeBytes > WARN_RESPONSE_BYTES) {
          console.warn(
            `[PERFORMANCE WARNING] Outbound response size exceeded 1MB: ` +
            `${sizeBytes} bytes for ${req.method} ${req.originalUrl}`
          );
        }
      }
    } catch (err) {
      // Prevent logging/enforcement failures from affecting client response
      console.warn('[responseSizeLogger] Enforcement error (non-blocking):', err.message);
    }

    return originalJson.call(this, body);
  };

  next();
};
