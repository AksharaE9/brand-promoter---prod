'use strict';
const { deleteCachePattern, deleteCache } = require('./cache');

async function runInvalidations(patterns) {
  const unique = [...new Set(patterns.filter(Boolean))];
  await Promise.all(unique.map(p => {
    if (p.includes('*')) {
      return deleteCachePattern(p);
    } else {
      return deleteCache(p);
    }
  }));
}

const inv = {
  async candidate(orgId, candidateId) {
    await runInvalidations([
      `candidates:list:${orgId}:*`,
      `candidates:filtered:${orgId}:*`,
      candidateId ? `candidates:detail:${candidateId}` : null,
      `dashboard:*:${orgId}*`,
      `analytics:*:${orgId}:*`,
      `reports:*:${orgId}:*`,
    ]);
  },

  async candidateList(orgId) {
    await runInvalidations([
      `candidates:list:${orgId}:*`,
      `candidates:filtered:${orgId}:*`,
      `dashboard:*:${orgId}*`,
      `analytics:*:${orgId}:*`,
    ]);
  },

  async job(orgId, jobId) {
    await runInvalidations([
      `jobs:list:${orgId}:*`,
      jobId ? `jobs:detail:${jobId}` : null,
      `dashboard:*:${orgId}*`,
    ]);
  },

  async user(orgId, userId) {
    await runInvalidations([
      `users:list:${orgId}:*`,
      userId ? `users:detail:${userId}` : null,
      `dashboard:*:${orgId}*`,
      `analytics:rperf:${orgId}*`,
    ]);
  },

  async application(orgId, candidateId) {
    await runInvalidations([
      `applications:list:${orgId}:*`,
      candidateId ? `candidates:detail:${candidateId}` : null,
      `candidates:list:${orgId}:*`,
      `dashboard:*:${orgId}*`,
      `analytics:*:${orgId}:*`,
    ]);
  },

  async interview(orgId) {
    await runInvalidations([
      `scheduling:rounds:list:${orgId}:*`,
      `analytics:iload:${orgId}*`,
      `analytics:rperf:${orgId}*`,
      `dashboard:*:${orgId}*`,
    ]);
  },

  async drive(orgId, driveId) {
    await runInvalidations([
      `drives:list:${orgId}:*`,
      driveId ? `drives:detail:${driveId}` : null,
      `dashboard:*:${orgId}*`,
    ]);
  },

  async dashboard(orgId) {
    await runInvalidations([
      `dashboard:*:${orgId}*`,
    ]);
  },

  async analytics(orgId) {
    await runInvalidations([
      `analytics:*:${orgId}:*`,
    ]);
  },

  async audit(orgId) {
    await runInvalidations([
      `audit:list:${orgId}:*`,
    ]);
  },

  async settings(orgId) {
    await runInvalidations([
      `settings:*:${orgId}*`,
      `users:detail:*`,
    ]);
  },
};

module.exports = inv;
module.exports.runInvalidations = runInvalidations;
