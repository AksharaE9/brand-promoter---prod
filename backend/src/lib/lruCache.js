'use strict';

/**
 * A lightweight, custom Map-based bounded LRU Cache.
 * Avoids any CommonJS/ESM dependency conflict issues or security vulnerabilities.
 */
class BoundedLRU {
  /**
   * @param {Object} options
   * @param {number} [options.max=50] Maximum number of keys to retain in cache.
   * @param {number} [options.ttl=30000] Time-to-live in milliseconds (default 30 seconds).
   */
  constructor({ max = 50, ttl = 30000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.cache = new Map();
  }

  /**
   * Get value associated with key. Updates LRU status.
   * Returns null if not found or expired.
   * @param {string} key
   * @returns {*} Cached value or null
   */
  get(key) {
    if (!this.cache.has(key)) return null;

    const entry = this.cache.get(key);
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Refresh entry position in Map insertion order (moves to newest)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Store value associated with key. Replaces existing key.
   * Drops least-recently-used entry if max size is exceeded.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      // Get the first key in insertion order (oldest) and delete it
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Evict specific entry
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }
}

module.exports = BoundedLRU;
