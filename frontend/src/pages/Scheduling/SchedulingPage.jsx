import React, { useState, useEffect, useCallback, useRef } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { CandidateNameLink } from '../../components/CandidateNameLink';
import MemberFileAttachmentModal from '../../components/Scheduling/MemberFileAttachmentModal';
import { getStoredUser } from '../../lib/api';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { computeCompletionPercentage } from '../../lib/leadImportSchema';
// Lazy load modals to optimize Scheduling page bundle size
const MembersManagementModal = React.lazy(() => import('../../components/Scheduling/MembersManagementModal'));
const LeadListImportModal = React.lazy(() => import('../../components/Scheduling/LeadListImportModal'));
const WorkDoneReportModal = React.lazy(() => import('../../components/Scheduling/WorkDoneReportModal'));
import { useQuery } from '@tanstack/react-query';
import useDebounce from '../../hooks/useDebounce';
import { search } from '../../lib/searchClient';
import UserChip from '../../components/UserChip';
import NotificationBell from '../../components/NotificationBell';
import { enterpriseNavItems, enterpriseFooterLinks } from '../../config/enterpriseNav';

import { getTodayString } from '../../lib/datetime';

const OVERVIEW_TIMEOUT_MS = 10_000; // 10 s — after this, replace loading with error+retry

export default function SchedulingPage() {
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'RECRUITER';

  const todayStr = getTodayString();
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Admin Data
  const [adminOverview, setAdminOverview] = useState([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [adminError, setAdminError] = useState('');
  const overviewTimeoutRef = useRef(null);

  // Member Data
  const [myList, setMyList] = useState(null);
  const [myReport, setMyReport] = useState(null);
  const [memberLoading, setMemberLoading] = useState(true);

  // Modals state
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [importMember, setImportMember] = useState(null);
  const [reportModalData, setReportModalData] = useState(null);
  const [attachmentModalData, setAttachmentModalData] = useState(null);

  // Lead List View Modal for Admin/Member
  const [viewingLeadList, setViewingLeadList] = useState(null);

  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 200);

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['scheduling', 'search', debouncedSearch, selectedDate],
    queryFn: ({ signal }) => search('/api/scheduling/search', {
      q: debouncedSearch,
      filters: { date: selectedDate }
    }, signal),
    enabled: debouncedSearch.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const displayedLeads = debouncedSearch.trim().length >= 2
    ? (searchResults?.data || [])
    : (myList?.leads || []);

  const loadAdminData = useCallback(async () => {
    setAdminLoading(true);
    setAdminError('');
    setError('');

    // Safety net: if the request takes > OVERVIEW_TIMEOUT_MS, surface an error
    // instead of leaving the user stuck on "Loading telecaller overview..."
    clearTimeout(overviewTimeoutRef.current);
    overviewTimeoutRef.current = setTimeout(() => {
      setAdminLoading((prev) => {
        if (prev) {
          setAdminError('Request timed out. The server took too long to respond.');
        }
        return false;
      });
    }, OVERVIEW_TIMEOUT_MS);

    try {
      const data = await schedulingLeadApi.getAdminOverview(selectedDate);
      clearTimeout(overviewTimeoutRef.current);
      setAdminOverview(data || []);
    } catch (err) {
      clearTimeout(overviewTimeoutRef.current);
      setAdminError(err.message || 'Failed to load admin overview');
    } finally {
      setAdminLoading(false);
    }
  }, [selectedDate]);

  const loadMemberData = useCallback(async () => {
    setMemberLoading(true);
    setError('');
    try {
      const [listRes, reportRes] = await Promise.all([
        schedulingLeadApi.getMyList({ date: selectedDate }),
        schedulingLeadApi.getMyReport({ date: selectedDate }),
      ]);
      setMyList(listRes);
      setMyReport(reportRes);
    } catch (err) {
      setError(err.message || 'Failed to load daily schedule');
    } finally {
      setMemberLoading(false);
    }
  }, [selectedDate]);

  const refreshAll = useCallback(() => {
    if (isAdmin) {
      loadAdminData();
    } else {
      loadMemberData();
    }
  }, [isAdmin, loadAdminData, loadMemberData]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Derived metrics for member
  const totalLeadsToday = myList?.totalLeads || 0;
  const callsDoneToday = myReport?.callsDone || 0;
  const completionPercentage = computeCompletionPercentage(callsDoneToday, totalLeadsToday);

  // Admin summary statistics
  const totalActiveMembers = adminOverview.length;
  const listsUploadedCount = adminOverview.filter((m) => m.listUploaded).length;
  const reportsSubmittedCount = adminOverview.filter((m) => m.reportSubmitted).length;
  const totalCallsDoneAdmin = adminOverview.reduce((acc, m) => acc + (m.callsDone || 0), 0);

  const handleExportCSV = (memberId, memberName) => {
    const url = schedulingLeadApi.exportLeadListUrl(memberId, selectedDate);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${memberName}_leads_${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleViewLeadList = async (memberId, memberName) => {
    setError('');
    try {
      const data = await schedulingLeadApi.getMyList({ memberId, date: selectedDate });
      if (!data || !data.leads || data.leads.length === 0) {
        setBanner(`No lead list found for ${memberName} on ${selectedDate}`);
        return;
      }
      setViewingLeadList({ memberName, ...data });
    } catch (err) {
      setError(err.message || 'Failed to load lead list');
    }
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="scheduling" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search scheduling by name or phone..."
          searchValue={searchQuery}
          onSearchChange={e => setSearchQuery(e.target.value)}
          tabs={[]}
          right={<><NotificationBell /><UserChip /></>}
        />
      }
    >
      <PageEnter>
        <div className="space-y-6 pb-12">
          {/* Header Banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-600 text-2xl">assignment</span>
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">Telecalling & Lead Scheduling</h1>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {isAdmin
                  ? 'Manage team lead assignments, import daily lists, and monitor activity reports.'
                  : 'View your assigned daily leads and submit your daily work-done activity report.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <span className="material-symbols-outlined text-slate-400 text-sm">calendar_today</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer"
                />
              </div>

              {isAdmin && (
                <button
                  onClick={() => setShowMembersModal(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-100 transition-all flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">groups</span>
                  Manage Team Members
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-semibold">
              {error}
            </div>
          )}
          {banner && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-700 font-semibold flex items-center justify-between">
              <span>{banner}</span>
              <button onClick={() => setBanner('')} className="text-emerald-700 font-bold hover:underline text-[10px]">
                Dismiss
              </button>
            </div>
          )}

          {/* ─────────────────────────────────────────────
              ADMIN DASHBOARD OVERVIEW
          ───────────────────────────────────────────── */}
          {isAdmin ? (
            <Reveal>
              <div className="space-y-6">
                {/* Admin Stat Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                      <span className="material-symbols-outlined">group</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase">Active Team Members</div>
                      <div className="text-2xl font-black text-slate-800">{totalActiveMembers}</div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                      <span className="material-symbols-outlined">upload_file</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase">Lists Uploaded ({selectedDate})</div>
                      <div className="text-2xl font-black text-slate-800">{listsUploadedCount} / {totalActiveMembers}</div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                      <span className="material-symbols-outlined">fact_check</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase">Reports Submitted</div>
                      <div className="text-2xl font-black text-slate-800">{reportsSubmittedCount} / {totalActiveMembers}</div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                      <span className="material-symbols-outlined">call</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase">Total Calls Reported</div>
                      <div className="text-2xl font-black text-slate-800">{totalCallsDoneAdmin}</div>
                    </div>
                  </div>
                </div>

                {/* Admin Overview Table */}
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Telecaller Overview</h2>
                      <p className="text-xs text-slate-500">Member lead list status, daily work done, and progress for {selectedDate}</p>
                    </div>
                  </div>

                  {adminLoading ? (
                    <div className="p-12 text-center text-slate-400 text-sm animate-pulse">Loading telecaller overview...</div>
                  ) : adminError ? (
                    <div className="p-12 text-center space-y-3">
                      <span className="material-symbols-outlined text-4xl text-red-300">cloud_off</span>
                      <div className="text-sm text-red-600 font-semibold">{adminError}</div>
                      <button
                        onClick={loadAdminData}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all"
                      >
                        Retry
                      </button>
                    </div>
                  ) : adminOverview.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 text-sm italic">
                      No active telecalling members found. Click "Manage Team Members" to add team members.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold text-[10px] tracking-wider">
                            <th className="p-4">Member Name</th>
                            <th className="p-4">Linked User Account</th>
                            <th className="p-4">Lead List Status</th>
                            <th className="p-4">Report Status</th>
                            <th className="p-4 w-48">Daily Completion %</th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {adminOverview.map((item) => (
                            <tr key={item.memberId} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-4 font-bold text-slate-800 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                  {item.memberName.charAt(0).toUpperCase()}
                                </div>
                                <CandidateNameLink
                                  type="member"
                                  candidateId={item.memberId}
                                  candidateName={item.memberName}
                                />
                              </td>

                              <td className="p-4 text-slate-600">
                                {item.linkedUser ? (
                                  <span className="font-semibold text-slate-700">{item.linkedUser.fullName}</span>
                                ) : (
                                  <span className="text-slate-400 italic">Unlinked</span>
                                )}
                              </td>

                              <td className="p-4">
                                {item.listUploaded ? (
                                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px] inline-flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs">check_circle</span>
                                    {item.totalLeads} Leads
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-semibold text-[11px]">
                                    No List
                                  </span>
                                )}
                              </td>

                              <td className="p-4">
                                {item.reportSubmitted ? (
                                  <div className="space-y-0.5">
                                    <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[11px] inline-flex items-center gap-1">
                                      <span className="material-symbols-outlined text-xs">analytics</span>
                                      {item.callsDone} Calls Done
                                    </span>
                                  </div>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-semibold text-[11px]">
                                    Pending
                                  </span>
                                )}
                              </td>

                              <td className="p-4">
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-bold">
                                    <span className="text-slate-600">{item.completionPercentage}%</span>
                                    <span className="text-slate-400">({item.callsDone} / {item.totalLeads})</span>
                                  </div>
                                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                    <div
                                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                                      style={{ width: `${item.completionPercentage}%` }}
                                    />
                                  </div>
                                </div>
                              </td>

                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => setImportMember({ id: item.memberId, name: item.memberName })}
                                    className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-[11px] border border-blue-200 transition-colors flex items-center gap-1"
                                    title="Upload Lead Sheet"
                                  >
                                    <span className="material-symbols-outlined text-xs">upload</span>
                                    Import
                                  </button>

                                  {item.listUploaded && (
                                    <>
                                      <button
                                        onClick={() => handleViewLeadList(item.memberId, item.memberName)}
                                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold text-[11px] transition-colors"
                                        title="View Lead List"
                                      >
                                        View List
                                      </button>
                                      <button
                                        onClick={() => handleExportCSV(item.memberId, item.memberName)}
                                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold text-[11px] transition-colors flex items-center gap-1"
                                        title="Export List CSV"
                                      >
                                        <span className="material-symbols-outlined text-xs">download</span>
                                      </button>
                                    </>
                                  )}

                                  <button
                                    onClick={() => setReportModalData({
                                      memberId: item.memberId,
                                      totalLeadsToday: item.totalLeads,
                                      initialData: item.report,
                                    })}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] border border-emerald-200 transition-colors"
                                    title="View/Edit Work Done Report"
                                  >
                                    Report
                                  </button>

                                  <button
                                    onClick={() => setAttachmentModalData({
                                      memberId: item.memberId,
                                      memberName: item.memberName,
                                      files: item.files || [],
                                    })}
                                    className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 font-bold text-[11px] border border-violet-200 transition-colors flex items-center gap-1"
                                    title="Attach / View Files"
                                  >
                                    <span className="material-symbols-outlined text-xs">attach_file</span>
                                    Add File
                                    {item.files?.length > 0 && (
                                      <span className="bg-violet-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-black ml-0.5">
                                        {item.files.length}
                                      </span>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </Reveal>
          ) : (
            /* ─────────────────────────────────────────────
                MEMBER DASHBOARD VIEW
            ───────────────────────────────────────────── */
            <Reveal>
              <div className="space-y-6">
                {/* Work Done Today Panel */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Work Done Today</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Submit your daily telecalling activity report for {selectedDate}</p>
                    </div>

                    <button
                      onClick={() => setReportModalData({
                        memberId: null,
                        totalLeadsToday,
                        initialData: myReport,
                      })}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-base">edit_note</span>
                      {myReport ? 'Edit Work Done Report' : 'Submit Work Done Report'}
                    </button>
                  </div>

                  {/* Progress Bar & Metrics */}
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Completion Percentage</span>
                      <span className="text-base font-black text-blue-700">{completionPercentage}%</span>
                    </div>

                    <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${completionPercentage}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-slate-400 font-bold uppercase">Calls Done</div>
                        <div className="text-lg font-black text-slate-800">{myReport?.callsDone || 0}</div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-amber-600 font-bold uppercase">Didn't Pick</div>
                        <div className="text-lg font-black text-amber-700">{myReport?.callsDidntPick || 0}</div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-emerald-600 font-bold uppercase">Calls Picked</div>
                        <div className="text-lg font-black text-emerald-700">{myReport?.callsPicked || 0}</div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-indigo-600 font-bold uppercase">Scheduled</div>
                        <div className="text-lg font-black text-indigo-700">{myReport?.scheduledEntries || 0}</div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-blue-600 font-bold uppercase">Updated ATS</div>
                        <div className="text-lg font-black text-blue-700">{myReport?.updatedInAts || 0}</div>
                      </div>
                      <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-center">
                        <div className="text-[10px] text-purple-600 font-bold uppercase">Updated Mail</div>
                        <div className="text-lg font-black text-purple-700">{myReport?.updatedInMail || 0}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Today's Read-Only Lead List */}
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Today's Assigned Lead List</h2>
                      <p className="text-xs text-slate-500">Read-only view of leads assigned for {selectedDate}</p>
                    </div>
                    {myList && (
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-bold text-xs">
                        Total Leads: {totalLeadsToday}
                      </span>
                    )}
                  </div>

                  {memberLoading ? (
                    <div className="p-12 text-center text-slate-400 text-sm animate-pulse">Loading assigned lead list...</div>
                  ) : !myList || !myList.leads || myList.leads.length === 0 ? (
                    <div className="p-12 text-center space-y-2 bg-slate-50/50">
                      <span className="material-symbols-outlined text-4xl text-slate-300">event_busy</span>
                      <div className="text-sm font-bold text-slate-700">No List Assigned For Today</div>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Your manager has not uploaded a lead list for {selectedDate} yet. Please check back later or notify your admin.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold text-[10px] tracking-wider">
                            <th className="p-4 w-12">#</th>
                            <th className="p-4">Name</th>
                            <th className="p-4">Phone Number</th>
                            {/* Dynamically render any additional lead fields */}
                            {displayedLeads[0]?.leadData &&
                              Object.keys(displayedLeads[0].leadData)
                                .filter((k) => k !== 'name' && k !== 'phone')
                                .map((k) => (
                                  <th key={k} className="p-4 capitalize">
                                    {k}
                                  </th>
                                ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {displayedLeads.map((item, idx) => {
                            const data = item.leadData || {};
                            const extraKeys = Object.keys(data).filter((k) => k !== 'name' && k !== 'phone');
                            return (
                              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-4 text-slate-400 font-bold">{idx + 1}</td>
                                <td className="p-4 font-bold text-slate-800">{data.name || '-'}</td>
                                <td className="p-4 font-mono font-semibold text-blue-600">{data.phone || '-'}</td>
                                {extraKeys.map((k) => (
                                  <td key={k} className="p-4 text-slate-600">
                                    {data[k] || '-'}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </Reveal>
          )}

          {/* Lead List Detail View Modal */}
          {viewingLeadList && (
            <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setViewingLeadList(null)} />
              <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">Lead List: {viewingLeadList.memberName}</h2>
                    <p className="text-xs text-slate-500">{viewingLeadList.totalLeads} leads assigned for {selectedDate}</p>
                  </div>
                  <button
                    onClick={() => setViewingLeadList(null)}
                    className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold text-[10px]">
                        <th className="p-3 w-10">#</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Phone</th>
                        {viewingLeadList.leads[0]?.leadData &&
                          Object.keys(viewingLeadList.leads[0].leadData)
                            .filter((k) => k !== 'name' && k !== 'phone')
                            .map((k) => (
                              <th key={k} className="p-3 capitalize">{k}</th>
                            ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingLeadList.leads.map((item, idx) => {
                        const data = item.leadData || {};
                        const extraKeys = Object.keys(data).filter((k) => k !== 'name' && k !== 'phone');
                        return (
                          <tr key={item.id}>
                            <td className="p-3 text-slate-400 font-bold">{idx + 1}</td>
                            <td className="p-3 font-bold text-slate-800">{data.name || '-'}</td>
                            <td className="p-3 font-mono text-blue-600 font-semibold">{data.phone || '-'}</td>
                            {extraKeys.map((k) => (
                              <td key={k} className="p-3 text-slate-600">{data[k] || '-'}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => setViewingLeadList(null)}
                    className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modals */}
          <React.Suspense fallback={null}>
            <MembersManagementModal
              isOpen={showMembersModal}
              onClose={() => setShowMembersModal(false)}
              onMembersUpdated={refreshAll}
            />
          </React.Suspense>

          <React.Suspense fallback={null}>
            <LeadListImportModal
              isOpen={Boolean(importMember)}
              onClose={() => setImportMember(null)}
              member={importMember}
              selectedDate={selectedDate}
              onUploadSuccess={refreshAll}
            />
          </React.Suspense>

          {reportModalData && (
            <React.Suspense fallback={null}>
              <WorkDoneReportModal
                isOpen={Boolean(reportModalData)}
                onClose={() => setReportModalData(null)}
                totalLeadsToday={reportModalData.totalLeadsToday}
                initialData={reportModalData.initialData}
                selectedDate={selectedDate}
                memberId={reportModalData.memberId}
                onReportSubmitted={refreshAll}
              />
            </React.Suspense>
          )}

          {attachmentModalData && (
            <MemberFileAttachmentModal
              memberId={attachmentModalData.memberId}
              memberName={attachmentModalData.memberName}
              initialFiles={attachmentModalData.files}
              selectedDate={selectedDate}
              onClose={() => setAttachmentModalData(null)}
              onRefresh={refreshAll}
            />
          )}
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
}


