import { apiGet, apiDelete } from '../lib/api';
import { getStoredToken, API_BASE_URL } from '../lib/api';

async function customRequest(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Handle FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type']; // Let browser set boundary
  } else if (options.body && typeof options.body === 'object') {
    options.body = JSON.stringify(options.body);
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
    const error = Object.assign(new Error(message), {
      status: response.status,
      response: { data }
    });
    throw error;
  }

  return { data };
}

const api = {
  get: async (path, config) => {
    if (config?.responseType === 'blob') {
      const { apiGetBlob } = await import('../lib/api');
      return { data: await apiGetBlob(path) };
    }
    const data = await apiGet(path, false, config);
    return { data };
  },
  post: async (path, body, config) => {
    return customRequest(path, { method: 'POST', body, ...config });
  },
  put: async (path, body, config) => {
    return customRequest(path, { method: 'PUT', body, ...config });
  },
  patch: async (path, body, config) => {
    return customRequest(path, { method: 'PATCH', body, ...config });
  },
  delete: async (path, config) => {
    const data = await apiDelete(path);
    return { data };
  }
};

export default api;
