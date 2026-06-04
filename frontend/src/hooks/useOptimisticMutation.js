import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from './useToast';

/**
 * Generic optimistic mutation hook.
 * Reduces boilerplate for mutations that follow the pattern:
 *   1. onMutate: update cache optimistically
 *   2. onError: rollback
 *   3. onSuccess: reconcile with server data
 *
 * @param {Object} options
 * @param {Function} options.mutationFn - The API call function
 * @param {string|string[]} options.invalidateKeys - Query keys to cancel/invalidate (prefix)
 * @param {Object[]} [options.cacheUpdates] - Array of cache update definitions
 * @param {string|Function} [options.successMessage] - Toast message on success
 * @param {string|Function} [options.errorMessage] - Toast message on error
 * @param {Function} [options.onSuccessCallback] - Additional onSuccess logic
 *
 * Cache update definition shape:
 * {
 *   queryKey: string[] | (variables) => string[],  // specific query key
 *   type: 'update' | 'remove' | 'prepend',         // type of cache update
 *   getId: (variables) => string,                   // extract item ID from variables
 *   getChanges: (variables) => object,              // changes to apply (for 'update')
 *   getNewItem: (variables) => object,              // new item (for 'prepend')
 *   isListQuery: boolean,                           // if true, uses setQueriesData (fuzzy match)
 * }
 */
export function useOptimisticMutation({
  mutationFn,
  invalidateKeys = [],
  cacheUpdates = [],
  successMessage,
  errorMessage = 'Operation failed',
  onSuccessCallback,
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn,

    onMutate: async (variables) => {
      // Cancel in-flight queries for all related keys
      const normalizedKeys = Array.isArray(invalidateKeys) ? invalidateKeys : [invalidateKeys];
      for (const key of normalizedKeys) {
        await queryClient.cancelQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }

      // Snapshot previous state for rollback
      const snapshots = new Map();

      for (const update of cacheUpdates) {
        const qk = typeof update.queryKey === 'function'
          ? update.queryKey(variables)
          : update.queryKey;

        if (update.isListQuery) {
          const existing = queryClient.getQueriesData({ queryKey: qk });
          snapshots.set(JSON.stringify(qk), existing);

          queryClient.setQueriesData({ queryKey: qk }, (old) => {
            if (update.type === 'update') {
              const id = update.getId(variables);
              const changes = update.getChanges(variables);
              const list = old?.data ?? old;
              if (!Array.isArray(list)) return old;
              const updated = list.map(item =>
                item.id === id ? { ...item, ...changes, _optimistic: true } : item
              );
              return old?.data ? { ...old, data: updated } : updated;
            }
            if (update.type === 'remove') {
              const id = update.getId(variables);
              const list = old?.data ?? old;
              if (!Array.isArray(list)) return old;
              const filtered = list.filter(item => item.id !== id);
              return old?.data ? { ...old, data: filtered } : filtered;
            }
            if (update.type === 'prepend') {
              const newItem = update.getNewItem(variables);
              const list = old?.data ?? old;
              if (!Array.isArray(list)) return [newItem];
              const updated = [newItem, ...list];
              return old?.data ? { ...old, data: updated } : updated;
            }
            return old;
          });
        } else {
          const existing = queryClient.getQueryData(qk);
          snapshots.set(JSON.stringify(qk), existing);

          if (update.type === 'update') {
            const changes = update.getChanges(variables);
            queryClient.setQueryData(qk, (old) => {
              if (!old) return old;
              const currentData = old.data ?? old;
              return {
                ...old,
                data: { ...currentData, ...changes, _optimistic: true },
              };
            });
          }
        }
      }

      return { snapshots };
    },

    onError: (err, variables, context) => {
      // Rollback all snapshots
      if (context?.snapshots) {
        for (const [keyStr, snapshot] of context.snapshots) {
          const qk = JSON.parse(keyStr);
          if (Array.isArray(snapshot)) {
            // Was from getQueriesData — restore each
            snapshot.forEach(([key, data]) => {
              queryClient.setQueryData(key, data);
            });
          } else {
            queryClient.setQueryData(qk, snapshot);
          }
        }
      }

      const msg = typeof errorMessage === 'function'
        ? errorMessage(err, variables)
        : `${errorMessage}: ${err.message}`;
      toast.error(msg);
    },

    onSuccess: (data, variables) => {
      // Invalidate related queries
      const normalizedKeys = Array.isArray(invalidateKeys) ? invalidateKeys : [invalidateKeys];
      for (const key of normalizedKeys) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }

      if (successMessage) {
        const msg = typeof successMessage === 'function'
          ? successMessage(data, variables)
          : successMessage;
        toast.success(msg);
      }

      if (onSuccessCallback) {
        onSuccessCallback(data, variables);
      }
    },
  });
}
