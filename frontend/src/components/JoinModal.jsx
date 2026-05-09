import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const TODAY = new Date().toISOString().split('T')[0];

const JoinModal = ({ candidateName, jobTitle, isLoading, onConfirm, onCancel }) => {
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [notes, setNotes] = useState('');
  const overlayRef = useRef(null);
  const firstInputRef = useRef(null);
  const confirmBtnRef = useRef(null);

  const isValid = dateOfJoining.trim() !== '';

  // Focus trap on mount
  useEffect(() => {
    const el = firstInputRef.current;
    if (el) el.focus();
  }, []);

  // Escape key closes modal
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && !isLoading) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isLoading, onCancel]);

  // Click outside closes modal
  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current && !isLoading) onCancel();
  }, [isLoading, onCancel]);

  // Focus trap inside modal
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
    onConfirm({ dateOfJoining, notes });
  };

  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-modal-title"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal-container">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon modal-header-icon--join">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>how_to_reg</span>
          </div>
          <div className="modal-header-content">
            <h2 className="modal-title" id="join-modal-title">Confirm Joining</h2>
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
            You are marking <strong>{candidateName}</strong> as joined for <strong>{jobTitle}</strong>.
            This action will move them to the Joined Candidates section and cannot be undone.
          </p>

          <div className="modal-field">
            <label htmlFor="join-date-input">
              Date of Joining <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="join-date-input"
              ref={firstInputRef}
              type="date"
              min={TODAY}
              required
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="modal-field">
            <label htmlFor="join-notes-input">Notes <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              id="join-notes-input"
              placeholder="Any onboarding notes or remarks..."
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
            ref={confirmBtnRef}
            className="modal-btn-confirm modal-btn-confirm--join"
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <span className="btn-spinner" />
                Confirming...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                Confirm Joining
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default JoinModal;
