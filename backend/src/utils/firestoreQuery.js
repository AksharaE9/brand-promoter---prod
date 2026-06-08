'use strict';
const { db: adminDb } = require('../config/firebase');

// In production: strict mode — never fall back to in-memory sort
// In development: warn and fall back so missing indexes are visible during development
const STRICT_MODE = process.env.NODE_ENV === 'production';

async function safeQuery(queryFn, queryName = 'unknown') {
  try {
    return await queryFn();
  } catch (err) {
    const isIndexError = err.code === 9
      || err.message?.includes('requires an index')
      || err.message?.includes('FAILED_PRECONDITION');

    if (isIndexError) {
      // Extract the URL to create the index
      const urlMatch = err.message?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
      const indexUrl = urlMatch ? urlMatch[0] : 'Check Firebase Console';

      console.error(
        `[FirestoreQuery] MISSING INDEX for query "${queryName}"\n` +
        `Create index at: ${indexUrl}\n` +
        `This query is failing in ${STRICT_MODE ? 'STRICT (production)' : 'FALLBACK (dev)'} mode`
      );

      if (STRICT_MODE) {
        // In production: return empty results rather than corrupt in-memory sort
        // Do NOT fall back to in-memory sort — it is unreliable and expensive
        console.error(
          `[FirestoreQuery] Returning empty results for "${queryName}" in strict mode. ` +
          `Deploy the missing index immediately.`
        );
        return { docs: [], size: 0, empty: true, _missingIndex: true };
      }
      // In development: throw so the developer sees it immediately
      throw err;
    }
    throw err;
  }
}

module.exports = { safeQuery };
