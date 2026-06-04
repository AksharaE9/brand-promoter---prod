'use strict';
const Redis = require('ioredis');

const redisConfig = {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 20) return null; // stop retrying after 20 attempts
    return Math.min(times * 200, 5000);
  },
  reconnectOnError: (err) => {
    const retry = ['READONLY', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'];
    return retry.some(e => err.message.includes(e));
  },
  enableOfflineQueue: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
  lazyConnect: false,
  enableReadyCheck: true,
};

let redis;

function getRedisClient() {
  if (!redis) {
    if (process.env.REDIS_URL) {
      redis = new Redis(process.env.REDIS_URL, redisConfig);
    } else {
      redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        ...redisConfig
      });
    }
    redis.on('connect',      () => console.log('[Redis] Connected'));
    redis.on('ready',        () => console.log('[Redis] Ready'));
    redis.on('error',        (e) => console.error('[Redis] Error:', e.message));
    redis.on('close',        () => console.warn('[Redis] Connection closed'));
    redis.on('reconnecting', () => console.log('[Redis] Reconnecting...'));
  }
  return redis;
}

const client = getRedisClient();

/**
 * Check if Redis connection is healthy
 * @returns {Promise<boolean>}
 */
async function isHealthy() {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Get Redis connection info for monitoring
 * @returns {{ status: string, isReady: boolean }}
 */
function getConnectionInfo() {
  return {
    status: client.status || 'unknown',
    isReady: client.status === 'ready',
  };
}

// Attach health methods to the client instance
client.isHealthy = isHealthy;
client.getConnectionInfo = getConnectionInfo;

module.exports = client;
