'use strict';
const Redis = require('ioredis');

const sharedConfig = {
  enableOfflineQueue:     false,  // Fail fast when disconnected to avoid hanging HTTP requests
  connectTimeout:         2000,   // 2 seconds connect timeout
  commandTimeout:         500,    // 500ms command timeout for fast fallback
  keepAlive:              30000,
  lazyConnect:            false,
  enableReadyCheck:       true,
  maxRetriesPerRequest:   1,      // Limit command retries to avoid latency spikes
  retryStrategy: (times) => {
    if (times > 3) {
      console.error('[Redis] Too many connection failures, disabling retries');
      return null;
    }
    return Math.min(times * 300, 2000);
  },
  reconnectOnError: (err) => {
    const targets = ['READONLY','ECONNRESET','ETIMEDOUT','ENOTFOUND'];
    return targets.some(t => err.message.includes(t)) ? 1 : false;
  },
};

const redisUrl = process.env.REDIS_URL;

// Primary client for reads, writes, pipelines
const client = redisUrl ? new Redis(redisUrl, sharedConfig) : new Redis({
  host:                   process.env.REDIS_HOST     || '127.0.0.1',
  port:               parseInt(process.env.REDIS_PORT) || 6379,
  password:               process.env.REDIS_PASSWORD || undefined,
  tls:         process.env.REDIS_TLS === 'true' ? {} : undefined,
  ...sharedConfig
});

// Subscriber client ONLY for SSE or pub/sub — never share with regular commands
// because a subscribed client cannot run other commands
const subscriberClient = redisUrl ? new Redis(redisUrl, sharedConfig) : new Redis({
  host:                   process.env.REDIS_HOST     || '127.0.0.1',
  port:               parseInt(process.env.REDIS_PORT) || 6379,
  password:               process.env.REDIS_PASSWORD || undefined,
  tls:         process.env.REDIS_TLS === 'true' ? {} : undefined,
  ...sharedConfig
});

client.on('connect',      () => console.log('[Redis:primary] Connected'));
client.on('ready',        () => console.log('[Redis:primary] Ready'));
client.on('error',        e  => console.error('[Redis:primary] Error:', e.message));
client.on('reconnecting', () => console.warn('[Redis:primary] Reconnecting'));

subscriberClient.on('connect', () => console.log('[Redis:subscriber] Connected'));
subscriberClient.on('error',   e  => console.error('[Redis:subscriber] Error:', e.message));

// Warmup — verify connection before server accepts traffic
async function warmup() {
  const result = await client.ping();
  if (result !== 'PONG') throw new Error('Redis warmup failed');
  console.log('[Redis] Warmup OK');
}

// Keep health methods on client for compatibility
async function isHealthy() {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

function getConnectionInfo() {
  return {
    status: client.status || 'unknown',
    isReady: client.status === 'ready',
  };
}

client.isHealthy = isHealthy;
client.getConnectionInfo = getConnectionInfo;

module.exports = client;
module.exports.subscriber = subscriberClient;
module.exports.warmup = warmup;
