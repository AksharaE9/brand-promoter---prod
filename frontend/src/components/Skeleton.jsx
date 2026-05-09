import React from 'react';

const Skeleton = ({ className }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`}></div>
);

export const CandidateCardSkeleton = () => (
  <div className="os-card p-5 border border-slate-100 shadow-sm h-[200px]">
    <div className="flex items-start justify-between mb-4">
      <Skeleton className="w-14 h-14 rounded-xl" />
      <Skeleton className="w-16 h-6 rounded-full" />
    </div>
    <Skeleton className="h-7 w-3/4 mb-2" />
    <Skeleton className="h-4 w-1/2 mb-4" />
    <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="flex flex-col items-end gap-1">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  </div>
);

export default Skeleton;
