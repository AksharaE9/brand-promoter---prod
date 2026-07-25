'use strict';

/**
 * Response size enforcement middleware.
 *
 * For list/array endpoints (/interviews list only — NOT calendar):
 *   - Hard blocks responses where body.data is an array AND the response
 *     exceeds MAX_LIST_RESPONSE_BYTES (500KB). This is secondary defense against
 *     fat-payload bugs reintroducing themselves.
 *   - EXCEPTION: calendar view (?view=calendar) fetches all interviews in a
 *     date range — no row limit is applied, so a larger payload is expected.
 *     Calendar responses are checked against a separate 2MB ceiling.
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

const MAX_LIST_RESPONSE_BYTES    = 500 * 1024;   // 500 KB — paginated list endpoint cap
const MAX_CALENDAR_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB  — calendar fetches entire date range
const WARN_RESPONSE_BYTES         = 1024 * 1024;  // 1 MB  — warn threshold for non-list endpoints

const LIST_ENDPOINT_PREFIXES = [
  '/api/interviews',
  '/api/candidates',
  '/api/audit-logs',
  '/api/scheduling',
];

function isListEndpoint(path) {
  return LIST_ENDPOINT_PREFIXES.some(prefix => path.startsWith(prefix));
}

module.exports = (req, res, next) => {
  const originalJson = res.json;

  res.json = function (body) {
    try {
      if (body) {
        const jsonString = JSON.stringify(body);
        const sizeBytes = jsonString.length;
        const path = req.originalUrl.split('?')[0];
        const isCalendar = req.query?.view === 'calendar';

        if (isListEndpoint(path) && Array.isArray(body?.data)) {
          const capBytes = isCalendar ? MAX_CALENDAR_RESPONSE_BYTES : MAX_LIST_RESPONSE_BYTES;

          if (sizeBytes > capBytes) {
            const kb  = Math.round(sizeBytes / 1024);
            const capKb = Math.round(capBytes / 1024);
            console.error(
              `[RESPONSE_SIZE_CAP] BLOCKED ${req.method} ${req.originalUrl} — ` +
              `${kb}KB exceeds ${capKb}KB cap. ` +
              `data.length=${body.data.length} rows. ` +
              `isCalendar=${isCalendar}. ` +
              `This indicates a fat-payload bug — check projection and page size.`
            );
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
                isCalendar,
              },
            });
          }
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
