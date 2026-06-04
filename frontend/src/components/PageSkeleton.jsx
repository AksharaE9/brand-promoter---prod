import React from 'react';
import Skeleton, {
  SkeletonTable,
  DashboardSkeleton,
  SkeletonKanbanBoard,
  SkeletonProfileModal
} from './Skeleton';

/**
 * PageSkeleton component used as fallback for React Suspense lazy routes.
 */
export const PageSkeleton = ({ type = 'table' }) => {
  switch (type) {
    case 'dashboard':
      return <DashboardSkeleton />;
    case 'kanban':
      return <SkeletonKanbanBoard />;
    case 'profile':
      return <SkeletonProfileModal />;
    case 'table':
    default:
      return (
        <div className="p-6 bg-slate-50 min-h-screen">
          <div className="mb-6 flex justify-between items-center">
            <div className="w-48 h-8 bg-slate-200 rounded animate-pulse" />
            <div className="w-32 h-10 bg-blue-200 rounded animate-pulse" />
          </div>
          <SkeletonTable rows={8} columns={5} />
        </div>
      );
  }
};

export default PageSkeleton;
