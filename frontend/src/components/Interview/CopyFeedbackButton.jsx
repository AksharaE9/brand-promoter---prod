import * as React from 'react';
import { useState } from 'react';
import { formatFeedbackForClipboard } from '../../lib/interviewTemplates';

export default function CopyFeedbackButton({ round, values, templateVersion, className = '' }) {
  const [copied, setCopied] = useState(false);
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [fallbackText, setFallbackText] = useState('');

  const handleCopy = async (e) => {
    e.preventDefault();
    const text = formatFeedbackForClipboard(round, values, templateVersion);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Clipboard API not available');
      }
    } catch (err) {
      setFallbackText(text);
      setShowFallbackModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${
          copied
            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
        } ${className}`}
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span>Copied ✓</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Copy Feedback</span>
          </>
        )}
      </button>

      {showFallbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-900">Copy Feedback (Manual Fallback)</h4>
              <button
                type="button"
                onClick={() => setShowFallbackModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Clipboard access was blocked. Press Ctrl+C (or Cmd+C) to copy the formatted feedback below:
            </p>
            <textarea
              readOnly
              value={fallbackText}
              onClick={(e) => e.target.select()}
              className="w-full h-48 rounded-lg border border-slate-300 p-2.5 text-xs font-mono text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1f52cc]"
              autoFocus
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowFallbackModal(false)}
                className="px-3 py-1.5 text-xs font-medium bg-[#1f52cc] text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
