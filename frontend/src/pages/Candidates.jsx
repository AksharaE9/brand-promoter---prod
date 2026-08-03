import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import Loader from '../components/Loader';
import { lazyWithRetry } from '../lib/lazyWithRetry';
// Lazy load modals to optimize Candidates page bundle size
const JoinModal = lazyWithRetry(() => import('../components/JoinModal'), 'JoinModal');
const RejectModal = lazyWithRetry(() => import('../components/RejectModal'), 'RejectModal');
const BulkUploadModal = lazyWithRetry(() => import('../components/BulkUpload/BulkUploadModal'), 'BulkUploadModal');
import { buildApiUrl, API_ROOT_URL, apiGet, apiPost, apiDelete, getStoredUser } from '../lib/api';
import { usePaginatedList } from '../hooks/usePaginatedList';
import InfiniteScrollSentinel from '../components/InfiniteScrollSentinel';
import { search as apiSearch } from '../lib/searchClient';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import CollegeDriveWorkspace from '../components/CollegeDriveWorkspace';
import Skeleton, { CardSkeleton } from '../components/Skeleton';
import { useDeleteCandidate, useAddCandidate } from '../hooks/useCandidateMutations';
import CompanyDropdownInput from '../components/CompanyDropdownInput';
import { companyApi } from '../services/companyApi';
import { MAX_UPLOAD_BYTES } from '../lib/uploadLimits';
import './OfferDecision.css';
import TruncatedText from '../components/TruncatedText';
import { PLACE_OPTIONS, matchesPlaceFilter } from '../lib/places';
import { ROLE_OPTIONS, matchesRoleFilter } from '../lib/roles';
import {
  DATE_FILTER_PRESETS,
  matchesDateFilter,
  dateFilterHint,
} from '../lib/dateFilter';

const initialForm = {
  fullName: '',
  email: '',
  phone: '',
  currentCompany: '',
  totalExperienceYears: '',
  source: '',
  category: 'Company',
  location: '',
  area: '',
  graduationYear: '',
  preferredRole: '',
  course: '',
  primarySkill: '',
  customFields: {},
};

const emptyCreateForm = {
  fullName: '',
  email: '',
  phone: '',
  course: '',
  location: '',
  preferredRole: '',
  company: '',   // ── NEW field ──
  source: '',
  resume: null
};

/* ─── OfferDecisionBadge ───────────────────────────────────────────────────── */
const OfferDecisionBadge = React.forwardRef(({ decision, decidedAt, dateOfJoining, rejectionReason }, ref) => {
  const isJoined = decision === 'JOINED';
  return (
    <div
      ref={ref}
      className={`decision-badge ${isJoined ? 'badge--joined' : 'badge--rejected'}`}
      tabIndex={-1}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {isJoined ? 'how_to_reg' : 'person_remove'}
      </span>
      <div className="badge-text">
        <span className="badge-label">{isJoined ? 'Joined' : 'Rejected'}</span>
        <span className="badge-sub">
          {isJoined
            ? dateOfJoining ? `DOJ: ${new Date(dateOfJoining).toLocaleDateString('en-IN')}` : new Date(decidedAt).toLocaleDateString('en-IN')
            : rejectionReason ? rejectionReason.replace(/_/g, ' ') : new Date(decidedAt).toLocaleDateString('en-IN')
          }
        </span>
      </div>
    </div>
  );
});
OfferDecisionBadge.displayName = 'OfferDecisionBadge';

/* ─── CandidateCard ────────────────────────────────────────────────────────── */
const CandidateCard = React.memo(({ candidate, canManageCandidates, onDelete, onNavigate, onUpdateStatus, isOfferSent }) => {
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [localDecision, setLocalDecision] = useState(candidate.offerDecision || null);
  const [localDecisionMeta, setLocalDecisionMeta] = useState({});
  const badgeRef = useRef(null);

  // Sync if parent updates
  useEffect(() => {
    setLocalDecision(candidate.offerDecision || null);
  }, [candidate.offerDecision]);

  const handleNavigation = useCallback((e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label') || e.target.closest('select')) return;
    onNavigate(candidate.id);
  }, [candidate.id, onNavigate]);

  const handleMouseEnter = useCallback(() => {
    // Prefetch candidate profile dossier
    apiGet(`/candidates/${candidate.id}`).catch(() => {});
  }, [candidate.id]);

  const initials = useMemo(() => (candidate.name || 'C')
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2), [candidate.name]);

  // Show action buttons ONLY on Offer Sent page for admins/recruiters.
  // This removes them from the general "All Candidates" pool view.
  const showActions = isOfferSent && canManageCandidates;

  const hasDecision = localDecision !== null && localDecision !== undefined;
  const isJoined = localDecision === 'JOINED';
  const isRejected = localDecision === 'REJECTED';

  const handleJoinConfirm = useCallback(async ({ dateOfJoining, notes }) => {
    setIsPending(true);
    try {
      // Optimistic update
      setLocalDecision('JOINED');
      setLocalDecisionMeta({ dateOfJoining, decidedAt: new Date().toISOString() });
      setShowJoinModal(false);
      await onUpdateStatus(candidate.applicationId, 'JOINED', dateOfJoining, notes, 'join');
      // Focus badge for accessibility
      setTimeout(() => badgeRef.current?.focus(), 100);
    } catch (err) {
      // Revert
      setLocalDecision(candidate.offerDecision || null);
      setLocalDecisionMeta({});
    } finally {
      setIsPending(false);
    }
  }, [candidate.applicationId, candidate.offerDecision, onUpdateStatus]);

  const handleRejectConfirm = useCallback(async ({ rejectionReason, notes }) => {
    setIsPending(true);
    try {
      setLocalDecision('REJECTED');
      setLocalDecisionMeta({ rejectionReason, decidedAt: new Date().toISOString() });
      setShowRejectModal(false);
      await onUpdateStatus(candidate.applicationId, 'REJECTED', null, notes, 'reject', rejectionReason);
      setTimeout(() => badgeRef.current?.focus(), 100);
    } catch (err) {
      setLocalDecision(candidate.offerDecision || null);
      setLocalDecisionMeta({});
    } finally {
      setIsPending(false);
    }
  }, [candidate.applicationId, candidate.offerDecision, onUpdateStatus]);

  return (
    <Reveal>
      <div
        className={`os-card p-5 hover:shadow-lg transition-all duration-300 cursor-pointer relative group flex flex-col hover:-translate-y-1 offer-candidate-row${isJoined ? ' row--joined' : ''}${isRejected ? ' row--rejected' : ''}`}
        onClick={handleNavigation}
        onMouseEnter={handleMouseEnter}
        style={{ minHeight: '160px' }}
      >
        {/* Delete button */}
        {canManageCandidates && !isPending && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(candidate.id, candidate.name); }}
            className="absolute top-3 right-3 z-20 p-1.5 text-[#6f7d98] hover:text-red-500 bg-white rounded-lg shadow-sm border border-[#e9eef4] opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Delete ${candidate.name}`}
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        )}

        {/* Card body */}
        <div className="flex items-center gap-4 flex-1">
          {candidate.profilePhotoUrl ? (
            <img 
              className="w-14 h-14 rounded-xl object-cover border border-[#e9eef4] flex-shrink-0" 
              src={candidate.profilePhotoUrl} 
              alt={candidate.name} 
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#1f52cc] to-[#3a7bd5] text-white flex items-center justify-center font-bold text-xl shadow-inner flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <TruncatedText as="h3" text={candidate.name} className="text-base font-bold font-[Manrope] text-[#0f1b3d] leading-tight pr-6" />
            <p className="text-sm text-[#1f52cc] font-semibold mt-0.5 truncate">{candidate.role}</p>
            {candidate.location && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-[#6f7d98] font-semibold truncate">
                <span className="material-symbols-outlined text-[11px] text-slate-400">location_on</span>
                <span className="truncate">{candidate.location}</span>
              </div>
            )}
            {candidate.source && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-[#6f7d98] font-bold uppercase tracking-wider">
                <span className="material-symbols-outlined text-[12px] text-[#1f52cc]">hub</span>
                {candidate.source}
              </div>
            )}
            {candidate.company && (
              <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold truncate" style={{ color: '#1f52cc' }}>
                <span className="material-symbols-outlined text-[11px]" style={{ color: '#1f52cc' }}>domain</span>
                <span className="truncate">{candidate.company}</span>
              </div>
            )}
            {candidate.joiningDate && (
              <div className="mt-2 inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                <span className="material-symbols-outlined text-[12px]">event_available</span>
                <span className="text-[9px] font-bold uppercase">Joining: {new Date(candidate.joiningDate).toLocaleDateString('en-IN')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action area at bottom — Always show footer for consistency */}
        <div className="mt-4 pt-3 border-t border-[#f0f4fa] flex flex-wrap items-center justify-between gap-3" onClick={e => e.stopPropagation()}>
          {showActions ? (
            hasDecision ? (
              <OfferDecisionBadge
                ref={badgeRef}
                decision={localDecision}
                decidedAt={localDecisionMeta.decidedAt || candidate.offerDecidedAt}
                dateOfJoining={localDecisionMeta.dateOfJoining || candidate.dateOfJoining}
                rejectionReason={localDecisionMeta.rejectionReason || candidate.rejectionReason}
              />
            ) : (
              <div className="offer-action-buttons">
                <button
                  className="btn-join"
                  onClick={(e) => { e.stopPropagation(); if (candidate.applicationId) setShowJoinModal(true); }}
                  disabled={isPending || !candidate.applicationId}
                  title={!candidate.applicationId ? 'No application linked to this candidate' : `Mark ${candidate.name} as joined`}
                  aria-label={`Mark ${candidate.name} as joined`}
                >
                  {isPending ? <span className="btn-spinner" /> : (
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>how_to_reg</span>
                  )}
                  Joined
                </button>
                <button
                  className="btn-reject-offer"
                  onClick={(e) => { e.stopPropagation(); if (candidate.applicationId) setShowRejectModal(true); }}
                  disabled={isPending || !candidate.applicationId}
                  title={!candidate.applicationId ? 'No application linked to this candidate' : `Reject offer for ${candidate.name}`}
                  aria-label={`Reject offer for ${candidate.name}`}
                >
                  {isPending ? <span className="btn-spinner" /> : (
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>person_remove</span>
                  )}
                  Reject
                </button>
              </div>
            )
          ) : (
            <div className="flex-1" /> /* Spacer for alignment */
          )}
          
          <button 
            className="os-btn-outline !h-8 !px-3 !text-[11px] !border-slate-200 hover:!bg-slate-50 !text-slate-600 hover:!text-[#1f52cc] hover:!border-[#1f52cc] transition-all"
            onClick={(e) => { e.stopPropagation(); onNavigate(candidate.id); }}
          >
            View Profile
          </button>
        </div>
      </div>

      {/* Modals rendered via portal */}
      {showJoinModal && (
        <React.Suspense fallback={null}>
          <JoinModal
            candidateName={candidate.name}
            jobTitle={candidate.role}
            isLoading={isPending}
            onConfirm={handleJoinConfirm}
            onCancel={() => setShowJoinModal(false)}
          />
        </React.Suspense>
      )}
      {showRejectModal && (
        <React.Suspense fallback={null}>
          <RejectModal
            candidateName={candidate.name}
            jobTitle={candidate.role}
            isLoading={isPending}
            onConfirm={handleRejectConfirm}
            onCancel={() => setShowRejectModal(false)}
          />
        </React.Suspense>
      )}
    </Reveal>
  );
});

const Candidates = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = useMemo(() => searchParams.get('status'), [searchParams]);
  const [items, setItems] = useState([]);
  const [viewMode, setViewMode] = useState('list');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(null);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('search') || '');
  const [totalCount, setTotalCount] = useState(0);
  const statusFilter = statusParam || 'All';
  const [roleFilter, setRoleFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [companyFilter, setCompanyFilter] = useState('All');     // ── NEW ──
  const [companyOptions, setCompanyOptions] = useState([]);      // ── NEW ──
  const [dateFilter, setDateFilter] = useState('All');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState(null);
  const scrollContainerRef = useRef(null); // scrollable os-content element

  const currentUser = useMemo(() => getStoredUser(), []);
  const canManageCandidates = useMemo(() => ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'].includes(currentUser?.role), [currentUser]);
  const isSuperAdmin = useMemo(() => currentUser?.role === 'SUPER_ADMIN', [currentUser]);

  // Delete all candidates (SUPER_ADMIN only)
  const candidatesFilters = useMemo(() => ({
    ...(statusFilter && statusFilter !== 'All' ? { status: statusFilter } : {}),
    ...(companyFilter && companyFilter !== 'All' ? { company: companyFilter } : {}),
    ...(debouncedSearch && debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
  }), [statusFilter, companyFilter, debouncedSearch]);

  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    error: queryError,
  } = usePaginatedList('/candidates', {
    pageSize: 100,
    filters: candidatesFilters,
    queryKey: ['candidates', 'pool'],
  });

  const loading = isLoading;

  // Synchronize infinite query data to items local state
  useEffect(() => {
    if (infiniteData?.pages) {
      const flattened = infiniteData.pages.flatMap(page => page.data || page.rows || []);
      setItems(flattened);
      
      // Also sync totalCount for the count rendering
      const firstPage = infiniteData.pages[0];
      setTotalCount(firstPage?.pagination?.total || flattened.length);
    } else {
      setItems([]);
    }
  }, [infiniteData]);

  // Handle query error
  useEffect(() => {
    if (queryError) {
      setError(queryError.message || 'Failed to load candidates.');
    }
  }, [queryError]);

  const loadCandidates = useCallback((query, stat) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (stat !== undefined) {
        if (stat === 'All') {
          next.delete('status');
        } else {
          next.set('status', stat);
        }
      }
      if (query !== undefined) {
        if (!query.trim()) {
          next.delete('search');
        } else {
          next.set('search', query.trim());
        }
      }
      return next;
    });

    if (query !== undefined && query !== debouncedSearch) {
      setSearch(query);
      setDebouncedSearch(query);
    }
    refetch();
  }, [debouncedSearch, refetch, setSearchParams]);

  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to DELETE ALL candidates? This cannot be undone!')) return;
    if (!window.confirm('This will permanently remove ALL candidates from the database. Continue?')) return;

    try {
      const res = await apiDelete('/candidates/all');
      if (res.success) {
        setBanner(`Deleted all candidates: ${res.message}`);
        loadCandidates('', 'All');
      } else {
        setError(res.message || 'Failed to delete candidates');
      }
    } catch (err) {
      setError(err.message || 'Failed to delete candidates');
    }
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // statusFilter is now derived directly from URL statusParam

  // Reset role/location filter AND scroll to top on section change
  useEffect(() => {
    setRoleFilter('All');
    setLocationFilter('All');
    // Scroll back to top of the content container
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    } else {
      // Fallback: find the os-content element
      document.querySelector('.os-content')?.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [statusFilter]);

  // Load company options for the filter dropdown
  useEffect(() => {
    companyApi.list()
      .then(res => setCompanyOptions(res.data || []))
      .catch(() => {});
  }, []);

  // Initialize scrollContainerRef on mount
  useEffect(() => {
    scrollContainerRef.current = document.querySelector('.os-content');
  }, []);



  const handleNavigate = useCallback((id) => navigate(`/candidate/${id}`), [navigate]);
  
  const onUpdateStatus = useCallback(async (applicationId, status, joiningDate = null, notes = null, action = 'status', rejectionReason = null) => {
    // Optimistic: remove from OFFER_SENT filter view instantly
    setItems(prev => {
      if (statusFilter !== 'All' && status !== statusFilter) {
        return prev.filter(c => !c.applications?.some(a => a.id === applicationId));
      }
      return prev.map(c => {
        if (c.applications?.some(a => a.id === applicationId)) {
          return {
            ...c,
            applications: c.applications.map(a =>
              a.id === applicationId
                ? { ...a, status, joiningDate, offerDecision: status === 'JOINED' ? 'JOINED' : status === 'REJECTED' ? 'REJECTED' : null }
                : a
            )
          };
        }
        return c;
      });
    });

    try {
      let res;
      if (action === 'join') {
        res = await fetch(buildApiUrl(`/applications/${applicationId}/join`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
          },
          body: JSON.stringify({ dateOfJoining: joiningDate, notes }),
        });
      } else if (action === 'reject') {
        // Use the new /reject endpoint
        res = await fetch(buildApiUrl(`/applications/${applicationId}/reject`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
          },
          body: JSON.stringify({ rejectionReason: rejectionReason || 'OTHER', notes }),
        });
      } else {
        // Legacy PATCH for other status changes
        res = await fetch(buildApiUrl(`/applications/${applicationId}/status`), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
          },
          body: JSON.stringify({ status, joiningDate }),
        });
      }

      const json = await res.json();
      if (!res.ok || !json.success) {
        const errMsg = json.message || 'Failed to update status';
        if (res.status === 409) {
          // Already decided — sync with server
          loadCandidates(debouncedSearch, statusFilter);
        }
        throw new Error(errMsg);
      }

      setBanner(`Candidate marked as ${status}.`);
      setTimeout(() => setBanner(''), 3000);
    } catch (err) {
      setError(err.message);
      loadCandidates(debouncedSearch, statusFilter);
      setTimeout(() => setError(''), 3000);
      throw err; // re-throw so card can revert optimistic state
    }
  }, [debouncedSearch, statusFilter, loadCandidates]);

  // Snapshot ref for delete rollback
  const itemsSnapshotRef = useRef([]);

  const { deleteCandidate, isDeletingId } = useDeleteCandidate({
    onOptimisticRemove: (id) => {
      // Capture snapshot before removing so we can rollback
      itemsSnapshotRef.current = items;
      setItems(prev => prev.filter(c => c.id !== id));
    },
    onRollback: () => {
      // Restore from snapshot
      setItems(itemsSnapshotRef.current);
    },
    onError: (err) => {
      setError(err.message || 'Failed to delete candidate');
      setTimeout(() => setError(''), 3000);
    },
    onSuccess: () => {
      refetch();
    }
  });

  const onDeleteCandidate = useCallback(async (id, name) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    await deleteCandidate(id);
  }, [deleteCandidate]);

  const { addCandidate, isAdding } = useAddCandidate({
    onOptimisticAdd: (tempCandidate) => {
      setItems(prev => [tempCandidate, ...prev]);
    },
    onReplace: (tempId, realCandidate) => {
      setItems(prev => prev.map(c => c.id === tempId ? realCandidate : c));
    },
    onRollback: (tempId) => {
      setItems(prev => prev.filter(c => c.id !== tempId));
    },
    onSuccess: () => {
      setBanner('Candidate created successfully!');
      setTimeout(() => setBanner(''), 3000);
      refetch();
    },
    onError: (err) => {
      setError(err.message || 'Failed to create candidate');
      setTimeout(() => setError(''), 3000);
    },
  });


  const allMapped = useMemo(() => items.map(c => {
    const matchedApp = c.applications?.find(a => a.status === statusFilter) || c.applications?.[0];
    const jobTitle = matchedApp?.job?.title;
    return {
      id: c.id,
      name: c.fullName,
      role: jobTitle || c.preferredRole || 'Candidate',
      location: c.location || c.area || '',
      company: c.company || '',       // ── NEW field ──
      profilePhotoUrl: c.profilePhotoFile?.storageKey || null,
      resumeUrl: c.resumeFile?.storageKey || null,
      status: matchedApp?.status || 'POOL',
      applicationId: matchedApp?.id || null,
      joiningDate: matchedApp?.joiningDate || matchedApp?.dateOfJoining || c.doj || null,
      // Offer decision fields
      offerDecision: matchedApp?.offerDecision || c.offerDecision || null,
      offerDecidedAt: matchedApp?.offerDecidedAt || null,
      dateOfJoining: matchedApp?.dateOfJoining || matchedApp?.joiningDate || c.doj || null,
      doj: c.doj || null,
      rejectionReason: matchedApp?.rejectionReason || null,
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      appCreatedAt: matchedApp?.createdAt || null,
      appUpdatedAt: matchedApp?.updatedAt || null,
    };
  }), [items, statusFilter]);

  // Unique roles and locations for filter dropdowns
  const visibleCandidates = useMemo(() => {
    let list = allMapped;
    if (roleFilter !== 'All') list = list.filter(c => matchesRoleFilter(c.role, roleFilter));
    if (locationFilter !== 'All') list = list.filter(c => matchesPlaceFilter(c.location, locationFilter));
    if (dateFilter !== 'All' || customDateFrom || customDateTo) {
      list = list.filter(c =>
        matchesDateFilter(c, statusFilter, dateFilter, customDateFrom, customDateTo)
      );
    }
    return list;
  }, [allMapped, roleFilter, locationFilter, dateFilter, customDateFrom, customDateTo, statusFilter]);

  const clearAllFilters = useCallback(() => {
    setRoleFilter('All');
    setLocationFilter('All');
    setCompanyFilter('All');
    setDateFilter('All');
    setCustomDateFrom('');
    setCustomDateTo('');
  }, []);

  const hasActiveFilters =
    roleFilter !== 'All' ||
    locationFilter !== 'All' ||
    companyFilter !== 'All' ||
    dateFilter !== 'All' ||
    Boolean(customDateFrom) ||
    Boolean(customDateTo);

  const pageTitle = useMemo(() => {
    if (statusFilter === 'OFFER_SENT') return 'Offer Sent Registry';
    if (statusFilter === 'JOINED') return 'Joined Candidates';
    if (statusFilter === 'REJECTED') return 'Rejected Candidates';
    return 'Candidate Pool';
  }, [statusFilter]);

  const pageSub = useMemo(() => {
    if (statusFilter === 'OFFER_SENT') return 'Manage candidates who have received formal offers';
    if (statusFilter === 'JOINED') return 'Onboarded talent and successful hires';
    if (statusFilter === 'REJECTED') return 'Directory of past applicants and rejected profiles';
    return 'Manage and track your global talent community';
  }, [statusFilter]);

  const activeNavKey = useMemo(() => {
    if (statusFilter === 'OFFER_SENT') return 'passed';
    if (statusFilter === 'JOINED') return 'joined';
    if (statusFilter === 'REJECTED') return 'rejected';
    return 'candidates';
  }, [statusFilter]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const days = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month - 1, prevMonthDays - i), isCurrentMonth: false });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [currentMonth]);

  const joiningMap = useMemo(() => {
    const map = {};
    visibleCandidates.forEach(c => {
      if (!c.joiningDate) return;
      const d = new Date(c.joiningDate);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [visibleCandidates]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active={activeNavKey} items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={<EnterpriseTopbar searchPlaceholder="Search pool..." searchValue={search} onSearchChange={e => setSearch(e.target.value)} tabs={[]} right={<UserChip avatarSeed="candidates" />} />}
    >
      <PageEnter>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="os-h1">{pageTitle}</h1>
            <p className="text-xs text-slate-500 mt-1">{pageSub}</p>
          </div>
          <div className="flex items-center gap-3">
            {loading && <Loader size="small" message="" />}
            
            {statusFilter === 'JOINED' && (
              <div className="flex bg-slate-100 p-1 rounded-xl mr-2">
                <button 
                  onClick={() => setViewMode('list')}
                  className={`px-4 h-9 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'list' ? 'bg-white text-[#1f52cc] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <span className="material-symbols-outlined text-sm">list</span> List
                </button>
                <button 
                  onClick={() => setViewMode('grid')}
                  className={`px-4 h-9 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'grid' ? 'bg-white text-[#1f52cc] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <span className="material-symbols-outlined text-sm">calendar_view_month</span> Grid
                </button>
              </div>
            )}

            {canManageCandidates && (
              <div className="flex gap-2">
                <button
                  className="os-btn-outline flex items-center gap-2 !h-11 bg-white border-[#e4ebf1] text-[#142651] hover:bg-slate-50 shadow-sm"
                  onClick={() => setShowBulkModal(true)}
                >
                  <span className="material-symbols-outlined text-base">upload_file</span>
                  Bulk Upload
                </button>
                <button
                  className="os-btn-primary flex items-center gap-2 !h-11 shadow-lg shadow-blue-100"
                  onClick={() => setShowCreateModal(true)}
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  Add Candidate
                </button>
              </div>
            )}

          </div>
        </div>

        {banner && <div className="os-card p-3 mb-4 text-blue-600 bg-blue-50 border-blue-100 text-sm animate-in fade-in slide-in-from-top-2">{banner}</div>}
        {error && <div className="os-card p-3 mb-4 text-red-600 bg-red-50 border-red-100 text-sm animate-in fade-in slide-in-from-top-2">{error}</div>}

        {/* Role & Location filters (available across all candidate registries) */}
        {(ROLE_OPTIONS.length > 0 || PLACE_OPTIONS.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 mb-5 p-3.5 bg-white border border-[#e9eef4] rounded-2xl shadow-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Filter by</span>

            {/* Role filter — fixed canonical roles only */}
            <div className="relative flex items-center">
              <span className="material-symbols-outlined text-[14px] text-[#1f52cc] absolute left-2.5 pointer-events-none">work</span>
              <select
                className="h-9 pl-8 pr-8 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100 appearance-none transition-all cursor-pointer"
                value={roleFilter}
                onChange={e => { setRoleFilter(e.target.value); }}
              >
                <option value="All">All Roles</option>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className="material-symbols-outlined text-[12px] text-slate-400 absolute right-2 pointer-events-none">expand_more</span>
            </div>

            {/* Location filter — fixed canonical places only */}
            <div className="relative flex items-center">
              <span className="material-symbols-outlined text-[14px] text-[#1f52cc] absolute left-2.5 pointer-events-none">location_on</span>
              <select
                className="h-9 pl-8 pr-8 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100 appearance-none transition-all cursor-pointer"
                value={locationFilter}
                onChange={e => { setLocationFilter(e.target.value); }}
              >
                <option value="All">All Places</option>
                {PLACE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="material-symbols-outlined text-[12px] text-slate-400 absolute right-2 pointer-events-none">expand_more</span>
            </div>

            {/* Company filter */}
            {companyOptions.length > 0 && (
              <div className="relative flex items-center">
                <span className="material-symbols-outlined text-[14px] text-[#1f52cc] absolute left-2.5 pointer-events-none">domain</span>
                <select
                  className="h-9 pl-8 pr-8 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100 appearance-none transition-all cursor-pointer"
                  value={companyFilter}
                  onChange={e => { setCompanyFilter(e.target.value); }}
                >
                  <option value="All">All Companies</option>
                  {companyOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <span className="material-symbols-outlined text-[12px] text-slate-400 absolute right-2 pointer-events-none">expand_more</span>
              </div>
            )}

            {/* Date filter — tab-aware (joining / selection / created) */}
            <div className="relative flex items-center gap-2">
              <div className="relative flex items-center">
                <span className="material-symbols-outlined text-[14px] text-[#1f52cc] absolute left-2.5 pointer-events-none">calendar_month</span>
                <select
                  className="h-9 pl-8 pr-8 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100 appearance-none transition-all cursor-pointer"
                  value={dateFilter}
                  onChange={e => {
                    const next = e.target.value;
                    setDateFilter(next);
                    if (next !== 'Custom') {
                      setCustomDateFrom('');
                      setCustomDateTo('');
                    }
                  }}
                  title={dateFilterHint(statusFilter)}
                >
                  {DATE_FILTER_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined text-[12px] text-slate-400 absolute right-2 pointer-events-none">expand_more</span>
              </div>
              {dateFilter === 'Custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    className="h-9 px-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100"
                    value={customDateFrom}
                    onChange={e => setCustomDateFrom(e.target.value)}
                    title="From date"
                  />
                  <span className="text-[10px] text-slate-400 font-bold">to</span>
                  <input
                    type="date"
                    className="h-9 px-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white outline-none focus:border-[#1f52cc] focus:ring-2 focus:ring-blue-100"
                    value={customDateTo}
                    onChange={e => setCustomDateTo(e.target.value)}
                    title="To date"
                  />
                </div>
              )}
              <span className="hidden lg:inline text-[9px] text-slate-400 font-medium whitespace-nowrap">
                {dateFilterHint(statusFilter)}
              </span>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                className="h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all flex items-center gap-1"
                onClick={clearAllFilters}
              >
                <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
                Clear
              </button>
            )}

            <span className="ml-auto text-[10px] text-slate-400 font-semibold">
              {visibleCandidates.length} candidate{visibleCandidates.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <CardSkeleton key={i} />)}
          </div>
        ) : searchError ? (
          <div className="py-20 text-center os-card border-red-100 bg-red-50/20">
            <div className="text-red-600 mb-3 font-semibold">{searchError}</div>
            <button className="os-btn-primary" onClick={() => fetchCandidates({ reset: true })}>Retry Search</button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center os-card">
            {statusFilter === 'JOINED' ? (
              <>
                <div className="text-slate-500 mb-2 font-semibold">No joined candidates yet.</div>
                <p className="text-sm text-slate-400 max-w-md mx-auto mb-5">
                  Candidates appear here after you mark them as Joined from Offer Sent, or when you add them with + Add Candidate on this page.
                </p>
                {canManageCandidates && (
                  <button className="os-btn-primary" type="button" onClick={() => setShowCreateModal(true)}>
                    + Add Joined Candidate
                  </button>
                )}
              </>
            ) : statusFilter === 'OFFER_SENT' ? (
              <>
                <div className="text-slate-400 mb-2">No offer-sent candidates found.</div>
                <button className="os-btn-outline" onClick={() => { setSearch(''); clearAllFilters(); }}>Clear Filters</button>
              </>
            ) : (
              <>
                <div className="text-slate-400 mb-2">No candidates found matching your criteria.</div>
                <button className="os-btn-outline" onClick={() => { setSearch(''); setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('status'); next.delete('search'); return next; }); }}>Clear Filters</button>
              </>
            )}
          </div>
        ) : viewMode === 'grid' && statusFilter === 'JOINED' ? (
          <>
            {/* Calendar Grid */}
            <div className="os-card p-0 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="p-5 border-b border-[#e4ebf1] flex justify-between items-center bg-[#fcfdfe]">
                <h2 className="text-lg font-bold text-[#142651]">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { const d = new Date(currentMonth); d.setMonth(d.getMonth() - 1); setCurrentMonth(d); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-[#e4ebf1] text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <button onClick={() => setCurrentMonth(new Date())} className="px-4 h-9 rounded-xl bg-white border border-[#e4ebf1] text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">Today</button>
                  <button
                    onClick={() => { const d = new Date(currentMonth); d.setMonth(d.getMonth() + 1); setCurrentMonth(d); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-[#e4ebf1] text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 bg-[#f8fafc] border-b border-[#e4ebf1]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="py-3 text-center text-[10px] font-bold uppercase text-slate-400 tracking-wider border-r border-[#e4ebf1] last:border-r-0">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => {
                  const key = `${day.date.getFullYear()}-${day.date.getMonth()}-${day.date.getDate()}`;
                  const joinings = joiningMap[key] || [];
                  const isToday = new Date().toDateString() === day.date.toDateString();
                  const isSelected = selectedCalendarDay?.key === key;

                  return (
                    <div
                      key={idx}
                      className={`min-h-[120px] p-3 border-r border-b border-[#e4ebf1] relative transition-all cursor-pointer
                        ${!day.isCurrentMonth ? 'bg-slate-50/60 opacity-40 pointer-events-none' : 'bg-white hover:bg-emerald-50/30'}
                        ${isSelected ? 'ring-2 ring-inset ring-emerald-500 bg-emerald-50/40' : ''}`}
                      onClick={() => {
                        if (!day.isCurrentMonth) return;
                        setSelectedCalendarDay(isSelected ? null : { key, date: day.date, joinings });
                      }}
                    >
                      <span className={`text-xs font-bold inline-flex items-center justify-center w-6 h-6 rounded-lg
                        ${isToday ? 'bg-[#1f52cc] text-white shadow-md' : 'text-slate-400'}`}>
                        {day.date.getDate()}
                      </span>

                      {joinings.length > 0 && (
                        <div className="mt-2">
                          <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold">
                            <span className="material-symbols-outlined text-[12px]">group</span>
                            {joinings.length}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day Detail Popover */}
            {selectedCalendarDay && (
              <div className="os-card p-0 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="p-5 border-b border-[#e4ebf1] flex justify-between items-center bg-emerald-50/50">
                  <div>
                    <h3 className="text-base font-bold text-[#142651]">
                      {selectedCalendarDay.date.toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </h3>
                    <p className="text-xs text-emerald-700 font-semibold mt-0.5">
                      {selectedCalendarDay.joinings.length} candidate{selectedCalendarDay.joinings.length !== 1 ? 's' : ''} joining
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedCalendarDay(null)}
                    className="w-9 h-9 rounded-xl bg-white border border-[#e4ebf1] flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {selectedCalendarDay.joinings.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-[#e4ebf1] shadow-sm hover:shadow-md hover:border-emerald-200 transition-all group">
                      {c.profilePhotoUrl ? (
                        <img src={c.profilePhotoUrl} alt={c.name} className="w-11 h-11 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {(c.name || 'C').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <TruncatedText as="p" text={c.name} className="text-sm font-bold text-[#142651]" />
                        <p className="text-xs text-[#1f52cc] font-semibold truncate">{c.role}</p>
                        {c.location && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#6f7d98] font-semibold truncate">
                            <span className="material-symbols-outlined text-[11px] text-slate-400">location_on</span>
                            <span className="truncate">{c.location}</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleNavigate(c.id)}
                        className="w-9 h-9 rounded-xl bg-[#f0f5ff] border border-[#c7d8ff] flex items-center justify-center text-[#1f52cc] hover:bg-[#1f52cc] hover:text-white transition-all flex-shrink-0"
                        title="View Profile"
                      >
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {visibleCandidates.map((c) => (
                <CandidateCard 
                  key={c.id}
                  candidate={c} 
                  onNavigate={handleNavigate} 
                  onDelete={onDeleteCandidate} 
                  onUpdateStatus={onUpdateStatus}
                  canManageCandidates={canManageCandidates}
                  isOfferSent={statusFilter === 'OFFER_SENT'}
                />
              ))}
            </div>
            <InfiniteScrollSentinel
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
            {!hasNextPage && items.length > 0 && (
              <p className="text-xs text-slate-400 font-medium text-center mt-6 w-full">All {totalCount > 0 ? totalCount : items.length} candidates loaded</p>
            )}
          </>
        )}
      </PageEnter>

      <React.Suspense fallback={null}>
        <BulkUploadModal 
          isOpen={showBulkModal} 
          onClose={() => setShowBulkModal(false)} 
          onImportComplete={() => loadCandidates(debouncedSearch, statusFilter)} 
        />
      </React.Suspense>

      {/* CREATE CANDIDATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowCreateModal(false)} />
          <Reveal className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-[#0f1b3d] font-[Manrope]">Create New Candidate</h2>
                  <p className="text-sm text-slate-500 mt-1">Enter candidate details and upload their profile</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowCreateModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form className="space-y-5" onSubmit={async (e) => {
                e.preventDefault();
                if (isAdding) return;

                if (!createForm.resume) {
                  setError('Resume is required. Upload a PDF or Word document to create the candidate.');
                  setTimeout(() => setError(''), 4000);
                  return;
                }

                const formData = new FormData();
                formData.append('fullName', createForm.fullName);
                formData.append('email', createForm.email);
                formData.append('phone', createForm.phone);
                formData.append('course', createForm.course);
                formData.append('location', createForm.location);
                formData.append('preferredRole', createForm.preferredRole);
                formData.append('company', createForm.company?.trim() || 'Akshara Enterprises'); // ── NEW ──
                formData.append('source', createForm.source || 'Manual Entry');
                if (statusFilter && statusFilter !== 'All') {
                  formData.append('status', statusFilter);
                }
                formData.append('resume', createForm.resume);

                // Close modal and clear form INSTANTLY (optimistic UX)
                setShowCreateModal(false);
                setCreateForm(emptyCreateForm);

                // The hook will prepend a ghost card to items[], then swap in real data
                await addCandidate(formData, {
                  fullName: createForm.fullName,
                  email: createForm.email,
                  phone: createForm.phone,
                  course: createForm.course,
                  location: createForm.location,
                  preferredRole: createForm.preferredRole,
                  company: createForm.company?.trim() || 'Akshara Enterprises', // ── NEW ──
                  source: createForm.source || 'Manual Entry',
                  status: statusFilter && statusFilter !== 'All' ? statusFilter : 'ACTIVE',
                });
              }}>
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Full Name *</label>
                    <input 
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. John Doe"
                      required
                      value={createForm.fullName}
                      onChange={e => setCreateForm(prev => ({...prev, fullName: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Email Address</label>
                    <input 
                      type="email"
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. john@example.com"
                      value={createForm.email}
                      onChange={e => setCreateForm(prev => ({...prev, email: e.target.value}))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Phone Number *</label>
                    <input 
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. +91 98765 43210"
                      required
                      value={createForm.phone}
                      onChange={e => setCreateForm(prev => ({...prev, phone: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Current Course</label>
                    <input 
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. B.Tech CSE"
                      value={createForm.course}
                      onChange={e => setCreateForm(prev => ({...prev, course: e.target.value}))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Location</label>
                    <input 
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. Bangalore, KA"
                      value={createForm.location}
                      onChange={e => setCreateForm(prev => ({...prev, location: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Preferred Role</label>
                    <input 
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all" 
                      placeholder="e.g. Frontend Developer"
                      value={createForm.preferredRole}
                      onChange={e => setCreateForm(prev => ({...prev, preferredRole: e.target.value}))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Company</label>
                    <CompanyDropdownInput
                      value={createForm.company}
                      onChange={val => setCreateForm(prev => ({...prev, company: val}))}
                      placeholder="e.g. Akshara Enterprises"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Source</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                      placeholder="e.g. LinkedIn, Referral, Direct"
                      value={createForm.source}
                      onChange={e => setCreateForm(prev => ({...prev, source: e.target.value}))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">
                    Resume / Profile Document <span className="text-red-500">*</span>
                  </label>
                  <div className="relative group">
                    <input 
                      type="file"
                      className="hidden"
                      id="resume-upload"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      required
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file && file.size > MAX_UPLOAD_BYTES) {
                          alert('File exceeds the 10 MB limit. Split it into smaller files if needed.');
                          e.target.value = '';
                          setCreateForm(prev => ({...prev, resume: null}));
                          return;
                        }
                        setCreateForm(prev => ({...prev, resume: file || null}));
                      }}
                    />
                    <label 
                      htmlFor="resume-upload"
                      className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-[24px] cursor-pointer transition-all ${
                        createForm.resume
                          ? 'border-[#1f52cc] bg-blue-50/40'
                          : 'border-slate-200 hover:border-[#1f52cc] hover:bg-blue-50/30'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-3xl transition-all ${createForm.resume ? 'text-[#1f52cc]' : 'text-slate-400 group-hover:text-[#1f52cc] group-hover:scale-110'}`}>
                        {createForm.resume ? 'description' : 'upload_file'}
                      </span>
                      <span className="text-xs text-slate-500 mt-2 font-medium px-4 text-center">
                        {createForm.resume ? createForm.resume.name : 'Click to upload PDF or Word document (required)'}
                      </span>
                    </label>
                  </div>
                  {!createForm.resume && (
                    <p className="text-[11px] text-slate-400 ml-1">A resume is required before HR can create the candidate.</p>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button type="button" className="flex-1 h-12 rounded-2xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button
                    type="submit"
                    className="flex-1 h-12 rounded-2xl bg-[#1f52cc] text-white font-bold shadow-lg shadow-blue-200 hover:bg-[#1844b0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isAdding || !createForm.resume}
                    title={!createForm.resume ? 'Upload a resume to create the candidate' : undefined}
                  >
                    {isAdding ? 'Creating...' : 'Create Candidate'}
                  </button>
                </div>
              </form>
            </div>
          </Reveal>
        </div>
      )}
    </EnterpriseLayout>
  );
};

export default Candidates;
