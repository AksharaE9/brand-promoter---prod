import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulingApi } from '../services/schedulingApi';
import { useToast } from './useToast';

const QUERY_KEYS = {
  rounds: (filters) => ['scheduling', 'rounds', filters],
  round: (id) => ['scheduling', 'round', id],
};

// ── Fetch rounds list ──
export function useRoundsList(filters = {}) {
  const isSearch = !!(filters.search && filters.search.trim());
  return useQuery({
    queryKey: QUERY_KEYS.rounds(filters),
    queryFn: () => schedulingApi.getRounds(filters),
    // Search results must always be fresh — no caching. Normal list: 30s stale time.
    staleTime: isSearch ? 0 : 30_000,
    gcTime: isSearch ? 0 : 5 * 60_000, // don't keep search results in memory
    refetchOnWindowFocus: false,
    select: (data) => {
      // Direct array or data wrapper check
      return data?.data ?? data ?? [];
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
        (/** @type {any} */ old) => {
          const list = old?.data ?? old;
          if (!Array.isArray(list)) return old;
          const updated = list.map((r) =>
            r.id === roundId ? { ...r, status, _optimistic: true } : r
          );
          return old?.data ? { ...old, data: updated } : updated;
        }
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

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.map((r) =>
          r.id === roundId
            ? { ...r, scheduledStart: scheduledDate, durationMinutes, status: 'RESCHEDULED', _optimistic: true }
            : r
        );
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      toast.error(`Reschedule failed: ${err.message}`);
    },

    onSuccess: () => {
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

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.map((r) =>
          r.id === roundId ? { ...r, meetingLink: meetLink, _optimistic: true } : r
        );
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
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

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.map((r) =>
          r.id === roundId ? { ...r, interviewerIds: panelMembers, _optimistic: true } : r
        );
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error('Failed to update panel');
    },

    onSuccess: () => toast.success('Panel updated'),
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

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.map((r) =>
          r.id === roundId ? { ...r, jobId: toJobId, jobTitle: toJobTitle, _optimistic: true } : r
        );
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousRound, previousLists };
    },

    onError: (err, variables, context) => {
      if (context?.previousRound) queryClient.setQueryData(QUERY_KEYS.round(variables.roundId), context.previousRound);
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error('Transfer failed');
    },

    onSuccess: () => toast.success('Candidate transferred'),
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

    onSuccess: () => toast.success('Feedback submitted'),
  });
}

// ── Create round (optimistic) — interview appears INSTANTLY, server syncs in background ──
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

      // Immediately inject into every rounds list in cache
      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return [tempRound];
        const updated = [tempRound, ...list];
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousLists, tempId: tempRound.id };
    },

    onError: (err, variables, context) => {
      // Roll back the optimistic insert
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Failed to schedule interview: ${err.message}`);
    },

    onSuccess: (data, variables, context) => {
      // Replace the temp entry with the real server data
      const realId = data?.data?.id || data?.tempId || data?.id;
      const responseData = data?.data ?? data;
      if (realId && context?.tempId) {
        queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
          const list = old?.data ?? old;
          if (!Array.isArray(list)) return old;
          const updated = list.map((r) =>
            r.id === context.tempId ? { ...responseData, _optimistic: false } : r
          );
          return old?.data ? { ...old, data: updated } : updated;
        });
      }
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

      // Snapshot current state for rollback
      const previousLists = queryClient.getQueriesData({ queryKey: ['scheduling', 'rounds'] });

      // ✨ Instantly remove from every cached list — this is the "instant delete"
      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.filter((r) => r.id !== roundId);
        return old?.data ? { ...old, data: updated } : updated;
      });

      return { previousLists, deletedId: roundId };
    },

    onError: (err, variables, context) => {
      // Server rejected the delete — restore previous state
      context?.previousLists?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(`Delete failed: ${err.message}`);
    },

    onSuccess: (data, roundId) => {
      // Also evict the single-round cache so a direct fetch won't return stale data
      queryClient.removeQueries({ queryKey: QUERY_KEYS.round(roundId) });

      // Mark the list as stale WITHOUT triggering an immediate refetch
      // The next user action or focus event will fetch fresh data
      queryClient.invalidateQueries({
        queryKey: ['scheduling', 'rounds'],
        refetchType: 'none', // ← KEY: marks stale but does NOT re-fetch now
      });

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

      queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
        const list = old?.data ?? old;
        if (!Array.isArray(list)) return old;
        const updated = list.map((r) =>
          r.id === roundId ? { ...r, ...payload, _optimistic: true } : r
        );
        return old?.data ? { ...old, data: updated } : updated;
      });

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
        queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (/** @type {any} */ old) => {
          const list = old?.data ?? old;
          if (!Array.isArray(list)) return old;
          const updated = list.map((r) =>
            r.id === variables.roundId ? { ...r, ...realData, _optimistic: false } : r
          );
          return old?.data ? { ...old, data: updated } : updated;
        });
      }
      toast.success('Interview updated');
    },
  });
}
