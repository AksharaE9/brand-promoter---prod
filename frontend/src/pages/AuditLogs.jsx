import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import { apiGet, API_BASE_URL } from '../lib/api';
import { subscribeSSE } from '../lib/sse';

import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';

const actionGroups = [
  {
    category: "Authentication",
    actions: ["LOGIN", "LOGOUT"]
  },
  {
    category: "Team Management",
    actions: ["USER_INVITED", "USER_JOINED", "TEAM_MEMBER_DELETED", "TEAM_MEMBER_RESTORED", "ROLE_CHANGED", "CREATE_USER", "UPDATE_USER", "UPDATE_USER_STATUS"]
  },
  {
    category: "Candidate Actions",
    actions: ["CREATE_CANDIDATE", "UPDATE_CANDIDATE", "DELETE_CANDIDATE", "BULK_UPLOAD_CANDIDATES", "CREATE_CANDIDATE_WITH_RESUME"]
  },
  {
    category: "Interview Actions",
    actions: ["SCHEDULE_INTERVIEW", "UPDATE_INTERVIEW", "CANCEL_INTERVIEW"]
  },
  {
    category: "Settings Changes",
    actions: ["ORG_SETTINGS_UPDATED", "ORG_CONTACT_UPDATED", "USER_PROFILE_UPDATED", "PASSWORD_CHANGED"]
  }
];

const AuditLogs = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveCount, setLiveCount] = useState(0); // new events since page loaded
  const tableTopRef = useRef(null);

  // Filters state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedActions, setSelectedActions] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [interviewerSearch, setInterviewerSearch] = useState('');
  const [debouncedInterviewerSearch, setDebouncedInterviewerSearch] = useState('');
  const [showInterviewerDropdown, setShowInterviewerDropdown] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  // Active Dropdown flags
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [userSearchText, setUserSearchText] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Selected Log for Diff slide-over
  const [selectedLog, setSelectedLog] = useState(null);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Debounce interviewer search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInterviewerSearch(interviewerSearch);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [interviewerSearch]);

  // Load Team Members for User filter dropdown
  useEffect(() => {
    const loadTeam = async () => {
      try {
        const res = await apiGet('/users');
        if (res.success && Array.isArray(res.data)) {
          setTeamMembers(res.data);
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadTeam();
  }, []);

  // Fetch Audit Logs from backend
  const fetchLogs = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('page', String(page));
      if (entityType)      params.set('entityType', entityType);
      if (selectedUserId)  params.set('userId', selectedUserId);
      if (startDate)       params.set('startDate', new Date(startDate).toISOString());
      if (endDate)         params.set('endDate', endDate); // backend appends T23:59:59
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (debouncedInterviewerSearch) params.set('interviewerName', debouncedInterviewerSearch);
      if (selectedActions.length === 1) params.set('action', selectedActions[0]);

      const res = await apiGet(`/audit-logs?${params.toString()}`);
      if (res.success) {
        let resultLogs = res.data || [];
        // Client-side filter for multi-action selection
        if (selectedActions.length > 1) {
          resultLogs = resultLogs.filter(log => selectedActions.includes(log.action));
        }
        setLogs(resultLogs);
        setTotalCount(res.pagination?.total || resultLogs.length);
        setTotalPages(res.pagination?.totalPages || 1);
        setLiveCount(0); // reset live indicator on manual fetch
      } else {
        setError(res.message || 'Failed to fetch logs');
      }
    } catch (err) {
      setError(err.message || 'Failed to retrieve audit events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, entityType, selectedUserId, startDate, endDate, debouncedSearch, debouncedInterviewerSearch, selectedActions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time SSE: prepend new log entry at top of table without full reload
  useEffect(() => {
    const unsub = subscribeSSE((data) => {
      if (data.type !== 'AUDIT_LOG_CREATED') return;
      // Build a preview row from the SSE payload
      const liveLog = {
        id:          data.logId || `live-${Date.now()}`,
        action:      data.action,
        entityType:  data.entityType,
        entityId:    data.entityId,
        // Use entityName from SSE payload if provided; fall back to extracting from description
        // (e.g. "John Smith performed SCHEDULE_INTERVIEW on INTERVIEW (John - Round 1)")
        entityName:  data.entityName ||
                     (data.description?.match(/\(([^)]+)\)$/)?.[1]) ||
                     'Loading...',
        createdAt:   data.timestamp || new Date().toISOString(),
        actor: {
          fullName: data.performedByName || data.actorName || 'System',
          email:    '',
          role:     'Admin',
        },
        description: data.description || `${data.action} on ${data.entityType}`,
        _live: true, // mark as live for UI highlight
      };

      // Only prepend if we're on page 1 and no filters that would exclude it
      if (page === 1 && !startDate && !endDate && !debouncedSearch && selectedActions.length === 0) {
        setLogs(prev => [liveLog, ...prev.slice(0, limit - 1)]);
        setTotalCount(prev => prev + 1);
        setLiveCount(prev => prev + 1);
      } else {
        // Just bump the counter so user knows something happened
        setLiveCount(prev => prev + 1);
      }
    }, ['AUDIT_LOG_CREATED']);
    return () => unsub();
  }, [page, startDate, endDate, debouncedSearch, selectedActions, limit]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    tableTopRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Date Preset Handlers
  const applyPreset = (preset) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    if (preset === 'TODAY') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'YESTERDAY') {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0,0,0,0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23,59,59,999);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(end.toISOString().split('T')[0]);
    } else if (preset === 'LAST_7') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'LAST_30') {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'THIS_MONTH') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    }
    setPage(1);
  };

  const hasActiveFilters = startDate || endDate || selectedActions.length > 0 || selectedUserId || entityType || search || interviewerSearch;

  const clearAllFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedActions([]);
    setSelectedUserId('');
    setEntityType('');
    setSearch('');
    setDebouncedSearch('');
    setUserSearchText('');
    setInterviewerSearch('');
    setDebouncedInterviewerSearch('');
    setPage(1);
  };

  // Dropdown Multi-Select Category Handlers
  const handleToggleAction = (action) => {
    setSelectedActions(prev => 
      prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]
    );
    setPage(1);
  };

  const handleSelectAllGroup = (groupActions, selectAll) => {
    if (selectAll) {
      setSelectedActions(prev => [...new Set([...prev, ...groupActions])]);
    } else {
      setSelectedActions(prev => prev.filter(a => !groupActions.includes(a)));
    }
    setPage(1);
  };

  // Search user dropdown list
  const filteredUsers = useMemo(() => {
    if (!userSearchText.trim()) return teamMembers;
    const txt = userSearchText.toLowerCase();
    return teamMembers.filter(u => u.fullName?.toLowerCase().includes(txt));
  }, [teamMembers, userSearchText]);

  // Search interviewer dropdown list (prefer INTERVIEWER role, show all if no match)
  const filteredInterviewers = useMemo(() => {
    const interviewers = teamMembers.filter(u => u.role === 'INTERVIEWER' || u.role === 'SUPER_ADMIN' || u.role === 'RECRUITER');
    if (!interviewerSearch.trim()) return interviewers;
    const txt = interviewerSearch.toLowerCase();
    return interviewers.filter(u => u.fullName?.toLowerCase().includes(txt));
  }, [teamMembers, interviewerSearch]);

  // Relative Time Tooltip calculation
  const getRelativeTime = (dateStr) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${Math.round(diffHours / 24)} days ago`;
  };

  // Color Action badge
  const getActionColor = (action) => {
    const act = action.toUpperCase();
    if (act.includes('CREATE') || act.includes('INVITE') || act.includes('JOIN')) return 'bg-green-100 text-green-800';
    if (act.includes('UPDATE')) return 'bg-blue-100 text-blue-800';
    if (act.includes('DELETE') || act.includes('REVOKE')) return 'bg-red-100 text-red-800';
    if (act.includes('ROLE') || act.includes('SETTINGS') || act.includes('PASSWORD')) return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-800';
  };

  // Copy JSON log to clipboard
  const handleCopyLog = (log) => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    alert("Log JSON copied to clipboard");
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
              <UserChip fallbackName="System Admin" fallbackRole="SUPER_ADMIN" avatarSeed="audit-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Title */}
        <div className="flex items-end justify-between gap-3" ref={tableTopRef}>
          <div>
            <div className="os-eyebrow">Security & Compliance</div>
            <div className="flex items-center gap-3">
              <h1 className="os-h1">Enterprise Audit Logs</h1>
              {/* Live event indicator */}
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Live</span>
                {liveCount > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">
                    +{liveCount} new
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="os-btn-outline" onClick={() => fetchLogs()}>Refresh Logs</button>
        </div>

        {/* Filter Panel */}
        <div className="os-card mt-6 p-5 bg-white border border-[#e3eaf0] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            
            {/* Date Inputs */}
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-500">Date Range (From / To)</label>
              <div className="flex gap-2">
                <input 
                  type="date"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPage(1); }}
                />
                <input 
                  type="date"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPage(1); }}
                />
              </div>
            </div>

            {/* Action types multi-select custom selector */}
            <div className="flex flex-col gap-1 relative">
              <label className="text-[10px] uppercase font-bold text-slate-500">Action Type</label>
              <button 
                type="button" 
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-left text-xs bg-white flex items-center justify-between font-semibold text-slate-700 outline-none"
                onClick={() => setShowActionDropdown(!showActionDropdown)}
              >
                {selectedActions.length === 0 ? 'All Actions' : `${selectedActions.length} Actions`}
                <span className="text-[10px] text-slate-400">▼</span>
              </button>

              {/* Categorized Dropdown List */}
              {showActionDropdown && (
                <div className="absolute top-[48px] left-0 z-40 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-3 max-h-80 overflow-y-auto">
                  <div className="flex justify-between items-center pb-2 mb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-600">Select actions</span>
                    <button className="text-[10px] text-red-500 font-bold hover:underline" onClick={() => setSelectedActions([])}>Reset</button>
                  </div>
                  <div className="space-y-4">
                    {actionGroups.map((grp) => {
                      const isAllChecked = grp.actions.every(a => selectedActions.includes(a));
                      return (
                        <div key={grp.category} className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold text-[#1f52cc]">{grp.category}</span>
                            <label className="text-[10px] font-bold text-slate-400 cursor-pointer flex items-center gap-1">
                              <input 
                                type="checkbox" 
                                className="accent-[#1f52cc]"
                                checked={isAllChecked}
                                onChange={(e) => handleSelectAllGroup(grp.actions, e.target.checked)}
                              />
                              All
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {grp.actions.map((act) => {
                              const isChecked = selectedActions.includes(act);
                              return (
                                <button
                                  key={act}
                                  type="button"
                                  onClick={() => handleToggleAction(act)}
                                  className={`px-2 py-0.5 rounded text-[9px] font-semibold border transition-all ${
                                    isChecked ? 'bg-[#1f52cc] border-[#1f52cc] text-white' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                  }`}
                                >
                                  {act}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Search User searchable dropdown */}
            <div className="flex flex-col gap-1 relative">
              <label className="text-[10px] uppercase font-bold text-slate-500">Performed By</label>
              <input 
                type="text"
                placeholder={selectedUserId ? teamMembers.find(t => t.id === selectedUserId)?.fullName : 'Search member...'}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-[#1f52cc]"
                value={userSearchText}
                onChange={e => { setUserSearchText(e.target.value); setShowUserDropdown(true); }}
                onFocus={() => setShowUserDropdown(true)}
              />

              {showUserDropdown && (
                <div className="absolute top-[48px] left-0 z-40 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-1 max-h-56 overflow-y-auto">
                  <button 
                    type="button" 
                    className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-slate-50 rounded-lg"
                    onClick={() => { setSelectedUserId(''); setUserSearchText(''); setShowUserDropdown(false); setPage(1); }}
                  >
                    All Members
                  </button>
                  {filteredUsers.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-slate-50 rounded-lg"
                      onClick={() => {
                        setSelectedUserId(member.id);
                        setUserSearchText(member.fullName);
                        setShowUserDropdown(false);
                        setPage(1);
                      }}
                    >
                      {member.fullName} ({member.role})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Entity Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-bold text-slate-500">Entity Type</label>
              <select 
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs bg-white font-semibold text-slate-700 outline-none"
                value={entityType}
                onChange={e => { setEntityType(e.target.value); setPage(1); }}
              >
                <option value="">All Entities</option>
                <option value="CANDIDATE">Candidate</option>
                <option value="USER">User</option>
                <option value="JOB">Job</option>
                <option value="INTERVIEW">Interview</option>
                <option value="APPLICATION">Application</option>
                <option value="ORGANIZATION">Organization</option>
              </select>
            </div>

            {/* Interviewer Filter */}
            <div className="flex flex-col gap-1 relative">
              <label className="text-[10px] uppercase font-bold text-slate-500">Interviewer</label>
              <input
                type="text"
                placeholder="Search interviewer..."
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-[#1f52cc]"
                value={interviewerSearch}
                onChange={e => { setInterviewerSearch(e.target.value); setShowInterviewerDropdown(true); }}
                onFocus={() => setShowInterviewerDropdown(true)}
                onBlur={() => setTimeout(() => setShowInterviewerDropdown(false), 150)}
              />
              {interviewerSearch && (
                <button
                  type="button"
                  className="absolute right-2.5 top-[30px] text-slate-400 hover:text-slate-600 text-xs"
                  onClick={() => { setInterviewerSearch(''); setDebouncedInterviewerSearch(''); setPage(1); }}
                >
                  ✕
                </button>
              )}

              {showInterviewerDropdown && filteredInterviewers.length > 0 && (
                <div className="absolute top-[48px] left-0 z-40 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-1 max-h-56 overflow-y-auto">
                  {filteredInterviewers.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-slate-50 rounded-lg"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setInterviewerSearch(member.fullName);
                        setDebouncedInterviewerSearch(member.fullName);
                        setShowInterviewerDropdown(false);
                        setPage(1);
                      }}
                    >
                      <span className="block font-semibold text-slate-800">{member.fullName}</span>
                      <span className="text-[10px] text-slate-400">{member.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preset Buttons & Search input */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {/* Quick date presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Presets:</span>
              {['TODAY', 'YESTERDAY', 'LAST_7', 'LAST_30', 'THIS_MONTH'].map(p => (
                <button
                  key={p}
                  type="button"
                  className="px-2.5 h-7 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                  onClick={() => applyPreset(p)}
                >
                  {p.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* debounced search description */}
            <div className="flex items-center gap-2">
              <input 
                type="text"
                placeholder="Search log description..."
                className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-[#1f52cc]"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {hasActiveFilters && (
                <button className="os-btn-outline !h-9 text-xs text-red-500 border-red-100 hover:bg-red-50" onClick={clearAllFilters}>
                  Clear All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Results Info */}
        <div className="mt-4 text-xs font-semibold text-slate-500">
          Showing {logs.length} of {totalCount} total compliance records
        </div>

        {/* Audit Log Table */}
        <div className="os-card mt-2 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">
                <th className="p-4">Timestamp</th>
                <th className="p-4">User (Actor)</th>
                <th className="p-4">Action</th>
                <th className="p-4">Entity</th>
                <th className="p-4">Description</th>
                <th className="p-4">Changes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-b border-slate-100">
                    <td className="p-4"><div className="h-4 w-28 bg-slate-100 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-36 bg-slate-100 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-16 bg-slate-100 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-20 bg-slate-100 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-48 bg-slate-100 rounded" /></td>
                    <td className="p-4"><div className="h-6 w-16 bg-slate-100 rounded" /></td>
                  </tr>
                ))
              ) : logs.length > 0 ? (
                logs.map((log) => (
                  <tr key={log.id} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${
                    log._live ? 'bg-emerald-50/60 border-l-2 border-l-emerald-400 animate-in fade-in slide-in-from-top-1 duration-300' : ''
                  }`}>
                    {/* Timestamp */}
                    <td className="p-4 text-xs font-mono text-slate-500 cursor-help" title={getRelativeTime(log.createdAt)}>
                      {new Date(log.createdAt).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>

                    {/* User */}
                    <td className="p-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#1f52cc]/10 text-[#1f52cc] flex items-center justify-center font-bold text-xs">
                          {(log.actor?.fullName || 'S').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-900">{log.actor?.fullName || 'System'}</span>
                          <span className="text-[10px] text-slate-400">{log.actor?.role || 'Admin'}</span>
                        </div>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${getActionColor(log.action)}`}>
                        {log.action?.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Entity */}
                    <td className="p-4 text-xs font-bold text-slate-700">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[8px] uppercase text-slate-500 block w-max mb-1">
                        {log.entityType}
                      </span>
                      {log.entityName || 'N/A'}
                    </td>

                    {/* Description */}
                    <td className="p-4 text-xs text-slate-600 max-w-xs truncate cursor-help" title={log.description || 'No description provided'}>
                      {log.description || `${log.action} performed on ${log.entityType}`}
                    </td>

                    {/* Changes button */}
                    <td className="p-4">
                      <button 
                        className="os-btn-outline !h-8 text-xs font-bold border-slate-200" 
                        onClick={() => setSelectedLog(log)}
                      >
                        View Diff
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400 text-sm italic">No compliance events match filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="mt-6 flex justify-center items-center gap-3">
            <button 
              className="os-btn-outline !h-9 text-xs" 
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
            >
              Previous
            </button>
            <span className="text-xs font-bold text-slate-600">Page {page} of {totalPages}</span>
            <button 
              className="os-btn-outline !h-9 text-xs" 
              onClick={() => handlePageChange(page + 1)}
              disabled={page === totalPages}
            >
              Next
            </button>
          </div>
        )}

        {/* Change Detail Slide-over Panel (480px) */}
        {selectedLog && (
          <div className="fixed inset-0 z-[1300] flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedLog(null)} />
            
            {/* Panel */}
            <Reveal className="w-[480px] bg-white h-full shadow-2xl relative z-10 p-6 flex flex-col justify-between border-l border-slate-200 animate-in slide-in-from-right duration-350">
              <div className="space-y-6 overflow-y-auto max-h-[85vh] pr-2">
                {/* Header */}
                <div className="flex justify-between items-start border-b border-slate-100 pb-4">
                  <div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getActionColor(selectedLog.action)}`}>
                      {selectedLog.action}
                    </span>
                    <h3 className="text-lg font-bold text-slate-800 mt-2 font-[Manrope]">Action Details</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Performed by: <strong>{selectedLog.actor?.fullName || 'System'}</strong> on {new Date(selectedLog.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={() => setSelectedLog(null)}>
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                {/* Changed Fields Tags */}
                {selectedLog.metadata?.changedFields && selectedLog.metadata.changedFields.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Modified Fields</h4>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedLog.metadata.changedFields.map(f => (
                        <span key={f} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Diff Comparison View */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Change Comparison</h4>
                  {selectedLog.metadata?.before || selectedLog.metadata?.after ? (
                    <div className="space-y-3">
                      {/* Before / After Columns */}
                      <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold border-b border-slate-100 pb-2">
                        <div className="bg-red-50 text-red-700 py-1.5 rounded-lg border border-red-100">Before</div>
                        <div className="bg-emerald-50 text-emerald-700 py-1.5 rounded-lg border border-emerald-100">After</div>
                      </div>
                      
                      {/* Diff rows */}
                      {Object.keys(selectedLog.metadata.after || {}).map(key => {
                        const beforeVal = selectedLog.metadata.before?.[key];
                        const afterVal = selectedLog.metadata.after?.[key];
                        // If values are same, we skip showing
                        if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) return null;

                        return (
                          <div key={key} className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 font-mono uppercase block">{key}</span>
                            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                              <div className="text-red-600 break-all bg-white p-2 rounded-lg border border-slate-100">
                                {beforeVal !== undefined && beforeVal !== null ? String(JSON.stringify(beforeVal)) : 'null'}
                              </div>
                              <div className="text-emerald-700 break-all bg-white p-2 rounded-lg border border-slate-100 font-bold">
                                {afterVal !== undefined && afterVal !== null ? String(JSON.stringify(afterVal)) : 'null'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Show Raw Metadata if no before/after diff is present */
                    <pre className="bg-[#0b1b3d] text-white p-4 rounded-xl text-xs overflow-x-auto font-mono max-h-72">
                      {JSON.stringify(selectedLog.metadata || selectedLog.newData || selectedLog.oldData || {}, null, 2)}
                    </pre>
                  )}
                </div>
              </div>

              {/* Slide-over Footer Actions */}
              <div className="border-t border-slate-100 pt-4 flex gap-3">
                <button className="os-btn-outline w-full flex items-center justify-center gap-1.5" onClick={() => handleCopyLog(selectedLog)}>
                  <span className="material-symbols-outlined text-base">content_copy</span>
                  Copy JSON Log
                </button>
                <button className="os-btn-primary w-full bg-[#1f52cc]" onClick={() => setSelectedLog(null)}>
                  Close
                </button>
              </div>
            </Reveal>
          </div>
        )}

      </PageEnter>
    </EnterpriseLayout>
  );
};

export default AuditLogs;
