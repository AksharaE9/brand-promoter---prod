import React from 'react';

export default function SyncIndicator({ isPending }) {
  if (!isPending) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/60 shadow-sm animate-pulse"
      title="Saving to database..."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '11px',
        color: '#d97706',
        fontWeight: 600,
        backgroundColor: '#fffbeb',
        border: '1px solid #fef3c7',
        borderRadius: '9999px',
        padding: '2px 8px',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#d97706',
          boxShadow: '0 0 8px #d97706',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      Saving...
    </span>
  );
}
