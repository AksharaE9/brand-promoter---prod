import { getStoredToken, API_BASE_URL } from './api';

/**
 * Shared client-side search helper.
 * Tries HTTP QUERY first, and transparently falls back to POST on 405, 501, or network-level rejection.
 *
 * @param {string} endpoint - Search api endpoint (e.g. '/api/candidates/search')
 * @param {object} body - Request payload containing { q, filters, cursor, limit }
 * @param {AbortSignal} [signal] - Optional AbortSignal for request cancellation
 * @returns {Promise<any>} Response json promise
 */
export async function search(endpoint, body, signal) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Normalize url
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    // If endpoint already has /api and API_BASE_URL also has /api, avoid duplicating
    const base = API_BASE_URL.replace(/\/+$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    if (base.endsWith('/api') && cleanEndpoint.startsWith('/api')) {
      url = `${base.slice(0, -4)}${cleanEndpoint}`;
    } else {
      url = `${base}${cleanEndpoint}`;
    }
  }

  try {
    const res = await fetch(url, {
      method: 'QUERY',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res.json();
    // Some proxies/servers return 405/501 for unsupported QUERY method
    if (![405, 501].includes(res.status)) {
      throw new Error(`Search failed: ${res.status}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Network-level rejection (some environments reject unknown methods). Fall through to POST.
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}
