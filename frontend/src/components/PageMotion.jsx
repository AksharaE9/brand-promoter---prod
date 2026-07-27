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
 * RouteTransition — wraps the router outlet and plays a clean fade-slide
 * animation every time the pathname changes.
 *
 * Rendered INSIDE <Routes> so it has access to useLocation().
 * The key={pathname} approach forces a fresh mount (and therefore a fresh
 * animation) on every navigation without any heavy animation library.
 */
export function RouteTransition({ children }) {
  const { pathname } = useLocation();
  const [displayKey, setDisplayKey] = useState(pathname);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;

    // Show the top progress bar immediately
    setShowBar(true);
    setIsTransitioning(true);

    const swapTimer = setTimeout(() => {
      setDisplayKey(pathname);
      setIsTransitioning(false);
    }, 80);

    const barTimer = setTimeout(() => setShowBar(false), 700);

    return () => {
      clearTimeout(swapTimer);
      clearTimeout(barTimer);
    };
  }, [pathname]);

  return (
    <>
      {/* Top progress bar — shows during navigation */}
      {showBar && <div className="route-loading-bar" key={pathname + '-bar'} />}

      <div
        key={displayKey}
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
