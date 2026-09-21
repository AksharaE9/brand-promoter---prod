import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * useCandidateCounts — Hook to fetch candidate status counts and filtered counts in parallel
 * without blocking list fetching.
 */
export function useCandidateStatusCounts() {
  return useQuery({
    queryKey: ['candidates', 'status-counts'],
    queryFn: async () => {
      const res = await api.get('/candidates/status-counts');
      return res.data?.counts || { ALL: 0, ACTIVE: 0, OFFER_SENT: 0, JOINED: 0, REJECTED: 0 };
    },
    staleTime: 30000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });
}

export function useCandidateFilteredCount(filters = {}, enabled = true) {
  const cleanFilters = {};
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'All') {
        cleanFilters[k] = typeof v === 'string' ? v.trim() : v;
      }
    });
  }

  const hasNonStatusFilters = Object.keys(cleanFilters).some(
    (k) => k !== 'status'
  );

  return useQuery({
    queryKey: ['candidates', 'filtered-count', cleanFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(cleanFilters).forEach(([k, v]) => {
        params.set(k, String(v));
      });
      const queryString = params.toString() ? `?${params.toString()}` : '';
      const res = await api.get(`/candidates/count${queryString}`);
      return res.data?.count ?? null;
    },
    enabled: enabled && hasNonStatusFilters,
    staleTime: 30000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });
}
