import { useEffect, useRef, useCallback } from 'react';
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
