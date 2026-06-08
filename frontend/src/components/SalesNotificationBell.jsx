import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';

const SEEN_KEY = 'sales_notifications_seen_v1';

function loadSeenMap() {
    try {
        return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    } catch (_) {
        return {};
    }
}

function saveSeenMap(map) {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
}

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

const SalesNotificationBell = () => {
    const rootRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [seenMap, setSeenMap] = useState(loadSeenMap);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const productsRes = await apiGet('/sales/products');
                if (!active) return;

                const followUpItems = (productsRes.data || [])
                    .filter(p => p.tracking?.followUpDate && p.tracking?.status !== 'CONVERTED' && p.tracking?.status !== 'REJECTED')
                    .map((p) => {
                        const followUpDate = new Date(p.tracking.followUpDate);
                        const isOverdue = followUpDate < new Date();
                        return {
                            id: `sales-followup-${p.id}`,
                            title: isOverdue ? 'Overdue Follow-up' : 'Upcoming Follow-up',
                            body: `${p.name} - ${p.tracking.status} (Due: ${followUpDate.toLocaleDateString()})`,
                            at: p.tracking.updatedAt || new Date().toISOString(),
                            href: '/sales/tracker',
                            kind: isOverdue ? 'alert' : 'info',
                        };
                    });

                const merged = [...followUpItems]
                    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                    .slice(0, 10);

                setItems(merged);
                setError('');
            } catch (err) {
                if (!active) return;
                setError(err.message || 'Unable to load notifications');
            }
        };

        load();
        const timer = setInterval(load, 60000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const onDocClick = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const unreadCount = useMemo(
        () => items.reduce((acc, item) => acc + (seenMap[item.id] ? 0 : 1), 0),
        [items, seenMap],
    );

    const markRead = (id) => {
        setSeenMap((prev) => {
            const next = { ...prev, [id]: true };
            saveSeenMap(next);
            return next;
        });
    };

    const markAllRead = () => {
        const next = { ...seenMap };
        items.forEach((item) => {
            next[item.id] = true;
        });
        setSeenMap(next);
        saveSeenMap(next);
    };

    return (
        <div className="os-notify-root" ref={rootRef}>
            <button className="os-icon-btn" type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
                <span className="material-symbols-outlined">notifications</span>
                {unreadCount > 0 ? <span className="os-notify-badge !bg-orange-500">{Math.min(9, unreadCount)}</span> : null}
            </button>

            {open ? (
                <div className="os-notify-menu !w-80">
                    <div className="os-notify-head">
                        <div>
                            <div className="os-notify-title">Sales Alerts</div>
                            <div className="os-notify-sub">{unreadCount} active follow-ups</div>
                        </div>
                        <button className="os-btn-outline !h-8 !px-3" type="button" onClick={markAllRead}>
                            Mark all read
                        </button>
                    </div>

                    {error ? <div className="os-notify-empty">{error}</div> : null}

                    {!error && items.length === 0 ? <div className="os-notify-empty text-xs">No follow-ups tracked yet.</div> : null}

                    {!error ? (
                        <div className="os-notify-list">
                            {items.map((item) => (
                                <Link
                                    key={item.id}
                                    to={item.href}
                                    className={`os-notify-item ${seenMap[item.id] ? 'seen' : ''}`}
                                    onClick={() => {
                                        markRead(item.id);
                                        setOpen(false);
                                    }}
                                >
                                    <div className="os-notify-item-head">
                                        <span className={item.kind === 'alert' ? 'text-red-500 font-bold' : 'text-[#1f52cc] font-bold'}>{item.title}</span>
                                        <span className="text-[10px] text-[#8b95ad]">{ageLabel(item.at)}</span>
                                    </div>
                                    <div className="os-notify-item-body">{item.body}</div>
                                </Link>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};

export default SalesNotificationBell;
