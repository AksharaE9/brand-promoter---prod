'use strict';
const { db: adminDb } = require('../config/firebase');

// Test queries that require composite indexes
// If any of these fail with "requires an index" error, the index is not yet built
const INDEX_TEST_QUERIES = [
  {
    name: 'candidates-by-status-createdAt',
    fn: () => adminDb.collection('candidates')
      .where('organizationId', '==', 'test')
      .where('isDeleted', '==', false)
      .where('status', '==', 'ACTIVE')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
  },
  {
    name: 'interviews-by-scheduledStart',
    fn: () => adminDb.collection('interviews')
      .where('organizationId', '==', 'test')
      .where('isDeleted', '==', false)
      .orderBy('scheduledStart', 'desc')
      .limit(1)
      .get()
  },
  {
    name: 'notifications-by-userId-isRead-createdAt',
    fn: () => adminDb.collection('notifications')
      .where('userId', '==', 'test')
      .where('isDeleted', '==', false)
      .where('isRead', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
  },
];

async function checkIndexes() {
  const results = { passed: [], failed: [], building: [] };

  for (const test of INDEX_TEST_QUERIES) {
    try {
      await test.fn();
      results.passed.push(test.name);
    } catch (err) {
      if (err.message?.includes('requires an index') || err.code === 9) {
        results.building.push(test.name);
        console.warn(`[IndexCheck] BUILDING/MISSING: ${test.name} — index not yet ready`);
        // Extract the index creation URL from the error message
        const urlMatch = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
        if (urlMatch) {
          console.warn(`[IndexCheck] Create index at: ${urlMatch[0]}`);
        }
      } else {
        results.failed.push({ name: test.name, error: err.message });
        console.error(`[IndexCheck] FAILED: ${test.name} —`, err.message);
      }
    }
  }

  if (results.building.length > 0) {
    console.warn(
      `[IndexCheck] ${results.building.length} indexes still building or missing. ` +
      `Self-healing bridge mode will activate for these queries until indexes are ready.`
    );
  }

  if (results.failed.length > 0) {
    console.error(
      `[IndexCheck] ${results.failed.length} index checks failed with unexpected errors.`
    );
  }

  return results;
}

module.exports = { checkIndexes };
