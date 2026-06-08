'use strict';
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../utils/redisClient');

class SelfHealingStore {
  constructor(options) {
    this.memoryStore = new MemoryStore();
    this.redisStore = new RedisStore(options);
    this.useMemoryFallback = false;
    this.lastFailureTime = 0;
    this.fallbackDurationMs = 60000; // 1 minute
  }

  async init(options) {
    this.memoryStore.init(options);
    try {
      await this.redisStore.init(options);
    } catch (err) {
      console.warn(`[RateLimiter] Failed to initialize RedisStore, falling back to MemoryStore:`, err.message);
      this.useMemoryFallback = true;
      this.lastFailureTime = Date.now();
    }
  }

  shouldUseMemory() {
    if (this.useMemoryFallback) {
      if (Date.now() - this.lastFailureTime > this.fallbackDurationMs) {
        this.useMemoryFallback = false;
        return false;
      }
      return true;
    }
    return false;
  }

  async get(key) {
    if (this.shouldUseMemory()) {
      return this.memoryStore.get(key);
    }
    try {
      return await this.redisStore.get(key);
    } catch (err) {
      console.warn(`[RateLimiter] RedisStore.get failed, falling back to MemoryStore:`, err.message);
      this.useMemoryFallback = true;
      this.lastFailureTime = Date.now();
      return this.memoryStore.get(key);
    }
  }

  async increment(key) {
    if (this.shouldUseMemory()) {
      return this.memoryStore.increment(key);
    }
    try {
      return await this.redisStore.increment(key);
    } catch (err) {
      console.warn(`[RateLimiter] RedisStore.increment failed, falling back to MemoryStore:`, err.message);
      this.useMemoryFallback = true;
      this.lastFailureTime = Date.now();
      return this.memoryStore.increment(key);
    }
  }

  async decrement(key) {
    if (this.shouldUseMemory()) {
      return this.memoryStore.decrement(key);
    }
    try {
      await this.redisStore.decrement(key);
    } catch (err) {
      console.warn(`[RateLimiter] RedisStore.decrement failed, falling back to MemoryStore:`, err.message);
      this.useMemoryFallback = true;
      this.lastFailureTime = Date.now();
      await this.memoryStore.decrement(key);
    }
  }

  async resetKey(key) {
    if (this.shouldUseMemory()) {
      return this.memoryStore.resetKey(key);
    }
    try {
      await this.redisStore.resetKey(key);
    } catch (err) {
      console.warn(`[RateLimiter] RedisStore.resetKey failed, falling back to MemoryStore:`, err.message);
      this.useMemoryFallback = true;
      this.lastFailureTime = Date.now();
      await this.memoryStore.resetKey(key);
    }
  }
}

function createLimiter(windowMs, max, prefix) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    validate: false,
    store: new SelfHealingStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `ratelimit:${prefix}:`,
    }),
    keyGenerator: (req) => {
      const clientIpOrOrg = (req.user?.organizationId || req.ip || 'unknown').replace(/:/g, '_');
      const userId = (req.user?.id || 'anon').replace(/:/g, '_');
      return `${clientIpOrOrg}__${userId}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    },
  });
}

module.exports = {
  authLimiter:      createLimiter(15 * 60_000, 20,   'auth'),
  apiLimiter:       createLimiter(60 * 1000,   200,  'api'),
  uploadLimiter:    createLimiter(60 * 60_000, 10,   'upload'),
  analyticsLimiter: createLimiter(60 * 1000,   30,   'analytics'),
  exportLimiter:    createLimiter(60 * 60_000, 5,    'export'),
};
