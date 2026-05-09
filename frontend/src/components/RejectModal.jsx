import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const REJECTION_REASONS = [
  { value: 'NOT_A_FIT',      label: 'Not a fit' },
  { value: 'OVERQUALIFIED',  label: 'Overqualified' },
  { value: 'WITHDREW',       label: 'Candidate withdrew' },
  { value: 'OFFER_DECLINED', label: 'Offer declined' },
  { value: 'NO_SHOW',        label: 'No show' },
  { value: 'OTHER',          label: 'Other' },
];

const RejectModal = ({ candidateName, jobTitle, isLoading, onConfirm, onCancel }) => {
  const [rejectionReason, setRejectionReason] = useState('');
  const [notes, setNotes] = useState('');
  const overlayRef = useRef(null);
  const firstInputRef = useRef(null);

  const isValid = rejectionReason !== '';

  useEffect(() => {
    const el = firstInputRef.current;
    if (el) el.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && !isLoading) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isLoading, onCancel]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current && !isLoading) onCancel();
  }, [isLoading, onCancel]);

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return;
    const focusable = overlayRef.current?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }, []);

  const handleConfirm = () => {
    if (!isValid || isLoading) return;
    onConfirm({ rejectionReason, notes });
  };

  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal-container">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon modal-header-icon--reject">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>person_remove</span>
          </div>
          <div className="modal-header-content">
            <h2 className="modal-title" id="reject-modal-title">Confirm Rejection</h2>
            <p className="modal-subtitle">{jobTitle}</p>
          </div>
          <button
            className="modal-close-btn"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close modal"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <p className="modal-description">
            You are rejecting the offer for <strong>{candidateName}</strong> applying to{' '}
            <strong>{jobTitle}</strong>. They will be moved to <strong>Rejected Candidates</strong>.
            This action cannot be undone.
          </p>

          <div className="modal-field">
            <label htmlFor="rejection-reason-select">
              Rejection Reason <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="rejection-reason-select"
              ref={firstInputRef}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              disabled={isLoading}
              required
            >
              <option value="">— Select a reason —</option>
              {REJECTION_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="modal-field">
            <label htmlFor="reject-notes-input">Notes <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              id="reject-notes-input"
              placeholder="Additional context for this rejection..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isLoading}
              rows={3}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            className="modal-btn-cancel"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className="modal-btn-confirm modal-btn-confirm--reject"
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <span className="btn-spinner" />
                Rejecting...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>cancel</span>
                Confirm Rejection
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RejectModal;
