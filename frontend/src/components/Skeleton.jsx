import React from 'react';

// ── Base Skeleton ───────────────────────────────────────────
const Skeleton = ({ className, width, height, circle, style: extraStyle }) => {
  const style = {
    width: width || '100%',
    height: height || '20px',
    borderRadius: circle ? '50%' : '12px',
    ...extraStyle,
  };

  return (
    <div
      className={`skeleton-shimmer ${className || ''}`}
      style={style}
    />
  );
};

// ── Skeleton Box (explicit API) ─────────────────────────────
export function SkeletonBox({ width = '100%', height = 16, borderRadius = 4, className = '' }) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

// ── Dashboard Skeleton ──────────────────────────────────────
export const DashboardSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '24px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="os-card" style={{ padding: '20px' }}>
          <SkeletonBox width="40%" height={14} borderRadius={6} />
          <div style={{ height: 8 }} />
          <SkeletonBox width="60%" height={28} borderRadius={8} />
          <div style={{ height: 8 }} />
          <SkeletonBox width="30%" height={12} borderRadius={4} />
        </div>
      ))}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
      <Skeleton height="300px" />
      <Skeleton height="300px" />
    </div>
  </div>
);

// ── Candidate Card Skeleton ─────────────────────────────────
export const CandidateCardSkeleton = () => (
  <div className="os-card" style={{ padding: '20px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <Skeleton width="56px" height="56px" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Skeleton width="60%" height="16px" />
        <Skeleton width="40%" height="12px" />
      </div>
    </div>
    <div style={{ paddingTop: '12px', borderTop: '1px solid #f1f5f9', marginTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
      <Skeleton width="30%" height="24px" />
      <Skeleton width="20%" height="24px" />
    </div>
  </div>
);

// ── Table Skeleton ──────────────────────────────────────────
export const SkeletonTable = ({ rows = 8, columns = 5 }) => (
  <div className="os-card" style={{ overflow: 'hidden' }}>
    {/* Header row */}
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '12px', padding: '14px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonBox key={i} width={`${60 + Math.random() * 30}%`} height={14} borderRadius={6} />
      ))}
    </div>
    {/* Data rows */}
    {Array.from({ length: rows }).map((_, rowIdx) => (
      <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '12px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
        {Array.from({ length: columns }).map((_, colIdx) => (
          <SkeletonBox key={colIdx} width={`${50 + Math.random() * 40}%`} height={14} borderRadius={6} />
        ))}
      </div>
    ))}
  </div>
);

// ── Kanban Board Skeleton ───────────────────────────────────
export const SkeletonKanbanBoard = () => (
  <div style={{ display: 'flex', gap: '16px', overflow: 'hidden', height: '100%' }}>
    {[1, 2, 3, 4, 5].map(col => (
      <div key={col} style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <SkeletonBox width="60%" height={20} borderRadius={8} />
        {[1, 2, 3].map(card => (
          <div key={card} className="os-card" style={{ padding: '16px' }}>
            <SkeletonBox width="80%" height={16} borderRadius={6} />
            <div style={{ height: 8 }} />
            <SkeletonBox width="50%" height={12} borderRadius={4} />
            <div style={{ height: 8 }} />
            <SkeletonBox width="35%" height={24} borderRadius={6} />
          </div>
        ))}
      </div>
    ))}
  </div>
);

// ── Profile Modal Skeleton ──────────────────────────────────
export const SkeletonProfileModal = () => (
  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <Skeleton width="72px" height="72px" circle />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <SkeletonBox width="40%" height={20} borderRadius={8} />
        <SkeletonBox width="60%" height={14} borderRadius={6} />
      </div>
    </div>
    {[1, 2, 3, 4].map(i => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <SkeletonBox width="20%" height={12} borderRadius={4} />
        <SkeletonBox width="100%" height={40} borderRadius={8} />
      </div>
    ))}
  </div>
);

export const CardSkeleton = CandidateCardSkeleton;

export default Skeleton;
