/**
 * Singleton SSE Manager
 * ONE EventSource connection shared across the entire app.
 * Pages subscribe/unsubscribe without touching the connection.
 */
import { API_BASE_URL } from './api';

let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;

const subscribers = new Map(); // id -> callback

function connect() {
  const token = localStorage.getItem('ats_token');
  if (!token) return;
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  clearTimeout(reconnectTimer);

  try {
    // EventSource requires an absolute URL. Since API_BASE_URL may be relative ('/api'),
    // we prefix it with window.location.origin so the request goes through the Vite proxy in dev
    // and works same-origin in production. This prevents CORS failures on direct-to-4000 calls.
    const sseOrigin = API_BASE_URL.startsWith('http') ? '' : window.location.origin;
    eventSource = new EventSource(`${sseOrigin}${API_BASE_URL}/sse/stream?token=${token}`);

    eventSource.onopen = () => {
      reconnectDelay = 2000; // reset backoff on success
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
      // Exponential backoff reconnect
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay);
    };
  } catch (_) { /* ignore */ }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  eventSource?.close();
  eventSource = null;
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
      connect();
      subscribers.forEach((cb) => {
        try { cb({ type: 'VISIBILITY_RECONCILE' }); } catch (_) { /* ignore */ }
      });
    }
  });
}
