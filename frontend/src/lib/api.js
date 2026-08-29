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
  return localStorage.getItem('ats_token');
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
    '/api/auth/signup',
    '/api/health'
  ];
  const isApi = cleanPath.startsWith('/api') || cleanPath.startsWith(API_BASE_URL);
  if (!isApi) return false;
  return !publicRoutes.some(route => cleanPath.startsWith(route));
}

async function request(path, options = {}, retries = 1) {
  const url = buildApiUrl(path);
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (isAuthenticatedRoute(url) && !headers.Authorization) {
    console.error('Authenticated request built without Authorization header:', url);
    if (import.meta.env.DEV) {
      throw new Error(`[Security Guard] Authenticated request built without Authorization header: ${url}`);
    }
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

  // Mutations get 60s, GETs get 45s (Render cold starts can take 30s)
  const TIMEOUT_MS = isGet ? 45000 : 60000;

  const fetchPromise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Backoff: 0ms first, respect Retry-After or default to 1000ms on retry
      if (attempt > 0) {
        const delayMs = lastErr && lastErr.retryAfter ? parseInt(lastErr.retryAfter, 10) * 1000 : 1000;
        await new Promise(r => setTimeout(r, delayMs));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const onAbort = () => {
        controller.abort();
      };

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
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }

        let data = null;
        try { data = await response.json(); } catch (_) { data = null; }

        if (!response.ok) {
          const message = data?.message || `Request failed (${response.status})`;
          const error = new Error(message);
          error.status = response.status;
          error.payload = data;
          error.retryAfter = response.headers.get('Retry-After');
          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            // 401 on an authenticated route = dead session (token expired/revoked).
            // Clear auth state and redirect to login — do this BEFORE throwing so
            // callers receive the error but the redirect has already been queued.
            if (response.status === 401) {
              handle401SessionExpiry();
            }
            throw error;
          }
          lastErr = error;
          continue; // retry on 5xx
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
          if (options.signal?.aborted) {
            throw err;
          }
          // Genuine timeout — the request was started but didn't respond in time.
          // This is the cold-start / slow-server scenario in production.
          lastErr = new Error('Request timed out. Server may be waking up — please try again.');
          if (!isGet) continue; // retry mutations on timeout
          continue;
        }
        // Connection-level failures (ERR_CONNECTION_REFUSED, ERR_CONNECTION_RESET,
        // CORS pre-flight blocked, etc.) arrive here as TypeError with no .status.
        // These are fundamentally different from a timeout: nothing is listening or
        // the request was outright rejected, not just slow.
        if (!err.status && (err instanceof TypeError)) {
          const msg = err.message || '';
          // ERR_CONNECTION_REFUSED / ERR_CONNECTION_RESET / network failure
          lastErr = new Error(
            'Could not reach the server — please check it is running and try again.'
          );
          if (attempt < retries) continue;
          break;
        }
        if (err.status >= 400 && err.status < 500) throw err; // don't retry 4xx
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
  // Option to bypass cache if needed
  if (!useCache) {
    const requestKey = `GET:${path}`;
    apiCache.delete(requestKey);
  }
  return request(path, { method: 'GET', bypassCache: !useCache, ...options });
}

export async function apiGetBlob(path) {
  const url = buildApiUrl(path);
  const token = localStorage.getItem('ats_token');
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
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Export failed (${response.status})`);
  }

  return response.blob();
}

function invalidateRelated(path) {
  // Targeted: only clear cache keys matching the top-level resource
  const resource = '/' + (path.split('/')[1] || '');
  for (const key of apiCache.keys()) {
    if (key.includes(resource)) apiCache.delete(key);
  }
  // Cross-invalidation for user/team
  if (resource === '/team' || resource === '/users') {
    for (const key of apiCache.keys()) {
      if (key.includes('/team') || key.includes('/users')) {
        apiCache.delete(key);
      }
    }
  }
  // Clear analytics and dashboard cache on any candidate, application, job, or interview mutation
  if (['/candidates', '/applications', '/jobs', '/interviews'].includes(resource)) {
    for (const key of apiCache.keys()) {
      if (key.includes('/analytics') || key.includes('/dashboard')) {
        apiCache.delete(key);
      }
    }
  }
}

export function apiPost(path, body) {
  invalidateRelated(path);
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiQuery(path, body, options = {}) {
  const useQueryMethod = import.meta.env.VITE_DISABLE_HTTP_QUERY !== 'true';

  if (useQueryMethod) {
    try {
      return await request(path, {
        method: 'QUERY',
        body: JSON.stringify(body),
        ...options
      });
    } catch (err) {
      console.warn('HTTP QUERY method failed or is unsupported, falling back to POST /search', err);
      const fallbackPath = `${path.replace(/\/+$/, '')}/search`;
      return await request(fallbackPath, {
        method: 'POST',
        body: JSON.stringify(body),
        ...options
      });
    }
  } else {
    const fallbackPath = `${path.replace(/\/+$/, '')}/search`;
    return await request(fallbackPath, {
      method: 'POST',
      body: JSON.stringify(body),
      ...options
    });
  }
}

export function apiPut(path, body) {
  invalidateRelated(path);
  return request(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiPatch(path, body) {
  invalidateRelated(path);
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete(path) {
  invalidateRelated(path);
  return request(path, { method: 'DELETE' });
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

export function clearAuth() {
  localStorage.removeItem('ats_token');
  localStorage.removeItem('ats_user');
  apiCache.clear();
  try {
    useAuthStore.getState().clearAuth();
  } catch (_) {
    // ignore
  }
}

/**
 * handle401SessionExpiry — called whenever any API request receives a 401.
 *
 * Differentiates between two 401 scenarios:
 *  a) Missing Authorization header — already caught by the security guard above;
 *     the request was never sent. This function won't be called in that case.
 *  b) Token present but expired/invalid — the server rejected a valid-looking request.
 *     This is the genuine session-expiry case. We must clear state and redirect.
 *
 * One central call site prevents the UI from continuing to render as authenticated
 * while all requests silently fail in the background.
 */
export function handle401SessionExpiry() {
  // Clear all auth state immediately
  localStorage.removeItem('ats_token');
  localStorage.removeItem('ats_user');
  apiCache.clear();
  try {
    useAuthStore.getState().clearAuth();
  } catch (_) {
    // ignore
  }

  // Avoid a redirect loop if we're already on the login page
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/login?sessionExpired=true&returnTo=${encodeURIComponent(returnTo)}`;
  }
}

export function getStoredUser() {
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
    let message = `Download failed (${response.status})`;
    try {
      const text = await response.text();
      const parsed = JSON.parse(text);
      if (typeof parsed?.error === 'string') message = parsed.error;
      else if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
      else if (typeof parsed?.message === 'string') message = parsed.message;
    } catch {
      // not JSON
    }
    throw new Error(message);
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
          (typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message) ||
          parsed?.message ||
          'Server returned an error response.'
        );
      }
    } catch (e) {
      if (e.message) throw e;
    }
  }

  const cd = response.headers.get('content-disposition');
  const filenameFromServer = cd?.match(/filename="?([^"]+)"?/)?.[1];
  const filename = filenameFromServer ? decodeURIComponent(filenameFromServer) : suggestedFilename;

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
