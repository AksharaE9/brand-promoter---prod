import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';

export function usePanelists(options = {}) {
  return useQuery({
    queryKey: ['panelists'],
    queryFn: async () => {
      const res = await apiGet('/users/interviewers');
      return res.data || [];
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    ...options,
  });
}
