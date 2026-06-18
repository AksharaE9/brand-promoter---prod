/**
 * companyApi.js
 * ──────────────────────────────────────────────────────────────────────────
 * Thin, typed wrapper around the /api/companies endpoints.
 * Keeps a module-level in-memory cache so the dropdown never fires more
 * than one network request per 5-minute window — identical TTL to server.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { getStoredToken, API_BASE_URL } from '../lib/api';

// ── Module-level request cache (prevents duplicate in-flight fetches) ──────
let _cachedCompanies = null;
let _cacheExpiry     = 0;
let _inflightPromise = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches server TTL

async function authFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const companyApi = {
  /**
   * List companies for the current org.
   * Returns an array of { id, name } objects.
   * Uses module-level cache to avoid redundant API calls when the combobox
   * mounts multiple times on the same page.
   */
  async list() {
    const now = Date.now();

    // Return cached data if still fresh
    if (_cachedCompanies && now < _cacheExpiry) {
      return { success: true, data: _cachedCompanies };
    }

    // Deduplicate in-flight requests (singleton promise pattern)
    if (_inflightPromise) return _inflightPromise;

    _inflightPromise = authFetch('/companies')
      .then(res => {
        _cachedCompanies = res.data ?? [];
        _cacheExpiry     = Date.now() + CACHE_TTL_MS;
        _inflightPromise = null;
        return { success: true, data: _cachedCompanies };
      })
      .catch(err => {
        _inflightPromise = null;
        throw err;
      });

    return _inflightPromise;
  },

  /**
   * Explicitly add a new company name.
   * The server returns the full updated list so we can refresh the cache.
   */
  async create(name) {
    const res = await authFetch('/companies', {
      method: 'POST',
      body: { name },
    });
    // Bust local cache so the next list() returns fresh data
    _cachedCompanies = res.data ?? null;
    _cacheExpiry     = _cachedCompanies ? Date.now() + CACHE_TTL_MS : 0;
    return res;
  },

  /**
   * Forcibly clear the module-level cache.
   * Call this if the user creates a candidate with a new company name
   * so the next dropdown open reflects it immediately.
   */
  bust() {
    _cachedCompanies = null;
    _cacheExpiry     = 0;
    _inflightPromise = null;
  },
};
