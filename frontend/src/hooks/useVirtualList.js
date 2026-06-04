import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Custom virtualization hook wrapper for window virtualization.
 * Wraps @tanstack/react-virtual useVirtualizer.
 *
 * @param {Object} options
 * @param {number} options.count - Number of items to render
 * @param {React.RefObject} options.parentRef - Scroll container element reference
 * @param {number} [options.estimateSize] - Estimated height of each item (default: 50)
 * @param {number} [options.overscan] - Number of items to render off-screen (default: 5)
 * @returns {import('@tanstack/react-virtual').Virtualizer}
 */
export function useVirtualList({ count, parentRef, estimateSize = 50, overscan = 5 }) {
  return useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });
}

export default useVirtualList;
