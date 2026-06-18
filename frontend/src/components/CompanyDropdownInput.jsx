/**
 * CompanyDropdownInput.jsx
 * ──────────────────────────────────────────────────────────────────────────
 * Combobox that:
 *  • Fetches company list from /api/companies once (cached 5 min)
 *  • Filters as the user types (client-side, instant)
 *  • Shows "+ Add as new company" for novel entries
 *  • On "Add" click: POSTs to /api/companies and updates the dropdown
 *    in real-time (no page reload, no manual refresh needed)
 *  • Exposes `onChange(name)` — always fires with the raw text so the
 *    parent form gets every keystroke; the parent decides when to persist.
 *
 * Props:
 *   value       {string}    Controlled value (the company name string)
 *   onChange    {function}  Called with (name: string) on every change
 *   placeholder {string}    Input placeholder (default "e.g. Akshara Enterprises")
 *   inputClass  {string}    Extra CSS classes for the input element
 *   disabled    {boolean}   Disable the field
 * ──────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { companyApi } from '../services/companyApi';

export default function CompanyDropdownInput({
  value = '',
  onChange,
  placeholder = 'e.g. Akshara Enterprises',
  inputClass = '',
  disabled = false,
}) {
  const [inputValue, setInputValue]   = useState(value || '');
  const [companies, setCompanies]     = useState([]);
  const [isOpen, setIsOpen]           = useState(false);
  const [isAdding, setIsAdding]       = useState(false);
  const [error, setError]             = useState('');
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  // Sync external value changes (e.g. form reset)
  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  // Fetch companies once on mount
  useEffect(() => {
    let cancelled = false;
    companyApi.list()
      .then(res => { if (!cancelled) setCompanies(res.data || []); })
      .catch(() => { /* silent — dropdown degrades to free-text */ });
    return () => { cancelled = true; };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Filtered list — case-insensitive partial match
  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(c => c.name.toLowerCase().includes(q));
  }, [companies, inputValue]);

  // Whether the typed text is already in the list (exact match, case-insensitive)
  const exactMatch = useMemo(() =>
    companies.some(c => c.name.toLowerCase() === inputValue.trim().toLowerCase()),
    [companies, inputValue]
  );

  const handleSelect = useCallback((name) => {
    setInputValue(name);
    onChange?.(name);
    setIsOpen(false);
    setError('');
  }, [onChange]);

  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange?.(val); // propagate raw text immediately
    setIsOpen(true);
    setError('');
  }, [onChange]);

  const handleAddNew = useCallback(async () => {
    const name = inputValue.trim();
    if (!name || isAdding) return;
    setIsAdding(true);
    setError('');
    try {
      const res = await companyApi.create(name);
      // Server returns full updated list — refresh dropdown immediately
      if (res.data) setCompanies(res.data);
      // Select the newly-added name
      handleSelect(name);
    } catch (err) {
      setError(err.message || 'Failed to add company');
    } finally {
      setIsAdding(false);
    }
  }, [inputValue, isAdding, handleSelect]);

  const showDropdown = isOpen && (filtered.length > 0 || (inputValue.trim() && !exactMatch));

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* ── Input ─────────────────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <span
          className="material-symbols-outlined"
          style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, color: '#1f52cc', pointerEvents: 'none',
          }}
        >
          domain
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          className={`h-12 w-full rounded-2xl border border-slate-200 pl-10 pr-4 text-sm focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100 outline-none transition-all ${inputClass}`}
          aria-haspopup="listbox"
          aria-expanded={showDropdown}
          aria-label="Company"
        />
      </div>

      {/* ── Error hint ────────────────────────────────────────────── */}
      {error && (
        <p style={{ fontSize: 11, color: '#ef4444', marginTop: 3, paddingLeft: 4 }}>{error}</p>
      )}

      {/* ── Dropdown ──────────────────────────────────────────────── */}
      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            maxHeight: 224,
            overflowY: 'auto',
            zIndex: 9999,
          }}
        >
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={inputValue === c.name}
              onClick={() => handleSelect(c.name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 14px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #f1f5f9',
                fontSize: 13,
                color: '#1e293b',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#94a3b8' }}>business</span>
              {c.name}
            </button>
          ))}

          {/* ── "Add new" row ───────────────────────────────────── */}
          {inputValue.trim() && !exactMatch && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={isAdding}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '11px 14px',
                textAlign: 'left',
                background: '#eff6ff',
                border: 'none',
                fontSize: 13,
                color: '#2563eb',
                fontWeight: 600,
                cursor: isAdding ? 'default' : 'pointer',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                {isAdding ? 'hourglass_top' : 'add_circle'}
              </span>
              {isAdding ? 'Adding...' : `Add "${inputValue.trim()}" as a new company`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
