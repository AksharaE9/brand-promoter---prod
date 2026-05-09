import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, apiPatch, apiPost, getStoredUser, API_BASE_URL } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import JoinModal from '../components/JoinModal';
import RejectModal from '../components/RejectModal';
import './OfferDecision.css';

const emptyApplicationForm = {
  candidateId: '',
  jobId: '',
};

const emptyStageForm = {
  name: '',
  sortOrder: '',
  isTerminal: false,
  jobId: '',
};

const Pipeline = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const jobFilterId = query.get('jobId') || '';
  const candidateFilterId = query.get('candidateId') || '';

  const [viewMode, setViewMode] = useState('board'); // 'board' or 'table'
  const [stages, setStages] = useState([]);
  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedStages, setSelectedStages] = useState({});
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [loading, setLoading] = useState(true);
  const [moveRemarks, setMoveRemarks] = useState({});
  const [movingId, setMovingId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showStageCreate, setShowStageCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryModalTitle, setSummaryModalTitle] = useState('');
  const [summaryModalItems, setSummaryModalItems] = useState([]);
  const [applicationForm, setApplicationForm] = useState(emptyApplicationForm);
  const [stageForm, setStageForm] = useState({
    ...emptyStageForm,
    jobId: jobFilterId || '',
  });
  const [expandedHistory, setExpandedHistory] = useState({});
  const [historyByApp, setHistoryByApp] = useState({});
  const currentUser = getStoredUser();
  const canMovePipeline = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'].includes(currentUser?.role);
  const canCreateApplication = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  const loadAll = async () => {
    const appQuery = [
      'limit=200',
      jobFilterId ? `jobId=${encodeURIComponent(jobFilterId)}` : '',
      candidateFilterId ? `candidateId=${encodeURIComponent(candidateFilterId)}` : '',
    ]
      .filter(Boolean)
      .join('&');

    const fetchRequests = [
      apiGet(`/pipeline/stages${jobFilterId ? `?jobId=${encodeURIComponent(jobFilterId)}` : ''}`),
      apiGet(`/applications?${appQuery}`),
    ];

    // Only fetch candidates and jobs if we don't have them yet or if we're doing a full reload
    const shouldFetchLists = candidates.length === 0 || jobs.length === 0;
    if (shouldFetchLists) {
      fetchRequests.push(apiGet('/candidates?limit=200'));
      fetchRequests.push(apiGet('/jobs?limit=200'));
    }

    const results = await Promise.all(fetchRequests);
    const stagesRes = results[0];
    const applicationsRes = results[1];
    const candidatesRes = shouldFetchLists ? results[2] : null;
    const jobsRes = shouldFetchLists ? results[3] : null;


    const stageRows = stagesRes.data || [];
    const applicationRows = applicationsRes.data || [];

    setStages(stageRows);
    setApplications(applicationRows);
    if (candidatesRes) setCandidates(candidatesRes.data || []);
    if (jobsRes) setJobs(jobsRes.data || []);
    setSelectedStages(
      applicationRows.reduce((acc, app) => {
        acc[app.id] = app.currentStage?.id || '';
        return acc;
      }, {}),
    );
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        await loadAll();
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load pipeline');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [jobFilterId, candidateFilterId]);

  useEffect(() => {
    setStageForm((prev) => ({ ...prev, jobId: prev.jobId || jobFilterId || '' }));
  }, [jobFilterId]);

  const onCreateApplication = async (event) => {
    event.preventDefault();
    setError('');
    setBanner('');

    try {
      setSaving(true);
      await apiPost('/applications', {
        candidateId: applicationForm.candidateId,
        jobId: applicationForm.jobId,
      });
      await loadAll();
      setApplicationForm(emptyApplicationForm);
      setShowCreate(false);
      setBanner('Application added to pipeline.');
    } catch (err) {
      setError(err.message || 'Failed to add application');
    } finally {
      setSaving(false);
    }
  };

  const onCreateStage = async (event) => {
    event.preventDefault();
    setError('');
    setBanner('');

    try {
      setSavingStage(true);
      await apiPost('/pipeline/stages', {
        name: stageForm.name.trim(),
        sortOrder: Number(stageForm.sortOrder),
        isTerminal: Boolean(stageForm.isTerminal),
        jobId: stageForm.jobId || null,
      });
      await loadAll();
      setStageForm({ ...emptyStageForm, jobId: jobFilterId || '' });
      setShowStageCreate(false);
      setBanner('Pipeline stage created successfully.');
    } catch (err) {
      setError(err.message || 'Failed to create stage');
    } finally {
      setSavingStage(false);
    }
  };

  const onToggleShortlist = useCallback(async (application) => {
    setError('');
    setBanner('');
    try {
      await apiPatch(`/applications/${application.id}/shortlist`, {
        shortlisted: !Boolean(application.shortlisted),
      });
      await loadAll();
      setBanner(`Application ${application.shortlisted ? 'removed from' : 'added to'} shortlist.`);
    } catch (err) {
      setError(err.message || 'Failed to update shortlist');
    }
  }, [applications]);

  const onMoveStage = useCallback(async (applicationId) => {
    const toStageId = selectedStages[applicationId];
    if (!toStageId) {
      setError('Please select a stage before moving.');
      return;
    }

    setError('');
    setBanner('');
    setMovingId(applicationId);
    try {
      const remark = moveRemarks[applicationId] || 'Moved from pipeline board';
      await apiPatch(`/pipeline/applications/${applicationId}/move`, {
        toStageId,
        remark,
      });
      setMoveRemarks((prev) => {
        const next = { ...prev };
        delete next[applicationId];
        return next;
      });
      await loadAll();
      await onLoadHistory(applicationId); // Refresh visible history immediately
      setBanner('Application moved successfully.');
    } catch (err) {
      setError(err.message || 'Failed to move pipeline stage');
    } finally {
      setMovingId('');
    }
  }, [selectedStages, moveRemarks]);

  const onUpdateStatus = useCallback(async (applicationId, status, joiningDate = null, notes = null, action = 'status', rejectionReason = null) => {
    setError('');
    setBanner('');
    try {
      let res;
      const token = localStorage.getItem('ats_token');
      if (action === 'join') {
        res = await fetch(`${API_BASE_URL}/applications/${applicationId}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ dateOfJoining: joiningDate, notes }),
        });
      } else if (action === 'reject') {
        res = await fetch(`${API_BASE_URL}/applications/${applicationId}/reject`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ rejectionReason: rejectionReason || 'OTHER', notes }),
        });
      }

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Action failed');

      setBanner(`Candidate marked as ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [loadAll]);

  const onLoadHistory = useCallback(async (applicationId) => {
    try {
      if (expandedHistory[applicationId]) {
        setExpandedHistory(prev => ({ ...prev, [applicationId]: false }));
        return;
      }
      const res = await apiGet(`/pipeline/applications/${applicationId}/history`);
      setHistoryByApp((prev) => ({
        ...prev,
        [applicationId]: res.data || [],
      }));
      setExpandedHistory(prev => ({ ...prev, [applicationId]: true }));
    } catch (err) {
      setError(err.message || 'Failed to load stage history');
    }
  }, [expandedHistory]);

  const columns = useMemo(() => {
    const stageOrder = [...(stages || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const grouped = stageOrder.map((stage) => ({ ...stage, items: [] }));
    const groupedById = new Map(grouped.map((item) => [item.id, item]));

    applications.forEach((app) => {
      const key = app.currentStage?.id;
      if (key && groupedById.has(key)) {
        groupedById.get(key).items.push(app);
      }
    });

    const unassigned = applications.filter((app) => !app.currentStage?.id || !groupedById.has(app.currentStage.id));
    if (unassigned.length > 0) {
      grouped.push({
        id: 'unassigned',
        name: 'Unassigned',
        sortOrder: 999,
        items: unassigned,
      });
    }

    return grouped;
  }, [applications, stages]);

  // Optimization: Internal Card component to isolate re-renders
  const PipelineCard = React.memo(({ 
    app, 
    stages, 
    selectedStage, 
    onStageChange, 
    remark, 
    onRemarkChange, 
    onMove, 
    onHistory, 
    onToggleShortlist, 
    isMoving, 
    isExpanded, 
    history, 
    canMove, 
    canManage,
    onUpdateStatus
  }) => {
    const navigate = useNavigate();
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [isPendingLocal, setIsPendingLocal] = useState(false);

    const isOfferStage = app.currentStage?.name?.toLowerCase().includes('offer');
    const isJoined = app.status === 'JOINED';
    const isRejected = app.status === 'REJECTED';
    const hasDecision = isJoined || isRejected;

    const handleNavigation = (e) => {
      // Don't navigate if clicking on interactive elements
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
      navigate(`/candidate/${app.candidate?.id || ''}`);
    };

    return (
      <div 
        className="os-card !p-2.5 shadow-none border-[#e2e8f0] cursor-pointer group/main-card"
        onClick={handleNavigation}
        onDoubleClick={handleNavigation}
      >
        <div className="flex items-center gap-2 group/card-top">
          {app.candidate?.profilePhotoFile?.storageKey ? (
            <img 
              className="w-8 h-8 rounded-lg object-cover group-hover/card-top:ring-2 group-hover/card-top:ring-[#1f52cc] transition-all" 
              src={app.candidate.profilePhotoFile.storageKey} 
              alt={app.candidate?.fullName} 
              loading="lazy"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-[#1f52cc] text-white flex items-center justify-center font-bold text-[10px] shrink-0 group-hover/card-top:scale-105 transition-transform">
              {(app.candidate?.fullName || 'C').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate leading-5 group-hover/card-top:text-[#1f52cc] transition-colors">
              {app.candidate?.fullName || 'Candidate'}
            </div>
            <div className="text-xs text-[#7a88a3] truncate">{app.job?.title || 'Role'}</div>
          </div>
        </div>

        <div className="mt-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className={`text-[10px] uppercase tracking-wider font-bold ${app.shortlisted ? 'text-[#218b55]' : 'text-[#7a88a3]'}`}>
              {app.shortlisted ? 'Shortlisted' : 'Not Shortlisted'}
            </span>
            {canManage ? (
              <button 
                className="text-[10px] text-[#1f52cc] font-bold hover:underline relative z-10" 
                type="button" 
                onClick={(e) => { e.stopPropagation(); onToggleShortlist(app); }}
              >
                {app.shortlisted ? 'Remove' : 'Shortlist'}
              </button>
            ) : null}
          </div>

          {isOfferStage && !hasDecision ? (
            <div className="mt-2 flex flex-col gap-2 relative z-10">
              <div className="flex gap-2">
                <button
                  className="flex-1 bg-emerald-600 text-white rounded-lg h-9 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setShowJoinModal(true); }}
                  disabled={isMoving || isPendingLocal}
                >
                  <span className="material-symbols-outlined text-[14px]">how_to_reg</span>
                  Joined
                </button>
                <button
                  className="flex-1 border border-rose-500 text-rose-600 rounded-lg h-9 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-rose-50 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setShowRejectModal(true); }}
                  disabled={isMoving || isPendingLocal}
                >
                  <span className="material-symbols-outlined text-[14px]">person_remove</span>
                  Reject
                </button>
              </div>
              <div className="text-[10px] text-slate-400 text-center font-medium italic">Offer Sent Stage</div>
            </div>
          ) : hasDecision ? (
             <div className={`mt-2 p-2 rounded-lg text-center text-[10px] font-bold uppercase tracking-wider ${isJoined ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                {isJoined ? 'Candidate Joined' : 'Offer Rejected'}
             </div>
          ) : (
            <>
              <select
                className="h-9 w-full rounded-lg border border-[#dbe4ee] px-2 text-xs relative z-10"
                value={selectedStage || ''}
                onChange={(e) => onStageChange(app.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                disabled={!canMove}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Remark..."
                className="mt-2 h-9 w-full rounded-lg border border-[#dbe4ee] px-2 text-xs relative z-10"
                value={remark || ''}
                onChange={(e) => onRemarkChange(app.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                disabled={!canMove || isMoving}
              />
              <div className="mt-2 flex gap-1.5 relative z-10">
                {canMove ? (
                  <button 
                    className="os-btn-primary !h-8 w-full !text-xs shadow-none" 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); onMove(app.id); }} 
                    disabled={isMoving}
                  >
                    {isMoving ? '...' : 'Move'}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>

        {showJoinModal && (
          <JoinModal
            candidateName={app.candidate?.fullName}
            jobTitle={app.job?.title}
            isLoading={isPendingLocal}
            onConfirm={async (data) => {
              setIsPendingLocal(true);
              try {
                await onUpdateStatus(app.id, 'JOINED', data.dateOfJoining, data.notes, 'join');
                setShowJoinModal(false);
              } catch (err) {
                console.error(err);
              } finally {
                setIsPendingLocal(false);
              }
            }}
            onCancel={() => setShowJoinModal(false)}
          />
        )}
        {showRejectModal && (
          <RejectModal
            candidateName={app.candidate?.fullName}
            jobTitle={app.job?.title}
            isLoading={isPendingLocal}
            onConfirm={async (data) => {
              setIsPendingLocal(true);
              try {
                await onUpdateStatus(app.id, 'REJECTED', null, data.notes, 'reject', data.rejectionReason);
                setShowRejectModal(false);
              } catch (err) {
                console.error(err);
              } finally {
                setIsPendingLocal(false);
              }
            }}
            onCancel={() => setShowRejectModal(false)}
          />
        )}
      </div>
    );
  });

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="pipeline" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidates, jobs, or tasks..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline', active: true },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              {canCreateApplication ? (
                <button className="os-btn-primary" type="button" onClick={() => setShowCreate((value) => !value)}>
                  {showCreate ? 'Close Form' : 'Add App'}
                </button>
              ) : null}
              {canCreateApplication ? (
                <button className="os-btn-outline" type="button" onClick={() => setShowStageCreate((value) => !value)}>
                  {showStageCreate ? 'Close Stage' : 'Add Stage'}
                </button>
              ) : null}
              <UserChip fallbackName={currentUser?.fullName || 'Marcus Thorne'} fallbackRole={String(currentUser?.role || 'Head of Talent').replace('_', ' ')} avatarSeed="pipeline-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div>
          <div className="os-eyebrow">Recruitment Flow</div>
          <h1 className="os-h1">{jobs.find((j) => j.id === jobFilterId)?.title || 'Recruitment'} Pipeline</h1>
        </div>

        {showCreate && canCreateApplication ? (
          <Reveal className="os-card mt-4 p-5">
            <form className="grid md:grid-cols-2 gap-3" onSubmit={onCreateApplication}>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Candidate</label>
                <select className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={applicationForm.candidateId} onChange={(event) => setApplicationForm((prev) => ({ ...prev, candidateId: event.target.value }))} required>
                  <option value="">Select candidate</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.fullName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Job</label>
                <select className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={applicationForm.jobId} onChange={(event) => setApplicationForm((prev) => ({ ...prev, jobId: event.target.value }))} required>
                  <option value="">Select job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <button className="os-btn-outline" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="os-btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add To Pipeline'}</button>
              </div>
            </form>
          </Reveal>
        ) : null}

        {showStageCreate && canCreateApplication ? (
          <Reveal className="os-card mt-4 p-5">
            <form className="grid md:grid-cols-4 gap-3" onSubmit={onCreateStage}>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Stage Name</label>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm"
                  value={stageForm.name}
                  onChange={(event) => setStageForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Sort Order</label>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm"
                  type="number"
                  min="1"
                  value={stageForm.sortOrder}
                  onChange={(event) => setStageForm((prev) => ({ ...prev, sortOrder: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Job Scope</label>
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm"
                  value={stageForm.jobId}
                  onChange={(event) => setStageForm((prev) => ({ ...prev, jobId: event.target.value }))}
                >
                  <option value="">Global (all jobs)</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-sm text-[#5e6b87] flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stageForm.isTerminal}
                    onChange={(event) => setStageForm((prev) => ({ ...prev, isTerminal: event.target.checked }))}
                  />
                  Terminal
                </label>
                <button className="os-btn-primary ml-auto" type="submit" disabled={savingStage}>
                  {savingStage ? 'Saving...' : 'Create'}
                </button>
              </div>
            </form>
          </Reveal>
        ) : null}

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}
        {banner ? <div className="mt-4 os-card p-4 text-[#2454cf] text-sm">{banner}</div> : null}
        {loading ? <div className="mt-4 os-card p-4 text-sm text-[#6f7d98]">Loading pipeline...</div> : null}
        {(jobFilterId || candidateFilterId) ? (
          <div className="mt-4 os-card p-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <div className="text-[#5f6a84]">Filtered view {jobFilterId ? '(Job)' : ''} {candidateFilterId ? '(Candidate)' : ''}</div>
              <div className="flex bg-[#f2f5f8] rounded-lg p-1 gap-1">
                <button
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${viewMode === 'board' ? 'bg-white shadow-sm text-[#1f52cc]' : 'text-[#7a88a3]'}`}
                  onClick={() => setViewMode('board')}
                >
                  Board
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-[#1f52cc]' : 'text-[#7a88a3]'}`}
                  onClick={() => setViewMode('table')}
                >
                  Table
                </button>
              </div>
            </div>
            <button className="os-btn-outline !h-9" type="button" onClick={() => navigate('/pipeline')}>Clear Filter</button>
          </div>
        ) : (
          <div className="mt-4 flex justify-end">
            <div className="flex bg-[#f2f5f8] rounded-lg p-1 gap-1">
              <button
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${viewMode === 'board' ? 'bg-white shadow-sm text-[#1f52cc]' : 'text-[#7a88a3]'}`}
                onClick={() => setViewMode('board')}
              >
                Kanban Board
              </button>
              <button
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-[#1f52cc]' : 'text-[#7a88a3]'}`}
                onClick={() => setViewMode('table')}
              >
                Candidate Table
              </button>
            </div>
          </div>
        )}

        {viewMode === 'board' ? (
          <div className="os-card p-6 mb-8 border-none bg-gradient-to-br from-[#ffffff] to-[#f8fafc] shadow-sm">
            <div className="flex flex-wrap gap-6 items-center justify-between">
              <div className="flex gap-8">
                <div 
                  className="group cursor-pointer" 
                  onClick={() => {
                    const list = applications.filter(a => a.currentStage?.name?.toLowerCase().includes('round 1'));
                    setSummaryModalTitle('1st Round Interviews');
                    setSummaryModalItems(list);
                    setShowSummaryModal(true);
                  }}
                >
                  <div className="text-[10px] uppercase tracking-[.15em] text-[#8c97ad] font-bold mb-1 group-hover:text-[#1f52cc] transition-colors">1st Round</div>
                  <div className="text-3xl font-bold text-[#101b3d] font-[Manrope]">
                    {applications.filter(a => a.currentStage?.name?.toLowerCase().includes('round 1')).length}
                  </div>
                </div>
                <div 
                  className="group cursor-pointer"
                  onClick={() => {
                    const list = applications.filter(a => a.currentStage?.name?.toLowerCase().includes('round 2'));
                    setSummaryModalTitle('2nd Round Interviews');
                    setSummaryModalItems(list);
                    setShowSummaryModal(true);
                  }}
                >
                  <div className="text-[10px] uppercase tracking-[.15em] text-[#8c97ad] font-bold mb-1 group-hover:text-[#1f52cc] transition-colors">2nd Round</div>
                  <div className="text-3xl font-bold text-[#101b3d] font-[Manrope]">
                    {applications.filter(a => a.currentStage?.name?.toLowerCase().includes('round 2')).length}
                  </div>
                </div>
                <div 
                  className="group cursor-pointer"
                  onClick={() => {
                    const list = applications.filter(a => a.status === 'SELECTED');
                    setSummaryModalTitle('Selected Candidates');
                    setSummaryModalItems(list);
                    setShowSummaryModal(true);
                  }}
                >
                  <div className="text-[10px] uppercase tracking-[.15em] text-[#8c97ad] font-bold mb-1 group-hover:text-[#2fb56f] transition-colors">Selected</div>
                  <div className="text-3xl font-bold text-[#101b3d] font-[Manrope]">
                    {applications.filter(a => a.status === 'SELECTED').length}
                  </div>
                </div>
                <div 
                  className="group cursor-pointer"
                  onClick={() => {
                    const list = applications.filter(a => a.candidate?.doj);
                    setSummaryModalTitle('Upcoming Joinings');
                    setSummaryModalItems(list);
                    setShowSummaryModal(true);
                  }}
                >
                  <div className="text-[10px] uppercase tracking-[.15em] text-[#8c97ad] font-bold mb-1 group-hover:text-[#f2994a] transition-colors">Joinings</div>
                  <div className="text-3xl font-bold text-[#101b3d] font-[Manrope]">
                    {applications.filter(a => a.candidate?.doj).length}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-[1px] bg-[#e2e8f0] mx-2 hidden xl:block" />
                <button 
                  className="os-btn-primary !h-11 !px-6 bg-[#0b1b3d] border-none shadow-lg shadow-blue-100" 
                  type="button" 
                  onClick={() => setShowStageCreate(true)}
                >
                  <span className="material-symbols-outlined text-lg">add_box</span>
                  New Milestone
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showSummaryModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowSummaryModal(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-8 py-6 border-b border-[#f1f5f9] flex items-center justify-between bg-gradient-to-r from-white to-[#f8fafc]">
                <h3 className="text-xl font-bold text-[#101b3d] font-[Manrope]">{summaryModalTitle}</h3>
                <button className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors" onClick={() => setShowSummaryModal(false)}>
                  <span className="material-symbols-outlined text-gray-400">close</span>
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[calc(80vh-140px)] thin-scrollbar">
                <div className="grid gap-3">
                  {summaryModalItems.map((app) => (
                    <div 
                      key={app.id} 
                      className="p-4 rounded-2xl border border-[#eef2f6] hover:border-[#1f52cc] hover:bg-[#f9fbff] transition-all cursor-pointer group flex items-center justify-between"
                      onClick={() => navigate(`/candidate/${app.candidate?.id}`)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[#1f52cc] text-white flex items-center justify-center font-bold text-lg">
                          {app.candidate?.fullName?.[0] || 'C'}
                        </div>
                        <div>
                          <div className="font-bold text-[#101b3d] group-hover:text-[#1f52cc] transition-colors">{app.candidate?.fullName}</div>
                          <div className="text-xs text-[#64748b]">{app.job?.title || 'Unknown Role'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-bold text-[#94a3b8]">Status</div>
                          <div className="text-xs font-semibold text-[#1f52cc] bg-[#edf3ff] px-2 py-0.5 rounded-full">{app.currentStage?.name || app.status}</div>
                        </div>
                        <span className="material-symbols-outlined text-gray-300 group-hover:text-[#1f52cc] transition-transform group-hover:translate-x-1">chevron_right</span>
                      </div>
                    </div>
                  ))}
                  {summaryModalItems.length === 0 && (
                    <div className="py-12 text-center">
                      <div className="text-gray-400 mb-2">No candidates found in this category.</div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {viewMode === 'board' ? (
          <div className="mt-4 overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-max pb-2">
              {columns.map((column, idx) => (
                <Reveal key={column.id} delay={idx * 0.03}>
                  <div className="rounded-2xl border border-[#e2e8ef] bg-[#f6fafb] p-3 min-h-[520px] w-[320px] shrink-0 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-semibold text-sm">{column.name}</div>
                      <div className="text-xs text-[#8090ad]">{column.items.length}</div>
                    </div>
                    <div className="space-y-3">
                      {column.items.slice(0, 15).map((app) => (
                        <PipelineCard 
                          key={app.id}
                          app={app}
                          stages={stages}
                          selectedStage={selectedStages[app.id]}
                          onStageChange={(id, val) => setSelectedStages(prev => ({ ...prev, [id]: val }))}
                          remark={moveRemarks[app.id]}
                          onRemarkChange={(id, val) => setMoveRemarks(prev => ({ ...prev, [id]: val }))}
                          onMove={onMoveStage}
                          onHistory={onLoadHistory}
                          onToggleShortlist={onToggleShortlist}
                          isMoving={movingId === app.id}
                          isExpanded={expandedHistory[app.id]}
                          history={historyByApp[app.id]}
                          canMove={canMovePipeline}
                          canManage={canCreateApplication}
                          onUpdateStatus={onUpdateStatus}
                        />
                      ))}
                      {column.items.length > 15 && (
                        <div className="text-center py-2">
                          <button 
                            className="text-[11px] text-[#1f52cc] font-semibold hover:underline"
                            onClick={() => navigate(`/candidates?stageId=${column.id}`)}
                          >
                            View {column.items.length - 15} more in list
                          </button>
                        </div>
                      )}
                      {column.items.length === 0 ? <div className="text-xs os-muted">No applications.</div> : null}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        ) : (
          <Reveal className="os-card mt-4 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8fafc] text-[#7a88a3] text-[11px] uppercase tracking-[.15em] border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-5 py-3">Candidate</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Area</th>
                  <th className="px-5 py-3">Current Stage</th>
                  <th className="px-5 py-3">Job Title</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-[#f1f5f9] hover:bg-[#f9fafb] transition-colors">
                    <td className="px-5 py-4 font-semibold text-[#101c43]">{app.candidate?.fullName}</td>
                    <td className="px-5 py-4 text-xs text-[#5e6b86]">{app.candidate?.location || 'N/A'}</td>
                    <td className="px-5 py-4 text-xs text-[#5e6b86]">{app.candidate?.area || 'N/A'}</td>
                    <td className="px-5 py-4">
                      <span className="bg-[#ebf3ff] text-[#1f52cc] px-2 py-1 rounded-md font-medium text-xs">
                        {app.currentStage?.name || 'Unassigned'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#5e6b86]">{app.job?.title}</td>
                    <td className="px-5 py-4">
                      <button className="os-btn-outline !h-8 !px-3" onClick={() => navigate(`/candidate/${app.candidate?.id}`)}>View Profile</button>
                    </td>
                  </tr>
                ))}
                {applications.length === 0 ? (
                  <tr>
                    <td className="px-5 py-10 text-center os-muted" colSpan={4}>No applications currently in this pipeline view.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Reveal>
        )}
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Pipeline;
