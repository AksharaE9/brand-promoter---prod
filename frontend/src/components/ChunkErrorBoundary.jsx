import React from 'react';

/**
 * ChunkErrorBoundary
 *
 * Specific boundary to catch chunk loading/dynamic import errors.
 * Renders a friendly "New version available" fallback UI instead of crashing the whole app.
 */
class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    const errorMsg = error?.message || '';
    const errorName = error?.name || '';
    const isChunkError =
      errorName === 'ChunkLoadError' ||
      /failed to fetch/i.test(errorMsg) ||
      /loading chunk/i.test(errorMsg) ||
      /dynamically imported module/i.test(errorMsg) ||
      errorMsg.includes('Failed to fetch dynamically imported module');

    if (isChunkError) {
      return { hasError: true, error };
    }
    // For other errors, let them bubble up to the root ErrorBoundary
    throw error;
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ChunkErrorBoundary] Caught chunk loading error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#1e293b',
          padding: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
            padding: '40px',
          }}>
            {/* Cloud Update Icon */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              backgroundColor: '#eff6ff',
              color: '#1f52cc',
              marginBottom: '20px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>system_update</span>
            </div>

            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '10px',
              letterSpacing: '-0.025em',
            }}>
              Update Available
            </h2>

            <p style={{
              fontSize: '14px',
              color: '#64748b',
              lineHeight: '1.6',
              marginBottom: '28px',
            }}>
              A new version of the application has been deployed. Please refresh to continue.
            </p>

            <button
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                backgroundColor: '#1f52cc',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '14px',
                padding: '12px 24px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 6px -1px rgba(31, 82, 204, 0.2)',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#163fa3'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#1f52cc'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>refresh</span>
              Refresh Now
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChunkErrorBoundary;
