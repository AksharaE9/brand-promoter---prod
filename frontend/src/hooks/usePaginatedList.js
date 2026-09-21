import { useMemo, useCallback } from 'react';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';

/**
 * usePaginatedList — The definitive shared list-fetching primitive for all candidate views
 * and paginated resources.
 *
 * Enforces:
 * 1. Chunked loading: initial page size = 50 (fast first paint), subsequent pages = 100 (high throughput).
 * 2. Complete query key serialization including all active filters and search terms.
 * 3. Stable caching (staleTime 30-60s) with seamless keepPreviousData transitions.
 * 4. Automatic response shaping: returns flattened `items`, `nextCursor`, `hasMore`, `totalCount`.
 *
 * @param {string} endpoint - The list endpoint path (e.g. '/candidates')
 * @param {object} options
 * @param {object} options.filters - Server-side filters { status, role, location, company, dateFrom, dateTo, search, ... }
 * @param {string[]} options.queryKey - Base query key array (e.g. ['candidates', 'pool'])
 * @param {number} [options.initialPageSize=50] - First chunk size
 * @param {number} [options.subsequentPageSize=100] - Subsequent chunk size
 * @param {number} [options.staleTime=30000] - Milliseconds before data becomes stale
 * @param {boolean} [options.enabled=true] - Whether query is active
 * @returns {object}
 */
export function usePaginatedList(endpoint, options = {}) {
  const {
    filters = {},
    queryKey = [endpoint],
    initialPageSize = 50,
    subsequentPageSize = 100,
    staleTime = 30000,
    enabled = true,
  } = options;

  // Build clean deterministic filter object
  const cleanFilters = useMemo(() => {
    const result = {};
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '' && v !== 'All') {
          result[k] = typeof v === 'string' ? v.trim() : v;
        }
      });
    }
    return result;
  }, [filters]);

  const fullQueryKey = useMemo(() => {
    return [...queryKey, 'list', cleanFilters];
  }, [queryKey, cleanFilters]);

  const queryResult = useInfiniteQuery({
    queryKey: fullQueryKey,
    queryFn: async ({ pageParam = null, signal }) => {
      const isFirstPage = !pageParam;
      const limit = isFirstPage ? initialPageSize : subsequentPageSize;

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (pageParam) {
        params.set('cursor', String(pageParam));
      }

      Object.entries(cleanFilters).forEach(([k, v]) => {
        params.set(k, String(v));
      });

      const queryString = params.toString() ? `?${params.toString()}` : '';
      const res = await api.get(`${endpoint}${queryString}`, { signal });
      return res.data;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.hasMore === false) return undefined;
      return lastPage.nextCursor || undefined;
    },
    initialPageParam: null,
    enabled,
    staleTime,
    gcTime: 300000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  // Flatten items across all loaded pages safely
  const items = useMemo(() => {
    if (!queryResult.data?.pages) return [];
    return queryResult.data.pages.flatMap((page) => {
      if (!page) return [];
      if (Array.isArray(page.items)) return page.items;
      if (Array.isArray(page.data)) return page.data;
      if (Array.isArray(page.rows)) return page.rows;
      return [];
    });
  }, [queryResult.data]);

  const firstPage = queryResult.data?.pages?.[0];
  const lastPage = queryResult.data?.pages?.[queryResult.data.pages.length - 1];
  const hasMore = lastPage ? Boolean(lastPage.hasMore) : false;
  const nextCursor = lastPage ? lastPage.nextCursor || null : null;

  return {
    ...queryResult,
    items,
    hasMore,
    nextCursor,
    totalCount: firstPage?.pagination?.total ?? null,
  };
}
