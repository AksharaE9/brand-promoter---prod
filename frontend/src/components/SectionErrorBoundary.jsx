import React from 'react';
import { buildApiUrl } from '../lib/api';

/**
 * SectionErrorBoundary — Scoped error boundary for candidate profile sections / tabs.
 * Displays "This section couldn't be displayed — Retry · Report"
 * and isolates failures to that specific section rather than crashing the full profile dossier.
 */
export default class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, reported: false };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleManualReport = this.handleManualReport.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const sectionName = this.props.sectionName || this.props.title || 'Section';
    console.error(`[SectionErrorBoundary] Error in ${sectionName}:`, error, errorInfo);

    this.sendErrorReport(error, errorInfo, false);
  }

  sendErrorReport(error, errorInfo, isManual = false) {
    try {
      if (typeof window !== 'undefined' && window.fetch) {
        const errorMsg = error?.message || String(error || 'Unknown section render error');
        const route = window.location.pathname;
        const dedupeKey = `se_dedupe_${route}_${(this.props.sectionName || '')}_${errorMsg.slice(0, 50)}`;

        if (!isManual && sessionStorage.getItem(dedupeKey)) {
          return;
        }
        sessionStorage.setItem(dedupeKey, '1');

        fetch(buildApiUrl('/client-errors'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level: 'error',
            type: 'SectionRenderError',
            section: this.props.sectionName || 'profile-section',
            candidateId: this.props.candidateId || null,
            message: errorMsg,
            componentStack: errorInfo?.componentStack || null,
            route,
            build: import.meta.env.VITE_BUILD_HASH || 'dev',
            timestamp: new Date().toISOString(),
          }),
        })
          .then(() => {
            this.setState({ reported: true });
          })
          .catch(() => {});
      }
    } catch (_) {}
  }

  handleRetry() {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onRetry === 'function') {
      try {
        this.props.onRetry();
      } catch (e) {
        console.warn('[SectionErrorBoundary] onRetry failed:', e);
      }
    }
  }

  handleManualReport() {
    this.sendErrorReport(this.state.error, null, true);
    this.setState({ reported: true });
  }

  render() {
    if (this.state.hasError) {
      const sectionTitle = this.props.title || this.props.sectionName || 'section';
      return (
        <div className="os-card p-5 bg-amber-50/50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs my-2">
          <div className="flex items-center gap-2 text-amber-900">
            <span className="material-symbols-outlined text-amber-600 text-lg">error_outline</span>
            <span>
              This {sectionTitle} couldn't be displayed.
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3 py-1 bg-white border border-amber-300 hover:bg-amber-100/60 text-amber-900 font-semibold rounded-lg shadow-sm transition-all"
            >
              Retry
            </button>
            <span className="text-amber-400">•</span>
            <button
              type="button"
              onClick={this.handleManualReport}
              disabled={this.state.reported}
              className="text-amber-700 hover:underline font-medium disabled:opacity-50"
            >
              {this.state.reported ? 'Reported ✓' : 'Report'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
