'use strict';
const express = require('express');
const router = express.Router();
const sse = require('../utils/sse');
const { auth } = require('../middleware/auth');

router.get('/stream', auth, async (req, res) => {
  const userId = req.user.id;
  const orgId = req.user.organizationId || 'defaultOrg';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try {
      origin = new URL(req.headers.referer).origin;
    } catch (e) {
      // ignore
    }
  }
  if (!origin || origin === '*') {
    if (process.env.FRONTEND_URL) {
      origin = process.env.FRONTEND_URL;
    } else if (process.env.NODE_ENV !== 'production') {
      origin = 'http://localhost:5173';
    } else {
      origin = '*';
    }
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  // Register this client
  sse.addClient(orgId, userId, res);

  // Replay missed events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'] || req.query.lastEventId;
  if (lastEventId) {
    sse.replayEvents(orgId, res, lastEventId);
  }

  // Send initial state
  await sendInitialState(orgId, userId, res);

  req.on('close', () => {
    sse.removeClient(orgId, userId, res);
  });
  req.on('error', () => {
    sse.removeClient(orgId, userId, res);
  });
  res.on('finish', () => {
    sse.removeClient(orgId, userId, res);
  });
});

// Health/stats endpoint
router.get('/stats', auth, (req, res) => {
  res.json({ success: true, data: sse.getStats() });
});

async function sendInitialState(orgId, userId, res) {
  try {
    const { getDirtyQueue } = require('../services/schedulingCacheService');
    const dirtyItems = await getDirtyQueue();
    const orgPending = dirtyItems.filter(i => i.orgId === orgId).length;
    res.write(`event: SYNC_STATE\ndata: ${JSON.stringify({ pendingSync: orgPending })}\n\n`);
  } catch (err) {
    // non-critical
  }
}

module.exports = router;
