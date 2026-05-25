import React from 'react';
import { motion } from 'framer-motion';

/**
 * PageEnter — animates the whole page in on mount. Uses framer-motion.
 */
export function PageEnter({ children, className = '' }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
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
