'use strict';

class L1Cache {
  constructor() {
    this.store = new Map();
    this.maxSize = 500; // max 500 entries
    
    // Clean expired entries every 10 seconds
    const timer = setInterval(() => this._evict(), 10_000);
    if (timer.unref) {
      timer.unref();
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    entry.hits++;
    return entry.data;
  }

  set(key, data, ttlMs) {
    // Evict if at capacity — remove the least-recently-set entry
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      setAt: Date.now(),
      hits: 0,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  deletePattern(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + (pattern.includes('*') ? '$' : '.*');
    const regex = new RegExp(regexStr);
    for (const key of this.store.keys()) {
      if (regex.test(key)) this.store.delete(key);
    }
  }

  _evict() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  getStats() {
    return {
      size:     this.store.size,
      maxSize:  this.maxSize,
      keys:     [...this.store.keys()].slice(0, 20),
    };
  }
}

module.exports = new L1Cache();
