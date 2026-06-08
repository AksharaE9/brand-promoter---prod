'use strict';
const { createClient } = require('@vercel/edge-config');

let edgeConfig;
try {
  if (process.env.EDGE_CONFIG) {
    edgeConfig = createClient(process.env.EDGE_CONFIG);
  }
} catch (err) {
  console.warn('[EdgeConfig] Initialization failed:', err.message);
}

const DEFAULTS = {
  CANDIDATE_LIST_TTL:    30,
  DASHBOARD_TTL:         45,
  ANALYTICS_TTL:        120,
  BULK_IMPORT_BATCH:     25,
  SSE_HEARTBEAT_INTERVAL: 20,
  MAX_PAGE_SIZE:         50,
};

async function getConfig(key) {
  try {
    if (!edgeConfig) return DEFAULTS[key] ?? null;
    const val = await edgeConfig.get(key);
    return val ?? DEFAULTS[key] ?? null;
  } catch {
    return DEFAULTS[key] ?? null;
  }
}

async function getAllConfig() {
  try {
    if (!edgeConfig) return DEFAULTS;
    const all = await edgeConfig.getAll();
    return { ...DEFAULTS, ...all };
  } catch {
    return DEFAULTS;
  }
}

module.exports = { getConfig, getAllConfig };
