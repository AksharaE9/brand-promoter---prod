import React, { useRef, useState, useEffect } from 'react';
import { SkeletonBox } from './Skeleton';

export default function LazySection({
  children,
  loader,
  fallback,
  height = '150px'
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && active) {
          setVisible(true);
          if (typeof loader === 'function') {
            loader();
          }
          observer.disconnect();
        }
      },
      {
        rootMargin: '200px', // start loading 200px before coming into viewport
        threshold: 0.01
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [loader]);

  if (visible) {
    return children;
  }

  return (
    <div ref={ref} style={{ minHeight: height, width: '100%' }}>
      {fallback || (
        <div className="os-card p-6 space-y-4">
          <SkeletonBox width="30%" height={16} borderRadius={6} />
          <SkeletonBox width="100%" height={80} borderRadius={12} />
        </div>
      )}
    </div>
  );
}
