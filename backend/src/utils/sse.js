'use strict';

// ─────────────────────────────────────────────
// SSE Manager — Hardened with replay, limits, dead cleanup
// ─────────────────────────────────────────────

// orgId -> Map(userId -> Set(res))
const orgClients = new Map();
// userId -> Set(res)
const userClients = new Map();

// ── Event replay buffer (last 100 events per org) ──
const MAX_REPLAY_BUFFER = 100;
const replayBuffers = new Map();   // orgId -> Array<{id, eventName, payload}>
const eventCounters = new Map();   // orgId -> number (auto-incrementing event ID)

// ── Per-user connection limit ──
const MAX_CONNECTIONS_PER_USER = 5;

function getNextEventId(orgId) {
  const current = eventCounters.get(orgId) || 0;
  const next = current + 1;
  eventCounters.set(orgId, next);
  return next;
}

function pushToReplayBuffer(orgId, eventId, eventName, payload) {
  if (!replayBuffers.has(orgId)) replayBuffers.set(orgId, []);
  const buffer = replayBuffers.get(orgId);
  buffer.push({ id: eventId, eventName, payload });
  // Circular: keep only last MAX_REPLAY_BUFFER events
  if (buffer.length > MAX_REPLAY_BUFFER) {
    buffer.splice(0, buffer.length - MAX_REPLAY_BUFFER);
  }
}

function addClient(orgId, userId, res) {
  if (res === undefined) {
    res = userId;
    userId = orgId;
    orgId = 'defaultOrg';
  }

  // Enforce per-user connection limit
  if (!userClients.has(userId)) userClients.set(userId, new Set());
  const userSet = userClients.get(userId);
  if (userSet.size >= MAX_CONNECTIONS_PER_USER) {
    // Close oldest connection
    const oldest = userSet.values().next().value;
    if (oldest) {
      try { oldest.end(); } catch { /* ignore */ }
      removeClient(orgId, userId, oldest);
    }
  }

  if (!orgClients.has(orgId)) orgClients.set(orgId, new Map());
  const orgMap = orgClients.get(orgId);
  if (!orgMap.has(userId)) orgMap.set(userId, new Set());
  orgMap.get(userId).add(res);

  userSet.add(res);

  writeEvent(res, 'CONNECTED', {
    userId, orgId, timestamp: Date.now(),
    message: 'Real-time connection established',
  });
}

function removeClient(orgId, userId, res) {
  if (res === undefined) {
    res = userId;
    userId = orgId;
    orgId = 'defaultOrg';
  }

  orgClients.get(orgId)?.get(userId)?.delete(res);
  if (orgClients.get(orgId)?.get(userId)?.size === 0) {
    orgClients.get(orgId)?.delete(userId);
  }
  if (orgClients.get(orgId)?.size === 0) {
    orgClients.delete(orgId);
  }
  userClients.get(userId)?.delete(res);
  if (userClients.get(userId)?.size === 0) {
    userClients.delete(userId);
  }
}

function broadcastToOrg(orgId, eventName, data) {
  const orgMap = orgClients.get(orgId);
  if (!orgMap || orgMap.size === 0) {
    // Still buffer the event for replay on reconnect
    const eventId = getNextEventId(orgId);
    const payload = buildPayload(eventName, data, eventId);
    pushToReplayBuffer(orgId, eventId, eventName, payload);
    return;
  }

  const eventId = getNextEventId(orgId);
  const payload = buildPayload(eventName, data, eventId);
  pushToReplayBuffer(orgId, eventId, eventName, payload);

  orgMap.forEach((resSet) => {
    resSet.forEach((res) => safeWrite(res, payload));
  });
}

function sendToUser(userId, eventName, data) {
  if (data === undefined) {
    data = eventName;
    eventName = 'message';
  }
  const resSet = userClients.get(userId);
  if (!resSet || resSet.size === 0) return;
  const payload = buildPayload(eventName, data);
  resSet.forEach((res) => safeWrite(res, payload));
}

function broadcastGlobal(eventName, data) {
  const payload = buildPayload(eventName, data);
  orgClients.forEach((orgMap) => {
    orgMap.forEach((resSet) => {
      resSet.forEach((res) => safeWrite(res, payload));
    });
  });
}

function buildPayload(eventName, data, eventId) {
  const lines = [];
  if (eventId) lines.push(`id: ${eventId}`);
  lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify({
    ...data,
    _ts: Date.now(),
    _event: eventName,
    ...(eventId ? { _eventId: eventId } : {}),
  })}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

function writeEvent(res, eventName, data) {
  safeWrite(res, buildPayload(eventName, data));
}

function safeWrite(res, payload) {
  try {
    if (!res.writableEnded && !res.socket?.destroyed) {
      res.write(payload);
    }
  } catch { /* connection dropped */ }
}

/**
 * Replay missed events to a reconnecting client
 * @param {string} orgId 
 * @param {object} res - HTTP response
 * @param {number|string} lastEventId - The last event ID the client received
 */
function replayEvents(orgId, res, lastEventId) {
  const buffer = replayBuffers.get(orgId);
  if (!buffer || !lastEventId) return;

  const parsedId = parseInt(lastEventId, 10);
  if (isNaN(parsedId)) return;

  const missed = buffer.filter(entry => entry.id > parsedId);
  missed.forEach(entry => {
    safeWrite(res, entry.payload);
  });
}

function getStats() {
  let totalConnections = 0;
  const orgs = [];
  orgClients.forEach((orgMap, orgId) => {
    let orgConnections = 0;
    orgMap.forEach((resSet) => { orgConnections += resSet.size; });
    orgs.push({ orgId, connections: orgConnections });
    totalConnections += orgConnections;
  });
  return {
    totalConnections,
    totalOrgs: orgClients.size,
    orgs,
    replayBufferSizes: Object.fromEntries(
      [...replayBuffers.entries()].map(([org, buf]) => [org, buf.length])
    ),
  };
}

// Heartbeat every 20s — prevents proxy timeouts + cleans dead connections
const heartbeatInterval = setInterval(() => {
  const hb = `: heartbeat ${Date.now()}\n\n`;
  const deadConnections = [];

  orgClients.forEach((orgMap, orgId) => {
    orgMap.forEach((resSet, userId) => {
      resSet.forEach((res) => {
        try {
          if (res.writableEnded || res.socket?.destroyed) {
            deadConnections.push({ orgId, userId, res });
          } else {
            res.write(hb);
          }
        } catch {
          deadConnections.push({ orgId, userId, res });
        }
      });
    });
  });

  // Cleanup dead connections
  deadConnections.forEach(({ orgId, userId, res }) => {
    removeClient(orgId, userId, res);
  });

  if (deadConnections.length > 0) {
    console.log(`[SSE] Cleaned ${deadConnections.length} dead connections`);
  }
}, 20000);

// Graceful shutdown
process.on('SIGTERM', () => clearInterval(heartbeatInterval));

module.exports = {
  addClient, removeClient,
  broadcastToOrg, sendToUser, broadcastGlobal,
  writeEvent, getStats, replayEvents,
  // Backward-compatible exports
  broadcast(data) {
    broadcastGlobal('message', data);
  },
  broadcastNamedEvent(eventName, payload) {
    broadcastGlobal(eventName, payload);
    // Also broadcast as standard message for legacy consumers
    broadcastGlobal('message', { ...payload, type: eventName });
  }
};
