const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:4000/api' : '/api';
const RESOLVED_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  DEFAULT_API_BASE_URL;
export const API_BASE_URL = RESOLVED_API_BASE_URL.replace(/\/+$/, '');
export const API_ROOT_URL = API_BASE_URL.endsWith('/api') ? API_BASE_URL.slice(0, -4) : API_BASE_URL;

// Performance: Request Deduplication & Caching
const inflightRequests = new Map();
const apiCache = new Map();
const CACHE_TTL = 60000; // 60 seconds

export function getStoredToken() {
  return localStorage.getItem('ats_token');
}

async function request(path, options = {}, retries = 2) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Deduplication for GET requests
  const isGet = !options.method || options.method === 'GET';
  const requestKey = `${options.method || 'GET'}:${path}`;

  if (isGet && !options.bypassCache && inflightRequests.has(requestKey)) {
    return inflightRequests.get(requestKey);
  }

  // Cache lookup
  if (isGet && !options.bypassCache && apiCache.has(requestKey)) {
    const cached = apiCache.get(requestKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    apiCache.delete(requestKey);
  }

  const fetchPromise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Exponential backoff: 0ms, 800ms, 1600ms
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 800));

      // 15s timeout per attempt
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          ...options,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        let data = null;
        try { data = await response.json(); } catch (_) { data = null; }

        if (!response.ok) {
          const message = data?.message || `Request failed (${response.status})`;
          const error = new Error(message);
          error.status = response.status;
          error.payload = data;
          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) throw error;
          lastErr = error;
          continue; // retry on 5xx
        }

        if (isGet) {
          apiCache.set(requestKey, { data, timestamp: Date.now() });
        }
        return data;
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          lastErr = new Error('Request timed out. Please check your connection.');
          continue; // retry on timeout
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
    fetchPromise.finally(() => inflightRequests.delete(requestKey));
  }

  return fetchPromise;
}

export function apiGet(path, useCache = true) {
  // Option to bypass cache if needed
  if (!useCache) {
    const requestKey = `GET:${path}`;
    apiCache.delete(requestKey);
  }
  return request(path, { method: 'GET', bypassCache: !useCache });
}

export async function apiGetBlob(path) {
  const token = localStorage.getItem('ats_token');
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
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

export function clearAuth() {
  localStorage.removeItem('ats_token');
  localStorage.removeItem('ats_user');
  apiCache.clear();
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
