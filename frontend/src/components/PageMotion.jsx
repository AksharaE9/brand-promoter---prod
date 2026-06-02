import React from 'react';

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
export function Reveal({ children, className = '', delay = 0, style = {} }) {
  return (
    <div
      className={`reveal-fade ${className}`}
      style={{
        animationDelay: `${Math.min(delay, 0.3)}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default Reveal;
