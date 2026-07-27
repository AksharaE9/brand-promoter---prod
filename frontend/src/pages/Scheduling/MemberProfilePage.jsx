import React, { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { getStoredUser } from '../../lib/api';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { formatTime24h, formatDateTime24h, getTodayString } from '../../lib/datetime';
import { enterpriseNavItems, enterpriseFooterLinks } from '../../config/enterpriseNav';
import UserChip from '../../components/UserChip';
import NotificationBell from '../../components/NotificationBell';
import MemberFileAttachmentModal from '../../components/Scheduling/MemberFileAttachmentModal';

import { lazyWithRetry } from '../../lib/lazyWithRetry';

const LeadListImportModal = lazyWithRetry(() => import('../../components/Scheduling/LeadListImportModal'), 'LeadListImportModal_MemberProfile');

export default function MemberProfilePage() {
  const { memberId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentUser = getStoredUser();

  // Tab State
  const activeTab = searchParams.get('tab') || 'reports';

  // Date Filter State (default to last 30 days)
  const defaultTo = useMemo(() => getTodayString(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(defaultTo);
    d.setDate(d.getDate() - 30);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [defaultTo]);

  const fromDate = searchParams.get('from') || defaultFrom;
  const toDate = searchParams.get('to') || defaultTo;

  // Modals
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [reimportDate, setReimportDate] = useState(null);

  // Lead List Expansion
  const [expandedListId, setExpandedListId] = useState(null);
  const [expandedLeads, setExpandedLeads] = useState({});
  const [loadingLeads, setLoadingLeads] = useState({});

  // 1. Fetch Member Profile Details
  const { data: memberProfile, isLoading: isProfileLoading, error: profileError } = useQuery({
    queryKey: ['scheduling', 'member-profile', memberId],
    queryFn: () => schedulingLeadApi.getMemberProfile(memberId),
    retry: false,
    staleTime: 60_000,
  });

  // 2. Fetch Grouped Uploaded Files (Infinite Query)
  const {
    data: filesData,
    fetchNextPage: fetchNextFiles,
    hasNextPage: hasMoreFiles,
    isFetchingNextPage: isFetchingMoreFiles,
    isLoading: isFilesLoading,
    isError: isFilesError,
    error: filesError
  } = useInfiniteQuery({
    queryKey: ['scheduling', 'member-files', memberId, fromDate, toDate],
    queryFn: async ({ pageParam = '' }) => {
      return await schedulingLeadApi.getMemberFiles(memberId, {
        cursor: pageParam,
        limit: 50,
        from: fromDate,
        to: toDate
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: !!memberId,
  });

  // 3. Fetch Assigned Lead Lists (Infinite Query)
  const {
    data: listsData,
    fetchNextPage: fetchNextLists,
    hasNextPage: hasMoreLists,
    isFetchingNextPage: isFetchingMoreLists,
    isLoading: isListsLoading,
    isError: isListsError,
    error: listsError
  } = useInfiniteQuery({
    queryKey: ['scheduling', 'member-lead-lists', memberId, fromDate, toDate],
    queryFn: async ({ pageParam = '' }) => {
      return await schedulingLeadApi.getMemberLeadLists(memberId, {
        cursor: pageParam,
        limit: 50,
        from: fromDate,
        to: toDate
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: !!memberId,
  });

  // 4. Fetch Daily Reports (Infinite Query)
  const {
    data: reportsData,
    fetchNextPage: fetchNextReports,
    hasNextPage: hasMoreReports,
    isFetchingNextPage: isFetchingMoreReports,
    isLoading: isReportsLoading,
    isError: isReportsError,
    error: reportsError
  } = useInfiniteQuery({
    queryKey: ['scheduling', 'member-reports', memberId, fromDate, toDate],
    queryFn: async ({ pageParam = '' }) => {
      return await schedulingLeadApi.getMemberReports(memberId, {
        cursor: pageParam,
        limit: 50,
        from: fromDate,
        to: toDate
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: !!memberId,
  });

  // Helpers to flatmap infinite query pages
  const groupedFiles = useMemo(() => {
    if (!filesData?.pages) return [];
    const merged = {};
    for (const page of filesData.pages) {
      if (!page.data) continue;
      for (const group of page.data) {
        if (!merged[group.date]) {
          merged[group.date] = [];
        }
        merged[group.date].push(...group.files);
      }
    }
    return Object.keys(merged)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        files: merged[date]
      }));
  }, [filesData]);

  const leadLists = useMemo(() => {
    if (!listsData?.pages) return [];
    return listsData.pages.flatMap(page => page.data || []);
  }, [listsData]);

  const dailyReports = useMemo(() => {
    if (!reportsData?.pages) return [];
    return reportsData.pages.flatMap(page => page.data || []);
  }, [reportsData]);

  // Tab & Date Range state updates
  const handleTabChange = (newTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', newTab);
    setSearchParams(params);
  };

  const handleDateChange = (field, val) => {
    const params = new URLSearchParams(searchParams);
    if (val) params.set(field, val);
    else params.delete(field);
    setSearchParams(params);
  };

  const handleExportCSV = (dateStr) => {
    const url = schedulingLeadApi.exportLeadListUrl(memberId, dateStr);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${memberProfile?.name || 'Member'}_leads_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReimport = (dateStr) => {
    setReimportDate(dateStr);
    setShowImportModal(true);
  };

  const toggleExpandLeads = async (listId, dateStr) => {
    if (expandedListId === listId) {
      setExpandedListId(null);
      return;
    }
    setExpandedListId(listId);
    if (!expandedLeads[listId]) {
      setLoadingLeads(prev => ({ ...prev, [listId]: true }));
      try {
        const data = await schedulingLeadApi.getMyList({ memberId, date: dateStr });
        if (data && data.leads) {
          setExpandedLeads(prev => ({ ...prev, [listId]: data.leads }));
        }
      } catch (err) {
        console.error('Failed to load lead details preview:', err);
      } finally {
        setLoadingLeads(prev => ({ ...prev, [listId]: false }));
      }
    }
  };

  if (isProfileLoading) {
    return (
      <EnterpriseLayout
        sidebar={<EnterpriseSidebar active="scheduling" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
        topbar={<EnterpriseTopbar tabs={[]} right={<><NotificationBell /><UserChip /></>} />}
      >
        <div className="p-12 text-center text-slate-400 text-sm animate-pulse">
          Loading member profile...
        </div>
      </EnterpriseLayout>
    );
  }

  if (profileError) {
    const is403 = profileError.message?.includes('403') || profileError.status === 403;
    return (
      <EnterpriseLayout
        sidebar={<EnterpriseSidebar active="scheduling" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
        topbar={<EnterpriseTopbar tabs={[]} right={<><NotificationBell /><UserChip /></>} />}
      >
        <div className="p-12 text-center max-w-md mx-auto space-y-4">
          <span className="material-symbols-outlined text-6xl text-red-400">gpp_bad</span>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">
            {is403 ? 'Access Denied' : 'Profile Error'}
          </h2>
          <p className="text-xs text-slate-500">
            {is403
              ? 'You do not have administrative permissions to view this telecalling member profile page.'
              : profileError.message || 'An error occurred while loading this member profile.'}
          </p>
        </div>
      </EnterpriseLayout>
    );
  }

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="scheduling" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          tabs={[]}
          right={<><NotificationBell /><UserChip /></>}
        />
      }
    >
      <PageEnter>
        <div className="space-y-6 pb-12">
          {/* Header section */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-2xl shadow-inner">
                {memberProfile.name.charAt(0).toUpperCase()}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-slate-800 tracking-tight">{memberProfile.name}</h1>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase inline-flex items-center gap-1 ${
                    memberProfile.active
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {memberProfile.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Linked User: {' '}
                    {memberProfile.linkedUser ? (
                      <span className="font-bold text-slate-700">{memberProfile.linkedUser.fullName}</span>
                    ) : (
                      <span className="text-slate-400 italic">None</span>
                    )}
                  </span>
                  <span className="text-slate-300">•</span>
                  <span>Joined {new Date(memberProfile.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              </div>
            </div>

            {/* Date range picker */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => handleDateChange('from', e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => handleDateChange('to', e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Tabs bar */}
          <div className="flex justify-between items-center border-b border-slate-200/80 pb-px">
            <div className="flex gap-1.5">
              {[
                { id: 'reports', label: 'Daily Reports' },
                { id: 'files', label: 'Uploaded Files' },
                { id: 'lists', label: 'Assigned Lead Lists' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => handleTabChange(t.id)}
                  className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2 -mb-px ${
                    activeTab === t.id
                      ? 'border-blue-600 text-blue-600 bg-blue-50/20'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Top-right quick actions depending on tab */}
            {activeTab === 'files' && (
              <button
                onClick={() => setShowAttachmentModal(true)}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-100 transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">attach_file</span>
                Add File
              </button>
            )}
            {activeTab === 'lists' && (
              <button
                onClick={() => {
                  setReimportDate(null);
                  setShowImportModal(true);
                }}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-100 transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">upload</span>
                Import List
              </button>
            )}
          </div>

          {/* Tab content area */}
          <div className="min-h-[40vh]">
            <Reveal>
              {/* TAB 1: UPLOADED FILES */}
              {activeTab === 'files' && (
                <div className="space-y-6">
                  {isFilesLoading ? (
                    <div className="p-12 text-center text-slate-400 text-sm animate-pulse">Loading uploaded files...</div>
                  ) : isFilesError ? (
                    <div className="p-12 text-center text-red-500 text-xs">Failed to load files: {filesError.message}</div>
                  ) : groupedFiles.length === 0 ? (
                    <div className="p-16 text-center text-slate-400 text-xs italic bg-white rounded-3xl border border-dashed border-slate-200">
                      No files uploaded for this member yet.
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {groupedFiles.map(group => (
                        <div key={group.date} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                          {/* Sticky header */}
                          <div className="sticky top-0 bg-slate-50 px-4 py-2 text-slate-800 font-bold border-b border-slate-100 flex justify-between items-center text-xs">
                            <span className="font-mono">{group.date}</span>
                            <span className="text-slate-400 font-semibold">{group.files.length} file{group.files.length !== 1 ? 's' : ''}</span>
                          </div>

                          <div className="divide-y divide-slate-100">
                            {group.files.map(file => (
                              <div key={file.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-all text-xs">
                                <div className="min-w-0 flex-1 pr-6 space-y-1">
                                  <a
                                    href={file.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold text-blue-600 hover:underline truncate block"
                                  >
                                    {file.filename}
                                  </a>
                                  {file.note && (
                                    <p className="text-[11px] text-slate-500 italic">"{file.note}"</p>
                                  )}
                                  <div className="text-[10px] text-slate-400">
                                    Uploaded by <span className="font-semibold text-slate-500">{file.uploaded_by}</span> at {formatTime24h(file.created_at)}
                                  </div>
                                </div>
                                <a
                                  href={file.fileUrl}
                                  download
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all flex items-center justify-center shadow-sm"
                                  title="Download File"
                                >
                                  <span className="material-symbols-outlined text-sm">download</span>
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      {hasMoreFiles && (
                        <div className="text-center pt-4">
                          <button
                            onClick={() => fetchNextFiles()}
                            disabled={isFetchingMoreFiles}
                            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                          >
                            {isFetchingMoreFiles ? 'Loading more...' : 'Load More Files'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: ASSIGNED LEAD LISTS */}
              {activeTab === 'lists' && (
                <div className="space-y-4">
                  {isListsLoading ? (
                    <div className="p-12 text-center text-slate-400 text-sm animate-pulse">Loading lead lists...</div>
                  ) : isListsError ? (
                    <div className="p-12 text-center text-red-500 text-xs">Failed to load lead lists: {listsError.message}</div>
                  ) : leadLists.length === 0 ? (
                    <div className="p-16 text-center text-slate-400 text-xs italic bg-white rounded-3xl border border-dashed border-slate-200">
                      No lead lists have been imported for this member yet.
                    </div>
                  ) : (
                    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold text-[10px] tracking-wider">
                              <th className="p-4 w-12"></th>
                              <th className="p-4">List Date</th>
                              <th className="p-4">Total Leads</th>
                              <th className="p-4">Imported By</th>
                              <th className="p-4">Imported At</th>
                              <th className="p-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {leadLists.map((item) => (
                              <React.Fragment key={item.id}>
                                <tr
                                  className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${
                                    expandedListId === item.id ? 'bg-slate-50/20' : ''
                                  }`}
                                  onClick={() => toggleExpandLeads(item.id, item.list_date)}
                                >
                                  <td className="p-4 text-center">
                                    <span className="material-symbols-outlined text-slate-400 text-lg transition-transform duration-200" style={{
                                      transform: expandedListId === item.id ? 'rotate(90deg)' : 'none'
                                    }}>
                                      chevron_right
                                    </span>
                                  </td>
                                  <td className="p-4 font-mono font-bold text-slate-800">{item.list_date}</td>
                                  <td className="p-4">
                                    <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                                      {item.total_leads} Leads
                                    </span>
                                  </td>
                                  <td className="p-4 text-slate-600">{item.imported_by}</td>
                                  <td className="p-4 text-slate-500">{formatDateTime24h(item.imported_at)}</td>
                                  <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => handleExportCSV(item.list_date)}
                                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1"
                                        title="Download Lead List CSV"
                                      >
                                        <span className="material-symbols-outlined text-xs">download</span>
                                        Download
                                      </button>
                                      <button
                                        onClick={() => handleReimport(item.list_date)}
                                        className="px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-[11px] border border-blue-200 rounded-lg transition-colors flex items-center gap-1"
                                        title="Re-import List"
                                      >
                                        <span className="material-symbols-outlined text-xs">sync</span>
                                        Re-import
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {/* Expanded Preview Row */}
                                {expandedListId === item.id && (
                                  <tr onClick={(e) => e.stopPropagation()}>
                                    <td colSpan={6} className="bg-slate-50/50 p-4 border-t border-slate-100">
                                      {loadingLeads[item.id] ? (
                                        <div className="text-center py-4 text-slate-400 text-xs animate-pulse">Loading leads...</div>
                                      ) : !expandedLeads[item.id] || expandedLeads[item.id].length === 0 ? (
                                        <div className="text-center py-4 text-slate-400 text-xs italic">No leads found in this list.</div>
                                      ) : (
                                        <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden max-w-2xl mx-auto shadow-sm">
                                          <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center text-[11px]">
                                            <span className="font-bold text-slate-700">Preview: First 10 Leads</span>
                                            {expandedLeads[item.id].length > 10 && (
                                              <span className="text-slate-400 font-semibold">showing 10 of {expandedLeads[item.id].length} leads</span>
                                            )}
                                          </div>
                                          <table className="w-full text-left border-collapse text-[11px]">
                                            <thead>
                                              <tr className="bg-slate-50/30 border-b border-slate-100 text-slate-500 font-bold">
                                                <th className="p-2 w-8">#</th>
                                                <th className="p-2">Name</th>
                                                <th className="p-2">Phone</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                              {expandedLeads[item.id].slice(0, 10).map((lead, idx) => (
                                                <tr key={lead.id} className="hover:bg-slate-50/50">
                                                  <td className="p-2 text-slate-400 font-bold">{idx + 1}</td>
                                                  <td className="p-2 font-bold text-slate-800">{lead.leadData?.name || '-'}</td>
                                                  <td className="p-2 font-mono text-blue-600 font-semibold">{lead.leadData?.phone || '-'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {hasMoreLists && (
                        <div className="text-center p-4 border-t border-slate-100">
                          <button
                            onClick={() => fetchNextLists()}
                            disabled={isFetchingMoreLists}
                            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                          >
                            {isFetchingMoreLists ? 'Loading more...' : 'Load More Lists'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: DAILY REPORTS */}
              {activeTab === 'reports' && (
                <div className="space-y-4">
                  {isReportsLoading ? (
                    <div className="p-12 text-center text-slate-400 text-sm animate-pulse">Loading daily reports...</div>
                  ) : isReportsError ? (
                    <div className="p-12 text-center text-red-500 text-xs">Failed to load reports: {reportsError.message}</div>
                  ) : dailyReports.length === 0 ? (
                    <div className="p-16 text-center text-slate-400 text-xs italic bg-white rounded-3xl border border-dashed border-slate-200">
                      No reports have been submitted for this member yet.
                    </div>
                  ) : (
                    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold text-[10px] tracking-wider">
                              <th className="p-4">Report Date</th>
                              <th className="p-4">Calls Done</th>
                              <th className="p-4">Didn't Pick</th>
                              <th className="p-4">Picked</th>
                              <th className="p-4">Scheduled</th>
                              <th className="p-4">ATS Updated</th>
                              <th className="p-4">Mail Updated</th>
                              <th className="p-4 w-48">Completion %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {dailyReports.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-4 font-mono font-bold text-slate-800">{item.report_date}</td>
                                <td className="p-4 font-bold text-slate-700">{item.calls_done}</td>
                                <td className="p-4 text-amber-600 font-semibold">{item.calls_didnt_pick}</td>
                                <td className="p-4 text-emerald-600 font-semibold">{item.calls_picked}</td>
                                <td className="p-4 text-indigo-600 font-semibold">{item.scheduled_entries}</td>
                                <td className="p-4 text-blue-600 font-semibold">{item.updated_in_ats}</td>
                                <td className="p-4 text-purple-600 font-semibold">{item.updated_in_mail}</td>
                                <td className="p-4">
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold">
                                      <span className="text-slate-600">{item.completion_percentage}%</span>
                                      <span className="text-slate-400">({item.calls_done} / {item.total_leads_for_date})</span>
                                    </div>
                                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                      <div
                                        className="bg-blue-600 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${item.completion_percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {hasMoreReports && (
                        <div className="text-center p-4 border-t border-slate-100">
                          <button
                            onClick={() => fetchNextReports()}
                            disabled={isFetchingMoreReports}
                            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                          >
                            {isFetchingMoreReports ? 'Loading more...' : 'Load More Reports'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Reveal>
          </div>

          {/* Modal Components */}
          {showAttachmentModal && (
            <MemberFileAttachmentModal
              memberId={memberId}
              memberName={memberProfile.name}
              initialFiles={[]}
              selectedDate={getTodayString()}
              onClose={() => setShowAttachmentModal(false)}
              onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ['scheduling', 'member-files', memberId] });
              }}
            />
          )}

          {showImportModal && (
            <React.Suspense fallback={null}>
              <LeadListImportModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                member={{ id: memberId, name: memberProfile.name }}
                selectedDate={reimportDate || getTodayString()}
                onUploadSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ['scheduling', 'member-lead-lists', memberId] });
                }}
              />
            </React.Suspense>
          )}
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
}
