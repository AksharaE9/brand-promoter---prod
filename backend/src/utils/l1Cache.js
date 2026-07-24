'use strict';

/**
 * L1Cache — Memory-budgeted LRU Cache for Render Starter instance protection.
 * Ensures a single shared memory budget (~25MB max size, max 500 entries)
 * across all caching features (Dashboard, Candidates, Scheduling) to prevent OOM.
 */
class L1Cache {
  constructor() {
    this.store = new Map();
    this.maxCount = 500; // max 500 entries
    this.maxSizeBytes = 25 * 1024 * 1024; // 25MB total footprint cap
    this.currentSizeBytes = 0;

    // Clean expired entries every 10 seconds
    const timer = setInterval(() => this._evictExpired(), 10_000);
    if (timer.unref) {
      timer.unref();
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._deleteEntry(key);
      return null;
    }
    // Refresh insertion order (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
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
    return {
      size: this.store.size,
      maxCount: this.maxCount,
      currentSizeMB: (this.currentSizeBytes / (1024 * 1024)).toFixed(2),
      maxSizeMB: (this.maxSizeBytes / (1024 * 1024)).toFixed(0),
      keys: [...this.store.keys()].slice(0, 20),
    };
  }
}

module.exports = new L1Cache();
