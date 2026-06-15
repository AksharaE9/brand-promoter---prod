import React from 'react';

export function InterviewMemberSkeleton({ count = 3 }) {
  return (
    <>
      <style>{`
        @keyframes skeleton-shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
        .skeleton-shimmer-bg {
          background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%;
          animation: skeleton-shimmer 1.4s ease infinite;
        }
        .skeleton-chip-shimmer-bg {
          background: linear-gradient(90deg, #e8f0fe 25%, #d8e8fd 50%, #e8f0fe 75%);
          background-size: 200% 100%;
          animation: skeleton-shimmer 1.4s ease infinite;
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="w-full flex gap-3 p-3 rounded-xl mb-1 border border-slate-100 bg-white items-center"
        >
          {/* Avatar skeleton */}
          <div className="w-10 h-10 rounded-full skeleton-shimmer-bg shrink-0" />
          {/* Text skeleton */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3.5 w-[55%] rounded skeleton-shimmer-bg" />
            <div className="h-3 w-[35%] rounded skeleton-shimmer-bg" />
            <div className="h-5 w-16 rounded skeleton-chip-shimmer-bg mt-1" />
          </div>
        </div>
      ))}
    </>
  );
}

export default InterviewMemberSkeleton;
