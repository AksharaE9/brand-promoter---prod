import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../../components/EnterpriseLayout';
import { enterpriseNavItems, enterpriseFooterLinks } from '../../config/enterpriseNav';
import UserChip from '../../components/UserChip';
import { PageEnter } from '../../components/PageMotion';
import { apiGet, apiPost } from '../../lib/api';
import { useToast } from '../../hooks/useToast';

// ─── Date Grouping Helper ───────────────────────────────────────────────────
function getDateGroup(dateStr) {
  if (!dateStr) return 'Older';
  const itemDate = new Date(dateStr);
  const now = new Date();

  const isToday =
    itemDate.getDate() === now.getDate() &&
    itemDate.getMonth() === now.getMonth() &&
    itemDate.getFullYear() === now.getFullYear();

  if (isToday) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    itemDate.getDate() === yesterday.getDate() &&
    itemDate.getMonth() === yesterday.getMonth() &&
    itemDate.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return 'Yesterday';

  return itemDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: itemDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function QualityCheckPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('PENDING'); // PENDING | ON_HOLD | DECIDED
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Modal State
  const [modalType, setModalType] = useState(null); // 'APPROVE' | 'REJECT' | 'HOLD' | null
  const [targetItem, setTargetItem] = useState(null);
  const [ctcAmount, setCtcAmount] = useState('');
  const [ctcCurrency, setCtcCurrency] = useState('INR');
  const [ctcUnit, setCtcUnit] = useState('LPA'); // LPA | Per Annum | Per Month
  const [decisionNotes, setDecisionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Fetch Counts
  const { data: countData } = useQuery({
    queryKey: ['quality-checks', 'counts'],
    queryFn: () => apiGet('/quality-checks/counts'),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const counts = countData?.counts || { pending: 0, onHold: 0, decided: 0 };

  // 2. Fetch Queue items
  const {
    data: queueData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['quality-checks', 'list', activeTab, search],
    queryFn: () =>
      apiGet(
        `/quality-checks?status=${activeTab}&search=${encodeURIComponent(search)}&limit=100`,
      ),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const rawItems = queueData?.items || [];

  // Group items by day
  const groupedItems = useMemo(() => {
    const groups = {};
    for (const item of rawItems) {
      const g = getDateGroup(item.enteredQueueAt || item.createdAt);
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }
    return groups;
  }, [rawItems]);

  const flatItems = useMemo(() => {
    return rawItems;
  }, [rawItems]);

  // Open Decision Dialog
  const openDecisionModal = useCallback((item, type) => {
    setTargetItem(item);
    setModalType(type);
    setCtcAmount('');
    setCtcCurrency('INR');
    setCtcUnit('LPA');
    setDecisionNotes('');
  }, []);

  const closeDecisionModal = useCallback(() => {
    setModalType(null);
    setTargetItem(null);
    setCtcAmount('');
    setDecisionNotes('');
  }, []);

  // Submit Decision Mutation
  const decisionMutation = useMutation({
    mutationFn: async ({ id, decision, payload }) => {
      return apiPost(`/quality-checks/${id}/decision`, {
        decision,
        ...payload,
      });
    },
    onMutate: async ({ id, decision: _decision }) => {
      // Optimistic Update: Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['quality-checks'] });

      const previousQueue = queryClient.getQueryData([
        'quality-checks',
        'list',
        activeTab,
        search,
      ]);

      // Optimistically remove or update item in current list
      if (previousQueue?.items) {
        queryClient.setQueryData(
          ['quality-checks', 'list', activeTab, search],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.filter((i) => i.id !== id),
            };
          },
        );
      }

      return { previousQueue };
    },
    onError: (err, variables, context) => {
      if (context?.previousQueue) {
        queryClient.setQueryData(
          ['quality-checks', 'list', activeTab, search],
          context.previousQueue,
        );
      }
      toast.error(err.message || 'Failed to submit decision. Rolled back.');
    },
    onSuccess: (data, variables) => {
      const decisionName =
        variables.decision === 'APPROVED'
          ? 'Approved'
          : variables.decision === 'REJECTED'
          ? 'Rejected'
          : 'Put on Hold';
      toast.success(
        `Candidate successfully ${decisionName}${
          variables.payload.ctcAmount ? ` with CTC: ₹${variables.payload.ctcAmount} ${variables.payload.ctcUnit || ''}` : ''
        }`,
      );
      queryClient.invalidateQueries({ queryKey: ['quality-checks'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      closeDecisionModal();
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!targetItem || !modalType) return;

    if (modalType === 'APPROVE') {
      const numCtc = parseFloat(ctcAmount);
      if (!ctcAmount || isNaN(numCtc) || numCtc <= 0) {
        toast.error('Please provide a valid positive CTC amount.');
        return;
      }
    }

    if ((modalType === 'REJECT' || modalType === 'HOLD') && !decisionNotes.trim()) {
      toast.error('A brief reason is required.');
      return;
    }

    setIsSubmitting(true);
    const decisionCode =
      modalType === 'APPROVE'
        ? 'APPROVED'
        : modalType === 'REJECT'
        ? 'REJECTED'
        : 'ON_HOLD';

    const formattedCtc =
      modalType === 'APPROVE'
        ? ctcUnit === 'LPA'
          ? parseFloat(ctcAmount) * 100000
          : parseFloat(ctcAmount)
        : null;

    decisionMutation.mutate({
      id: targetItem.id,
      decision: decisionCode,
      payload: {
        ctcAmount: formattedCtc,
        ctcCurrency,
        ctcUnit,
        comments: decisionNotes,
      },
    });
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (modalType) {
        if (e.key === 'Escape') closeDecisionModal();
        return;
      }

      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(flatItems.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const cur = flatItems[selectedIndex];
        if (cur) {
          setExpandedId((prev) => (prev === cur.id ? null : cur.id));
        }
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const cur = flatItems[selectedIndex];
        if (cur && cur.status !== 'APPROVED') openDecisionModal(cur, 'APPROVE');
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        const cur = flatItems[selectedIndex];
        if (cur && cur.status !== 'ON_HOLD') openDecisionModal(cur, 'HOLD');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        const cur = flatItems[selectedIndex];
        if (cur && cur.status !== 'REJECTED') openDecisionModal(cur, 'REJECT');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flatItems, selectedIndex, modalType, closeDecisionModal, openDecisionModal]);

  return (
    <EnterpriseLayout
      sidebar={
        <EnterpriseSidebar
          active="quality-check"
          items={enterpriseNavItems}
          footerLinks={enterpriseFooterLinks}
        />
      }
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidate, phone, role..."
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          tabs={[]}
          right={<UserChip avatarSeed="quality-approver" />}
        />
      }
    >
      <PageEnter>
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-2xl">fact_check</span>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-[Manrope]">
                    Second Round Quality Check
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Evaluate interview outcomes, approve compensation (CTC), or place candidate on hold.
                  </p>
                </div>
              </div>
            </div>

            {/* Live refresh & keyboard helper */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200/60">
                <span className="font-semibold text-slate-600">Keys:</span>
                <span><kbd className="bg-white border rounded px-1 text-slate-600">↑/↓</kbd> Nav</span>
                <span><kbd className="bg-white border rounded px-1 text-slate-600">A</kbd> Approve</span>
                <span><kbd className="bg-white border rounded px-1 text-slate-600">H</kbd> Hold</span>
                <span><kbd className="bg-white border rounded px-1 text-slate-600">R</kbd> Reject</span>
              </div>

              <button
                onClick={() => refetch()}
                title="Refresh Queue"
                disabled={isFetching}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition flex items-center gap-1.5 text-xs font-medium border border-slate-200"
              >
                <span className={`material-symbols-outlined text-sm ${isFetching ? 'animate-spin text-indigo-600' : ''}`}>
                  refresh
                </span>
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200/80 pb-3 overflow-x-auto">
            <button
              onClick={() => {
                setActiveTab('PENDING');
                setSelectedIndex(0);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
                activeTab === 'PENDING'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>Pending Review</span>
              {counts.pending > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activeTab === 'PENDING'
                      ? 'bg-white text-indigo-700'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {counts.pending}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('APPROVED');
                setSelectedIndex(0);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
                activeTab === 'APPROVED'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>Approved</span>
              {counts.approved > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activeTab === 'APPROVED'
                      ? 'bg-white text-emerald-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {counts.approved}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('ON_HOLD');
                setSelectedIndex(0);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
                activeTab === 'ON_HOLD'
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>On Hold</span>
              {counts.onHold > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activeTab === 'ON_HOLD'
                      ? 'bg-white text-amber-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {counts.onHold}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('REJECTED');
                setSelectedIndex(0);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
                activeTab === 'REJECTED'
                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>Rejected</span>
              {counts.rejected > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activeTab === 'REJECTED'
                      ? 'bg-white text-rose-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {counts.rejected}
                </span>
              )}
            </button>
          </div>

          {/* Queue List Content */}
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="bg-white p-5 rounded-2xl border border-slate-100 animate-pulse space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="h-5 bg-slate-200 rounded w-1/4" />
                    <div className="h-5 bg-slate-200 rounded w-24" />
                  </div>
                  <div className="h-4 bg-slate-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : rawItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto mb-4 border border-slate-200">
                <span className="material-symbols-outlined text-3xl">task_alt</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800 font-[Manrope]">
                {activeTab === 'PENDING'
                  ? 'Nothing awaiting review'
                  : activeTab === 'APPROVED'
                  ? 'No approved candidates yet'
                  : activeTab === 'ON_HOLD'
                  ? 'No candidates on hold'
                  : 'No rejected records'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                {activeTab === 'PENDING'
                  ? 'All qualifying Round 2 / Final Round interview clearances have been processed.'
                  : activeTab === 'APPROVED'
                  ? 'Candidates approved by Quality Check will appear here.'
                  : activeTab === 'ON_HOLD'
                  ? 'Candidates placed on hold for further review will appear here.'
                  : 'Candidates rejected during quality check will appear here.'}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedItems).map(([groupTitle, items]) => (
                <div key={groupTitle} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {groupTitle}
                    </span>
                    <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                      {items.length}
                    </span>
                    <div className="flex-1 h-[1px] bg-slate-100" />
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => {
                      const flatIndex = flatItems.findIndex((x) => x.id === item.id);
                      const isSelected = selectedIndex === flatIndex;
                      const isExpanded = expandedId === item.id;
                      const cand = item.candidate || {};
                      const feedbacks = cand.interviewFeedbacks || [];
                      const latestFeedback =
                        feedbacks.find((f) => f.round === item.round) ||
                        feedbacks[feedbacks.length - 1] ||
                        {};

                      return (
                        <div
                          key={item.id}
                          className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden ${
                            isSelected
                              ? 'border-indigo-500 shadow-md ring-1 ring-indigo-500/20'
                              : 'border-slate-200 hover:border-slate-300 shadow-sm'
                          }`}
                        >
                          {/* Card Header Row */}
                          <div
                            onClick={() => {
                              setSelectedIndex(flatIndex);
                              setExpandedId(isExpanded ? null : item.id);
                            }}
                            className="p-5 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="flex items-start gap-3.5 flex-1 min-w-0">
                              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-base flex-shrink-0 border border-slate-200/60">
                                {cand.fullName ? cand.fullName.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-slate-900 text-base font-[Manrope]">
                                    {cand.fullName || 'Unnamed Candidate'}
                                  </span>
                                  {cand.preferredRole && (
                                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-medium">
                                      {cand.preferredRole}
                                    </span>
                                  )}
                                  {item.round && (
                                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-semibold border border-indigo-100">
                                      {item.round.replace('_', ' ')}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                                  {cand.phone && (
                                    <span className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[14px]">call</span>
                                      {cand.phone}
                                    </span>
                                  )}
                                  {cand.location && (
                                    <span className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[14px]">location_on</span>
                                      {cand.location}
                                    </span>
                                  )}
                                  {cand.company && (
                                    <span className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[14px]">domain</span>
                                      {cand.company}
                                    </span>
                                  )}
                                  <span className="text-slate-400">
                                    • Entered {formatRelativeTime(item.enteredQueueAt)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Ratings, Status & Actions */}
                            <div className="flex items-center gap-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                              {latestFeedback.overallRating !== undefined && latestFeedback.overallRating !== null && (
                                <div className="flex items-center gap-1 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-xl text-amber-900 font-bold text-xs">
                                  <span className="material-symbols-outlined text-amber-500 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                                    star
                                  </span>
                                  <span>{Number(latestFeedback.overallRating).toFixed(1)}/10</span>
                                </div>
                              )}

                              {item.status === 'APPROVED' && (
                                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-xl text-xs font-bold">
                                  <span className="material-symbols-outlined text-sm">check_circle</span>
                                  <span>Approved ({item.ctcAmount ? `₹${(item.ctcAmount / 100000).toFixed(2)} LPA` : 'Approved'})</span>
                                </div>
                              )}

                              {item.status === 'REJECTED' && (
                                <div className="flex items-center gap-1.5 bg-rose-50 text-rose-800 border border-rose-200 px-3 py-1 rounded-xl text-xs font-bold">
                                  <span className="material-symbols-outlined text-sm">cancel</span>
                                  <span>Rejected</span>
                                </div>
                              )}

                              {item.status === 'ON_HOLD' && (
                                <div className="flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-xl text-xs font-bold">
                                  <span className="material-symbols-outlined text-sm">pause_circle</span>
                                  <span>On Hold</span>
                                </div>
                              )}

                              {/* Decision Quick Buttons */}
                              {item.status === 'PENDING' && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => openDecisionModal(item, 'APPROVE')}
                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">check</span>
                                    <span>Approve</span>
                                  </button>

                                  <button
                                    onClick={() => openDecisionModal(item, 'HOLD')}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 rounded-xl text-xs font-bold transition flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">pause</span>
                                    <span>Hold</span>
                                  </button>

                                  <button
                                    onClick={() => openDecisionModal(item, 'REJECT')}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-800 rounded-xl text-xs font-bold transition flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">close</span>
                                    <span>Reject</span>
                                  </button>
                                </div>
                              )}

                              {item.status === 'ON_HOLD' && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => openDecisionModal(item, 'APPROVE')}
                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">check</span>
                                    <span>Approve</span>
                                  </button>
                                  <button
                                    onClick={() => openDecisionModal(item, 'REJECT')}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-800 rounded-xl text-xs font-bold transition flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">close</span>
                                    <span>Reject</span>
                                  </button>
                                </div>
                              )}

                              {item.status === 'APPROVED' && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => openDecisionModal(item, 'HOLD')}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-800 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                                    title="Move to Hold"
                                  >
                                    <span className="material-symbols-outlined text-xs">pause</span>
                                    <span>Hold</span>
                                  </button>
                                  <button
                                    onClick={() => openDecisionModal(item, 'REJECT')}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-800 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                                    title="Reject Candidate"
                                  >
                                    <span className="material-symbols-outlined text-xs">close</span>
                                    <span>Reject</span>
                                  </button>
                                </div>
                              )}

                              {item.status === 'REJECTED' && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => openDecisionModal(item, 'APPROVE')}
                                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1"
                                    title="Reconsider and Approve"
                                  >
                                    <span className="material-symbols-outlined text-xs">check</span>
                                    <span>Approve</span>
                                  </button>
                                  <button
                                    onClick={() => openDecisionModal(item, 'HOLD')}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-800 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                                    title="Move to Hold"
                                  >
                                    <span className="material-symbols-outlined text-xs">pause</span>
                                    <span>Hold</span>
                                  </button>
                                </div>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIndex(flatIndex);
                                  setExpandedId(isExpanded ? null : item.id);
                                }}
                                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition"
                              >
                                <span className="material-symbols-outlined text-lg">
                                  {isExpanded ? 'expand_less' : 'expand_more'}
                                </span>
                              </button>
                            </div>
                          </div>

                          {/* In-Place Expanded Detail */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-slate-50/70 p-6 space-y-6">
                              {/* Resume and Candidate Summary */}
                              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80">
                                <div className="flex items-center gap-4 text-xs">
                                  <div>
                                    <span className="text-slate-400 block font-medium">Experience</span>
                                    <span className="font-semibold text-slate-800">
                                      {cand.totalExperienceYears ? `${cand.totalExperienceYears} yrs` : 'Not specified'}
                                    </span>
                                  </div>
                                  <div className="w-[1px] h-6 bg-slate-200" />
                                  <div>
                                    <span className="text-slate-400 block font-medium">Current Company</span>
                                    <span className="font-semibold text-slate-800">
                                      {cand.currentCompany || 'N/A'}
                                    </span>
                                  </div>
                                  <div className="w-[1px] h-6 bg-slate-200" />
                                  <div>
                                    <span className="text-slate-400 block font-medium">Email</span>
                                    <span className="font-semibold text-slate-800">{cand.email || 'N/A'}</span>
                                  </div>
                                </div>

                                {cand.resumeLinkOriginal && (
                                  <a
                                    href={cand.resumeLinkOriginal}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition border border-indigo-100"
                                  >
                                    <span className="material-symbols-outlined text-sm">description</span>
                                    <span>View Resume</span>
                                  </a>
                                )}
                              </div>

                              {/* Interview Rounds & Feedback */}
                              <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Interview Evaluations & Verbatim Feedback
                                </h4>

                                {feedbacks.length === 0 ? (
                                  <p className="text-xs text-slate-400 italic">No feedback entries recorded.</p>
                                ) : (
                                  <div className="grid md:grid-cols-2 gap-4">
                                    {feedbacks.map((fb) => (
                                      <div
                                        key={fb.id}
                                        className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2 shadow-xs"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                            {fb.round.replace('_', ' ')}
                                          </span>
                                          <div className="flex items-center gap-2">
                                            {fb.overallRating !== null && fb.overallRating !== undefined && (
                                              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                                                ★ {Number(fb.overallRating).toFixed(1)}/10
                                              </span>
                                            )}
                                            <span
                                              className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                                                fb.selectionStatus === 'SELECTED'
                                                  ? 'bg-emerald-100 text-emerald-800'
                                                  : fb.selectionStatus === 'REJECTED'
                                                  ? 'bg-rose-100 text-rose-800'
                                                  : 'bg-amber-100 text-amber-800'
                                              }`}
                                            >
                                              {fb.selectionStatus}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="text-xs text-slate-600 pt-1 space-y-1">
                                          <div className="text-[11px] text-slate-400">
                                            Evaluated by {fb.submittedBy?.fullName || fb.submittedBy?.email || 'Panelist'} •{' '}
                                            {new Date(fb.createdAt).toLocaleDateString()}
                                          </div>

                                          {/* Feedback data fields */}
                                          {fb.feedbackData && typeof fb.feedbackData === 'object' && (
                                            <div className="mt-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1.5">
                                              {Object.entries(fb.feedbackData).map(([k, v]) => {
                                                if (['status', 'selectionStatus', 'overallRating'].includes(k)) return null;
                                                if (!v) return null;
                                                return (
                                                  <div key={k} className="leading-relaxed">
                                                    <span className="font-semibold text-slate-700 capitalize">
                                                      {k.replace(/([A-Z])/g, ' $1')}:{' '}
                                                    </span>
                                                    <span className="text-slate-600">
                                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Approver Decisions History */}
                              {item.decisions && item.decisions.length > 0 && (
                                <div className="space-y-2 pt-2 border-t border-slate-200/60">
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                    Quality Decision History
                                  </h4>
                                  <div className="space-y-1.5">
                                    {item.decisions.map((dec) => (
                                      <div
                                        key={dec.id}
                                        className="text-xs bg-white p-3 rounded-lg border border-slate-200/80 flex items-center justify-between"
                                      >
                                        <div>
                                          <span className="font-bold text-slate-800 mr-2">{dec.decision}</span>
                                          {dec.comments && <span className="text-slate-600 italic">"{dec.comments}"</span>}
                                          {dec.ctcAmount && (
                                            <span className="ml-2 font-semibold text-emerald-700">
                                              (CTC: ₹{(dec.ctcAmount / 100000).toFixed(2)} LPA)
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-slate-400">
                                          by {dec.decidedBy?.fullName || 'Approver'} on{' '}
                                          {new Date(dec.decidedAt).toLocaleString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Decision Modals ──────────────────────────────────────────────── */}
        {modalType && targetItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div
              className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`p-6 border-b ${
                  modalType === 'APPROVE'
                    ? 'bg-emerald-50/70 border-emerald-100'
                    : modalType === 'REJECT'
                    ? 'bg-rose-50/70 border-rose-100'
                    : 'bg-amber-50/70 border-amber-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white ${
                        modalType === 'APPROVE'
                          ? 'bg-emerald-600'
                          : modalType === 'REJECT'
                          ? 'bg-rose-600'
                          : 'bg-amber-600'
                      }`}
                    >
                      <span className="material-symbols-outlined">
                        {modalType === 'APPROVE' ? 'verified' : modalType === 'REJECT' ? 'cancel' : 'pause_circle'}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 font-[Manrope]">
                        {modalType === 'APPROVE'
                          ? 'Approve Candidate & Record CTC'
                          : modalType === 'REJECT'
                          ? 'Reject Candidate'
                          : 'Place Candidate on Hold'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {targetItem.candidate?.fullName || 'Candidate'} • {targetItem.candidate?.preferredRole || 'Role'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={closeDecisionModal}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleDecisionSubmit} className="p-6 space-y-4">
                {/* Approve CTC Capture */}
                {modalType === 'APPROVE' && (
                  <div className="space-y-3 bg-emerald-50/40 p-4 rounded-2xl border border-emerald-100/80">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Approved Compensation (CTC) <span className="text-rose-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                          ₹
                        </span>
                        <input
                          type="number"
                          step="any"
                          required
                          autoFocus
                          value={ctcAmount}
                          onChange={(e) => setCtcAmount(e.target.value)}
                          placeholder="e.g. 8.5 (for LPA) or 850000"
                          className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-hidden"
                        />
                      </div>

                      <select
                        value={ctcUnit}
                        onChange={(e) => setCtcUnit(e.target.value)}
                        className="py-2.5 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-hidden bg-white"
                      >
                        <option value="LPA">LPA (Lakhs/Yr)</option>
                        <option value="Fixed">Fixed Amount</option>
                      </select>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Recording the approved CTC makes this candidate eligible for offer letter issuance.
                    </p>
                  </div>
                )}

                {/* Reason / Notes */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    {modalType === 'APPROVE' ? 'Notes / Justification (Optional)' : 'Decision Reason'}
                    {(modalType === 'REJECT' || modalType === 'HOLD') && (
                      <span className="text-rose-500"> *</span>
                    )}
                  </label>
                  <textarea
                    rows={3}
                    required={modalType === 'REJECT' || modalType === 'HOLD'}
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder={
                      modalType === 'APPROVE'
                        ? 'e.g. Excellent technical performance in round 2, strong cultural fit...'
                        : modalType === 'REJECT'
                        ? 'e.g. Technical competency did not meet benchmark for this role...'
                        : 'e.g. Awaiting additional team panel review or budget confirmation...'
                    }
                    className="w-full p-3 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-hidden"
                  />
                </div>

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeDecisionModal}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5 ${
                      modalType === 'APPROVE'
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                        : modalType === 'REJECT'
                        ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                        : 'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
                    }`}
                  >
                    {isSubmitting && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                    <span>
                      {modalType === 'APPROVE'
                        ? 'Confirm Approval'
                        : modalType === 'REJECT'
                        ? 'Confirm Rejection'
                        : 'Put on Hold'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </PageEnter>
    </EnterpriseLayout>
  );
}
