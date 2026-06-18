import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, apiPatch, apiPost, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import { subscribeSSE } from '../lib/sse';
import Skeleton from '../components/Skeleton';

const defaultJobForm = {
  title: '',
  department: '',
  location: '',
  employmentType: 'Full-time',
  openingsCount: 1,
  description: '',
};

const JobsManager = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(defaultJobForm);
  const [shortlistByJob, setShortlistByJob] = useState({});
  const currentUser = getStoredUser();
  const canManageJobs = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  // ── Data loading ──────────────────────────────────────────────────────────
  // Only fetches jobs — shortlist counts come from _count.applications on each job doc.
  // Previously fetched /applications?limit=3000 just to count shortlists — removed.
  const loadJobs = useCallback(async (useCache = true) => {
    const query = statusFilter === 'all' ? '' : `&isActive=${statusFilter === 'active'}`;
    const res = await apiGet(`/jobs?limit=100${query}`, useCache);
    setItems(res.data || []);
  }, [statusFilter]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        await loadJobs(reloadTrigger === 0);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load jobs');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [statusFilter, reloadTrigger, loadJobs]);

  // Singleton SSE — debounced so rapid job events don't flood reloads
  useEffect(() => {
    const TYPES = ['JOB_CREATED','JOB_UPDATED','JOB_STATUS_UPDATED','APPLICATION_STATUS_UPDATED','CANDIDATE_CREATED','CANDIDATE_UPDATED'];
    let debounceTimer = null;
    const unsub = subscribeSSE(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setReloadTrigger(p => p + 1), 5000);
    }, TYPES);
    return () => { unsub(); clearTimeout(debounceTimer); };
  }, []);

  const onCreateJob = async (event) => {
    event.preventDefault();
    setError('');
    setBanner('');

    const tempId = `temp_${Date.now()}`;
    const tempJob = {
      id: tempId,
      title: form.title.trim(),
      department: form.department.trim() || null,
      location: form.location.trim() || null,
      employmentType: form.employmentType.trim() || 'Full-time',
      openingsCount: Number(form.openingsCount) || 1,
      description: form.description.trim() || null,
      isActive: true,
      createdBy: { fullName: currentUser?.fullName || 'You' },
      _count: { applications: 0, shortlisted: 0 },
      _optimistic: true,
    };

    // Optimistic Update: Close form immediately & Prepend job
    setForm(defaultJobForm);
    setShowCreate(false);
    setItems(prev => [tempJob, ...prev]);
    setBanner('Job created successfully.');

    try {
      const res = await apiPost('/jobs', {
        title: tempJob.title,
        department: tempJob.department,
        location: tempJob.location,
        employmentType: tempJob.employmentType,
        openingsCount: tempJob.openingsCount,
        description: tempJob.description,
      });

      // Swap temp ID with server ID
      const realJob = res.data;
      setItems(prev => prev.map(item => item.id === tempId ? { ...realJob, createdBy: { fullName: currentUser?.fullName || 'You' } } : item));
    } catch (err) {
      // Rollback
      setItems(prev => prev.filter(item => item.id !== tempId));
      setBanner('');
      setError(err.message || 'Failed to create job');
    }
  };

  const onToggleStatus = async (job) => {
    setError('');
    setBanner('');
    const newActiveState = !job.isActive;

    // Optimistic Update: flip active status locally
    setItems(prev => prev.map(item => item.id === job.id ? { ...item, isActive: newActiveState } : item));
    setBanner(`Job "${job.title}" moved to ${newActiveState ? 'Active' : 'Closed'}.`);

    try {
      await apiPatch(`/jobs/${job.id}/status`, { isActive: newActiveState });
    } catch (err) {
      // Rollback on failure
      setItems(prev => prev.map(item => item.id === job.id ? { ...item, isActive: job.isActive } : item));
      setBanner('');
      setError(err.message || 'Failed to update job status');
    }
  };

  const jobs = useMemo(
    () =>
      items
        .map((job) => ({
          id: job.id,
          title: job.title,
          location: job.location || '-',
          status: job.isActive ? 'Active' : 'Closed',
          lead: job.createdBy?.fullName || 'Assigned',
          applicants: job._count?.applications || 0,
          // Shortlist count comes from the job document — no extra fetch needed
          shortlisted: job._count?.shortlisted || shortlistByJob[job.id] || 0,
          isActive: Boolean(job.isActive),
          _optimistic: Boolean(job._optimistic),
        }))
        .sort((a, b) => {
          if (sortBy === 'title') return a.title.localeCompare(b.title);
          return b.applicants - a.applicants;
        }),
    [items, shortlistByJob, sortBy],
  );

  const prefetchJobDetails = useCallback((jobId) => {
    // Prefetch job documents and questions
    apiGet(`/jobs/${jobId}/documents`).catch(() => {});
    apiGet(`/jobs/${jobId}/questions`).catch(() => {});
  }, []);

  const activeCount = jobs.filter((j) => j.status === 'Active').length;

  return (
    <EnterpriseLayout
      sidebar={
        <EnterpriseSidebar
          active="jobs"
          items={enterpriseNavItems}
          footerLinks={enterpriseFooterLinks}
          footerButton={
            canManageJobs ? (
              <button className="os-btn-primary w-full" onClick={() => setShowCreate((value) => !value)} type="button">
                + Post New Job
              </button>
            ) : null
          }
        />
      }
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search jobs, candidates, or applications..."
          tabs={[
            { key: 'all', label: 'All Jobs', href: '/jobs', active: true },
          ]}
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="Alex Rivera" fallbackRole="Recruiting Lead" avatarSeed="jobs-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="os-eyebrow">Recruitment Overview</div>
              <h1 className="os-h1">Job Management</h1>
            </div>
            {canManageJobs && (
              <button className="os-btn-primary !h-9 ml-4" type="button" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? 'Close Form' : '+ Post Job'}
              </button>
            )}
          </div>
          <div className="flex gap-3 self-end mb-1">
            <div className="os-card px-4 py-2.5 text-[11px] text-[#4f5a77] flex items-center gap-2 font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[#1f4bc6] text-sm">bolt</span>
              Velocity <b style={{ color: '#1f4bc6' }}>12.4d</b>
            </div>
            <div className="rounded-2xl bg-[#2455d9] text-white px-4 py-2.5 text-[11px] flex items-center gap-2 font-bold uppercase tracking-wider shadow-md">
              <span className="material-symbols-outlined text-sm">groups</span>
              Active <b>{activeCount}</b>
            </div>
          </div>
        </div>

        {showCreate && canManageJobs ? (
          <Reveal className="os-card mt-4 p-5">
            <form className="grid md:grid-cols-2 xl:grid-cols-3 gap-3" onSubmit={onCreateJob}>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Title</label>
                <input className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} required />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Department</label>
                <input className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={form.department} onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Location</label>
                <input className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Employment Type</label>
                <select className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" value={form.employmentType} onChange={(event) => setForm((prev) => ({ ...prev, employmentType: event.target.value }))}>
                  <option>Full-time</option>
                  <option>Contract</option>
                  <option>Part-time</option>
                  <option>Internship</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Openings</label>
                <input className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" type="number" min="1" value={form.openingsCount} onChange={(event) => setForm((prev) => ({ ...prev, openingsCount: event.target.value }))} />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Description</label>
                <textarea className="mt-1 min-h-[90px] w-full rounded-lg border border-[#dbe4ee] px-3 py-2 text-sm" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </div>
              <div className="md:col-span-2 xl:col-span-3 flex justify-end gap-2">
                <button className="os-btn-outline" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="os-btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Job'}</button>
              </div>
            </form>
          </Reveal>
        ) : null}

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}
        {banner ? <div className="mt-4 os-card p-4 text-[#2454cf] text-sm">{banner}</div> : null}

        <Reveal className="os-card mt-4 p-3 flex items-center justify-between">
          <div className="flex gap-2 text-sm">
            <button className={`os-btn-outline !h-10 ${statusFilter === 'all' ? '!border-[#1f52cc] !text-[#1f52cc]' : ''}`} onClick={() => setStatusFilter('all')} type="button">All Jobs</button>
            <button className={`os-btn-outline !h-10 ${statusFilter === 'active' ? '!border-[#1f52cc] !text-[#1f52cc]' : ''}`} onClick={() => setStatusFilter('active')} type="button">Active</button>
            <button className={`os-btn-outline !h-10 ${statusFilter === 'closed' ? '!border-[#1f52cc] !text-[#1f52cc]' : ''}`} onClick={() => setStatusFilter('closed')} type="button">Closed</button>
          </div>
          <div className="text-[#7a859f] flex gap-2">
            <button className="os-icon-btn !h-8 !w-8" type="button" onClick={() => setStatusFilter('active')} title="Show active">
              <span className="material-symbols-outlined">filter_alt</span>
            </button>
            <button className="os-icon-btn !h-8 !w-8" type="button" onClick={() => setSortBy((prev) => (prev === 'newest' ? 'title' : 'newest'))} title="Toggle sort">
              <span className="material-symbols-outlined">sort</span>
            </button>
          </div>
        </Reveal>

        <div className="space-y-3 mt-4">
          {loading ? (
            // Skeleton loading — feels instant
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="os-card px-5 py-4 grid grid-cols-1 md:grid-cols-[1.8fr_.55fr_.72fr_.9fr] gap-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="space-y-2">
                  <Skeleton width="55%" height="20px" />
                  <Skeleton width="35%" height="12px" />
                </div>
                <Skeleton width="60px" height="16px" />
                <div className="space-y-2">
                  <Skeleton width="50px" height="10px" />
                  <Skeleton width="80px" height="14px" />
                </div>
                <div className="flex gap-2">
                  <Skeleton width="80px" height="36px" />
                  <Skeleton width="60px" height="36px" />
                </div>
              </div>
            ))
          ) : jobs.length === 0 ? (
            <div className="os-card p-10 text-center">
              <span className="material-symbols-outlined text-4xl text-slate-300">work_off</span>
              <p className="text-slate-400 mt-2 text-sm">No jobs found. {canManageJobs && <button className="text-[#1f52cc] underline" onClick={() => setShowCreate(true)}>Post one now</button>}</p>
            </div>
          ) : null}
          {jobs.map((row, idx) => (
            <Reveal key={row.id} delay={idx * 0.04}>
              <div 
                className={`os-card px-5 py-4 grid grid-cols-1 md:grid-cols-[1.8fr_.55fr_.72fr_.9fr] items-start md:items-center gap-4 ${row._optimistic ? 'opacity-60 pointer-events-none' : ''}`}
                onMouseEnter={() => prefetchJobDetails(row.id)}
              >
                <div>
                  <button className="text-xl font-semibold font-[Manrope] text-left" type="button" onClick={() => navigate(`/schedule?jobId=${row.id}`)}>
                    {row.title}
                  </button>
                  <div className="text-sm text-[#6b7690] mt-1">{row.location}</div>
                </div>
                <div className="text-xs uppercase tracking-[.1em] text-[#8f98ad]">{row.status}</div>
                <div>
                  <div className="text-xs uppercase tracking-[.1em] text-[#8f98ad]">Hiring Lead</div>
                  <div className="text-sm mt-1">{row.lead}</div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-start">
                  <button className="os-btn-primary !bg-[#2454cf] hover:!bg-[#1d43a6] !border-transparent !text-white" type="button" onClick={() => navigate(`/jobs/${row.id}`)}>
                    JD & Docs
                  </button>
                  {canManageJobs ? (
                    <button className="os-btn-outline" type="button" onClick={() => onToggleStatus(row)}>
                      {row.isActive ? 'Close' : 'Reopen'}
                    </button>
                  ) : (
                    <span className="text-xs text-[#7b88a3]">Read Only</span>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-6 text-sm text-[#687490]">Showing {jobs.length} jobs</div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default JobsManager;
