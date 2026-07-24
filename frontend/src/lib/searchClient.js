import { getStoredToken, buildApiUrl } from './api';

let cachedWorkingMethod = null;

/**
 * Shared client-side search helper.
 * Tries HTTP QUERY first, and transparently falls back to POST on 405, 501, or network-level rejection.
 *
 * @param {string} endpoint - Search api endpoint (e.g. '/candidates/search')
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

  const url = buildApiUrl(endpoint);

  const FORCE_METHOD = import.meta.env.VITE_SEARCH_METHOD;
  const methodsToTry = FORCE_METHOD
    ? [FORCE_METHOD]
    : (cachedWorkingMethod ? [cachedWorkingMethod] : ['QUERY', 'POST']);

  let lastError = null;

  for (const method of methodsToTry) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (res.ok) {
        if (!FORCE_METHOD) {
          cachedWorkingMethod = method;
        }
        return res.json();
      }

      if (![404, 405, 501].includes(res.status)) {
        throw new Error(`Search failed: ${res.status}`);
      }
      lastError = new Error(`Search failed: ${res.status}`);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      // CORS rejections throw a generic TypeError before any status is available — fall through too.
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Search failed: no working method found');
}
