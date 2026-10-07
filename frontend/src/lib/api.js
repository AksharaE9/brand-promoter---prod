import { useAuthStore } from '../stores/authStore';

// In DEV, use a relative base URL ('/api') so all requests route through the
// Vite dev-server proxy (vite.config.js proxy: '/api' → localhost:4000).
// This avoids CORS failures on direct browser→backend calls (EventSource, etc.)
// that would occur with an absolute http://localhost:4000 origin.
// In production the frontend and backend share the same origin so /api is also correct.
const DEFAULT_API_BASE_URL = '/api';
const RESOLVED_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  DEFAULT_API_BASE_URL;
export const API_BASE_URL = RESOLVED_API_BASE_URL.replace(/\/+$/, '');
// Derive the root URL (without /api suffix). For absolute URLs keep current logic;
// for relative paths ('/api') use the browser's own origin so fetch() and EventSource work.
const _isAbsolute = API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://');
export const API_ROOT_URL = _isAbsolute
  ? (API_BASE_URL.endsWith('/api') ? API_BASE_URL.slice(0, -4) : API_BASE_URL)
  : (typeof window !== 'undefined' ? window.location.origin : '');

export function buildApiUrl(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  let cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanPath.startsWith('/api/') && API_BASE_URL.endsWith('/api')) {
    cleanPath = cleanPath.slice(4); // Strip redundant /api prefix
  }
  return `${API_BASE_URL}${cleanPath}`;
}

// Performance: Request Deduplication & Caching
const inflightRequests = new Map();
const apiCache = new Map();
const CACHE_TTL = 90_000; // 90 seconds default

// Routes that benefit from a longer client-side cache (heavy pages)
const LONG_CACHE_ROUTES = [
  '/dashboard/init',
  '/dashboard/summary',
  '/interviews',
  '/candidates',
  '/jobs',
  '/users/interviewers',
  '/users',
];
const LONG_CACHE_TTL = 5 * 60_000; // 5 minutes

// Registered QueryClient and cleanup callbacks for session wipe
let _registeredQueryClient = null;
const _sessionExpiryCallbacks = new Set();

export function registerQueryClient(client) {
  _registeredQueryClient = client;
}

export function registerSessionExpiryCallback(callback) {
  if (typeof callback === 'function') {
    _sessionExpiryCallbacks.add(callback);
  }
  return () => _sessionExpiryCallbacks.delete(callback);
}

// Multi-Tab Synchronization via BroadcastChannel & storage event
let authBroadcastChannel = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    authBroadcastChannel = new BroadcastChannel('ats_auth_channel');
    authBroadcastChannel.onmessage = (event) => {
      if (event?.data?.type === 'SESSION_EXPIRED') {
        performLocalAuthWipe();
        const reason = event.data.reason || 'session_expired';
        const returnTo = event.data.returnTo || getSafeReturnTo();
        redirectToLogin(reason, returnTo);
      }
    };
  } catch (_) {
    // Fallback handled by storage event listener
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'ats_session_expired_event' && event.newValue) {
      performLocalAuthWipe();
      redirectToLogin('session_expired', getSafeReturnTo());
    }
  });
}

// ── Keep-Alive: ping Render every 10 minutes to prevent cold starts ──────────
const HEALTH_URL = buildApiUrl('/health');
let _keepAlivePing = null;
export function startKeepAlive() {
  if (_keepAlivePing) return; // already running
  const ping = () => {
    fetch(HEALTH_URL, { method: 'GET', cache: 'no-store' }).catch(() => {});
  };
  ping(); // immediate first ping
  _keepAlivePing = setInterval(ping, 10 * 60 * 1000); // every 10 minutes
}
export function stopKeepAlive() {
  if (_keepAlivePing) { clearInterval(_keepAlivePing); _keepAlivePing = null; }
}

export function getStoredToken() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('ats_token');
}

export function getStoredRefreshToken() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('ats_refresh_token');
}

export function getStoredUser() {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('ats_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function hasToken() {
  return Boolean(getStoredToken());
}

export function isAuthenticatedRoute(url) {
  if (!url) return false;
  let pathname = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      pathname = new URL(url).pathname;
    } catch (_) {
      // ignore
    }
  }
  const cleanPath = pathname.replace(/\/+/g, '/');
  const publicRoutes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/signup',
    '/api/health',
    '/api/version'
  ];
  const isApi = cleanPath.startsWith('/api') || cleanPath.startsWith(API_BASE_URL);
  if (!isApi) return false;
  return !publicRoutes.some(route => cleanPath.startsWith(route));
}

// ── Safe returnTo URL Validator ──────────────────────────────────────────────
export function getSafeReturnTo(candidatePath) {
  if (typeof window === 'undefined') return '/';
  const raw = candidatePath || (window.location.pathname + window.location.search);
  if (!raw || typeof raw !== 'string') return '/workspaces';
  // Must start with '/' and must NOT start with '//' or contain ':' before a slash (prevents open redirects)
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('javascript:')) {
    return '/workspaces';
  }
  if (raw.startsWith('/login') || raw.startsWith('/signup')) {
    return '/workspaces';
  }
  return raw;
}

// ── Local Auth State Wipe ──────────────────────────────────────────────────
function performLocalAuthWipe() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('ats_token');
    localStorage.removeItem('ats_user');
    localStorage.removeItem('ats_refresh_token');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
  }
  apiCache.clear();
  try {
    useAuthStore.getState().clearAuth();
  } catch (_) {}

  if (_registeredQueryClient) {
    try {
      if (typeof _registeredQueryClient.cancelQueries === 'function') {
        _registeredQueryClient.cancelQueries();
      }
      _registeredQueryClient.clear();
    } catch (_) {}
  }

  for (const cb of _sessionExpiryCallbacks) {
    try {
      cb();
    } catch (_) {}
  }
}

// ── Safe Redirect to Login ─────────────────────────────────────────────────
let _isRedirecting = false;
function redirectToLogin(reason = 'session_expired', returnTo = '') {
  if (typeof window === 'undefined') return;
  if (_isRedirecting) return;
  if (window.location.pathname.startsWith('/login') || window.location.pathname.startsWith('/signup')) {
    return;
  }
  _isRedirecting = true;
  const safeReturn = getSafeReturnTo(returnTo);
  const targetUrl = `/login?reason=${encodeURIComponent(reason)}&returnTo=${encodeURIComponent(safeReturn)}`;
  window.location.href = targetUrl;
}

/**
 * handle401SessionExpiry — central session-expiry executor.
 * Broadcasts across tabs, clears all storage and QueryClient cache, and redirects cleanly.
 */
let _isHandlingExpiry = false;
export function handle401SessionExpiry(reason = 'session_expired', customMessage = null) {
  if (_isHandlingExpiry) return;
  _isHandlingExpiry = true;

  performLocalAuthWipe();

  const safeReturn = getSafeReturnTo();

  // Broadcast to other tabs
  if (authBroadcastChannel) {
    try {
      authBroadcastChannel.postMessage({
        type: 'SESSION_EXPIRED',
        reason,
        returnTo: safeReturn,
        message: customMessage,
      });
    } catch (_) {}
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('ats_session_expired_event', Date.now().toString());
    } catch (_) {}
  }

  redirectToLogin(reason, safeReturn);
  setTimeout(() => { _isHandlingExpiry = false; }, 2000);
}

export function setAuthTokens(token, refreshToken = null) {
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('ats_token', token);
    else localStorage.removeItem('ats_token');
    if (refreshToken) localStorage.setItem('ats_refresh_token', refreshToken);
    else localStorage.removeItem('ats_refresh_token');
  }
}

export function clearAuth() {
  performLocalAuthWipe();
}
export const clearAuthTokens = clearAuth;

// ── Single-Flight Token Refresh Queue ──────────────────────────────────────
let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.map(cb => cb(token));
  refreshSubscribers = [];
}

function onRefreshFailed(err) {
  refreshSubscribers.map(cb => cb(null, err));
  refreshSubscribers = [];
}

async function attemptTokenRefresh() {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      subscribeTokenRefresh((newToken, err) => {
        if (err || !newToken) reject(err || new Error('Token refresh failed'));
        else resolve(newToken);
      });
    });
  }

  const currentRefreshToken = getStoredRefreshToken() || getStoredToken();
  if (!currentRefreshToken) {
    throw new Error('No refresh token available');
  }

  isRefreshing = true;
  try {
    const refreshUrl = buildApiUrl('/auth/refresh');
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentRefreshToken}`,
      },
      body: JSON.stringify({ refreshToken: currentRefreshToken }),
    });

    if (!response.ok) {
      throw new Error(`Refresh failed with status ${response.status}`);
    }

    const json = await response.json();
    const newToken = json?.data?.token;
    if (!newToken) {
      throw new Error('No token returned from refresh endpoint');
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ats_token', newToken);
      if (json?.data?.user) {
        localStorage.setItem('ats_user', JSON.stringify(json.data.user));
        try {
          useAuthStore.getState().setAuth(newToken, json.data.user);
        } catch (_) {}
      }
    }

    onRefreshed(newToken);
    return newToken;
  } catch (err) {
    onRefreshFailed(err);
    throw err;
  } finally {
    isRefreshing = false;
  }
}

// ── Core Request Execution Pipeline with Consolidated Interceptor ────────────
export async function request(path, options = {}, retries = 1) {
  const url = buildApiUrl(path);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  const token = getStoredToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Auto-propagate or generate Request ID
  if (!headers['X-Request-Id']) {
    headers['X-Request-Id'] = `req_fe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  if (isAuthenticatedRoute(url) && !headers.Authorization) {
    console.warn('[Security Guard] Authenticated request built without Authorization header:', url);
  }

  // Handle non-FormData JSON payload stringification
  let requestBody = options.body;
  if (!isFormData && requestBody && typeof requestBody === 'object' && !(requestBody instanceof String)) {
    requestBody = JSON.stringify(requestBody);
  }

  const isGet = !options.method || options.method === 'GET';
  const requestKey = `${options.method || 'GET'}:${path}`;

  // Deduplication for GET requests
  if (isGet && !options.bypassCache && inflightRequests.has(requestKey)) {
    return inflightRequests.get(requestKey);
  }

  // Cache lookup
  if (isGet && !options.bypassCache && apiCache.has(requestKey)) {
    const cached = apiCache.get(requestKey);
    const ttl = LONG_CACHE_ROUTES.some(r => path.startsWith(r)) ? LONG_CACHE_TTL : CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }
    apiCache.delete(requestKey);
  }

  const TIMEOUT_MS = isGet ? 45000 : 60000;

  const fetchPromise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delayMs = lastErr && lastErr.retryAfter ? parseInt(lastErr.retryAfter, 10) * 1000 : 1000;
        await new Promise(r => setTimeout(r, delayMs));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const onAbort = () => { controller.abort(); };
      if (options.signal) {
        if (options.signal.aborted) {
          controller.abort();
        } else {
          options.signal.addEventListener('abort', onAbort);
        }
      }

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          body: requestBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }

        let data = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try { data = await response.json(); } catch (_) { data = null; }
        } else {
          try { data = { message: await response.text() }; } catch (_) { data = null; }
        }

        const serverRequestId =
          response.headers.get('X-Request-Id') ||
          data?.error?.requestId ||
          data?.requestId ||
          headers['X-Request-Id'];

        // ── Response Interceptor ─────────────────────────────────────────────
        if (!response.ok) {
          const errorCode = data?.error?.code || data?.code || `HTTP_${response.status}`;
          const extractedMessage =
            data?.error?.message ||
            data?.message ||
            (Array.isArray(data?.errors) && data.errors.length > 0 ? data.errors.join(', ') : null) ||
            (typeof data?.error === 'string' ? data.error : null) ||
            `Request failed with status ${response.status}`;

          const error = new Error(extractedMessage);
          error.status = response.status;
          error.code = errorCode;
          error.requestId = serverRequestId;
          error.payload = data;
          error.response = { data, status: response.status, headers: response.headers };
          error.isAuthError = response.status === 401;
          error.isForbidden = response.status === 403;
          error.isServerError = response.status >= 500;
          error.retryAfter = response.headers.get('Retry-After');

          // ── 401 Handling: Refresh or Expire ──
          if (response.status === 401) {
            // Check if this request can be refreshed once
            if (!options._isRetryAfterRefresh) {
              try {
                const refreshedToken = await attemptTokenRefresh();
                if (refreshedToken) {
                  // Replay original request with fresh token
                  return await request(path, {
                    ...options,
                    _isRetryAfterRefresh: true,
                    headers: {
                      ...headers,
                      Authorization: `Bearer ${refreshedToken}`,
                    },
                  }, 0);
                }
              } catch (_) {
                // Refresh failed — proceed to session expiry
              }
            }

            const reason = errorCode === 'AUTH_USER_INACTIVE' ? 'user_inactive' : 'session_expired';
            handle401SessionExpiry(reason, extractedMessage);
            throw error;
          }

          // ── 403 Forbidden: Surface message, NEVER sign out ──
          if (response.status === 403) {
            throw error;
          }

          // ── 4xx Client Errors: Do not retry, surface error ──
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }

          // ── 5xx Server Errors: Never sign out, record and retry if allowed ──
          lastErr = error;
          continue;
        }

        if (isGet) {
          apiCache.set(requestKey, { data, timestamp: Date.now() });
        }
        return data;
      } catch (err) {
        clearTimeout(timeout);
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }

        if (err.name === 'AbortError') {
          if (options.signal?.aborted) throw err;
          lastErr = new Error('Request timed out. Server may be waking up — please try again.');
          lastErr.isNetworkError = true;
          if (!isGet) continue;
          continue;
        }

        if (!err.status && (err instanceof TypeError || err.message?.includes('fetch'))) {
          lastErr = new Error('Could not reach the server. Please check your connection and try again.');
          lastErr.isNetworkError = true;
          if (attempt < retries) continue;
          break;
        }

        if (err.status >= 400 && err.status < 500) throw err;
        lastErr = err;
      } finally {
        if (isGet && attempt === retries) inflightRequests.delete(requestKey);
      }
    }
    throw lastErr || new Error('Request failed after retries');
  })();

  if (isGet) {
    inflightRequests.set(requestKey, fetchPromise);
    fetchPromise.finally(() => inflightRequests.delete(requestKey)).catch(() => {});
  }

  return fetchPromise;
}

export function apiGet(path, useCache = true, options = {}) {
  if (!useCache) {
    const requestKey = `GET:${path}`;
    apiCache.delete(requestKey);
  }
  return request(path, { method: 'GET', bypassCache: !useCache, ...options });
}

export async function apiGetBlob(path) {
  const url = buildApiUrl(path);
  const token = getStoredToken();
  const headers = { 'X-Request-Id': `req_fe_blob_${Date.now()}` };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      handle401SessionExpiry();
    }
    const data = await response.json().catch(() => ({}));
    const msg = data?.error?.message || data?.message || `Export failed (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.payload = data;
    throw err;
  }

  return response.blob();
}

function invalidateRelated(path) {
  const resource = '/' + (path.split('/')[1] || '');
  for (const key of apiCache.keys()) {
    if (key.includes(resource)) apiCache.delete(key);
  }
  if (resource === '/team' || resource === '/users') {
    for (const key of apiCache.keys()) {
      if (key.includes('/team') || key.includes('/users')) {
        apiCache.delete(key);
      }
    }
  }
  if (['/candidates', '/applications', '/jobs', '/interviews'].includes(resource)) {
    for (const key of apiCache.keys()) {
      if (key.includes('/analytics') || key.includes('/dashboard')) {
        apiCache.delete(key);
      }
    }
  }
}

export function apiPost(path, body, options = {}) {
  invalidateRelated(path);
  return request(path, { method: 'POST', body, ...options });
}

export async function apiQuery(path, body, options = {}) {
  const useQueryMethod = import.meta.env.VITE_DISABLE_HTTP_QUERY !== 'true';

  if (useQueryMethod) {
    try {
      return await request(path, {
        method: 'QUERY',
        body,
        ...options
      });
    } catch (err) {
      console.warn('HTTP QUERY method failed or is unsupported, falling back to POST /search', err);
      const fallbackPath = `${path.replace(/\/+$/, '')}/search`;
      return await request(fallbackPath, {
        method: 'POST',
        body,
        ...options
      });
    }
  } else {
    const fallbackPath = `${path.replace(/\/+$/, '')}/search`;
    return await request(fallbackPath, {
      method: 'POST',
      body,
      ...options
    });
  }
}

export function apiPut(path, body, options = {}) {
  invalidateRelated(path);
  return request(path, { method: 'PUT', body, ...options });
}

export function apiPatch(path, body, options = {}) {
  invalidateRelated(path);
  return request(path, { method: 'PATCH', body, ...options });
}

export function apiDelete(path, options = {}) {
  invalidateRelated(path);
  return request(path, { method: 'DELETE', ...options });
}

export async function apiViewFile(path) {
  const newTab = window.open('about:blank', '_blank');
  if (newTab) {
    newTab.document.write('<p style="font-family: sans-serif; text-align: center; margin-top: 50px;">Loading document...</p>');
  }
  
  try {
    const token = getStoredToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(buildApiUrl(path), {
      headers
    });
    if (!res.ok) {
      if (res.status === 401) handle401SessionExpiry();
      throw new Error(`Failed to fetch file: ${res.statusText}`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    if (newTab) {
      newTab.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  } catch (err) {
    if (newTab) {
      newTab.close();
    }
    throw err;
  }
}

export async function downloadAuthenticatedFile(path, suggestedFilename) {
  const token = getStoredToken();
  const url = buildApiUrl(path);
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      handle401SessionExpiry();
    }
    let message = `Download failed (${response.status})`;
    try {
      const text = await response.text();
      const parsed = JSON.parse(text);
      if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
      else if (typeof parsed?.error === 'string') message = parsed.error;
      else if (typeof parsed?.message === 'string') message = parsed.message;
    } catch {
      // not JSON
    }
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  
  // Reject text/html to prevent downloading the SPA fallback index.html shell
  if (contentType.includes('text/html') && !suggestedFilename.toLowerCase().endsWith('.html')) {
    throw new Error('File not found or no longer available on this server.');
  }

  // Handle JSON error responses returned with 200 status code
  if (contentType.includes('application/json')) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.error === 'string') throw new Error(parsed.error);
      if (typeof parsed?.error?.message === 'string') throw new Error(parsed.error.message);
      if (typeof parsed?.message === 'string') throw new Error(parsed.message);
      if (parsed?.success === false) {
        throw new Error(
          parsed?.error?.message ||
          (typeof parsed?.error === 'string' ? parsed.error : null) ||
          parsed?.message ||
          'Server returned an error response.'
        );
      }
    } catch (e) {
      if (e.message) throw e;
    }
  }

  const cd = response.headers.get('content-disposition');
  let filenameFromServer = null;
  if (cd) {
    const rfcMatch = cd.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/i);
    if (rfcMatch && rfcMatch[1]) {
      try {
        filenameFromServer = decodeURIComponent(rfcMatch[1].trim());
      } catch (_) {}
    }
    if (!filenameFromServer) {
      const standardMatch = cd.match(/filename="?([^";]+)"?/i);
      if (standardMatch && standardMatch[1]) {
        try {
          filenameFromServer = decodeURIComponent(standardMatch[1].trim());
        } catch (_) {
          filenameFromServer = standardMatch[1].trim();
        }
      }
    }
  }
  const filename = filenameFromServer || suggestedFilename;

  const blob = await response.blob();

  // Validate ZIP magic bytes ONLY if the file is expected to be XLSX and is not a CSV/text response
  const isXlsxRequested = filename.toLowerCase().endsWith('.xlsx');
  const isCsvOrText = contentType.includes('text/csv') || contentType.includes('text/plain') || filename.toLowerCase().endsWith('.csv');

  if (isXlsxRequested && !isCsvOrText) {
    const firstBytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isValidZip = firstBytes[0] === 0x50 && firstBytes[1] === 0x4B
                    && firstBytes[2] === 0x03 && firstBytes[3] === 0x04;
    if (!isValidZip) {
      throw new Error('Downloaded file is not a valid XLSX (server returned unexpected content).');
    }
  }

  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
