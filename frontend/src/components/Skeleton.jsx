import React from 'react';

const Skeleton = ({ className, width, height, circle }) => {
  const style = {
    width: width || '100%',
    height: height || '20px',
    borderRadius: circle ? '50%' : '12px',
  };

  return (
    <div 
      className={`bg-slate-200 animate-pulse ${className || ''}`} 
      style={style}
    />
  );
};

export const DashboardSkeleton = () => (
  <div className="space-y-6">
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} height="100px" />)}
    </div>
    <div className="grid lg:grid-cols-3 gap-4">
      <Skeleton className="lg:col-span-2" height="300px" />
      <Skeleton height="300px" />
    </div>
  </div>
);

export const CandidateCardSkeleton = () => (
  <div className="os-card p-5 space-y-4">
    <div className="flex items-center gap-4">
      <Skeleton width="56px" height="56px" />
      <div className="flex-1 space-y-2">
        <Skeleton width="60%" height="16px" />
        <Skeleton width="40%" height="12px" />
      </div>
    </div>
    <div className="pt-3 border-t border-slate-100 flex justify-between">
      <Skeleton width="30%" height="24px" />
      <Skeleton width="20%" height="24px" />
    </div>
  </div>
);

export const CardSkeleton = CandidateCardSkeleton;

export default Skeleton;
