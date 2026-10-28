'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { monitorEventLoopDelay } = require('perf_hooks');

const perfContextStorage = new AsyncLocalStorage();

// Monitor event-loop lag (resolution: 20ms)
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

// Bounded ring buffer for per-route metrics
// Stores up to 100 recent durations and bytes per route
const MAX_SAMPLES_PER_ROUTE = 100;
const routeMetrics = new Map();

function recordRouteMetric(route, method, status, durationMs, bytes) {
  const key = `${method} ${route}`;
  let metric = routeMetrics.get(key);
  if (!metric) {
    metric = {
      method,
      route,
      count: 0,
      durations: [],
      bytes: [],
      totalBytes: 0,
      errors: 0,
    };
    routeMetrics.set(key, metric);
  }

  metric.count++;
  if (status >= 400) metric.errors++;
  metric.totalBytes += bytes || 0;

  metric.durations.push(durationMs);
  if (metric.durations.length > MAX_SAMPLES_PER_ROUTE) {
    metric.durations.shift();
  }

  metric.bytes.push(bytes || 0);
  if (metric.bytes.length > MAX_SAMPLES_PER_ROUTE) {
    metric.bytes.shift();
  }
}

function getPercentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return Number(sorted[index].toFixed(2));
}

function getRouteMetricsSummary() {
  const summary = [];
  for (const [key, m] of routeMetrics.entries()) {
    summary.push({
      route: key,
      count: m.count,
      errors: m.errors,
      p50_ms: getPercentile(m.durations, 50),
      p95_ms: getPercentile(m.durations, 95),
      avg_bytes: m.bytes.length > 0 ? Math.round(m.bytes.reduce((a, b) => a + b, 0) / m.bytes.length) : 0,
      total_bytes: m.totalBytes,
    });
  }
  return summary.sort((a, b) => b.count - a.count);
}

function getEventLoopMetrics() {
  const p99LagMs = (histogram.percentile(99) / 1e6).toFixed(2);
  const maxLagMs = (histogram.max / 1e6).toFixed(2);
  const mem = process.memoryUsage();
  return {
    p99LagMs: Number(p99LagMs),
    maxLagMs: Number(maxLagMs),
    rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
    heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
  };
}

// Log event-loop lag and memory once a minute
setInterval(() => {
  const m = getEventLoopMetrics();
  if (m.p99LagMs > 50 || m.rssMb > 350) {
    console.warn(`[PERF_HEARTBEAT] High event-loop delay or RAM: p99Lag=${m.p99LagMs}ms | rss=${m.rssMb}MB | heap=${m.heapUsedMb}MB`);
  } else if (process.env.DEBUG_PERF === 'true') {
    console.log(`[PERF_HEARTBEAT] p99Lag=${m.p99LagMs}ms | rss=${m.rssMb}MB | heap=${m.heapUsedMb}MB`);
  }
}, 60 * 1000);

module.exports = {
  perfContextStorage,
  recordRouteMetric,
  getRouteMetricsSummary,
  getEventLoopMetrics,
};
