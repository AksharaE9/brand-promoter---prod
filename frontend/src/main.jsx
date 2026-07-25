import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './screens.css';
import './responsive.css';
import './layout.css';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { startKeepAlive } from './lib/api';

// Prevent Render instance sleeping
startKeepAlive();

// Intercept clipboard copy to restore full text of visually truncated elements
if (typeof document !== 'undefined') {
  document.addEventListener('copy', (e) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return;

    try {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const containerElement = container.nodeType === Node.ELEMENT_NODE
        ? container
        : container.parentElement;
      if (!containerElement) return;

      const truncated = containerElement.closest('[data-fulltext]') ||
                        containerElement.querySelector('[data-fulltext]');
      if (!truncated) return;

      const el = truncated;
      if (el.scrollWidth <= el.clientWidth) return;

      const fullText = el.getAttribute('data-fulltext');
      if (!fullText) return;

      e.clipboardData?.setData('text/plain', fullText);
      e.preventDefault();
    } catch (_) {
      // Silent catch to preserve standard copy behavior if API fails
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 2 minutes: navigating away and back within 2min shows data instantly
      staleTime: 2 * 60 * 1000,
      // 15 minutes: keep data in memory after component unmounts
      gcTime: 15 * 60 * 1000,
      retry: (failureCount, error) => {
        // Never retry 4xx errors - they're deterministic failures, not transient.
        if (error && error.status >= 400 && error.status < 500) {
          return false;
        }
        // Retry other errors (network blips, 5xx) up to 2 times.
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnWindowFocus: false,      // do not refetch on window focus
      refetchOnReconnect: 'always',
      // 'always' but staleTime=2min means: show cached + revalidate in background
      refetchOnMount: 'always',
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
      // Persist dashboard + jobs + team + org-settings + drives + panel-members
      const filteredQueries = client.clientState.queries.filter(q => {
        const key = q.queryKey[0];
        return typeof key === 'string' && ['dashboard', 'jobs', 'team', 'org-settings', 'drives', 'panel-members'].includes(key) && q.state.status === 'success';
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
