import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  apiGetBlob,
  request,
  buildApiUrl,
  getStoredToken,
  getStoredUser,
  handle401SessionExpiry,
  isAuthenticatedRoute,
} from '../lib/api';

const api = {
  get: async (path, config) => {
    if (config?.responseType === 'blob') {
      return { data: await apiGetBlob(path) };
    }
    const useCache = config?.useCache !== undefined ? config.useCache : true;
    const data = await apiGet(path, useCache, config);
    return { data };
  },
  post: async (path, body, config = {}) => {
    const data = await apiPost(path, body, config);
    return { data };
  },
  put: async (path, body, config = {}) => {
    const data = await apiPut(path, body, config);
    return { data };
  },
  patch: async (path, body, config = {}) => {
    const data = await apiPatch(path, body, config);
    return { data };
  },
  delete: async (path, config = {}) => {
    const data = await apiDelete(path, config);
    return { data };
  },
};

export {
  getStoredToken,
  getStoredUser,
  buildApiUrl,
  handle401SessionExpiry,
  isAuthenticatedRoute,
  request,
};

export default api;

