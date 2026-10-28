'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/pollerService.js
 *
 * Scheduled reconciliation poller and backfill worker for Recruit AI:
 * - Runs every 15 minutes
 * - Polls results changed since (lastSyncAt - 10 minutes) overlap window
 * - Processes each result idempotently through processAssessmentPayload
 * - Updates IntegrationSyncState
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const prisma = require('../../../config/db');
const { processAssessmentPayload } = require('./inboxService');

let pollerInterval = null;

async function fetchFromRecruitAi(path, params = {}) {
  const baseUrl = process.env.RECRUITAI_BASE_URL || 'https://187.127.137.103';
  const apiKey = process.env.RECRUITAI_API_KEY;

  if (!apiKey) throw new Error('Missing RECRUITAI_API_KEY');

  const fullUrl = new URL(path, baseUrl);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
  });

  const isHttps = fullUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method: 'GET',
      timeout: 15000,
      rejectUnauthorized: false,
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.end();
  });
}

/**
 * Run a sync iteration
 */
async function runReconciliationSync(organizationId = 'defaultOrg') {
  if (process.env.RECRUITAI_SYNC_ENABLED === 'false') {
    return { skipped: true, reason: 'RECRUITAI_SYNC_ENABLED is false' };
  }

  const syncState = await prisma.integrationSyncState.findUnique({
    where: { provider: 'recruit_ai' }
  });

  // Overlap window: lastSyncAt - 10 minutes
  let since = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // Default last 24h
  if (syncState?.lastSyncAt) {
    const overlapTime = new Date(syncState.lastSyncAt.getTime() - 10 * 60 * 1000);
    since = overlapTime.toISOString();
  }

  let importedCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let errorCount = 0;

  try {
    // Check if results endpoint configured / responding
    // Expected endpoint on Recruit AI: /api/integrations/talentos/results or /api/results
    const resp = await fetchFromRecruitAi('/api/integrations/talentos/results', { updatedSince: since, limit: 100 });

    if (resp.status === 200 && resp.data && Array.isArray(resp.data.data || resp.data.results)) {
      const items = resp.data.data || resp.data.results;
      for (const item of items) {
        try {
          const outcome = await processAssessmentPayload(item, null, organizationId);
          importedCount++;
          if (outcome.matched) matchedCount++;
          else unmatchedCount++;
        } catch (err) {
          errorCount++;
        }
      }

      await prisma.integrationSyncState.upsert({
        where: { provider: 'recruit_ai' },
        create: {
          provider: 'recruit_ai',
          lastSuccessfulCursor: new Date().toISOString(),
          lastSyncAt: new Date(),
          lastError: null
        },
        update: {
          lastSuccessfulCursor: new Date().toISOString(),
          lastSyncAt: new Date(),
          lastError: null
        }
      });
    }

    return {
      success: true,
      importedCount,
      matchedCount,
      unmatchedCount,
      errorCount,
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    console.warn('[RecruitAI Poller] Reconciliation poll error:', err.message);

    await prisma.integrationSyncState.upsert({
      where: { provider: 'recruit_ai' },
      create: {
        provider: 'recruit_ai',
        lastError: err.message
      },
      update: {
        lastError: err.message
      }
    });

    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Start the 15-minute background poller
 */
function initPoller() {
  if (pollerInterval) clearInterval(pollerInterval);

  if (process.env.RECRUITAI_SYNC_ENABLED === 'false') {
    console.log('[RecruitAI Poller] Sync disabled via RECRUITAI_SYNC_ENABLED=false');
    return;
  }

  const intervalMs = 15 * 60 * 1000; // 15 minutes
  console.log('[RecruitAI Poller] Initializing 15-minute reconciliation poller...');
  
  pollerInterval = setInterval(async () => {
    try {
      await runReconciliationSync();
    } catch (e) {
      console.warn('[RecruitAI Poller] Scheduled poll tick failed:', e.message);
    }
  }, intervalMs);
}

module.exports = {
  fetchFromRecruitAi,
  runReconciliationSync,
  initPoller
};
