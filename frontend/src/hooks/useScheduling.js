import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulingApi } from '../services/schedulingApi';
import { useToast } from './useToast';

const QUERY_KEYS = {
  rounds: (filters) => ['scheduling', 'rounds', filters],
  round: (id) => ['scheduling', 'round', id],
};

// Helper to safely update query list cache for both flat lists and infinite scroll pages
export function updateInfiniteOrFlatList(old, updateFn) {
  if (!old) return old;
  
  // TanStack Query Infinite Query shape: { pages: [...], pageParams: [...] }
  if (old.pages && Array.isArray(old.pages)) {
    return {
      ...old,
      pages: old.pages.map(page => {
        const list = page.data || page.rows || [];
        if (!Array.isArray(list)) return page;
        const updatedList = updateFn(list);
        if (page.data !== undefined) {
          return { ...page, data: updatedList };
        } else if (page.rows !== undefined) {
          return { ...page, rows: updatedList };
        }
        return { ...page, data: updatedList };
      })
    };
  }
  
  // Flat array or simple { data: [...] } shape
  const list = old.data ?? old;
  if (!Array.isArray(list)) return old;
  const updatedList = updateFn(list);
  return old.data !== undefined ? { ...old, data: updatedList } : updatedList;
}

// ── Fetch rounds list ──
export function useRoundsList(filters = {}) {
  // Pass null to completely disable this query instance (e.g. when search is empty)
  const enabled = filters !== null;
  const safeFilters = filters ?? {};
  const isSearch = !!(safeFilters.search && safeFilters.search.trim());
  return useQuery({
    queryKey: QUERY_KEYS.rounds(safeFilters),
    queryFn: ({ signal }) => schedulingApi.getRounds(safeFilters, signal),
    enabled,
    // Search results must always be fresh — no caching. Normal list: 2min stale time.
    staleTime: isSearch ? 0 : 2 * 60_000,
    gcTime: isSearch ? 0 : 15 * 60_000,
    refetchOnWindowFocus: false,
    select: (data) => {
      // Backend now returns { data: [...], hasMore, nextCursor, pagination }
      if (data && Array.isArray(data.data)) return data;
      // Legacy: direct array
      if (Array.isArray(data)) return { data, hasMore: false, nextCursor: null };
      return { data: [], hasMore: false, nextCursor: null };
    },
  });
}

// ── Fetch single round ──
export function useRound(roundId) {
  return useQuery({
    queryKey: QUERY_KEYS.round(roundId),
    queryFn: () => schedulingApi.getRound(roundId),
    staleTime: 30_000,
    enabled: !!roundId,
    select: (data) => data?.data ?? data,
  });
}

// ── Fetch consolidated round details ──
export function useRoundDetails(roundId) {
  return useQuery({
    queryKey: ['scheduling', 'round-details', roundId],
    queryFn: () => schedulingApi.getRoundDetails(roundId),
    staleTime: 10_000,
    enabled: !!roundId,
    select: (data) => data?.data ?? data,
  });
}

// ── Update round status (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useUpdateRoundStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, status, notes }) =>
      schedulingApi.updateStatus(roundId, { status, notes }),

    onMutate: async ({ roundId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });

      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, status, _optimistic: true },
        };
      });

      queryClient.setQueriesData(
        { queryKey: ['scheduling', 'rounds'] },
        (/** @type {any} */ old) =>
          updateInfiniteOrFlatList(old, (list) =>
            list.map((r) =>
              r.id === roundId ? { ...r, status, _optimistic: true } : r
            )
          )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) {
        queryClient.setQueryData(
          QUERY_KEYS.round(variables.roundId),
          context.previousRound
        );
      }
      context?.previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      toast.error(`Failed to update status: ${err.message}`);
    },

    onSuccess: (data, variables) => {
      const realData = data?.data ?? data;
      queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, ...realData, _optimistic: false },
        };
      });
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ── Reschedule round (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useRescheduleRound() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, scheduledDate, durationMinutes, reason }) =>
      schedulingApi.reschedule(roundId, { scheduledDate, durationMinutes, reason }),

    onMutate: async ({ roundId, scheduledDate, durationMinutes }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: {
            ...currentData,
            scheduledStart: scheduledDate,
            durationMinutes,
            status: 'RESCHEDULED',
            _optimistic: true,
          },
        };
      });

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.map((r) =>
            r.id === roundId
              ? { ...r, scheduledStart: scheduledDate, durationMinutes, status: 'RESCHEDULED', _optimistic: true }
              : r
          )
        )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      toast.error(`Reschedule failed: ${err.message}`);
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Interview rescheduled');
    },
  });
}

// ── Save meet link (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useSaveMeetLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roundId, meetLink }) =>
      schedulingApi.updateMeetLink(roundId, { meetLink }),

    onMutate: async ({ roundId, meetLink }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, meetingLink: meetLink, _optimistic: true },
        };
      });

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.map((r) =>
            r.id === roundId ? { ...r, meetingLink: meetLink, _optimistic: true } : r
          )
        )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
    },
  });
}

// ── Update panel members (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useUpdatePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, panelMembers }) =>
      schedulingApi.updatePanel(roundId, { panelMembers }),

    onMutate: async ({ roundId, panelMembers }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, interviewerIds: panelMembers, _optimistic: true },
        };
      });

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.map((r) =>
            r.id === roundId ? { ...r, interviewerIds: panelMembers, _optimistic: true } : r
          )
        )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error('Failed to update panel');
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      toast.success('Panel updated');
    },
  });
}

// ── Transfer candidate (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useTransferCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, toJobId, toJobTitle, reason }) =>
      schedulingApi.transfer(roundId, { toJobId, toJobTitle, reason }),

    onMutate: async ({ roundId, toJobId, toJobTitle }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, jobId: toJobId, jobTitle: toJobTitle, _optimistic: true },
        };
      });

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.map((r) =>
            r.id === roundId ? { ...r, jobId: toJobId, jobTitle: toJobTitle, _optimistic: true } : r
          )
        )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error('Transfer failed');
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Candidate transferred');
    },
  });
}

// ── Submit feedback (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, feedback }) =>
      schedulingApi.submitFeedback(roundId, feedback),

    onMutate: async ({ roundId, feedback }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        const currentFeedbacks = currentData.feedback || currentData.feedbacks || [];
        return {
          ...old,
          data: {
            ...currentData,
            feedbacks: [...currentFeedbacks, { ...feedback, _optimistic: true }],
            status: feedback.recommendation === 'SELECTED' ? 'COMPLETED' : currentData.status,
            _optimistic: true,
          },
        };
      });

      return { previousRound };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      toast.error('Failed to submit feedback');
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Feedback submitted');
    },
  });
}

// ── Create round — interview appears INSTANTLY in sorted order, server confirms in ~2s ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useCreateRound() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (roundData) => schedulingApi.createRound(roundData),

    onMutate: async (roundData) => {
      // Cancel any in-flight refetches so they don't clobber our optimistic update
      await queryClient.cancelQueries({ queryKey: ['scheduling', 'rounds'] });
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      const tempRound = {
        ...roundData,
        id: `temp_${Date.now()}`,
        status: 'SCHEDULED',
        _optimistic: true,
        _isNew: true,
        createdAt: new Date().toISOString(),
      };

      // Insert in ascending roundNo order — never prepend blindly
      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        // If there's no cache at all, we can seed it with the infinite query shape
        if (!old) {
          return {
            pages: [{ data: [tempRound], hasMore: false, nextCursor: null, totalCount: 1 }],
            pageParams: [null]
          };
        }
        return updateInfiniteOrFlatList(old, (list) => {
          const merged = [...list, tempRound];
          merged.sort((a, b) => (a.roundNo ?? 0) - (b.roundNo ?? 0));
          return merged;
        });
      });

      return { previousLists, tempId: tempRound.id };
    },

    onError: (err, variables, context) => {
      // Roll back the optimistic insert
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Failed to schedule interview: ${err.message}`);
    },

    onSuccess: (data, variables, context) => {
      // Replace the temp entry with the real server data — no _optimistic flag kept
      const realId = data?.data?.id || data?.tempId || data?.id;
      const responseData = data?.data ?? data;
      if (realId && context?.tempId) {
        queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
          updateInfiniteOrFlatList(old, (list) => {
            const updated = list.map((r) =>
              r.id === context.tempId ? { ...responseData, _optimistic: false } : r
            );
            updated.sort((a, b) => (a.roundNo ?? 0) - (b.roundNo ?? 0));
            return updated;
          })
        );
      }

      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      toast.success('Interview scheduled ✓');
    },
  });
}

// ── Delete round — INSTANT optimistic remove, NO ghost-back on success ──
/**
 * The interview is removed from the UI the instant the user confirms.
 * If the server call fails, it is restored.
 * On success, we mark the query as stale (so next focus triggers a soft refresh)
 * but we do NOT immediately refetch — preventing the 1-second "ghost back" effect.
 *
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useDeleteRound() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (roundId) => schedulingApi.deleteRound(roundId),

    onMutate: async (roundId) => {
      // Stop any in-flight background refetch from restoring the item
      await queryClient.cancelQueries({ queryKey: ['scheduling', 'rounds'] });
      // Also cancel any in-flight detail fetch for this round to prevent stale data restoring the badge
      await queryClient.cancelQueries({ queryKey: ['scheduling', 'round-details', roundId] });

      // Snapshot current state for rollback
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      // ✨ Instantly remove from every cached list — this is the "instant delete"
      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.filter((r) => r.id !== roundId)
        )
      );

      // Immediately evict the round-details cache so the detail panel doesn't
      // keep showing stale data (e.g. result: 'SELECTED') for up to staleTime ms
      queryClient.removeQueries({ queryKey: ['scheduling', 'round-details', roundId] });

      return { previousLists, deletedId: roundId };
    },

    onError: (err, variables, context) => {
      // Server rejected the delete — restore previous state
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Delete failed: ${err.message}`);
    },

    onSuccess: (data, roundId) => {
      // Evict both the single-round cache AND the round-details cache
      queryClient.removeQueries({ queryKey: QUERY_KEYS.round(roundId) });
      queryClient.removeQueries({ queryKey: ['scheduling', 'round-details', roundId] });

      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      toast.success('Interview deleted');
    },
  });
}

// ── Update round (optimistic) ──
/**
 * @returns {import('@tanstack/react-query').UseMutationResult<any, any, any, any>}
 */
export function useUpdateRound() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ roundId, payload }) =>
      schedulingApi.updateRound(roundId, payload),

    onMutate: async ({ roundId, payload }) => {
      await queryClient.cancelQueries({ queryKey: ['scheduling'] });
      const previousRound = queryClient.getQueryData(QUERY_KEYS.round(roundId));
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      queryClient.setQueryData(QUERY_KEYS.round(roundId), (/** @type {any} */ old) => {
        if (!old) return old;
        const currentData = old.data ?? old;
        return {
          ...old,
          data: { ...currentData, ...payload, _optimistic: true },
        };
      });

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
        updateInfiniteOrFlatList(old, (list) =>
          list.map((r) =>
            r.id === roundId ? { ...r, ...payload, _optimistic: true } : r
          )
        )
      );

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Update failed: ${err.message}`);
    },

    onSuccess: (data, variables) => {
      // Reconcile with server data — clear optimistic flag
      const realData = data?.data ?? data;
      if (realData) {
        queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) =>
          updateInfiniteOrFlatList(old, (list) =>
            list.map((r) =>
              r.id === variables.roundId ? { ...r, ...realData, _optimistic: false } : r
            )
          )
        );
      }
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Interview updated');
    },
  });
}
