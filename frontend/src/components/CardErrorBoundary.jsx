import React from 'react';
import { buildApiUrl } from '../lib/api';

/**
 * CardErrorBoundary — Scoped error boundary for individual list cards.
 * Prevents a malformed item or child render error in a single card from crashing the entire page or list.
 */
export default class CardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[CardErrorBoundary] Error in ${this.props.resourceName || 'card'}:`, error, errorInfo);
    
    // Automatic telemetry with deduplication
    try {
      if (typeof window !== 'undefined' && window.fetch) {
        const errorMsg = error?.message || String(error);
        const route = window.location.pathname;
        const dedupeKey = `ce_dedupe_${route}_${errorMsg.slice(0, 50)}`;
        if (sessionStorage.getItem(dedupeKey)) return;
        sessionStorage.setItem(dedupeKey, '1');

        fetch(buildApiUrl('/client-errors'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level: 'warn',
            type: 'CardRenderError',
            message: errorMsg,
            componentStack: errorInfo?.componentStack || null,
            route,
            build: import.meta.env.VITE_BUILD_HASH || 'dev',
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {});
      }
    } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-2xl border border-red-100 bg-red-50/30 text-center flex flex-col items-center justify-center min-h-[160px]">
          <span className="material-symbols-outlined text-red-400 text-xl mb-1">warning</span>
          <p className="text-xs font-semibold text-slate-700">Unable to display this {this.props.resourceName ? this.props.resourceName.slice(0, -1) : 'item'}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 text-[11px] font-bold text-[#1f52cc] hover:underline"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
