import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPatch, getStoredUser } from '../lib/api';
import { subscribeSSE } from '../lib/sse';

function ageLabel(iso) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'recently';
  const minutes = Math.max(1, Math.floor((Date.now() - ts) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const NotificationBell = React.memo(() => {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  // Memoize user so it doesn't create a new object on every render
  const user = useMemo(() => getStoredUser(), []);

  // Initial fetch
  useEffect(() => {
    if (!user?.id) return;
    apiGet('/notifications')
      .then(res => { if (res.success) setItems(res.data || []); })
      .catch(err => setError(err.message));
  }, [user?.id]);

  // Subscribe to singleton SSE instead of opening own EventSource
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeSSE((data) => {
      if (data.type === 'ping') return;
      setItems(prev => [data, ...prev].slice(0, 20));
    });
    return unsub;
  }, [user?.id]);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const unreadCount = useMemo(
    () => items.filter(item => !item.isRead).length,
    [items],
  );

  const markRead = async (id) => {
    try {
      await apiPatch(`/notifications/${id}/read`);
      setItems(prev => prev.map(item => item.id === id ? { ...item, isRead: true } : item));
    } catch (err) {
      console.error(err);
    }
  };

  const markAllRead = async () => {
    try {
      await apiPatch('/notifications/read-all');
      setItems(prev => prev.map(item => ({ ...item, isRead: true })));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="os-notify-root" ref={rootRef}>
      <button className="os-icon-btn" type="button" onClick={() => setOpen(v => !v)} aria-label="Notifications">
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 ? <span className="os-notify-badge">{Math.min(9, unreadCount)}</span> : null}
      </button>

      {open ? (
        <div className="os-notify-menu">
          <div className="os-notify-head">
            <div>
              <div className="os-notify-title">Notifications</div>
              <div className="os-notify-sub">{unreadCount} unread</div>
            </div>
            <button className="os-btn-outline !h-8 !px-3" type="button" onClick={markAllRead}>
              Mark all read
            </button>
          </div>

          {error ? <div className="os-notify-empty">{error}</div> : null}
          {!error && items.length === 0 ? <div className="os-notify-empty">No notifications yet.</div> : null}

          {!error ? (
            <div className="os-notify-list">
              {items.map((item) => (
                <Link
                  key={item.id}
                  to={item.link || '#'}
                  className={`os-notify-item ${item.isRead ? 'seen' : ''}`}
                  onClick={() => { markRead(item.id); setOpen(false); }}
                >
                  <div className="os-notify-item-head">
                    <span className="font-bold">{item.title}</span>
                    <span className="text-[10px] text-slate-400">{ageLabel(item.createdAt)}</span>
                  </div>
                  <div className="os-notify-item-body">{item.message}</div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

NotificationBell.displayName = 'NotificationBell';
export default NotificationBell;
