import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Unhandled UI Error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleCopyError = () => {
    const errorDetails = `
Error: ${this.state.error?.toString()}
Stack: ${this.state.error?.stack || 'N/A'}
Component Stack: ${this.state.errorInfo?.componentStack || 'N/A'}
User Agent: ${navigator.userAgent}
Time: ${new Date().toISOString()}
    `.trim();

    navigator.clipboard.writeText(errorDetails)
      .then(() => {
        alert('Error details copied to clipboard!');
      })
      .catch((err) => {
        console.error('Could not copy text: ', err);
      });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f8fafc',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#1e293b',
          padding: '24px',
        }}>
          <div style={{
            width: '100%',
            maxWidth: '560px',
            backgroundColor: '#ffffff',
            borderRadius: '24px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
            padding: '40px',
            textAlign: 'center',
          }}>
            {/* Warning Icon */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              backgroundColor: '#fef2f2',
              color: '#ef4444',
              marginBottom: '24px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>error</span>
            </div>

            {/* Heading */}
            <h1 style={{
              fontSize: '24px',
              fontWeight: 800,
              color: '#0f172a',
              marginBottom: '12px',
              letterSpacing: '-0.025em',
            }}>
              Something went wrong
            </h1>

            {/* Description */}
            <p style={{
              fontSize: '14px',
              color: '#64748b',
              lineHeight: '1.6',
              marginBottom: '32px',
            }}>
              The application encountered an unexpected error. This might be due to a temporary network issue or a new update being deployed.
            </p>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              marginBottom: '24px',
            }}>
              <button
                onClick={this.handleReload}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
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
                Reload Application
              </button>

              <button
                onClick={this.handleCopyError}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '14px',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>content_copy</span>
                Copy Details
              </button>
            </div>

            {/* Collapsible Error Info */}
            <details style={{
              textAlign: 'left',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '20px',
              marginTop: '10px',
            }}>
              <summary style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748b',
                cursor: 'pointer',
                userSelect: 'none',
                outline: 'none',
              }}>
                Show Technical Details
              </summary>
              <div style={{
                marginTop: '12px',
                padding: '16px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#334155',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: '200px',
              }}>
                <strong>Error:</strong> {this.state.error?.toString()}<br /><br />
                <strong>Stack:</strong> {this.state.error?.stack || 'N/A'}<br /><br />
                <strong>Component Stack:</strong> {this.state.errorInfo?.componentStack || 'N/A'}
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
