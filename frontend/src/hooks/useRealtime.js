import { useEffect, useRef } from 'react';
import { API_ROOT_URL } from '../lib/api';

/**
 * A global hook for handling real-time updates via SSE.
 * Throttles refreshes to prevent UI flickering during high-frequency events.
 */
export const useRealtime = (onUpdate, relevantTypes = []) => {
  const throttleRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('ats_token');
    if (!token) return;

    const eventSource = new EventSource(`${API_ROOT_URL}/notifications/stream?token=${token}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;
        
        if (relevantTypes.length === 0 || relevantTypes.includes(data.type)) {
          // Throttle updates to at most once every 1000ms
          if (throttleRef.current) return;
          
          throttleRef.current = setTimeout(() => {
            onUpdate(data);
            throttleRef.current = null;
          }, 1000);
        }
      } catch (err) {
        console.error('[SSE] Real-time parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [onUpdate, JSON.stringify(relevantTypes)]);
};
