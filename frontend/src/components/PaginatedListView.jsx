import React, { useRef, useEffect } from 'react';
import { CardSkeleton } from './Skeleton';
import CardErrorBoundary from './CardErrorBoundary';

/**
 * PaginatedListView — The definitive shared presentation component for all list views.
 *
 * Enforces:
 * 1. Honest Skeletons: renders skeletons matching the expected initial page size (e.g. 50).
 * 2. Honest Progress: displays "Showing X of Y" only when count is known.
 * 3. Smooth Sentinel Prefetch: triggers fetchNextPage() when user scrolls within 400px of bottom.
 * 4. Inline Loading More indicator at the list foot that doesn't unmount or freeze existing cards.
 * 5. Clean Empty State with "Clear Filters" button when active.
 * 6. Scoped Card Error Boundaries to limit blast radius of corrupted records.
 */
export default function PaginatedListView({
  items = [],
  renderItem,
  keyExtractor = (item, index) => item.id || index,
  isLoading = false,
  isFetchingNextPage = false,
  hasNextPage = false,
  fetchNextPage,
  totalCount = null,
  resourceName = 'candidates',
  emptyMessage = 'No items found matching your criteria.',
  emptySub = null,
  hasActiveFilters = false,
  onClearFilters = null,
  initialSkeletonCount = 12,
  gridClassName = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500',
  customEmpty = null,
}) {
  const sentinelRef = useRef(null);

  // Sentinel Intersection Observer with 800px rootMargin and actual scroll container
  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage || isFetchingNextPage || !fetchNextPage) {
      return;
    }

    const scrollContainer = document.querySelector('.os-content') || null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      {
        root: scrollContainer,
        rootMargin: '800px', // Prefetch when within 800px of bottom
        threshold: 0.01,
      }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Immediate fill check: if sentinel is already in view on mount or chunk load, fetch next chunk
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && sentinelRef.current && typeof fetchNextPage === 'function') {
      const scrollContainer = document.querySelector('.os-content');
      let isVisible = false;
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const sentinelRect = sentinelRef.current.getBoundingClientRect();
        isVisible = sentinelRect.top <= containerRect.bottom + 800;
      } else {
        const sentinelRect = sentinelRef.current.getBoundingClientRect();
        isVisible = sentinelRect.top <= (window.innerHeight || document.documentElement.clientHeight) + 800;
      }
      if (isVisible) {
        fetchNextPage();
      }
    }
  }, [items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Initial Loading state
  if (isLoading && items.length === 0) {
    return (
      <div className={gridClassName} aria-busy="true" aria-label={`Loading ${resourceName}`}>
        {Array.from({ length: initialSkeletonCount }).map((_, idx) => (
          <CardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  // Genuinely Empty state
  if (!isLoading && items.length === 0) {
    if (customEmpty) return customEmpty;

    return (
      <div className="py-20 text-center os-card bg-white border border-[#e9eef4] rounded-2xl shadow-sm">
        <div className="text-slate-500 mb-2 font-semibold text-base">{emptyMessage}</div>
        {emptySub && (
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-5 leading-relaxed">
            {emptySub}
          </p>
        )}
        {hasActiveFilters && onClearFilters && (
          <button
            type="button"
            className="os-btn-outline inline-flex items-center gap-1.5 px-4 py-2 mt-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all cursor-pointer"
            onClick={onClearFilters}
          >
            <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
            Clear Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Item Grid */}
      <div className={gridClassName}>
        {items.map((item, index) => (
          <CardErrorBoundary key={keyExtractor(item, index)} resourceName={resourceName}>
            {renderItem(item, index)}
          </CardErrorBoundary>
        ))}
      </div>

      {/* Infinite Scroll Sentinel / Loading More */}
      {hasNextPage && (
        <div
          ref={sentinelRef}
          className="h-14 w-full flex items-center justify-center my-6"
          aria-hidden="true"
        >
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1f52cc] animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1f52cc] animate-ping" />
              Loading more {resourceName}...
            </div>
          ) : (
            <div className="h-1 w-full" />
          )}
        </div>
      )}

      {/* End of List indicator */}
      {!hasNextPage && items.length > 0 && (
        <p className="text-xs text-slate-400 font-medium text-center mt-8 mb-4 w-full">
          You've reached the end — {totalCount !== null && totalCount > 0 ? totalCount.toLocaleString() : items.length} {resourceName} loaded
        </p>
      )}
    </div>
  );
}
