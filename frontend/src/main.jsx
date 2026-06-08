import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './screens.css';
import './responsive.css';
import './layout.css';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,            // 30 seconds stale time
      gcTime: 10 * 60 * 1000,          // 10 minutes cache/gc time
      retry: 1,                        // retry once on failure
      retryDelay: 1000,
      refetchOnWindowFocus: false,      // do not refetch on window focus
      refetchOnReconnect: 'always',
      refetchOnMount: false,            // use cached data within stale time
      networkMode: 'online',
    },
    mutations: {
      retry: 0,
      networkMode: 'online',
    }
  }
});

const sessionPersister = {
  persistClient: async (client) => {
    try {
      // Filter cache to only persist jobs, team, org-settings, drives, panel-members
      const filteredQueries = client.clientState.queries.filter(q => {
        const key = q.queryKey[0];
        return typeof key === 'string' && ['jobs', 'team', 'org-settings', 'drives', 'panel-members'].includes(key) && q.state.status === 'success';
      });
      const cacheData = {
        clientState: {
          ...client,
          clientState: {
            ...client.clientState,
            queries: filteredQueries
          }
        },
        buster: import.meta.env.VITE_BUILD_HASH || 'default',
        timestamp: Date.now()
      };
      sessionStorage.setItem('REACT_QUERY_OFFLINE_CACHE', JSON.stringify(cacheData));
    } catch (e) {
      console.warn('Failed to persist QueryClient:', e.message);
    }
  },
  restoreClient: async () => {
    try {
      const cache = sessionStorage.getItem('REACT_QUERY_OFFLINE_CACHE');
      if (!cache) return undefined;
      const parsed = JSON.parse(cache);
      
      // Clear cache if build buster mismatch
      const currentBuster = import.meta.env.VITE_BUILD_HASH || 'default';
      if (parsed.buster !== currentBuster) {
        sessionStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        return undefined;
      }
      
      // Expire cache after 5 minutes
      if (Date.now() - parsed.timestamp > 5 * 60_000) {
        sessionStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        return undefined;
      }
      
      return parsed.clientState;
    } catch (e) {
      console.warn('Failed to restore QueryClient:', e.message);
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      sessionStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
    } catch (e) {
      console.warn('Failed to remove QueryClient:', e.message);
    }
  }
};

const rootElement = document.getElementById('app');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <PersistQueryClientProvider
                client={queryClient}
                persistOptions={{ persister: sessionPersister, maxAge: 1000 * 60 * 60 * 24 }}
            >
                <App />
            </PersistQueryClientProvider>
        </React.StrictMode>
    );
}
