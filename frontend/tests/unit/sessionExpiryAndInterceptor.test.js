import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function createStorageMock() {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, val) => {
      store[key] = String(val);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
}

const mockLocalStorage = createStorageMock();
const mockSessionStorage = createStorageMock();

vi.stubGlobal('localStorage', mockLocalStorage);
vi.stubGlobal('sessionStorage', mockSessionStorage);
vi.stubGlobal('window', {
  location: {
    pathname: '/interviews',
    search: '',
    href: 'http://localhost:3000/interviews',
    assign: vi.fn(),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});
vi.stubGlobal('BroadcastChannel', class {
  constructor(name) {
    this.name = name;
  }
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
});

import {
  request,
  getSafeReturnTo,
  setAuthTokens,
  clearAuthTokens,
  getStoredToken,
  getStoredRefreshToken,
  registerQueryClient,
  handle401SessionExpiry,
} from '../../src/lib/api.js';

describe('Frontend API Interceptor & Session Expiry Contract', () => {
  let mockQueryClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    window.location.href = 'http://localhost:3000/interviews';
    window.location.pathname = '/interviews';
    window.location.search = '';

    mockQueryClient = {
      clear: vi.fn(),
      cancelQueries: vi.fn(),
    };
    registerQueryClient(mockQueryClient);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('401 Session Expiry Handling', () => {
    it('signs out, clears tokens, clears QueryClient cache, and redirects when refresh token is missing on 401', async () => {
      setAuthTokens('expired_token', null);
      expect(getStoredToken()).toBe('expired_token');

      global.fetch = vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({
          error: {
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Your session has expired. Please sign in again.',
          },
        }),
      });

      await expect(request('/api/interviews/123')).rejects.toThrow(/session has expired/i);

      expect(getStoredToken()).toBeNull();
      expect(mockQueryClient.clear).toHaveBeenCalled();
      expect(mockQueryClient.cancelQueries).toHaveBeenCalled();
      expect(window.location.href).toContain('/login?reason=session_expired');
    });

    it('handles single-flight token refresh when request 401s and valid refresh token exists', async () => {
      setAuthTokens('old_access_token', 'valid_refresh_token');

      global.fetch = vi.fn().mockImplementation(async (url) => {
        if (url.includes('/api/auth/refresh')) {
          return {
            status: 200,
            ok: true,
            headers: {
              get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
            },
            json: async () => ({
              token: 'new_fresh_token',
              refreshToken: 'valid_refresh_token',
            }),
          };
        }

        return {
          status: 200,
          ok: true,
          headers: {
            get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
          },
          json: async () => ({ success: true, data: 'result' }),
        };
      });

      const res = await request('/api/protected');
      expect(res).toEqual({ success: true, data: 'result' });
    });
  });

  describe('What MUST NEVER Trigger a Sign-Out (Part 7 Contract)', () => {
    it('does NOT sign out on 403 Forbidden', async () => {
      setAuthTokens('valid_token', 'refresh_token');

      global.fetch = vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({
          error: {
            code: 'AUTH_INSUFFICIENT_PERMISSION',
            message: 'You do not have permission to perform this action.',
          },
        }),
      });

      await expect(request('/api/admin/restricted')).rejects.toThrow(/permission/i);

      // Token must still be intact
      expect(getStoredToken()).toBe('valid_token');
      // QueryClient must not be cleared
      expect(mockQueryClient.clear).not.toHaveBeenCalled();
      // Must not redirect to login
      expect(window.location.href).not.toContain('/login');
    });

    it('does NOT sign out on 500 Server Error and retains requestId', async () => {
      setAuthTokens('valid_token', 'refresh_token');

      global.fetch = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Database query timed out.',
            requestId: 'req_test_12345',
          },
        }),
      });

      try {
        await request('/api/interviews/123', { retries: 0 });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('Database query timed out.');
        expect(err.requestId).toBe('req_test_12345');
        expect(err.code).toBe('DATABASE_ERROR');
      }

      // Token intact & not signed out
      expect(getStoredToken()).toBe('valid_token');
      expect(mockQueryClient.clear).not.toHaveBeenCalled();
      expect(window.location.href).not.toContain('/login');
    });

    it('does NOT sign out on Network / Offline error', async () => {
      setAuthTokens('valid_token', 'refresh_token');

      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(request('/api/interviews', { retries: 0 })).rejects.toThrow(/Could not reach the server/i);

      expect(getStoredToken()).toBe('valid_token');
      expect(mockQueryClient.clear).not.toHaveBeenCalled();
      expect(window.location.href).not.toContain('/login');
    });

    it('does NOT sign out on 413 File Too Large', async () => {
      setAuthTokens('valid_token', 'refresh_token');

      global.fetch = vi.fn().mockResolvedValue({
        status: 413,
        ok: false,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'The uploaded file exceeds the 10MB limit.',
          },
        }),
      });

      await expect(request('/api/upload')).rejects.toThrow(/exceeds/i);

      expect(getStoredToken()).toBe('valid_token');
      expect(mockQueryClient.clear).not.toHaveBeenCalled();
      expect(window.location.href).not.toContain('/login');
    });
  });

  describe('Open Redirect Protection (getSafeReturnTo)', () => {
    it('accepts valid relative internal paths', () => {
      expect(getSafeReturnTo('/interviews/123')).toBe('/interviews/123');
      expect(getSafeReturnTo('/candidates?tab=active')).toBe('/candidates?tab=active');
      expect(getSafeReturnTo('/workspaces')).toBe('/workspaces');
    });

    it('rejects absolute external URLs and protocol-relative URLs', () => {
      expect(getSafeReturnTo('https://evil.com')).toBe('/workspaces');
      expect(getSafeReturnTo('http://attacker.com/steal')).toBe('/workspaces');
      expect(getSafeReturnTo('//evil.com/phish')).toBe('/workspaces');
      expect(getSafeReturnTo('javascript:alert(1)')).toBe('/workspaces');
    });

    it('rejects login paths to prevent redirect loops', () => {
      expect(getSafeReturnTo('/login')).toBe('/workspaces');
      expect(getSafeReturnTo('/login?reason=session_expired')).toBe('/workspaces');
      expect(getSafeReturnTo('/signup')).toBe('/workspaces');
    });
  });
});
