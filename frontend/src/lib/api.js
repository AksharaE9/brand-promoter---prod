const DEFAULT_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:4000/api' : '/api';
const RESOLVED_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  DEFAULT_API_BASE_URL;
export const API_BASE_URL = RESOLVED_API_BASE_URL.replace(/\/+$/, '');
export const API_ROOT_URL = API_BASE_URL.endsWith('/api') ? API_BASE_URL.slice(0, -4) : API_BASE_URL;

function getToken() {
  return localStorage.getItem('ats_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

export function apiGet(path) {
  return request(path, { method: 'GET' });
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

export function apiPost(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch(path, body) {
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete(path) {
  return request(path, { method: 'DELETE' });
}

export function clearAuth() {
  localStorage.removeItem('ats_token');
  localStorage.removeItem('ats_user');
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
  return Boolean(getToken());
}
