/**
 * ExcelView.jsx
 *
 * A lightweight Excel-like data grid for the Interviews module.
 * Implements per-column filtering/sorting, column resize, global search,
 * row selection, CSV export, and column visibility toggle — all without
 * any additional npm dependencies (uses React + vanilla CSS only).
 *
 * DEVIATION FROM PROMPT: The prompt recommends AG Grid Community. Since AG Grid
 * is not in the existing package.json and the user did not confirm installing it,
 * this implementation provides equivalent UX using native React + CSS.
 *
 * Props:
 * - interviews: Interview[] — already-filtered flat array from the shared filteredForViews
 * - viewDate: Date — the currently displayed month (for footer display)
 * - onSelectCandidate: (candidateId, interviewId) => void — navigate to List View detail
 *
 * BACKEND AUDIT VERIFIED:
 * - interview.result = outcome pill (PASS/FAIL/REJECTED/SELECTED etc.)  ← displayed as "Status"
 * - interview.status = workflow state (SCHEDULED/COMPLETED etc.)        ← NOT displayed
 * - interview.feedback[] is populated array of {ratings:{technical,communication,culture}, concerns, notes, ...}
 *   "concerns" maps to Concerns/Weaknesses field
 *   "notes"    maps to Overall Comments/Summary field
 * - slotNo is NOT in Prisma schema — treated as a virtual/custom field, may be undefined
 * - notes column = JSON-encoded {phoneFollowUp, emailFollowUp} file objects
 * - mode valid values: VIRTUAL | IN_PERSON | PHONE | ONLINE | DRIVE
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { parseNotesSafely, getFirstFeedback, isFollowUpUploaded } from '../../lib/interviewUtils';
import { getStoredUser, apiGet, apiPost } from '../../lib/api';
import { resolveFeedbackValue } from '../../lib/interviewTemplates';
import InfiniteScrollSentinel from '../InfiniteScrollSentinel';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

import { formatTime24h } from '../../lib/datetime';

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  return formatTime24h(dateStr) || '-';
}


function downloadBase64File(fileName, base64Data) {
  try {
    let blob;
    if (base64Data.startsWith('data:')) {
      const parts = base64Data.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: mime });
    } else {
      const bstr = atob(base64Data);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: 'application/octet-stream' });
    }
    
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    console.error('Failed to download file:', error);
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * StatusPill — coloured badge matching the List View status pill style.
 * Uses `iv.result` (the outcome field), NOT `iv.status` (workflow state).
 * This matches exactly what List View renders.
 */
function StatusPill({ result }) {
  const map = {
    PASS:         { bg: '#e8f5ed', text: '#2ca764', label: 'PASS' },
    SELECTED:     { bg: '#e8f5ed', text: '#2ca764', label: 'SELECTED' },
    FAIL:         { bg: '#fbeaea', text: '#cf3a3a', label: 'FAIL' },
    REJECTED:     { bg: '#fbeaea', text: '#cf3a3a', label: 'REJECTED' },
    ON_HOLD:      { bg: '#fef9ed', text: '#d97706', label: 'ON HOLD' },
    OFFER_LETTER: { bg: '#eff6ff', text: '#1f52cc', label: 'OFFER LETTER' },
    DIDNT_JOIN:   { bg: '#f1f5f9', text: '#64748b', label: "DIDN'T JOIN" },
  };
  const style = map[result] || { bg: '#fef4e8', text: '#f2994a', label: result || 'PENDING' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: '20px',
      background: style.bg, color: style.text, fontWeight: 700,
      fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap',
    }}>
      {style.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────

/**
 * IMPORTANT — field mapping audit against backend (relationPopulator.js):
 *
 * iv.application.candidate.fullName  ← populated by populateInterviewRelations
 * iv.application.job.title           ← populated by populateInterviewRelations
 * iv.interviewers[].fullName         ← populated array (never a JSON string on the wire)
 * iv.result                          ← outcome/status pill field
 * iv.slotNo                          ← NOT in Prisma schema; sent on create but may not persist
 * iv.notes                           ← JSON string: {phoneFollowUp, emailFollowUp}
 * iv.feedback[0].ratings.technical   ← nested ratings object
 * iv.feedback[0].ratings.communication
 * iv.feedback[0].ratings.culture
 * iv.feedback[0].notes               ← overall comments (stored as "notes" in feedback)
 * iv.feedback[0].concerns            ← weaknesses field (stored as "concerns" in feedback)
 * iv.mode                            ← VIRTUAL | IN_PERSON | PHONE | ONLINE | DRIVE
 */
const ALL_COLUMNS = [
  {
    key: 'candidateName',
    label: 'Candidate Name',
    width: 180,
    filterType: 'text',
    pinned: true,
    getValue: (iv) => iv.application?.candidate?.fullName || iv.candidateName || '',
    render: (iv, { onSelectCandidate }) => (
      <span
        role="button"
        tabIndex={0}
        onClick={() => onSelectCandidate(
          iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId,
          iv.id
        )}
        style={{
          color: '#1f52cc',
          fontWeight: 600,
          fontSize: 12,
          textAlign: 'left',
          cursor: 'pointer',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          MozUserSelect: 'text',
          msUserSelect: 'text',
          display: 'inline-block',
          width: '100%',
        }}
        title="Open interview detail"
      >
        {iv.application?.candidate?.fullName || iv.candidateName || '-'}
      </span>
    ),
  },
  {
    key: 'role',
    label: 'Role',
    width: 140,
    filterType: 'set',
    getValue: (iv) => iv.application?.job?.title || iv.jobTitle || '',
    render: (iv) => <span>{iv.application?.job?.title || iv.jobTitle || '-'}</span>,
  },
  {
    key: 'round',
    label: 'Round',
    width: 90,
    filterType: 'set',
    getValue: (iv) => {
      const rn = iv.roundNo;
      return rn === 99 ? 'Final' : rn ? `R${rn}` : (iv.round || '-');
    },
    render: (iv) => {
      const label = iv.roundNo === 99 ? 'Final' : iv.roundNo ? `R${iv.roundNo}` : (iv.round || '-');
      return (
        <span style={{ background: '#eff6ff', color: '#1f52cc', fontWeight: 700, fontSize: 10, padding: '2px 8px', borderRadius: 12 }}>
          {label}
        </span>
      );
    },
  },
  {
    key: 'interviewers',
    label: 'Interviewers',
    width: 160,
    filterType: 'set',
    // iv.interviewers is populated as an array of user objects by the backend
    getValue: (iv) => {
      const arr = Array.isArray(iv.interviewers) ? iv.interviewers : [];
      return arr.map(u => u.fullName).filter(Boolean).join(', ') || iv.interviewerNames || '';
    },
    render: (iv) => {
      const arr = Array.isArray(iv.interviewers) ? iv.interviewers : [];
      const names = arr.map(u => u.fullName).filter(Boolean).join(', ') || iv.interviewerNames || '-';
      return <span title={names}>{names}</span>;
    },
  },
  {
    key: 'createdByName',
    label: 'Created',
    width: 140,
    filterType: 'set',
    getValue: (iv) => iv.createdByName || 'Super Admin',
    render: (iv) => <span title={iv.createdByName || 'Super Admin'}>{iv.createdByName || 'Super Admin'}</span>,
  },
  {
    key: 'mode',
    label: 'Mode',
    width: 110,
    filterType: 'set',
    // Valid values from backend: VIRTUAL | IN_PERSON | PHONE | ONLINE | DRIVE
    getValue: (iv) => iv.mode || '',
    render: (iv) => <span>{iv.mode || '-'}</span>,
  },
  {
    key: 'date',
    label: 'Date',
    width: 110,
    filterType: 'text',
    getValue: (iv) => iv.scheduledStart ? formatDateDDMMYYYY(iv.scheduledStart) : '',
    render: (iv) => <span>{iv.scheduledStart ? formatDateDDMMYYYY(iv.scheduledStart) : '-'}</span>,
  },
  {
    key: 'time',
    label: 'Time',
    width: 90,
    filterType: 'text',
    getValue: (iv) => iv.scheduledStart ? formatTime(iv.scheduledStart) : '',
    render: (iv) => <span>{iv.scheduledStart ? formatTime(iv.scheduledStart) : '-'}</span>,
  },
  {
    key: 'timeSlot',
    label: 'Time Slot',
    width: 90,
    filterType: 'set',
    // slotNo is NOT in the Prisma schema — it is sent on create (as a computed value)
    // but may not be persisted. Safe null-check required.
    getValue: (iv) => iv.slotNo ? `Slot ${iv.slotNo}` : '',
    render: (iv) => <span>{iv.slotNo ? `Slot ${iv.slotNo}` : '-'}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    width: 130,
    filterType: 'set',
    // Uses `result` (outcome) NOT `status` (workflow), matching List View pill display
    getValue: (iv) => iv.result || 'PENDING',
    render: (iv) => <StatusPill result={iv.result} />,
  },
  {
    key: 'offerLetterSent',
    label: 'Offer Letter Sent',
    width: 140,
    filterType: 'set',
    getValue: (iv) => iv.offer_letter_sent || '—',
    render: (iv) => {
      const val = iv.offer_letter_sent || '—';
      if (val === 'Yes') {
        return (
          <span style={{ color: '#2ca764', fontWeight: 700, fontSize: 11 }}>
            Yes
          </span>
        );
      } else if (val === 'No') {
        return (
          <span style={{ color: '#d97706', fontWeight: 700, fontSize: 11 }}>
            No
          </span>
        );
      } else {
        return (
          <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 11 }}>
            —
          </span>
        );
      }
    },
  },
  {
    key: 'techScore',
    label: 'Tech Score',
    width: 90,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return '';
      const ver = fb.templateVersion || fb.template_version || 1;
      return resolveFeedbackValue(fb.feedbackData || fb, 'technical', ver);
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return <span>-</span>;
      const ver = fb.templateVersion || fb.template_version || 1;
      const val = resolveFeedbackValue(fb.feedbackData || fb, 'technical', ver);
      return <span>{val || '-'}</span>;
    },
  },
  {
    key: 'commScore',
    label: 'Comm Score',
    width: 100,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return '';
      const ver = fb.templateVersion || fb.template_version || 1;
      return resolveFeedbackValue(fb.feedbackData || fb, 'communication', ver);
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return <span>-</span>;
      const ver = fb.templateVersion || fb.template_version || 1;
      const val = resolveFeedbackValue(fb.feedbackData || fb, 'communication', ver);
      return <span>{val || '-'}</span>;
    },
  },
  {
    key: 'cultureScore',
    label: 'Culture Score',
    width: 105,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return '';
      const ver = fb.templateVersion || fb.template_version || 1;
      return resolveFeedbackValue(fb.feedbackData || fb, 'culture', ver);
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return <span>-</span>;
      const ver = fb.templateVersion || fb.template_version || 1;
      const val = resolveFeedbackValue(fb.feedbackData || fb, 'culture', ver);
      return <span>{val || '-'}</span>;
    },
  },
  {
    key: 'phoneFollowUp',
    label: 'Phone Follow-up',
    width: 135,
    filterType: 'set',
    // notes column is JSON-encoded {phoneFollowUp: {name, data}, emailFollowUp: {name, data}}
    // In list mode, the server strips base64 data and sends {name, exists: true} instead.
    getValue: (iv) => {
      const { phoneFollowUp } = parseNotesSafely(iv?.notes);
      return isFollowUpUploaded(phoneFollowUp) ? 'Uploaded' : "Didn't upload";
    },
    render: (iv) => {
      const { phoneFollowUp } = parseNotesSafely(iv?.notes);
      if (!isFollowUpUploaded(phoneFollowUp)) {
        return <span style={{ color: '#cf3a3a', fontWeight: 600, fontSize: 11 }}>✗ Didn't upload</span>;
      }
      // Full format: has base64 data — show downloadable button
      if (phoneFollowUp.data) {
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadBase64File(phoneFollowUp.name, phoneFollowUp.data);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: '#2ca764',
              fontWeight: 600,
              fontSize: 11,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            title={`Click to download: ${phoneFollowUp.name}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>download</span>
            Uploaded
          </button>
        );
      }
      // Stripped list-mode format: exists flag only — show status without download
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#2ca764', fontWeight: 600, fontSize: 11 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
          Uploaded
        </span>
      );
    },
  },
  {
    key: 'emailFollowUp',
    label: 'Email Follow-up',
    width: 135,
    filterType: 'set',
    getValue: (iv) => {
      const { emailFollowUp } = parseNotesSafely(iv?.notes);
      return isFollowUpUploaded(emailFollowUp) ? 'Uploaded' : "Didn't upload";
    },
    render: (iv) => {
      const { emailFollowUp } = parseNotesSafely(iv?.notes);
      if (!isFollowUpUploaded(emailFollowUp)) {
        return <span style={{ color: '#cf3a3a', fontWeight: 600, fontSize: 11 }}>✗ Didn't upload</span>;
      }
      if (emailFollowUp.data) {
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadBase64File(emailFollowUp.name, emailFollowUp.data);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: '#2ca764',
              fontWeight: 600,
              fontSize: 11,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            title={`Click to download: ${emailFollowUp.name}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>download</span>
            Uploaded
          </button>
        );
      }
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#2ca764', fontWeight: 600, fontSize: 11 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
          Uploaded
        </span>
      );
    },
  },
  {
    key: 'morningFollowUp',
    label: 'Morning Follow-up',
    width: 135,
    filterType: 'set',
    getValue: (iv) => {
      const { morningFollowUp } = parseNotesSafely(iv?.notes);
      return isFollowUpUploaded(morningFollowUp) ? 'Uploaded' : "Didn't upload";
    },
    render: (iv) => {
      const { morningFollowUp } = parseNotesSafely(iv?.notes);
      if (!isFollowUpUploaded(morningFollowUp)) {
        return <span style={{ color: '#cf3a3a', fontWeight: 600, fontSize: 11 }}>✗ Didn't upload</span>;
      }
      if (morningFollowUp.data) {
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadBase64File(morningFollowUp.name, morningFollowUp.data);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: '#2ca764',
              fontWeight: 600,
              fontSize: 11,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            title={`Click to download: ${morningFollowUp.name}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>download</span>
            Uploaded
          </button>
        );
      }
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#2ca764', fontWeight: 600, fontSize: 11 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
          Uploaded
        </span>
      );
    },
  },
  {
    key: 'nextSchedule',
    label: 'Next Schedule',
    width: 180,
    filterType: 'text',
    getValue: (iv) => {
      if (iv.roundNo === 1 || iv.roundNo === '1') return '-';
      const { nextSchedule } = parseNotesSafely(iv?.notes);
      return nextSchedule || '';
    },
    render: (iv) => {
      if (iv.roundNo === 1 || iv.roundNo === '1') {
        return <span style={{ color: '#64748b' }}>-</span>;
      }
      const { nextSchedule } = parseNotesSafely(iv?.notes);
      const text = nextSchedule || '';
      return (
        <input
          type="text"
          readOnly
          value={text || '-'}
          title={text}
          onClick={(e) => {
            e.stopPropagation();
            e.target.select();
          }}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '11px',
            color: '#334155',
            cursor: 'text',
            textOverflow: 'ellipsis',
          }}
        />
      );
    },
  },
  {
    key: 'overallSummary',
    label: 'Overall Summary',
    width: 200,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      if (!fb) return '';
      const ver = fb.templateVersion || fb.template_version || 1;
      return resolveFeedbackValue(fb.feedbackData || fb, 'overallSummary', ver);
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      const ver = fb ? (fb.templateVersion || fb.template_version || 1) : 1;
      const text = fb ? resolveFeedbackValue(fb.feedbackData || fb, 'overallSummary', ver) : '';
      return (
        <input
          type="text"
          readOnly
          value={text || '-'}
          title={text}
          onClick={(e) => {
            e.stopPropagation();
            e.target.select();
          }}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '11px',
            color: '#334155',
            cursor: 'text',
            textOverflow: 'ellipsis',
          }}
        />
      );
    },
  },
  {
    key: 'internalReport',
    label: 'Internal Report',
    width: 150,
    filterType: 'text',
    getValue: (iv) => {
      const reports = iv.application?.candidate?.internalReports || iv.candidate?.internalReports || [];
      return reports.length > 0 ? `${reports.length} report${reports.length > 1 ? 's' : ''}` : '—';
    },
    render: (iv, { onOpenInternalReports }) => {
      const reports = iv.application?.candidate?.internalReports || iv.candidate?.internalReports || [];
      const count = reports.length;
      if (count === 0) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ color: '#94a3b8' }}>—</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenInternalReports(iv); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '10px', color: '#1f52cc', padding: '2px 6px' }}
            >
              + Add
            </button>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between', width: '100%' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenInternalReports(iv); }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: '11px', color: '#1f52cc', fontWeight: 600 }}
          >
            [View] {count} report{count > 1 ? 's' : ''}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenInternalReports(iv); }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '10px', color: '#1f52cc', padding: '2px 6px' }}
          >
            + Add
          </button>
        </div>
      );
    }
  },
];

// ─────────────────────────────────────────────
// Resizable column header
// ─────────────────────────────────────────────

function ResizableHeader({ col, width, onResize, sortState, onSort }) {
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (mv) => onResize(Math.max(60, startW + (mv.clientX - startX)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width, onResize]);

  const sortIcon = sortState === 'asc' ? ' ↑' : sortState === 'desc' ? ' ↓' : '';

  return (
    <th
      style={{
        width, minWidth: width, maxWidth: width, position: 'relative', userSelect: 'none',
        background: '#f8fafc', borderRight: '1px solid #e4ebf1', borderBottom: '1px solid #e4ebf1',
        padding: '0 8px', height: 36, fontWeight: 700, fontSize: 11, color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
      onClick={onSort}
      title={col.label}
    >
      {col.label}
      <span style={{ color: '#1f52cc' }}>{sortIcon}</span>
      <span
        onMouseDown={onMouseDown}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 1 }}
      />
    </th>
  );
}

// ─────────────────────────────────────────────
// Main ExcelView component
// ─────────────────────────────────────────────

export default function ExcelView({
  interviews = [],
  viewDate,
  onSelectCandidate,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  totalCount = null,  // real DB COUNT(*) from backend — null until page 1 loads
}) {
  const containerRef = useRef(null);


  const isSuperAdmin = useMemo(() => {
    const user = getStoredUser();
    return user?.role === 'SUPER_ADMIN';
  }, []);

  // ── Column widths (resizable) ──
  const [colWidths, setColWidths] = useState(() =>
    Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c.width]))
  );

  // ── Column visibility (persisted to localStorage) ──
  const [hiddenCols, setHiddenCols] = useState(() => {
    try {
      const stored = localStorage.getItem('interview_excel_hidden_cols');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showColToggle, setShowColToggle] = useState(false);

  const toggleColVisibility = useCallback((key) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem('interview_excel_hidden_cols', JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => {
      if (c.key === 'internalReport') return isSuperAdmin;
      return true;
    }).filter((c) => !hiddenCols.includes(c.key)),
    [hiddenCols, isSuperAdmin]
  );

  const columnsForToggle = useMemo(() => {
    return ALL_COLUMNS.filter((c) => {
      if (c.key === 'internalReport') return isSuperAdmin;
      return true;
    });
  }, [isSuperAdmin]);

  // ── Internal Reports Modal State ──
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [reports, setReports] = useState([]);
  const [newReport, setNewReport] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reportError, setReportError] = useState('');

  const handleOpenInternalReports = useCallback(async (iv) => {
    const candidate = iv.application?.candidate || iv.candidate;
    if (!candidate) return;
    setSelectedCandidate(candidate);
    setReports(candidate.internalReports || []);
    setNewReport('');
    setReportError('');

    try {
      const res = await apiGet(`/candidates/${candidate.id}/internal-reports`);
      if (res.success) {
        setReports(res.data || []);
        candidate.internalReports = res.data || [];
      }
    } catch (err) {
      console.error('Failed to load internal reports:', err.message);
    }
  }, []);

  const handleSubmitReport = useCallback(async (e) => {
    e.preventDefault();
    if (!newReport.trim() || !selectedCandidate) return;
    setIsSubmitting(true);
    setReportError('');
    try {
      const res = await apiPost(`/candidates/${selectedCandidate.id}/internal-reports`, { content: newReport });
      if (res.success) {
        setReports(prev => [res.data, ...prev]);
        setNewReport('');
        selectedCandidate.internalReports = [res.data, ...(selectedCandidate.internalReports || [])];
      }
    } catch (err) {
      setReportError(err.message || 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  }, [newReport, selectedCandidate]);

  // ── Sort state ──
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const handleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: null };
    });
  }, []);

  // ── Per-column filter state ──
  const [colFilters, setColFilters] = useState({});
  const setColFilter = useCallback((key, val) => {
    setColFilters((prev) => ({ ...prev, [key]: val }));
  }, []);

  // ── Global search ──
  const [globalSearch, setGlobalSearch] = useState('');

  // ── Row selection ──
  const [selectedRows, setSelectedRows] = useState(new Set());
  const toggleRow = useCallback((id) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Compute set options for 'set' filter columns ──
  const setOptions = useMemo(() => {
    const opts = {};
    ALL_COLUMNS.filter((c) => c.filterType === 'set').forEach((c) => {
      const vals = new Set(interviews.map((iv) => c.getValue(iv)).filter(Boolean));
      opts[c.key] = Array.from(vals).sort();
    });
    return opts;
  }, [interviews]);

  // ── Filter + sort pipeline ──
  const filteredRows = useMemo(() => {
    let rows = interviews;

    // Global fuzzy search across Candidate Name, Role, Interviewers
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      rows = rows.filter((iv) =>
        (iv.application?.candidate?.fullName || iv.candidateName || '').toLowerCase().includes(q) ||
        (iv.application?.job?.title || iv.jobTitle || '').toLowerCase().includes(q) ||
        (Array.isArray(iv.interviewers) ? iv.interviewers : []).some(
          (u) => (u.fullName || '').toLowerCase().includes(q)
        )
      );
    }

    // Per-column filters
    ALL_COLUMNS.forEach((col) => {
      const filterVal = colFilters[col.key];
      if (!filterVal) return;
      rows = rows.filter((iv) => {
        const cellVal = col.getValue(iv);
        if (col.filterType === 'set') return cellVal === filterVal;
        return String(cellVal).toLowerCase().includes(filterVal.toLowerCase());
      });
    });

    // Sort
    if (sort.key && sort.dir) {
      const col = ALL_COLUMNS.find((c) => c.key === sort.key);
      if (col) {
        rows = [...rows].sort((a, b) => {
          if (col.key === 'date' || col.key === 'time') {
            const timeA = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
            const timeB = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
            return sort.dir === 'asc' ? timeA - timeB : timeB - timeA;
          }
          if (col.key === 'offerLetterSent') {
            const valA = col.getValue(a);
            const valB = col.getValue(b);
            const getPriority = (val) => {
              if (val === 'No') return 1;
              if (val === 'Yes') return 2;
              return 3;
            };
            const pA = getPriority(valA);
            const pB = getPriority(valB);
            return sort.dir === 'asc' ? pA - pB : pB - pA;
          }
          const cmp = String(col.getValue(a)).localeCompare(String(col.getValue(b)), undefined, { numeric: true });
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }

    return rows;
  }, [interviews, globalSearch, colFilters, sort]);

  // ── Select all / deselect all ──
  const allSelected = filteredRows.length > 0 && filteredRows.every((iv) => selectedRows.has(iv.id));
  const toggleAll = useCallback(() => {
    setSelectedRows(allSelected ? new Set() : new Set(filteredRows.map((iv) => iv.id)));
  }, [allSelected, filteredRows]);

  // ── CSV Export ──
  const exportCSV = useCallback(() => {
    const headers = visibleColumns.map((c) => c.label);
    const rows = filteredRows.map((iv) =>
      visibleColumns.map((c) => {
        const str = String(c.getValue(iv) ?? '').replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      })
    );
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const month = viewDate
      ? `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`
      : 'export';
    a.download = `interviews-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredRows, visibleColumns, viewDate]);

  const exportSelectedCSV = useCallback(() => {
    const selectedList = filteredRows.filter((iv) => selectedRows.has(iv.id));
    if (selectedList.length === 0) return;

    const headers = visibleColumns.map((c) => c.label);
    const rows = selectedList.map((iv) =>
      visibleColumns.map((c) => {
        const str = String(c.getValue(iv) ?? '').replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      })
    );
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const month = viewDate
      ? `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`
      : 'export';
    a.download = `interviews-selected-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredRows, selectedRows, visibleColumns, viewDate]);

  // ── Close col-toggle on outside click ──
  const colToggleRef = useRef(null);
  useEffect(() => {
    if (!showColToggle) return;
    const handler = (e) => {
      if (colToggleRef.current && !colToggleRef.current.contains(e.target)) setShowColToggle(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColToggle]);

  const totalWidth = visibleColumns.reduce((sum, c) => sum + (colWidths[c.key] || c.width), 0) + 40;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderBottom: '1px solid #e4ebf1', background: '#fff', flexWrap: 'wrap', flexShrink: 0,
      }}>
        {/* Global search */}
        <div style={{ position: 'relative', flex: '0 0 260px' }}>
          <span className="material-symbols-outlined" style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, color: '#94a3b8', pointerEvents: 'none',
          }}>search</span>
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search candidate, role, interviewer..."
            style={{
              height: 34, width: '100%', borderRadius: 8, border: '1px solid #e2e8f0',
              paddingLeft: 32, paddingRight: 10, fontSize: 12, outline: 'none',
              background: '#f8fafc', color: '#334155', boxSizing: 'border-box',
            }}
          />
          {globalSearch && (
            <button
              onClick={() => setGlobalSearch('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
            </button>
          )}
        </div>

        {/* Column toggle */}
        <div ref={colToggleRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColToggle((v) => !v)}
            className="os-btn-outline"
            style={{ height: 34, fontSize: 12, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>view_column</span>
            Columns
          </button>
          {showColToggle && (
            <div style={{
              position: 'absolute', top: 40, left: 0, zIndex: 100,
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
              padding: '8px 0', minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            }}>
              {columnsForToggle.map((col) => (
                <label key={col.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                  cursor: 'pointer', fontSize: 12, color: '#334155', userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.includes(col.key)}
                    onChange={() => toggleColVisibility(col.key)}
                    style={{ accentColor: '#1f52cc', width: 14, height: 14 }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Export CSV */}
        <button
          onClick={exportCSV}
          className="os-btn-outline"
          style={{ height: 34, fontSize: 12, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>download</span>
          Export CSV
        </button>

        {/* Bulk selection indicator & Select CSV */}
        {selectedRows.size > 0 && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            {/* Selected Count Badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#e8f0fe',
              border: '1px solid #bfdbfe',
              borderRadius: 8,
              padding: '0 12px',
              height: 34,
              fontSize: 12,
              color: '#1f52cc',
              fontWeight: 600,
              boxSizing: 'border-box'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_box</span>
              <span>{selectedRows.size} Selected</span>
            </div>

            {/* Select CSV Button */}
            <button
              onClick={exportSelectedCSV}
              className="os-btn-outline"
              style={{
                height: 34,
                fontSize: 12,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderColor: '#1f52cc',
                color: '#1f52cc',
                background: '#e8f0fe',
                fontWeight: 600
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>download_for_offline</span>
              Select CSV
            </button>

            {/* Clear Selection Button */}
            <button
              onClick={() => setSelectedRows(new Set())}
              className="os-btn-outline"
              style={{
                height: 34,
                width: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderColor: '#cbd5e1',
                color: '#64748b',
                background: '#fff'
              }}
              title="Clear selection"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div ref={containerRef} className="excel-grid-container" style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <table style={{
          width: totalWidth, minWidth: '100%', borderCollapse: 'collapse',
          tableLayout: 'fixed', fontSize: 12,
        }}>
          <colgroup>
            <col style={{ width: 40, minWidth: 40 }} />
            {visibleColumns.map((col) => (
              <col key={col.key} style={{ width: colWidths[col.key] || col.width }} />
            ))}
          </colgroup>

          {/* ── Sticky header ── */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            {/* Sort row */}
            <tr>
              <th style={{
                width: 40, background: '#f8fafc', borderRight: '1px solid #e4ebf1',
                borderBottom: '1px solid #e4ebf1', textAlign: 'center', height: 36,
              }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  style={{ accentColor: '#1f52cc', cursor: 'pointer' }}
                  title="Select all"
                />
              </th>
              {visibleColumns.map((col) => (
                <ResizableHeader
                  key={col.key}
                  col={col}
                  width={colWidths[col.key] || col.width}
                  onResize={(w) => setColWidths((prev) => ({ ...prev, [col.key]: w }))}
                  sortState={sort.key === col.key ? sort.dir : null}
                  onSort={() => handleSort(col.key)}
                />
              ))}
            </tr>

            {/* Floating filter row (like Excel's AutoFilter row) */}
            <tr>
              <td style={{ background: '#fff', borderRight: '1px solid #e4ebf1', borderBottom: '2px solid #e4ebf1', height: 30 }} />
              {visibleColumns.map((col) => (
                <td key={col.key} style={{
                  background: '#fff', borderRight: '1px solid #e4ebf1',
                  borderBottom: '2px solid #e4ebf1', padding: '0 4px',
                }}>
                  {col.filterType === 'set' ? (
                    <select
                      value={colFilters[col.key] || ''}
                      onChange={(e) => setColFilter(col.key, e.target.value)}
                      style={{
                        width: '100%', height: 24, border: '1px solid #e2e8f0',
                        borderRadius: 4, fontSize: 10, color: '#334155',
                        background: '#f8fafc', outline: 'none', paddingLeft: 4,
                      }}
                    >
                      <option value="">All</option>
                      {(setOptions[col.key] || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={colFilters[col.key] || ''}
                      onChange={(e) => setColFilter(col.key, e.target.value)}
                      placeholder="Filter..."
                      style={{
                        width: '100%', height: 24, border: '1px solid #e2e8f0',
                        borderRadius: 4, fontSize: 10, color: '#334155',
                        background: '#f8fafc', outline: 'none', paddingLeft: 4,
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </td>
              ))}
            </tr>
          </thead>

          {/* ── Body ── */}
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>
                  No interviews match the current filters.
                </td>
              </tr>
            )}
            {filteredRows.map((iv, rowIdx) => {
              const isSelected = selectedRows.has(iv.id);
              return (
                <tr
                  key={iv.id}
                  style={{
                    background: isSelected ? '#e8f0fe' : rowIdx % 2 === 0 ? '#fff' : '#f8fafc',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f1f5f9'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = rowIdx % 2 === 0 ? '#fff' : '#f8fafc'; }}
                >
                  <td style={{ borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e4ebf1', textAlign: 'center', width: 40 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(iv.id)}
                      style={{ accentColor: '#1f52cc', cursor: 'pointer' }}
                    />
                  </td>
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e4ebf1',
                        padding: '6px 8px', overflow: 'hidden', whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis', maxWidth: colWidths[col.key] || col.width,
                        color: '#334155',
                      }}
                    >
                      {col.render(iv, { onSelectCandidate, onOpenInternalReports: handleOpenInternalReports })}
                    </td>
                  ))}
                </tr>
              );
            })}
            {hasMore && (
              <tr className="border-none hover:bg-transparent">
                <td colSpan={visibleColumns.length + 1} className="p-0 border-none">
                  <InfiniteScrollSentinel
                    hasNextPage={hasMore}
                    isFetchingNextPage={loadingMore}
                    fetchNextPage={onLoadMore}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer: row count (updates live as filters change) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderTop: '1px solid #e4ebf1', background: '#f8fafc',
        flexShrink: 0, flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
          Showing{' '}
          <strong style={{ color: '#1f52cc' }}>{filteredRows.length}</strong>
          {' '}of{' '}
          {/* Use real DB totalCount when available; fall back to loaded interviews.length */}
          <strong>{(totalCount ?? interviews.length).toLocaleString()}</strong>{' '}
          interview{(totalCount ?? interviews.length) !== 1 ? 's' : ''}
          {viewDate && (
            <span style={{ marginLeft: 6, color: '#94a3b8' }}>
              for {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
          )}
        </span>
        {(Object.values(colFilters).some(Boolean) || globalSearch) && (
          <button
            onClick={() => { setColFilters({}); setGlobalSearch(''); }}
            style={{
              fontSize: 11, color: '#cf3a3a', background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
            Clear all filters
          </button>
        )}
      </div>
      {/* ── Candidate Internal Reports Modal ── */}
      {selectedCandidate && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(8px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
        }} onClick={() => setSelectedCandidate(null)}>
          <div className="os-card" style={{
            width: '550px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            overflow: 'hidden', background: '#fff', border: '1px solid #e2e8f0',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            borderRadius: '16px', padding: 0
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 24px', borderBottom: '1px solid #f1f5f9',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  Internal Reports
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Candidate: {selectedCandidate.fullName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#94a3b8', fontSize: '20px', padding: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', height: '24px', width: '24px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div style={{
              padding: '24px', overflowY: 'auto', flex: 1, display: 'flex',
              flexDirection: 'column', gap: '16px'
            }}>
              {/* Add Report Form */}
              <form onSubmit={handleSubmitReport} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  placeholder="Type your internal report or notes here..."
                  value={newReport}
                  onChange={(e) => setNewReport(e.target.value)}
                  style={{
                    width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px',
                    border: '1px solid #cbd5e1', outline: 'none', fontSize: '12px',
                    resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box'
                  }}
                  required
                />
                {reportError && (
                  <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: 500 }}>
                    {reportError}
                  </span>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={isSubmitting || !newReport.trim()}
                    className="os-btn-primary"
                    style={{
                      height: '32px', fontSize: '12px', padding: '0 16px',
                      display: 'flex', alignItems: 'center', gap: '4px',
                      background: isSubmitting || !newReport.trim() ? '#94a3b8' : '#1f52cc',
                      color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                    }}
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </form>

              <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: 0 }} />

              {/* Reports List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                  History ({reports.length})
                </h4>
                
                {reports.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: '24px', color: '#94a3b8',
                    fontSize: '12px', border: '1px dashed #e2e8f0', borderRadius: '8px'
                  }}>
                    No internal reports submitted yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                    {reports.map((r) => (
                      <div key={r.id} style={{
                        background: '#f8fafc', border: '1px solid #f1f5f9',
                        borderRadius: '10px', padding: '12px 16px', display: 'flex',
                        flexDirection: 'column', gap: '6px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#1e293b' }}>
                            {r.submittedBy}
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                            {new Date(r.submittedAt).toLocaleString()}
                          </span>
                        </div>
                        <p style={{
                          margin: 0, fontSize: '12px', color: '#334155',
                          whiteSpace: 'pre-wrap', lineHeight: 1.5, textAlign: 'left'
                        }}>
                          {r.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
