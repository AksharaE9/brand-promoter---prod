import React, { useRef, useEffect, useCallback } from 'react';
import { CardSkeleton } from './Skeleton';
import CardErrorBoundary from './CardErrorBoundary';

/**
 * PaginatedListView — The definitive shared presentation component for all list views.
 *
 * Implements deterministic chunk-loading:
 * 1. Callback ref for sentinel (disconnects on unmount, attaches on node mount).
 * 2. Latest-value refs for observer callback to eliminate stale closure bugs.
 * 3. Dynamic root detection (.os-content container with null/window fallback).
 * 4. Fill-viewport check after layout settles, on fetch resolution, on resize.
 * 5. Accessible fallback "Load more" button when hasNextPage is true.
 * 6. Scoped CardErrorBoundary per card.
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
  const observerRef = useRef(null);
  const sentinelNodeRef = useRef(null);

  // Latest props ref to guarantee intersection callback always sees latest state
  const latestPropsRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  useEffect(() => {
    latestPropsRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };
  });

  // Re-check whether sentinel is visible in the viewport / scroll container
  const checkSentinelVisibilityAndFetch = useCallback(() => {
    const { hasNextPage: hasNext, isFetchingNextPage: isFetching, fetchNextPage: fetchNext } = latestPropsRef.current;
    if (!hasNext || isFetching || typeof fetchNext !== 'function') return;

    const sentinel = sentinelNodeRef.current;
    if (!sentinel) return;

    const scrollContainer = document.querySelector('.os-content');
    let isVisible = false;

    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const sentinelRect = sentinel.getBoundingClientRect();
      isVisible = sentinelRect.top <= containerRect.bottom + 800 && sentinelRect.bottom >= containerRect.top - 200;
    } else {
      const sentinelRect = sentinel.getBoundingClientRect();
      const windowHeight = window.innerHeight || document.documentElement.clientHeight || 800;
      isVisible = sentinelRect.top <= windowHeight + 800 && sentinelRect.bottom >= -200;
    }

    if (isVisible) {
      fetchNext();
    }
  }, []);

  // Callback ref for the sentinel DOM node: guarantees observer is bound whenever node enters DOM
  const sentinelCallbackRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    sentinelNodeRef.current = node;

    if (!node) return;

    const scrollContainer = document.querySelector('.os-content') || null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          const { hasNextPage: hasNext, isFetchingNextPage: isFetching, fetchNextPage: fetchNext } = latestPropsRef.current;
          if (hasNext && !isFetching && typeof fetchNext === 'function') {
            fetchNext();
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '800px', // Pre-fetch buffer
        threshold: 0.01,
      }
    );

    observer.observe(node);
    observerRef.current = observer;

    // Immediate check right after observer attaches
    requestAnimationFrame(() => {
      checkSentinelVisibilityAndFetch();
    });
  }, [checkSentinelVisibilityAndFetch]);

  // Clean up observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  // Re-check visibility after items update, layout settles, or window resizes
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      checkSentinelVisibilityAndFetch();
    });

    const handleResize = () => {
      checkSentinelVisibilityAndFetch();
    };

    window.addEventListener('resize', handleResize, { passive: true });

    // Also observe the scroll container's size if ResizeObserver is available
    let resizeObserver = null;
    const scrollContainer = document.querySelector('.os-content');
    if (scrollContainer && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkSentinelVisibilityAndFetch();
      });
      resizeObserver.observe(scrollContainer);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [items.length, hasNextPage, isFetchingNextPage, checkSentinelVisibilityAndFetch]);

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
          ref={sentinelCallbackRef}
          className="h-20 w-full flex flex-col items-center justify-center my-6"
          aria-hidden="false"
        >
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1f52cc] animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1f52cc] animate-ping" />
              Loading more {resourceName}...
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!isFetchingNextPage && typeof fetchNextPage === 'function') {
                  fetchNextPage();
                }
              }}
              className="os-btn-outline !h-8 !px-4 text-xs font-bold !border-slate-200 hover:!border-[#1f52cc] hover:!text-[#1f52cc] text-slate-500 rounded-xl"
              aria-label={`Load more ${resourceName}`}
            >
              Load more {resourceName}
            </button>
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
