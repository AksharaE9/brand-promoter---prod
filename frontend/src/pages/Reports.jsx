import React, { useEffect, useState, useMemo } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import { subscribeSSE } from '../lib/sse';

const recruiterRoles = [
  { value: 'RECRUITER', label: 'Recruiter' }
];

const candidateSources = [
  { value: 'Direct Application', label: 'Direct Application' },
  { value: 'Referral', label: 'Referral' },
  { value: 'College Drive', label: 'College Drive' },
  { value: 'Bulk Upload', label: 'Bulk Upload' },
  { value: 'Manual Entry', label: 'Manual Entry' }
];

const Reports = () => {
  const currentUser = getStoredUser();
  const canExportReports = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  // States
  const [activeTab, setActiveTab] = useState('JOBS'); // JOBS, JOINED, OFFER_LETTERS
  const [candidates, setCandidates] = useState([]);
  const [jobsData, setJobsData] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [recruiters, setRecruiters] = useState([]);
  const [stages, setStages] = useState([]);
  const [stageCounts, setStageCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Sidebar visibility
  const [showSidebar, setShowSidebar] = useState(true);

  // Expanded/Collapsed filter groups
  const [expandedGroups, setExpandedGroups] = useState({ date: true, recruiter: true, stage: true, source: true });

  // Filters State
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedRecruiterId, setSelectedRecruiterId] = useState('');
  const [selectedStages, setSelectedStages] = useState([]);
  const [selectedSources, setSelectedSources] = useState([]);
  
  // Sorting state
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // Filter candidates based on selected tab
  const displayedCandidates = useMemo(() => {
    if (activeTab === 'JOINED') {
      return candidates.filter(c => c.status === 'JOINED' || c.stageName?.toUpperCase() === 'JOINED' || c.stageName?.toLowerCase() === 'joined');
    }
    if (activeTab === 'OFFER_LETTERS') {
      return candidates.filter(c => c.status === 'OFFER_SENT' || c.stageName?.toUpperCase().includes('OFFER') || c.stageName?.toLowerCase().includes('offer'));
    }
    return candidates;
  }, [candidates, activeTab]);

  // Load baseline data (recruiters list, stages list)
  useEffect(() => {
    const loadBaselines = async () => {
      try {
        const [usersRes, stagesRes, candsRes] = await Promise.all([
          apiGet('/users'),
          apiGet('/pipeline/stages'), // fallback if stages api doesn't exist
          apiGet('/candidates?limit=1000')
        ]);
        
        if (usersRes.success && Array.isArray(usersRes.data)) {
          setRecruiters(usersRes.data.filter(u => u.role === 'RECRUITER'));
        }

        // Parse stage counts from candidates
        if (candsRes.success && Array.isArray(candsRes.data)) {
          const counts = {};
          const uniqueStages = new Set();
          
          candsRes.data.forEach(c => {
            const app = c.applications?.[0];
            const sName = app?.currentStage?.name || 'Pool';
            counts[sName] = (counts[sName] || 0) + 1;
            if (app?.currentStage) {
              uniqueStages.add(JSON.stringify({ id: app.currentStageId, name: sName }));
            }
          });

          setStageCounts(counts);
          setStages(Array.from(uniqueStages).map(s => JSON.parse(s)));
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadBaselines();
  }, []);

  // Fetch report data
  const fetchReport = async () => {
    try {
      setLoading(true);
      setError('');
      
      let url = `/reports/candidates?sortBy=${sortBy}&sortOrder=${sortOrder}`;
      if (selectedRole) url += `&role=${selectedRole}`;
      if (selectedRecruiterId) url += `&recruiterId=${selectedRecruiterId}`;
      if (createdFrom) url += `&createdFrom=${createdFrom}`;
      if (createdTo) url += `&createdTo=${createdTo}`;
      
      selectedStages.forEach(s => {
        url += `&stage=${encodeURIComponent(s)}`;
      });
      selectedSources.forEach(s => {
        url += `&source=${encodeURIComponent(s)}`;
      });

      const res = await apiGet(url);
      if (res.success) {
        setCandidates(res.data || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [selectedRole, selectedRecruiterId, createdFrom, createdTo, selectedStages, selectedSources, sortBy, sortOrder, reloadTrigger]);

  const fetchJobsReport = async () => {
    try {
      setJobsLoading(true);
      setError('');
      const res = await apiGet('/reports/hiring-progress');
      if (res.success && Array.isArray(res.data)) {
        setJobsData(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch jobs report data');
    } finally {
      setJobsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'JOBS') {
      fetchJobsReport();
    }
  }, [activeTab, reloadTrigger]);

  const handleExportJobs = () => {
    try {
      const headers = ['Job Title', 'Department', 'Status', 'Total Applications', 'In Pipeline', 'Selected', 'Rejected', 'Joined'];
      const rows = jobsData.map(job => [
        `"${job.title || ''}"`,
        `"${job.department || ''}"`,
        `"${job.jobStatus || ''}"`,
        job.totalApplications,
        job.inPipeline,
        job.selected,
        job.rejected,
        job.joined
      ]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `jobs_report_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error(err);
      setError('Export failed');
    }
  };

  // Singleton SSE — debounced 15s
  useEffect(() => {
    const TYPES = ['CANDIDATE_CREATED','CANDIDATE_UPDATED','APPLICATION_STATUS_UPDATED','PIPELINE_MOVED'];
    let debounceTimer = null;
    const unsub = subscribeSSE(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setReloadTrigger(p => p + 1), 5000);
    }, TYPES);
    return () => { unsub(); clearTimeout(debounceTimer); };
  }, []);

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Preset Handlers
  const applyPreset = (preset) => {
    const today = new Date();
    
    if (preset === 'TODAY') {
      setCreatedFrom(today.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    } else if (preset === 'WEEK') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      setCreatedFrom(start.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    } else if (preset === 'MONTH') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setCreatedFrom(start.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    } else if (preset === '3_MONTHS') {
      const start = new Date();
      start.setMonth(start.getMonth() - 3);
      setCreatedFrom(start.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    } else if (preset === '6_MONTHS') {
      const start = new Date();
      start.setMonth(start.getMonth() - 6);
      setCreatedFrom(start.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    } else if (preset === 'THIS_YEAR') {
      const start = new Date(today.getFullYear(), 0, 1);
      setCreatedFrom(start.toISOString().split('T')[0]);
      setCreatedTo(today.toISOString().split('T')[0]);
    }
  };

  // Toggle checklist filters
  const handleToggleStage = (stageName) => {
    setSelectedStages(prev =>
      prev.includes(stageName) ? prev.filter(s => s !== stageName) : [...prev, stageName]
    );
  };

  const handleToggleSource = (sourceName) => {
    setSelectedSources(prev =>
      prev.includes(sourceName) ? prev.filter(s => s !== sourceName) : [...prev, sourceName]
    );
  };

  // Export report handler
  const handleExport = async (format) => {
    setError('');
    setBanner('');
    try {
      const token = localStorage.getItem('ats_token');
      let url = `${API_BASE_URL}/reports/export?reportType=candidates&format=${format}`;
      
      if (selectedRole) url += `&role=${selectedRole}`;
      if (selectedRecruiterId) url += `&recruiterId=${selectedRecruiterId}`;
      if (createdFrom) url += `&createdFrom=${createdFrom}`;
      if (createdTo) url += `&createdTo=${createdTo}`;
      if (activeTab === 'JOINED') {
        url += `&stage=Joined`;
      } else if (activeTab === 'OFFER_LETTERS') {
        url += `&stage=Offer%20Sent`;
      } else {
        selectedStages.forEach(s => { url += `&stage=${encodeURIComponent(s)}`; });
      }
      selectedSources.forEach(s => { url += `&source=${encodeURIComponent(s)}`; });

      setBanner('Preparing download, please wait...');
      
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error('Download failed');
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `candidates_report_${Date.now()}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
      setBanner('Download completed successfully.');
      setTimeout(() => setBanner(''), 3000);
    } catch (err) {
      setError(err.message || 'Export failed');
    }
  };

  // Active filter chips calculations
  const filterChips = useMemo(() => {
    const chips = [];
    if (createdFrom || createdTo) {
      chips.push({
        id: 'date',
        label: `Created: ${createdFrom || 'Start'} – ${createdTo || 'End'}`,
        clear: () => { setCreatedFrom(''); setCreatedTo(''); }
      });
    }
    if (selectedRole) {
      chips.push({
        id: 'role',
        label: `Role: ${selectedRole}`,
        clear: () => setSelectedRole('')
      });
    }
    if (selectedRecruiterId) {
      const rName = recruiters.find(r => r.id === selectedRecruiterId)?.fullName || 'Recruiter';
      chips.push({
        id: 'recruiter',
        label: `Recruiter: ${rName}`,
        clear: () => setSelectedRecruiterId('')
      });
    }
    selectedStages.forEach(stg => {
      chips.push({
        id: `stage-${stg}`,
        label: `Stage: ${stg}`,
        clear: () => setSelectedStages(prev => prev.filter(s => s !== stg))
      });
    });
    selectedSources.forEach(src => {
      chips.push({
        id: `source-${src}`,
        label: `Source: ${src}`,
        clear: () => setSelectedSources(prev => prev.filter(s => s !== src))
      });
    });
    return chips;
  }, [createdFrom, createdTo, selectedRole, selectedRecruiterId, selectedStages, selectedSources, recruiters]);

  const clearAllFilters = () => {
    setCreatedFrom('');
    setCreatedTo('');
    setSelectedRole('');
    setSelectedRecruiterId('');
    setSelectedStages([]);
    setSelectedSources([]);
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="reports" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search report features..."
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="System Administrator" fallbackRole="Admin" avatarSeed="reports-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="os-eyebrow">Enterprise Metrics</div>
            <h1 className="os-h1">Recruitment Reports</h1>
          </div>
          {activeTab !== 'JOBS' && (
            <button 
              className="os-btn-outline flex items-center gap-1.5"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              <span className="material-symbols-outlined text-base">filter_list</span>
              {showSidebar ? 'Hide Filters' : 'Show Filters'}
            </button>
          )}
        </div>

        {/* Tabs Controls */}
        <div className="flex gap-6 border-b border-[#e9eef4] mb-6">

          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'JOBS' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('JOBS')}
          >
            Jobs Report
          </button>
          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'JOINED' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('JOINED')}
          >
            Joined Candidates
          </button>
          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'OFFER_LETTERS' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('OFFER_LETTERS')}
          >
            Offer Letters
          </button>
        </div>

        {error && <div className="os-card p-3 mb-4 text-red-600 bg-red-50 text-sm font-semibold">{error}</div>}
        {banner && <div className="os-card p-3 mb-4 text-blue-600 bg-blue-50 text-sm font-semibold">{banner}</div>}

        <div className="flex gap-6 items-start relative">
          {/* 1. COLLAPSIBLE FILTER SIDEBAR (280px) */}
          {showSidebar && activeTab !== 'JOBS' && (
            <div className="w-[280px] shrink-0 os-card p-4 bg-white border border-[#e3eaf0] space-y-4 animate-in slide-in-from-left duration-300">
              
              {/* Date Group */}
              <div className="border-b border-slate-100 pb-3">
                <div 
                  className="flex justify-between items-center cursor-pointer mb-2"
                  onClick={() => setExpandedGroups(prev => ({ ...prev, date: !prev.date }))}
                >
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Date of Creation</span>
                  <span className="text-[10px] text-slate-400">{expandedGroups.date ? '▲' : '▼'}</span>
                </div>
                {expandedGroups.date && (
                  <div className="space-y-3 mt-2">
                    <div className="flex flex-col gap-1">
                      <input 
                        type="date"
                        className="h-8 rounded border border-slate-200 px-2 text-xs outline-none focus:border-[#1f52cc]"
                        value={createdFrom}
                        onChange={e => setCreatedFrom(e.target.value)}
                      />
                      <input 
                        type="date"
                        className="h-8 rounded border border-slate-200 px-2 text-xs outline-none focus:border-[#1f52cc]"
                        value={createdTo}
                        onChange={e => setCreatedTo(e.target.value)}
                      />
                    </div>
                    {/* Quick selection presets */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['TODAY', 'WEEK', 'MONTH', '3_MONTHS', '6_MONTHS', 'THIS_YEAR'].map(p => (
                        <button
                          key={p}
                          type="button"
                          className="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-[9px] font-semibold text-slate-600 hover:bg-slate-100"
                          onClick={() => applyPreset(p)}
                        >
                          {p.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Role & Recruiter Group */}
              <div className="border-b border-slate-100 pb-3">
                <div 
                  className="flex justify-between items-center cursor-pointer mb-2"
                  onClick={() => setExpandedGroups(prev => ({ ...prev, recruiter: !prev.recruiter }))}
                >
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Role & Recruiter</span>
                  <span className="text-[10px] text-slate-400">{expandedGroups.recruiter ? '▲' : '▼'}</span>
                </div>
                {expandedGroups.recruiter && (
                  <div className="space-y-3 mt-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400">Recruiter Role</label>
                      <select 
                        className="h-8 rounded border border-slate-200 px-2 text-xs outline-none bg-white font-semibold text-slate-600"
                        value={selectedRole}
                        onChange={e => setSelectedRole(e.target.value)}
                      >
                        <option value="">All Roles</option>
                        {recruiterRoles.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400">Specific Recruiter</label>
                      <select 
                        className="h-8 rounded border border-slate-200 px-2 text-xs outline-none bg-white font-semibold text-slate-600"
                        value={selectedRecruiterId}
                        onChange={e => setSelectedRecruiterId(e.target.value)}
                      >
                        <option value="">All Recruiters</option>
                        {recruiters.map(r => (
                          <option key={r.id} value={r.id}>{r.fullName}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Stage Checklist Group */}
              <div className="border-b border-slate-100 pb-3">
                <div 
                  className="flex justify-between items-center cursor-pointer mb-2"
                  onClick={() => setExpandedGroups(prev => ({ ...prev, stage: !prev.stage }))}
                >
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pipeline Stage</span>
                  <span className="text-[10px] text-slate-400">{expandedGroups.stage ? '▲' : '▼'}</span>
                </div>
                {expandedGroups.stage && (
                  <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto pr-1">
                    {stages.length > 0 ? (
                      stages.map(stg => (
                        <label key={stg.id || stg.name} className="flex items-center justify-between text-xs font-semibold text-slate-600 cursor-pointer hover:text-slate-800">
                          <span className="flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              className="accent-[#1f52cc]"
                              checked={selectedStages.includes(stg.name)}
                              onChange={() => handleToggleStage(stg.name)}
                            />
                            {stg.name}
                          </span>
                          <span className="bg-slate-100 text-slate-500 font-bold px-1.5 py-0.2 rounded-full text-[9px]">
                            {stageCounts[stg.name] || 0}
                          </span>
                        </label>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">No stages detected</span>
                    )}
                  </div>
                )}
              </div>

              {/* Source Checklist Group */}
              <div className="border-b border-slate-100 pb-2">
                <div 
                  className="flex justify-between items-center cursor-pointer mb-2"
                  onClick={() => setExpandedGroups(prev => ({ ...prev, source: !prev.source }))}
                >
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Candidate Source</span>
                  <span className="text-[10px] text-slate-400">{expandedGroups.source ? '▲' : '▼'}</span>
                </div>
                {expandedGroups.source && (
                  <div className="space-y-1.5 mt-2">
                    {candidateSources.map(src => (
                      <label key={src.value} className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer hover:text-slate-800">
                        <input 
                          type="checkbox" 
                          className="accent-[#1f52cc]"
                          checked={selectedSources.includes(src.value)}
                          onChange={() => handleToggleSource(src.value)}
                        />
                        {src.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* 2. REPORT CONTENT TABLE & CONTROLS */}
          <div className="flex-1 min-w-0">
            {/* Active Filters Row */}
            {filterChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {filterChips.map(chip => (
                  <span key={chip.id} className="inline-flex items-center gap-1 bg-[#1f52cc]/10 text-[#1f52cc] text-xs font-bold px-2 py-0.5 rounded-full">
                    {chip.label}
                    <button type="button" className="hover:text-red-500 font-extrabold text-[10px]" onClick={chip.clear}>✕</button>
                  </span>
                ))}
                <button type="button" className="text-xs font-bold text-red-500 hover:underline ml-2" onClick={clearAllFilters}>
                  Clear All
                </button>
              </div>
            )}

            {/* Export & Actions Panel */}
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-slate-500">
                {activeTab === 'JOBS' 
                  ? `Total: ${jobsData.length} jobs` 
                  : `Total: ${displayedCandidates.length} candidates`}
              </span>
              {canExportReports && (
                <div className="flex items-center gap-2">
                  {activeTab === 'JOBS' ? (
                    <button 
                      className="os-btn-primary !h-8 text-xs font-bold" 
                      onClick={handleExportJobs}
                      disabled={jobsLoading}
                    >
                      Export CSV
                    </button>
                  ) : (
                    <>
                      <button 
                        className="os-btn-outline !h-8 text-xs font-bold" 
                        onClick={() => handleExport('csv')}
                        disabled={loading}
                      >
                        Export CSV
                      </button>
                      <button 
                        className="os-btn-primary !h-8 text-xs font-bold" 
                        onClick={() => handleExport('xlsx')}
                        disabled={loading}
                      >
                        Export Excel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Reports Table */}
            <div className="os-card overflow-hidden">
              <div className="overflow-x-auto">
                {activeTab === 'JOBS' ? (
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">
                        <th className="p-4">Job Title</th>
                        <th className="p-4">Department</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-center">Total Apps</th>
                        <th className="p-4 text-center">In Pipeline</th>
                        <th className="p-4 text-center">Selected</th>
                        <th className="p-4 text-center">Rejected</th>
                        <th className="p-4 text-center">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobsLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="animate-pulse border-b border-slate-100">
                            <td className="p-4"><div className="h-4 w-32 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-20 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-16 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-8 bg-slate-100 rounded mx-auto" /></td>
                            <td className="p-4"><div className="h-4 w-8 bg-slate-100 rounded mx-auto" /></td>
                            <td className="p-4"><div className="h-4 w-8 bg-slate-100 rounded mx-auto" /></td>
                            <td className="p-4"><div className="h-4 w-8 bg-slate-100 rounded mx-auto" /></td>
                            <td className="p-4"><div className="h-4 w-8 bg-slate-100 rounded mx-auto" /></td>
                          </tr>
                        ))
                      ) : jobsData.length > 0 ? (
                        jobsData.map((job) => (
                          <tr key={job.jobId} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="p-4 font-semibold text-slate-800">{job.title}</td>
                            <td className="p-4 text-slate-600">{job.department}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                job.jobStatus === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {job.jobStatus}
                              </span>
                            </td>
                            <td className="p-4 text-slate-800 font-bold text-center">{job.totalApplications}</td>
                            <td className="p-4 text-blue-600 font-semibold text-center">{job.inPipeline}</td>
                            <td className="p-4 text-emerald-600 font-semibold text-center">{job.selected}</td>
                            <td className="p-4 text-red-600 font-semibold text-center">{job.rejected}</td>
                            <td className="p-4 text-purple-600 font-semibold text-center">{job.joined}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="8" className="p-8 text-center text-slate-400 italic">No jobs found matching report.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">
                        <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('fullName')}>
                          Name {sortBy === 'fullName' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                        </th>
                        <th className="p-4">Email</th>
                        <th className="p-4">Phone</th>
                        <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('recruiterName')}>
                          Recruiter {sortBy === 'recruiterName' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                        </th>
                        <th className="p-4 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('createdAt')}>
                          Created Date {sortBy === 'createdAt' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                        </th>
                        <th className="p-4">Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="animate-pulse border-b border-slate-100">
                            <td className="p-4"><div className="h-4 w-24 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-32 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-20 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-24 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-16 bg-slate-100 rounded" /></td>
                            <td className="p-4"><div className="h-4 w-12 bg-slate-100 rounded" /></td>
                          </tr>
                        ))
                      ) : displayedCandidates.length > 0 ? (
                        displayedCandidates.map((c) => (
                          <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="p-4 font-semibold text-slate-800">{c.fullName}</td>
                            <td className="p-4 text-slate-600">{c.email}</td>
                            <td className="p-4 text-slate-500 font-mono text-xs">{c.phone}</td>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-800">{c.recruiterName}</span>
                                <span className="bg-slate-100 text-slate-600 px-1 py-0.2 rounded text-[8px] font-bold w-max mt-0.5">
                                  {c.recruiterType || 'N/A'}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-slate-500 text-xs">
                              {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
                            </td>
                            <td className="p-4">
                              <span className="bg-blue-50 text-[#1f52cc] font-bold text-[9px] uppercase px-2 py-0.5 rounded-full">
                                {c.stageName || 'Pool'}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="6" className="p-8 text-center text-slate-400 italic">No candidates found matching report filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>
        </div>

      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Reports;
