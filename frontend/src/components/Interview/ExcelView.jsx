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
import { parseNotesSafely, getFirstFeedback } from '../../lib/interviewUtils';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const h = d.getHours(), m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mStr = m > 0 ? `:${String(m).padStart(2, '0')}` : '';
  return `${h12}${mStr} ${suffix}`;
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
      <button
        type="button"
        onClick={() => onSelectCandidate(
          iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId,
          iv.id
        )}
        style={{ color: '#1f52cc', fontWeight: 600, fontSize: 12, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        title="Open interview detail"
      >
        {iv.application?.candidate?.fullName || iv.candidateName || '-'}
      </button>
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
    key: 'techScore',
    label: 'Tech Score',
    width: 90,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.technical;
      return score != null ? String(score) : '';
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.technical;
      return <span>{score != null ? `${score}/5` : '-'}</span>;
    },
  },
  {
    key: 'commScore',
    label: 'Comm Score',
    width: 100,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.communication;
      return score != null ? String(score) : '';
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.communication;
      return <span>{score != null ? `${score}/5` : '-'}</span>;
    },
  },
  {
    key: 'cultureScore',
    label: 'Culture Score',
    width: 105,
    filterType: 'text',
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.culture;
      return score != null ? String(score) : '';
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      const score = fb?.ratings?.culture;
      return <span>{score != null ? `${score}/5` : '-'}</span>;
    },
  },
  {
    key: 'phoneFollowUp',
    label: 'Phone Follow-up',
    width: 135,
    filterType: 'set',
    // notes column is JSON-encoded {phoneFollowUp: {name, data}, emailFollowUp: {name, data}}
    getValue: (iv) => {
      const { phoneFollowUp } = parseNotesSafely(iv?.notes);
      return phoneFollowUp ? 'Uploaded' : "Didn't upload";
    },
    render: (iv) => {
      const { phoneFollowUp } = parseNotesSafely(iv?.notes);
      return phoneFollowUp
        ? <span style={{ color: '#2ca764', fontWeight: 600, fontSize: 11 }}>✓ Uploaded</span>
        : <span style={{ color: '#cf3a3a', fontWeight: 600, fontSize: 11 }}>✗ Didn't upload</span>;
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
    // feedback[].notes = overall comments (backend stores overallComments as "notes" in feedback entry)
    getValue: (iv) => {
      const fb = getFirstFeedback(iv);
      return fb?.notes || '';
    },
    render: (iv) => {
      const fb = getFirstFeedback(iv);
      const text = fb?.notes || '';
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

export default function ExcelView({ interviews = [], viewDate, onSelectCandidate }) {
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
      try { localStorage.setItem('interview_excel_hidden_cols', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => !hiddenCols.includes(c.key)),
    [hiddenCols]
  );

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
              {ALL_COLUMNS.map((col) => (
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

        {/* Bulk selection indicator (TODO: wire bulk actions when bulk API exists) */}
        {selectedRows.size > 0 && (
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
            background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
            padding: '4px 12px', fontSize: 12, color: '#1f52cc', fontWeight: 600,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_box</span>
            {selectedRows.size} selected
            {/* TODO: Bulk Reject, Export Selected — add when bulk-action API is available */}
            <button
              onClick={() => setSelectedRows(new Set())}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1f52cc', marginLeft: 4 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
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
                    background: isSelected ? '#eff6ff' : rowIdx % 2 === 0 ? '#fff' : '#f8fafc',
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
                      {col.render(iv, { onSelectCandidate })}
                    </td>
                  ))}
                </tr>
              );
            })}
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
          <strong>{interviews.length}</strong>{' '}
          interview{interviews.length !== 1 ? 's' : ''}
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
    </div>
  );
}
