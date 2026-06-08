'use strict';
const Redis = require('ioredis');

function createClient(name, overrides = {}) {
  const baseConfig = {
    ...(process.env.REDIS_URL
      ? {}
      : {
          host:     process.env.REDIS_HOST     || '127.0.0.1',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD  || undefined,
        }
    ),
    tls:                process.env.REDIS_TLS === 'true' ? {} : undefined,
    enableOfflineQueue: false,   // fail fast when Redis is down
    connectTimeout:     2000,    // 2s to establish connection
    commandTimeout:     500,     // 500ms per command — strict
    maxRetriesPerRequest: 1,     // retry once then fail
    retryStrategy: (times) => {
      if (times > 5) return null; // give up after 5 retries
      return Math.min(times * 300, 2000);
    },
    reconnectOnError: (err) => {
      const targets = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targets.some(t => err.message.includes(t)) ? 1 : false;
    },
    keepAlive:        15000,
    enableReadyCheck: true,
    lazyConnect:      false,
    ...overrides,
  };

  const url = process.env.REDIS_URL;
  const config = url ? { ...baseConfig, lazyConnect: false } : baseConfig;
  const client = url ? new Redis(url, config) : new Redis(config);

  client.on('connect',      () => console.log(`[Redis:${name}] Connected`));
  client.on('ready',        () => console.log(`[Redis:${name}] Ready`));
  client.on('error',        e  => {
    // Only log once per error type to avoid log flooding during Redis outage
    if (!client._lastErrorMsg || client._lastErrorMsg !== e.message) {
      console.error(`[Redis:${name}] Error:`, e.message);
      client._lastErrorMsg = e.message;
    }
  });
  client.on('reconnecting', () => console.warn(`[Redis:${name}] Reconnecting`));
  client.on('close',        () => console.warn(`[Redis:${name}] Connection closed`));

  return client;
}

// Primary client — strict 500ms timeout for all regular commands
const primaryClient = createClient('primary');

// Pipeline client — relaxed 5s timeout for batch write operations
const pipelineClient = createClient('pipeline', {
  commandTimeout: 5000,  // 5s for pipeline operations
  maxRetriesPerRequest: 2,
});

// Subscriber client — no command timeout (stays open for pub/sub)
const subscriberClient = createClient('subscriber', {
  commandTimeout: 0,     // 0 = no timeout for subscription connections
  enableOfflineQueue: true, // subscriber must queue to survive reconnects
});

async function warmup() {
  const result = await primaryClient.ping();
  if (result !== 'PONG') throw new Error('[Redis] Warmup ping failed');
  console.log('[Redis] Warmup OK — primary, pipeline, and subscriber clients ready');
}

// Support connection health info
async function isHealthy() {
  try {
    const result = await primaryClient.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

function getConnectionInfo() {
  return {
    status: primaryClient.status || 'unknown',
    isReady: primaryClient.status === 'ready',
  };
}

primaryClient.isHealthy = isHealthy;
primaryClient.getConnectionInfo = getConnectionInfo;

module.exports = primaryClient;
module.exports.pipeline = pipelineClient;
module.exports.subscriber = subscriberClient;
module.exports.warmup = warmup;
