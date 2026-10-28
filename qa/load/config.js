// qa/load/config.js
import http from 'k6/http';

export const BASE_URL = __ENV.ATS_BACKEND_URL || 'https://brandpromoter-backend.onrender.com';
export const ADMIN_EMAIL = __ENV.QA_ADMIN_EMAIL || 'superadmin@gmail.com';
export const BYPASS_SECRET = __ENV.LOADTEST_BYPASS_SECRET || '';
export const HIREIQ_API_KEY = __ENV.HIREIQ_API_KEY || 'tos_live_z8tUyPF9_op1aw57s45uyGtnN8gvMN9x3Lng0TNEL';

export const THRESHOLDS = {
  http_req_failed: ['rate<0.01'], // error rate < 1%
  'http_req_duration{type:read}': ['p(95)<800'], // p95 reads < 800ms
  'http_req_duration{type:write}': ['p(95)<1500'], // p95 writes < 1.5s
  http_req_duration: ['p(99)<3000'], // p99 overall < 3s
};

/**
 * Setup function run once per test to authenticate and retrieve a shared JWT token.
 * Never hammers /login per VU.
 */
export function authenticateAdmin() {
  if (__ENV.QA_ADMIN_TOKEN) {
    return { token: __ENV.QA_ADMIN_TOKEN };
  }
  const password = __ENV.QA_ADMIN_PASSWORD;
  if (!password) {
    console.warn('[LOAD_TEST_CONFIG] WARNING: Neither QA_ADMIN_TOKEN nor QA_ADMIN_PASSWORD set in environment.');
    return { token: null };
  }

  const payload = JSON.stringify({
    email: ADMIN_EMAIL,
    password: password,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Load-Test': BYPASS_SECRET,
    },
  };

  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);

  if (res.status === 200) {
    const body = res.json();
    const token = body.token || (body.data && body.data.token) || body.accessToken;
    console.log('[LOAD_TEST_CONFIG] Admin authentication successful. Shared token issued.');
    return { token };
  } else {
    console.error(`[LOAD_TEST_CONFIG] Admin login failed: HTTP ${res.status} - ${res.body}`);
    return { token: null };
  }
}

export function getHeaders(token, type = 'read') {
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Source': 'k6-load-test',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (BYPASS_SECRET) {
    headers['X-Load-Test'] = BYPASS_SECRET;
  }
  return {
    headers,
    tags: { type },
  };
}
