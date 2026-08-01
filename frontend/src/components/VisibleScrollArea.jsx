import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scroll container with a permanent, always-visible custom scrollbar.
 * Native OS overlay scrollbars are hidden so the rail never disappears.
 */
export default function VisibleScrollArea({
  children,
  className = '',
  scrollClassName = '',
  railTone = 'light', // 'light' | 'dark'
  as: Tag = 'div',
}) {
  const scrollRef = useRef(null);
  const railRef = useRef(null);
  const dragRef = useRef(null);
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false });

  const syncThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const visible = scrollHeight > clientHeight + 1;
    if (!visible) {
      setThumb((prev) => (prev.visible ? { top: 0, height: 0, visible: false } : prev));
      return;
    }

    const railHeight = railRef.current?.clientHeight || clientHeight;
    const height = Math.max(40, (clientHeight / scrollHeight) * railHeight);
    const maxTop = Math.max(0, railHeight - height);
    const top = maxTop === 0 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setThumb({ top, height, visible: true });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    syncThumb();
    el.addEventListener('scroll', syncThumb, { passive: true });

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncThumb) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);

    window.addEventListener('resize', syncThumb);
    return () => {
      el.removeEventListener('scroll', syncThumb);
      ro?.disconnect();
      window.removeEventListener('resize', syncThumb);
    };
  }, [syncThumb, children]);

  const onRailPointerDown = (event) => {
    if (!thumb.visible || event.target.closest('.os-scroll-thumb')) return;
    const el = scrollRef.current;
    const rail = railRef.current;
    if (!el || !rail) return;

    const rect = rail.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = Math.min(1, Math.max(0, (y - thumb.height / 2) / (rect.height - thumb.height)));
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  };

  const onThumbPointerDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;

    dragRef.current = {
      startY: event.clientY,
      startScrollTop: el.scrollTop,
    };

    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      const node = scrollRef.current;
      const rail = railRef.current;
      if (!drag || !node || !rail) return;

      const railHeight = rail.clientHeight;
      const thumbHeight = Math.max(32, (node.clientHeight / node.scrollHeight) * railHeight);
      const maxScroll = node.scrollHeight - node.clientHeight;
      const maxTop = Math.max(1, railHeight - thumbHeight);
      const delta = ((moveEvent.clientY - drag.startY) / maxTop) * maxScroll;
      node.scrollTop = drag.startScrollTop + delta;
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <Tag className={`os-scroll-frame os-scroll-frame--${railTone} ${className}`.trim()}>
      <div ref={scrollRef} className={`os-scroll-viewport ${scrollClassName}`.trim()}>
        {children}
      </div>
      <div
        ref={railRef}
        className={`os-scroll-rail ${thumb.visible ? 'is-active' : 'is-idle'}`}
        onPointerDown={onRailPointerDown}
        aria-hidden="true"
      >
        {thumb.visible && (
          <div
            className="os-scroll-thumb"
            style={{ transform: `translateY(${thumb.top}px)`, height: `${thumb.height}px` }}
            onPointerDown={onThumbPointerDown}
          />
        )}
      </div>
    </Tag>
  );
}
