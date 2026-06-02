import { useCallback, useRef } from 'react';

/**
 * Prefetch query data when user hovers over a row for 200ms.
 * Makes detail pages/modals load instantly on click.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient - QueryClient instance
 * @param {Array} queryKey - The query key to prefetch
 * @param {Function} queryFn - The function that fetches data
 * @param {number} staleTime - How long data is considered fresh (default 30s)
 * @returns {{ onMouseEnter: Function, onMouseLeave: Function }}
 *
 * @example
 * const queryClient = useQueryClient();
 * const prefetch = usePrefetchOnHover(
 *   queryClient,
 *   ['candidate', id],
 *   () => api.get(`/candidates/${id}`),
 * );
 * <div {...prefetch}>...</div>
 */
export function usePrefetchOnHover(queryClient, queryKey, queryFn, staleTime = 30000) {
  const timerRef = useRef(null);

  const onMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => {
      queryClient.prefetchQuery({ queryKey, queryFn, staleTime });
    }, 200); // 200ms hover delay
  }, [queryClient, queryKey, queryFn, staleTime]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { onMouseEnter, onMouseLeave };
}

export default usePrefetchOnHover;
