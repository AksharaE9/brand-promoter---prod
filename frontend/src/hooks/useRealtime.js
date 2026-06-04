import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/api';

/**
 * A global hook for handling real-time updates via SSE.
 * Features:
 *  - Exponential backoff reconnection (1s → 2s → 4s → 8s → max 30s)
 *  - Throttled updates to prevent UI flickering
 *  - Auto-reset backoff on successful message
 *  - Cleans up on unmount
 */
export const useRealtime = (onUpdate, relevantTypes = []) => {
  const queryClient = useQueryClient();
  const throttleRef = useRef(null);
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(1000);
  const relevantTypesRef = useRef(relevantTypes);

  // Keep relevantTypes ref current without causing reconnects
  useEffect(() => {
    relevantTypesRef.current = relevantTypes;
  }, [relevantTypes]);

  const connect = useCallback(() => {
    const token = localStorage.getItem('ats_token');
    if (!token) return;

    // Don't connect if already open
    if (eventSourceRef.current?.readyState === EventSource.OPEN) return;

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const eventSource = new EventSource(
      `${API_BASE_URL}/notifications/stream?token=${token}`
    );
    eventSourceRef.current = eventSource;

    // Listen for scheduling changes from other clients
    eventSource.addEventListener('SCHEDULING_UPDATE', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const { type, roundId, round } = payload;

        if (type === 'ROUND_UPDATED' || type === 'ROUND_CREATED') {
          // Update individual round cache
          queryClient.setQueryData(['scheduling', 'round', roundId], (old) => {
            if (!old) return old;
            const currentData = old.data ?? old;
            return {
              ...old,
              data: { ...currentData, ...round, _optimistic: false },
            };
          });

          // Update lists
          queryClient.setQueriesData(
            { queryKey: ['scheduling', 'rounds'] },
            (old) => {
              const list = old?.data ?? old;
              if (!Array.isArray(list)) return old;
              
              const exists = list.some(r => r.id === roundId);
              let updated;
              if (exists) {
                updated = list.map(r => r.id === roundId ? { ...r, ...round, _optimistic: false } : r);
              } else if (type === 'ROUND_CREATED') {
                updated = [round, ...list];
              } else {
                updated = list;
              }
              return old?.data ? { ...old, data: updated } : updated;
            }
          );
        }

        if (type === 'ROUND_DELETED') {
          queryClient.setQueriesData(
            { queryKey: ['scheduling', 'rounds'] },
            (old) => {
              const list = old?.data ?? old;
              if (!Array.isArray(list)) return old;
              const updated = list.filter(r => r.id !== roundId);
              return old?.data ? { ...old, data: updated } : updated;
            }
          );
        }
      } catch (err) {
        console.error('[SSE] SCHEDULING_UPDATE parse error:', err);
      }
    });

    // Handle sync completion — swap temporary IDs with real IDs
    eventSource.addEventListener('SCHEDULING_SYNC_COMPLETE', (e) => {
      try {
        const { tempIdMap } = JSON.parse(e.data);
        if (!tempIdMap || Object.keys(tempIdMap).length === 0) return;

        const tempIdLookup = new Map(Object.entries(tempIdMap));

        queryClient.setQueriesData(
          { queryKey: ['scheduling', 'rounds'] },
          (old) => {
            const list = old?.data ?? old;
            if (!Array.isArray(list)) return old;
            const updated = list.map(r => {
              const realId = tempIdLookup.get(r.id);
              return realId ? { ...r, id: realId, _pendingSync: false, _optimistic: false } : r;
            });
            return old?.data ? { ...old, data: updated } : updated;
          }
        );

        // Invalidate to guarantee latest fresh data
        queryClient.invalidateQueries({ queryKey: ['scheduling', 'rounds'] });
      } catch (err) {
        console.error('[SSE] SCHEDULING_SYNC_COMPLETE parse error:', err);
      }
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;

        // Reset backoff on successful message
        reconnectDelayRef.current = 1000;

        const types = relevantTypesRef.current;
        if (types.length === 0 || types.includes(data.type)) {
          // Throttle updates to at most once every 1000ms
          if (throttleRef.current) return;

          throttleRef.current = setTimeout(() => {
            onUpdate(data);
            throttleRef.current = null;
          }, 1000);
        }
      } catch (err) {
        // Silently ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;

      // Exponential backoff: 1s → 2s → 4s → 8s → 16s → max 30s
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30000);

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [onUpdate]);

  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
  }, [connect]);
};
