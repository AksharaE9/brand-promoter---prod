/**
 * Singleton SSE Manager
 * ONE EventSource connection shared across the entire app.
 * Pages subscribe/unsubscribe without touching the connection.
 */
import { buildApiUrl } from './api';

let eventSource = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

const subscribers = new Map(); // id -> callback

function connect() {
  const token = localStorage.getItem('ats_token');
  if (!token) return;
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  clearTimeout(reconnectTimer);

  try {
    // EventSource requires an absolute URL. Since buildApiUrl may return a relative path ('/api/...'),
    // we prefix it with window.location.origin so the request goes through the Vite proxy in dev
    // and works same-origin in production. This prevents CORS failures on direct-to-4000 calls.
    const url = buildApiUrl('/sse/stream');
    const sseOrigin = url.startsWith('http') ? '' : window.location.origin;
    eventSource = new EventSource(`${sseOrigin}${url}?token=${token}`);

    eventSource.onopen = () => {
      reconnectAttempt = 0; // reset attempts on success
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;
        subscribers.forEach((cb) => {
          try { cb(data); } catch (_) { /* ignore */ }
        });
      } catch (_) { /* ignore */ }
    };

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;

      reconnectAttempt++;
      if (reconnectAttempt > 8) {
        console.warn('[SSE] Max reconnect attempts reached (8). Stopping auto-reconnect.');
        subscribers.forEach((cb) => {
          try { cb({ type: 'SSE_MAX_RECONNECT_REACHED' }); } catch (_) { /* ignore */ }
        });
        return;
      }

      // Exponential backoff: 1s * 2^attempt -> max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
      reconnectTimer = setTimeout(() => {
        connect();
      }, delay);
    };
  } catch (_) { /* ignore */ }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  eventSource?.close();
  eventSource = null;
  reconnectAttempt = 0;
}

let subIdCounter = 0;

/**
 * Subscribe to SSE events.
 * @param {Function} callback - called with parsed event data
 * @param {string[]} [types] - optional list of event types to filter
 * @returns {Function} unsubscribe function
 */
export function subscribeSSE(callback, types) {
  const id = ++subIdCounter;
  const handler = types
    ? (data) => { if (types.includes(data.type)) callback(data); }
    : callback;

  subscribers.set(id, handler);

  // Start connection if not already running
  connect();

  return () => {
    subscribers.delete(id);
    // If no subscribers left, close connection
    if (subscribers.size === 0) disconnect();
  };
}

/**
 * Call this on login to pre-connect SSE.
 */
export function initSSE() {
  connect();
}

/**
 * Call this on logout.
 */
export function destroySSE() {
  subscribers.clear();
  disconnect();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reconnectAttempt = 0;
      connect();
      subscribers.forEach((cb) => {
        try { cb({ type: 'VISIBILITY_RECONCILE' }); } catch (_) { /* ignore */ }
      });
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    reconnectAttempt = 0;
    connect();
  });
}
