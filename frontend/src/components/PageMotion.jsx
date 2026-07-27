import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * PageEnter — animates the whole page in on mount. Uses lightweight CSS animations.
 */
export function PageEnter({ children, className = '' }) {
  return (
    <div className={`page-enter ${className}`}>
      {children}
    </div>
  );
}

/**
 * Reveal — lightweight CSS-based fade-in for list cards.
 * Previously used framer-motion whileInView which caused IntersectionObserver
 * on hundreds of DOM nodes simultaneously, causing layout thrashing.
 * Now uses a simple CSS animation — zero JS overhead.
 */
export const Reveal = React.forwardRef(({ children, className = '', delay = 0, style = {} }, ref) => {
  return (
    <div
      ref={ref}
      className={`reveal-fade ${className}`}
      style={{
        animationDelay: `${Math.min(delay, 0.3)}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
});
Reveal.displayName = 'Reveal';

/**
 * RouteTransition — plays a clean fade-slide animation on pathname change.
 *
 * KEY DESIGN DECISION: We deliberately do NOT use key={pathname} (or any
 * key-based remounting) here. The previous implementation used key={displayKey}
 * which forced React to destroy and remount the entire page component subtree
 * 80ms after every navigation. This aborted in-flight API fetches, caused
 * TanStack Query to see the request as stale/failed, and produced the
 * "URL changes but content doesn't load" bug.
 *
 * Instead, we achieve the visual transition purely via CSS opacity + transform,
 * without ever unmounting the child. The page component remains alive and its
 * data fetches complete normally.
 */
export function RouteTransition({ children }) {
  const { pathname, search } = useLocation();
  const currentKey = pathname + search;
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const prevPath = useRef(currentKey);

  useEffect(() => {
    if (currentKey === prevPath.current) return;
    prevPath.current = currentKey;

    // Flash the top progress bar and briefly fade out, then fade back in.
    setShowBar(true);
    setIsTransitioning(true);

    // Fade back in after a short delay — no key change, no remount.
    const fadeInTimer = setTimeout(() => {
      setIsTransitioning(false);
    }, 80);

    const barTimer = setTimeout(() => setShowBar(false), 700);

    return () => {
      clearTimeout(fadeInTimer);
      clearTimeout(barTimer);
    };
  }, [currentKey]);

  return (
    <>
      {/* Top progress bar — shows during navigation */}
      {showBar && <div className="route-loading-bar" key={currentKey + '-bar'} />}

      <div
        style={{
          opacity: isTransitioning ? 0 : 1,
          transform: isTransitioning ? 'translateY(4px)' : 'translateY(0)',
          transition: isTransitioning
            ? 'opacity 0.08s ease, transform 0.08s ease'
            : 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.22,1,0.36,1)',
          willChange: 'opacity, transform',
          height: '100%',
          display: 'contents',
        }}
      >
        {children}
      </div>
    </>
  );
}

export default Reveal;
