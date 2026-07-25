import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * A shared infinite scroll pagination hook using TanStack Query useInfiniteQuery.
 * Resolves cursor-based pagination and correctly builds queries.
 *
 * @param {string} endpoint - The list endpoint path (e.g. '/candidates' or '/interviews')
 * @param {object} options - Options containing pageSize, filters, queryKey, and enabled
 * @returns {import('@tanstack/react-query').UseInfiniteQueryResult<any, any>}
 */
export function usePaginatedList(endpoint, options = {}) {
  const { pageSize, filters = {}, queryKey, enabled = true } = options;
  const isSearchActive = !!(filters.search || filters.q);

  const queryResult = useInfiniteQuery({
    queryKey: [...queryKey, filters],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      if (pageParam) {
        params.set('cursor', String(pageParam));
      }

      if (filters) {
        Object.entries(filters).forEach(([key, val]) => {
          if (val !== undefined && val !== null && val !== '' && val !== 'All') {
            params.set(key, String(val));
          }
        });
      }

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
    staleTime: isSearchActive ? 0 : 10000,
    gcTime: 300000,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = queryResult;

  // Background progressive prefetching of subsequent chunks to load full dataset smoothly
  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage && !isLoading) {
      const timer = setTimeout(() => {
        fetchNextPage();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [enabled, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  return queryResult;
}
