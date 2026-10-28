'use strict';

/**
 * L1Cache — Memory-budgeted LRU Cache for Render Starter instance protection.
 * Ensures a single shared memory budget (~25MB max size, max 500 entries)
 * across all caching features (Dashboard, Candidates, Scheduling) to prevent OOM.
 */
class L1Cache {
  constructor() {
    this.store = new Map();
    this.inFlight = new Map();
    this.maxCount = 500; // max 500 entries
    this.maxSizeBytes = 20 * 1024 * 1024; // 20MB total footprint cap (Track 3)
    this.currentSizeBytes = 0;
    this.hits = 0;
    this.misses = 0;

    // Clean expired entries every 10 seconds
    const timer = setInterval(() => this._evictExpired(), 10_000);
    if (timer.unref) {
      timer.unref();
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this._deleteEntry(key);
      this.misses++;
      return null;
    }
    this.hits++;
    // Refresh insertion order (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  /**
   * Single-flight cache retrieval:
   * Concurrent misses for the same key share a single execution of fetchFn.
   */
  async getOrSet(key, fetchFn, ttlMs) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    if (this.inFlight.has(key)) {
      return await this.inFlight.get(key);
    }

    const promise = Promise.resolve()
      .then(() => fetchFn())
      .then((data) => {
        this.set(key, data, ttlMs);
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return await promise;
  }

  set(key, data, ttlMs) {
    if (data === null || data === undefined) return;

    // Calculate size of new entry
    let entrySize = 0;
    try {
      entrySize = JSON.stringify(data).length;
    } catch (_) {
      entrySize = 1024; // Fallback estimate 1KB if JSON serialization fails
    }

    // Delete existing entry if present
    if (this.store.has(key)) {
      this._deleteEntry(key);
    }

    // Enforce limits before adding the new entry
    while (
      (this.store.size >= this.maxCount || this.currentSizeBytes + entrySize > this.maxSizeBytes) &&
      this.store.size > 0
    ) {
      // Remove least-recently-used item (first key in Map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this._deleteEntry(oldestKey);
      }
    }

    // Add new entry
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      sizeBytes: entrySize,
    });
    this.currentSizeBytes += entrySize;
  }

  delete(key) {
    this._deleteEntry(key);
  }

  deletePattern(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + (pattern.includes('*') ? '$' : '.*');
    const regex = new RegExp(regexStr);
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this._deleteEntry(key);
      }
    }
  }

  _deleteEntry(key) {
    const entry = this.store.get(key);
    if (entry) {
      this.currentSizeBytes = Math.max(0, this.currentSizeBytes - entry.sizeBytes);
      this.store.delete(key);
    }
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this._deleteEntry(key);
      }
    }
  }

  getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? ((this.hits / totalRequests) * 100).toFixed(1) + '%' : '0.0%';
    return {
      size: this.store.size,
      maxCount: this.maxCount,
      currentSizeMB: (this.currentSizeBytes / (1024 * 1024)).toFixed(2),
      maxSizeMB: (this.maxSizeBytes / (1024 * 1024)).toFixed(0),
      hits: this.hits,
      misses: this.misses,
      hitRate,
      keys: [...this.store.keys()].slice(0, 20),
    };
  }
}

module.exports = new L1Cache();
