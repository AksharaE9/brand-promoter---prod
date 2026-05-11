import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPatch, getStoredUser, API_BASE_URL } from '../lib/api';


function ageLabel(iso) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'recently';
  const minutes = Math.max(1, Math.floor((Date.now() - ts) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const NotificationBell = () => {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const user = getStoredUser();

  const fetchNotifications = async () => {
    try {
      const res = await apiGet('/notifications');
      if (res.success) {
        setItems(res.data);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!user?.id) return;

    fetchNotifications();

    const token = localStorage.getItem('ats_token');

    const streamUrl = `${API_BASE_URL}/notifications/stream${token ? `?token=${token}` : ''}`;
    const eventSource = new EventSource(streamUrl, {
      withCredentials: true
    });
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;
        setItems(prev => [data, ...prev].slice(0, 20));
      } catch (err) {
        console.error('SSE Error processing message', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [user?.id]);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
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
      <button className="os-icon-btn" type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
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
                  onClick={() => {
                    markRead(item.id);
                    setOpen(false);
                  }}
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
};

export default NotificationBell;
