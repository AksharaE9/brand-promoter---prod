'use strict';
const { deleteCachePattern, deleteCache } = require('./cache');

const inv = {

  async candidate(orgId, candidateId) {
    await Promise.all([
      deleteCachePattern(`candidates:list:${orgId}:*`),
      deleteCachePattern(`candidates:filtered:${orgId}:*`),
      ...(candidateId ? [deleteCache(`candidates:detail:${candidateId}`)] : []),
      deleteCachePattern(`dashboard:*:${orgId}*`),
      deleteCachePattern(`analytics:*:${orgId}:*`),
      deleteCachePattern(`reports:*:${orgId}:*`),
    ]);
  },

  async candidateList(orgId) {
    await Promise.all([
      deleteCachePattern(`candidates:list:${orgId}:*`),
      deleteCachePattern(`candidates:filtered:${orgId}:*`),
      deleteCachePattern(`dashboard:*:${orgId}*`),
      deleteCachePattern(`analytics:*:${orgId}:*`),
    ]);
  },

  async job(orgId, jobId) {
    await Promise.all([
      deleteCachePattern(`jobs:list:${orgId}:*`),
      ...(jobId ? [deleteCache(`jobs:detail:${jobId}`)] : []),
      deleteCachePattern(`dashboard:*:${orgId}*`),
    ]);
  },

  async user(orgId, userId) {
    await Promise.all([
      deleteCachePattern(`users:list:${orgId}:*`),
      ...(userId ? [deleteCache(`users:detail:${userId}`)] : []),
      deleteCachePattern(`dashboard:*:${orgId}*`),
      deleteCachePattern(`analytics:rperf:${orgId}*`),
    ]);
  },

  async application(orgId, candidateId) {
    await Promise.all([
      deleteCachePattern(`applications:list:${orgId}:*`),
      ...(candidateId ? [deleteCache(`candidates:detail:${candidateId}`)] : []),
      deleteCachePattern(`candidates:list:${orgId}:*`),
      deleteCachePattern(`dashboard:*:${orgId}*`),
      deleteCachePattern(`analytics:*:${orgId}:*`),
    ]);
  },

  async interview(orgId) {
    await Promise.all([
      deleteCachePattern(`scheduling:rounds:list:${orgId}:*`),
      deleteCachePattern(`analytics:iload:${orgId}*`),
      deleteCachePattern(`analytics:rperf:${orgId}*`),
      deleteCachePattern(`dashboard:*:${orgId}*`),
    ]);
  },

  async drive(orgId, driveId) {
    await Promise.all([
      deleteCachePattern(`drives:list:${orgId}:*`),
      ...(driveId ? [deleteCache(`drives:detail:${driveId}`)] : []),
      deleteCachePattern(`dashboard:*:${orgId}*`),
    ]);
  },

  async dashboard(orgId) {
    await deleteCachePattern(`dashboard:*:${orgId}*`);
  },

  async analytics(orgId) {
    await deleteCachePattern(`analytics:*:${orgId}:*`);
  },

  async audit(orgId) {
    await deleteCachePattern(`audit:list:${orgId}:*`);
  },

  async settings(orgId) {
    await Promise.all([
      deleteCachePattern(`settings:*:${orgId}*`),
      deleteCachePattern(`users:detail:*`),
    ]);
  },
};

module.exports = inv;
