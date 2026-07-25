import React, { useEffect, useRef } from 'react';

/**
 * InfiniteScrollSentinel — a reusable sentinel component that fires fetchNextPage when visible.
 * It automatically searches up the DOM tree to find the nearest scrollable ancestor container (overflowY = auto|scroll)
 * to use as the IntersectionObserver root, preventing bugs where clipping containers cause root: null to not fire.
 */
export function InfiniteScrollSentinel({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;

    // Dynamically search for the closest scrollable parent
    let scrollParent = ref.current.parentElement;
    while (scrollParent) {
      const overflowY = window.getComputedStyle(scrollParent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        break;
      }
      scrollParent = scrollParent.parentElement;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      {
        root: scrollParent || null,
        rootMargin: '200px',
      }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!hasNextPage) return null;

  return (
    <div ref={ref} className="h-12 flex items-center justify-center w-full text-xs text-slate-400 font-medium py-4">
      {isFetchingNextPage ? (
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span>Loading more…</span>
        </div>
      ) : null}
    </div>
  );
}

export default InfiniteScrollSentinel;
