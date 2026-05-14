import React, { useEffect, useState, useRef, useCallback } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import { apiGet } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState({ entityType: '', action: '' });
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = useRef(null);

  const fetchLogs = async (targetOffset = 0, append = false) => {
    try {
      if (!append) setLoading(true);
      let url = `/audit-logs?limit=50&offset=${targetOffset}`;
      if (filter.entityType) url += `&entityType=${filter.entityType}`;
      if (filter.action) url += `&action=${filter.action}`;
      
      const res = await apiGet(url);
      if (res.success) {
        if (append) {
          setLogs(prev => [...prev, ...res.data]);
        } else {
          setLogs(res.data);
        }
        setHasMore(res.data.length === 50);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    fetchLogs(0, false);
  }, [filter]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextOffset = (page + 1) * 50;
      setPage(prev => prev + 1);
      fetchLogs(nextOffset, true);
    }
  }, [loading, hasMore, page]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [loadMore]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="audit" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search audit events..."
          right={
            <>
              <NotificationBell />
              <UserChip />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="os-eyebrow">Security & Compliance</div>
            <h1 className="os-h1">Enterprise Audit Logs</h1>
          </div>
          <button className="os-btn-outline" onClick={fetchLogs}>Refresh</button>
        </div>

        <div className="os-card mt-6 p-4 flex flex-wrap gap-4 items-center bg-[#f8fbff]">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-500">Entity Type</label>
            <select 
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white min-w-[150px]"
              value={filter.entityType}
              onChange={(e) => setFilter(prev => ({ ...prev, entityType: e.target.value }))}
            >
              <option value="">All Entities</option>
              <option value="CANDIDATE">Candidate</option>
              <option value="APPLICATION">Application</option>
              <option value="INTERVIEW">Interview</option>
              <option value="USER">User</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-500">Action</label>
            <select 
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white min-w-[150px]"
              value={filter.action}
              onChange={(e) => setFilter(prev => ({ ...prev, action: e.target.value }))}
            >
              <option value="">All Actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="LOGIN">Login</option>
            </select>
          </div>
        </div>

        <div className="os-card mt-4 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f1f5f9] border-b border-slate-200">
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">Timestamp</th>
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">Actor</th>
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">Action</th>
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">Entity</th>
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">Name</th>
                <th className="p-4 text-[11px] uppercase font-bold text-slate-600">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-b border-slate-100">
                    <td className="p-4"><div className="h-4 w-24 bg-slate-100 rounded"></div></td>
                    <td className="p-4"><div className="h-4 w-32 bg-slate-100 rounded"></div></td>
                    <td className="p-4"><div className="h-4 w-16 bg-slate-100 rounded"></div></td>
                    <td className="p-4"><div className="h-4 w-20 bg-slate-100 rounded"></div></td>
                    <td className="p-4"><div className="h-4 w-32 bg-slate-100 rounded"></div></td>
                    <td className="p-4"><div className="h-4 w-24 bg-slate-100 rounded"></div></td>
                  </tr>
                ))
              ) : logs.length > 0 ? (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer group">
                    <td className="p-4 text-sm text-slate-500 font-mono">{formatDate(log.createdAt)}</td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-900">{log.actor?.fullName || 'System'}</span>
                        <span className="text-[10px] text-slate-500">{log.actor?.email || ''}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        log.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                        log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                        log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4 text-sm font-medium text-slate-700">{log.entityType}</td>
                    <td className="p-4 text-sm font-medium text-slate-700">{log.entityName || 'N/A'}</td>
                    <td className="p-4 text-xs text-slate-500">{log.ipAddress || 'Internal'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400 text-sm italic">No audit logs found matching criteria.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div ref={observerTarget} className="h-10 flex items-center justify-center bg-white border-t border-slate-100">
            {loading && logs.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold animate-pulse">
                <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                Syncing audit events...
              </div>
            )}
            {!hasMore && logs.length > 0 && (
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">End of Audit History</div>
            )}
          </div>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default AuditLogs;
