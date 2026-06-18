'use strict';
const l1 = require('./l1Cache');

const L1_TTL_MS = {
  DASHBOARD:    15_000,
  JOBS:         60_000,
  TEAM:         60_000,
  ORG_SETTINGS: 300_000,
  PANEL:        120_000,
};

async function tieredGet(key, l1TtlMs = 15_000) {
  const l1hit = l1.get(key);
  if (l1hit !== null) return { data: l1hit, tier: 'l1' };
  return { data: null, tier: 'miss' };
}

async function tieredSet(key, data, redisTtlS = 60, l1TtlMs = 15_000) {
  if (data === null || data === undefined) return;
  l1.set(key, data, l1TtlMs);
}

async function tieredDelete(key) {
  l1.delete(key);
}

async function tieredDeletePattern(prefix) {
  l1.deletePattern(prefix);
}

module.exports = { tieredGet, tieredSet, tieredDelete, tieredDeletePattern, L1_TTL_MS };
