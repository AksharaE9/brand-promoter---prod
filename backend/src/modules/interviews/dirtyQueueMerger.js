'use strict';

/**
 * Merges pending dirty rounds into the list result.
 * Since Redis queue sync is disabled and writes are 100% synchronous to CockroachDB,
 * this is a simple pass-through.
 */
async function mergeDirtyQueue(dbRounds, orgId) {
  return dbRounds;
}

module.exports = { mergeDirtyQueue };
