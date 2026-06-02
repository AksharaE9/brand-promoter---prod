import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import html2canvas from 'html2canvas';
import { subscribeSSE } from '../lib/sse';
import { SkeletonBox } from '../components/Skeleton';

// Recharts components
import {
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  Cell,
  LabelList,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  PieChart,
  Pie
} from 'recharts';

const Analytics = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Date Range State (defaults to last 90 days)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Data States
  const [overview, setOverview] = useState(null);
  const [trends, setTrends] = useState([]);
  const [pipelineData, setPipelineData] = useState([]);
  const [interviewerData, setInterviewerData] = useState([]);
  const [sourceData, setSourceData] = useState([]);
  const [conversionData, setConversionData] = useState(null);
  const [velocityData, setVelocityData] = useState(null);

  // Active Dropdown menu for export cards
  const [activeMenuId, setActiveMenuId] = useState(null);

  const pipelineRef = useRef(null);
  const trendsRef  = useRef(null);
  const conversionRef = useRef(null);
  const sourceRef  = useRef(null);
  const chartRefs = useMemo(() => ({
    pipeline: pipelineRef,
    trends: trendsRef,
    conversion: conversionRef,
    source: sourceRef,
  }), []);

  const loadAnalytics = async (useCache = true) => {
    try {
      setLoading(true);
      setError('');
      setLastUpdated(new Date().toLocaleTimeString());
      
      const queryParams = `?startDate=${startDate}&endDate=${endDate}`;
      
      const [overviewRes, pipelineRes, velocityRes, interviewerRes, sourceRes, conversionRes, trendsRes] = await Promise.all([
        apiGet(`/analytics/overview${queryParams}`, useCache),
        apiGet(`/analytics/pipeline${queryParams}`, useCache),
        apiGet(`/analytics/hiring-velocity${queryParams}`, useCache),
        apiGet(`/analytics/interviewer-load${queryParams}`, useCache),
        apiGet(`/analytics/source-analysis${queryParams}`, useCache),
        apiGet(`/analytics/stage-conversion${queryParams}`, useCache),
        apiGet(`/analytics/monthly-trends${queryParams}`, useCache)
      ]);

      if (overviewRes.success) setOverview(overviewRes.data);
      if (pipelineRes.success) setPipelineData(pipelineRes.data?.funnel || []);
      if (velocityRes.success) setVelocityData(velocityRes.data);
      if (interviewerRes.success) setInterviewerData(interviewerRes.data?.interviewers || []);
      if (sourceRes.success) setSourceData(sourceRes.data?.sources || []);
      if (conversionRes.success) setConversionData(conversionRes.data);
      if (trendsRes.success) setTrends(trendsRes.data?.months || []);

    } catch (err) {
      setError(err.message || 'Failed to retrieve analytics dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const shouldBypass = reloadTrigger > 0;
    loadAnalytics(!shouldBypass);
  }, [startDate, endDate, reloadTrigger]);

  // Singleton SSE — debounced reload (1s minimum between analytics refreshes)
  const lastAnalyticsSSERef = useRef(0);
  const ANALYTICS_SSE_DEBOUNCE = 1000;
  const ANALYTICS_SSE_TYPES = [
    'CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'APPLICATION_STATUS_UPDATED',
    'PIPELINE_MOVED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_UPDATED', 'INTERVIEW_FEEDBACK_SUBMITTED',
    'RECRUITER_UPDATED', 'RECRUITER_STATUS_UPDATED', 'TEAM_UPDATE', 'OFFER_DECISION',
    'DRIVE_CREATED', 'DRIVE_UPDATED'
  ];
  useEffect(() => {
    const unsub = subscribeSSE((payload) => {
      const now = Date.now();
      if (now - lastAnalyticsSSERef.current < ANALYTICS_SSE_DEBOUNCE) return;
      lastAnalyticsSSERef.current = now;
      setReloadTrigger(prev => prev + 1);
    }, ANALYTICS_SSE_TYPES);
    return unsub;
  }, []);

  const applyPreset = (days) => {
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - days);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(today.toISOString().split('T')[0]);
  };

  // Export Chart Card as PNG
  const exportAsPng = async (refKey, sectionName) => {
    const node = chartRefs[refKey].current;
    if (!node) return;
    setActiveMenuId(null);
    try {
      const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = imgData;
      link.download = `${sectionName}_analytics_${Date.now()}.png`;
      link.click();
    } catch (err) {
      console.error(err);
      alert("Failed to export card image");
    }
  };

  // Export Chart Card Data as CSV
  const exportAsCsv = (data, sectionName) => {
    setActiveMenuId(null);
    if (!data || data.length === 0) {
      alert("No data available to export");
      return;
    }
    try {
      const headers = Object.keys(data[0]);
      let csvContent = headers.join(',') + '\n';
      data.forEach(row => {
        csvContent += headers.map(h => {
          let val = row[h];
          if (typeof val === 'object' && val !== null) val = JSON.stringify(val).replace(/"/g, '""');
          return `"${val}"`;
        }).join(',') + '\n';
      });
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sectionName}_data_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export data");
    }
  };

  // Sparkline Mocks
  const mockSparklines = {
    candidates: [12, 18, 14, 25, 20, 31, 38],
    pipeline: [30, 28, 35, 30, 32, 40, 42],
    offers: [5, 8, 4, 12, 8, 14, 18],
    acceptance: [50, 60, 55, 68, 70, 72, 75],
    days: [26, 24, 25, 22, 23, 21, 21.4],
    interviews: [20, 35, 28, 42, 38, 48, 52],
    joined: [1, 2, 1, 3, 2, 4, 5],
    rejected: [5, 8, 12, 6, 9, 11, 8]
  };

  const pipelineDistributionData = useMemo(() => {
    if (!overview?.metrics) return [];
    
    const joined = overview.metrics.candidatesJoined || 0;
    const rejected = overview.metrics.candidatesRejected || 0;
    const pipeline = overview.metrics.activeCandidates || 0;
    const offered = overview.metrics.offersExtended || 0;
    
    const total = joined + rejected + pipeline + offered;
    
    return [
      { name: 'Joined', value: joined, color: '#10b981', percentage: total > 0 ? Math.round((joined / total) * 100) : 0 },
      { name: 'Rejected in Pipeline', value: rejected, color: '#f43f5e', percentage: total > 0 ? Math.round((rejected / total) * 100) : 0 },
      { name: 'In Pipeline', value: pipeline, color: '#1f52cc', percentage: total > 0 ? Math.round((pipeline / total) * 100) : 0 },
      { name: 'Offer Extended', value: offered, color: '#f2994a', percentage: total > 0 ? Math.round((offered / total) * 100) : 0 }
    ];
  }, [overview]);

  const renderSparkline = (dataPoints, stroke = "#1f52cc") => (
    <svg className="w-16 h-8 overflow-visible" viewBox="0 0 70 30">
      <path
        d={`M ${dataPoints.map((val, i) => `${i * 10},${30 - (val / Math.max(...dataPoints)) * 25}`).join(' L ')}`}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="analytics" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search analytics..."
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="System Administrator" fallbackRole="Admin" avatarSeed="analytics-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Header section with Date Inputs and Presets */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="os-eyebrow">Real-time Performance Metrics</div>
            <h1 className="os-h1">Advanced Analytics</h1>
            <p className="text-xs text-slate-500 mt-1">Last Updated: {lastUpdated}</p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Presets */}
            <div className="flex gap-1.5 flex-wrap">
              <button className="px-2.5 h-8 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50" onClick={() => applyPreset(7)}>Last 7 Days</button>
              <button className="px-2.5 h-8 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50" onClick={() => applyPreset(30)}>Last 30 Days</button>
              <button className="px-2.5 h-8 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50" onClick={() => applyPreset(90)}>Last 90 Days</button>
              <button className="px-2.5 h-8 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50" onClick={() => applyPreset(180)}>Last 6 Months</button>
            </div>

            {/* Date Picker inputs */}
            <div className="flex gap-2">
              <input 
                type="date"
                className="h-8 rounded border border-slate-200 px-2 text-xs outline-none bg-white font-semibold text-slate-600"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
              <input 
                type="date"
                className="h-8 rounded border border-slate-200 px-2 text-xs outline-none bg-white font-semibold text-slate-600"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            
            <button className="os-btn-primary !h-8 text-xs font-bold" onClick={() => loadAnalytics(false)}>Refresh</button>
          </div>
        </div>

        {error && <div className="mt-4 os-card p-4 text-red-600 bg-red-50 text-sm font-semibold">{error}</div>}

        {/* METRICS CARDS (7 grid items) */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mt-6">
          
          {/* Card 1: Total Candidates */}
          <Reveal className="os-card p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">group</span>
                {renderSparkline(mockSparklines.candidates, "#1f52cc")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.totalCandidates || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Total Candidates</div>
            </div>
            <div className={`text-[10px] font-bold mt-2 flex items-center gap-1 ${
              (overview?.trends?.totalCandidates || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              <span>{(overview?.trends?.totalCandidates || 0) >= 0 ? '▲' : '▼'}</span>
              <span>{Math.abs(overview?.trends?.totalCandidates || 0)}%</span>
            </div>
          </Reveal>

          {/* Card 2: Active in Pipeline */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.03}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">filter_alt</span>
                {renderSparkline(mockSparklines.pipeline, "#4f7ff3")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.activeCandidates || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Active in Pipeline</div>
            </div>
            <div className="text-[10px] font-bold mt-2 text-slate-400 flex items-center gap-1">
              <span>●</span>
              <span>Steady</span>
            </div>
          </Reveal>

          {/* Card 3: Offers Extended */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.06}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">contact_mail</span>
                {renderSparkline(mockSparklines.offers, "#9cb4ed")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.offersExtended || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Offers Extended</div>
            </div>
            <div className={`text-[10px] font-bold mt-2 flex items-center gap-1 ${
              (overview?.trends?.offersExtended || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              <span>{(overview?.trends?.offersExtended || 0) >= 0 ? '▲' : '▼'}</span>
              <span>{Math.abs(overview?.trends?.offersExtended || 0)}%</span>
            </div>
          </Reveal>

          {/* Card 4: Joined Candidates */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.08}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">check_circle</span>
                {renderSparkline(mockSparklines.joined, "#10b981")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.candidatesJoined || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Joined Candidates</div>
            </div>
            <div className="text-[10px] font-bold mt-2 text-emerald-600 flex items-center gap-1">
              <span>●</span>
              <span>Active</span>
            </div>
          </Reveal>

          {/* Card 5: Rejected Candidates */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.10}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">cancel</span>
                {renderSparkline(mockSparklines.rejected, "#f43f5e")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.candidatesRejected || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Rejected Candidates</div>
            </div>
            <div className="text-[10px] font-bold mt-2 text-rose-500 flex items-center gap-1">
              <span>●</span>
              <span>Overall</span>
            </div>
          </Reveal>

          {/* Card 6: Offer Acceptance Rate */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.12}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">verified_user</span>
                {renderSparkline(mockSparklines.acceptance, "#22c55e")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : `${overview?.metrics?.offerAcceptanceRate || 0}%`}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Acceptance Rate</div>
            </div>
            <div className={`text-[10px] font-bold mt-2 flex items-center gap-1 ${
              (overview?.trends?.offerAcceptanceRate || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              <span>{(overview?.trends?.offerAcceptanceRate || 0) >= 0 ? '▲' : '▼'}</span>
              <span>{Math.abs(overview?.trends?.offerAcceptanceRate || 0)}% diff</span>
            </div>
          </Reveal>

          {/* Card 8: Interviews This Month */}
          <Reveal className="os-card p-4 flex flex-col justify-between" delay={0.16}>
            <div>
              <div className="flex items-center justify-between text-slate-400">
                <span className="material-symbols-outlined text-base">forum</span>
                {renderSparkline(mockSparklines.interviews, "#a855f7")}
              </div>
              <div className="text-2xl font-bold font-[Manrope] text-slate-800 mt-2">
                {loading ? <SkeletonBox width="60%" height={28} borderRadius={6} /> : overview?.metrics?.interviewsCompletedThisMonth || 0}
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Interviews (Month)</div>
            </div>
            <div className={`text-[10px] font-bold mt-2 flex items-center gap-1 ${
              (overview?.trends?.interviewsThisMonth || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              <span>{(overview?.trends?.interviewsThisMonth || 0) >= 0 ? '▲' : '▼'}</span>
              <span>{Math.abs(overview?.trends?.interviewsThisMonth || 0)}%</span>
            </div>
          </Reveal>
        </div>

        {/* Section 1: Pipeline Funnel */}
        <div className="mt-6">
          {/* Funnel conversions Table */}
          <Reveal className="os-card p-6">
            <h3 className="text-lg font-bold font-[Manrope] text-slate-800 mb-6">Stage Conversion Efficiency</h3>
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-bold text-xs uppercase">
                  <th className="pb-3">Stage</th>
                  <th className="pb-3">Count</th>
                  <th className="pb-3">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [1, 2, 3, 4, 5].map(i => (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-3"><SkeletonBox width="45%" height={16} /></td>
                      <td className="py-3"><SkeletonBox width="25%" height={16} /></td>
                      <td className="py-3"><SkeletonBox width="35%" height={16} /></td>
                    </tr>
                  ))
                ) : (
                  pipelineData.map((row, idx) => (
                    <tr key={row.stage} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-3 font-semibold text-slate-700">{row.label}</td>
                      <td className="py-3 text-slate-600 font-mono font-semibold">{row.count}</td>
                      <td className="py-3 font-bold text-[#1f52cc]">{row.percentage}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Reveal>
        </div>

        {/* Section 2: Monthly Hiring Trends */}
        <Reveal className="os-card mt-6 p-6 relative" ref={chartRefs.trends}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold font-[Manrope] text-slate-800">Monthly Recruitment Flow Trends</h3>
            <div className="relative">
              <button className="material-symbols-outlined text-slate-400 hover:text-slate-600" onClick={() => setActiveMenuId(activeMenuId === 'trends' ? null : 'trends')}>more_vert</button>
              {activeMenuId === 'trends' && (
                <div className="absolute right-0 mt-1 z-30 w-32 bg-white border border-slate-200 rounded-xl shadow-lg p-1">
                  <button className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 rounded-lg" onClick={() => exportAsPng('trends', 'monthly_trends')}>Export PNG</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 rounded-lg" onClick={() => exportAsCsv(trends, 'monthly_trends')}>Export CSV</button>
                </div>
              )}
            </div>
          </div>
          <div className="h-[300px]">
            {loading ? (
              <div className="h-full w-full bg-slate-50 animate-pulse rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eef6" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6b7895' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7895' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="candidatesAdded" name="Candidates Added" fill="#1f52cc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="interviewsScheduled" name="Interviews Scheduled" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="offersExtended" name="Offers Extended" stroke="#f2994a" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="candidatesJoined" name="Joined Candidates" stroke="#22c55e" strokeWidth={2.5} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Reveal>




        {/* Section 5 & 6: Stage Conversion Funnel & Source Analysis */}
        <div className="grid lg:grid-cols-2 gap-6 mt-6">
          
          {/* Section 5: Stage Conversion Vertical Trapezoid funnel */}
          <Reveal className="os-card p-6 relative" ref={chartRefs.conversion}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold font-[Manrope] text-slate-800">Stage Conversion Funnel</h3>
              <div className="relative">
                <button className="material-symbols-outlined text-slate-400 hover:text-slate-600" onClick={() => setActiveMenuId(activeMenuId === 'conversion' ? null : 'conversion')}>more_vert</button>
                {activeMenuId === 'conversion' && (
                  <div className="absolute right-0 mt-1 z-30 w-32 bg-white border border-slate-200 rounded-xl shadow-lg p-1">
                    <button className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 rounded-lg" onClick={() => exportAsPng('conversion', 'stage_conversion')}>Export PNG</button>
                  </div>
                )}
              </div>
            </div>
            
            {/* Custom SVG Vertical Trapezoid funnel chart */}
            <div className="flex flex-col items-center py-4 bg-slate-50/50 rounded-xl border border-slate-100">
              {conversionData?.stages ? (
                <div className="space-y-2 w-full max-w-sm">
                  {conversionData.stages.map((stg, idx) => {
                    // Width scaling (trapezoid top/bottom)
                    const widthPercent = (stg.count / conversionData.stages[0].count) * 100;
                    const nextStg = conversionData.stages[idx + 1];
                    const nextWidth = nextStg ? (nextStg.count / conversionData.stages[0].count) * 100 : widthPercent;
                    
                    return (
                      <React.Fragment key={stg.stage}>
                        <div className="flex flex-col items-center">
                          {/* Trapezoid layer */}
                          <div 
                            className="h-10 rounded-lg flex items-center justify-between px-4 text-xs font-bold text-white transition-all shadow-sm"
                            style={{ 
                              width: `${Math.max(30, widthPercent)}%`, 
                              backgroundColor: stg.color || '#1f52cc',
                              clipPath: `polygon(5% 0%, 95% 0%, 100% 100%, 0% 100%)`
                            }}
                          >
                            <span className="truncate pr-2">{stg.stage}</span>
                            <span className="font-mono">{stg.count}</span>
                          </div>
                        </div>

                        {/* Conversion Arrow */}
                        {nextStg && conversionData.conversions?.[idx] !== undefined && (
                          <div className="flex flex-col items-center">
                            <span className="material-symbols-outlined text-slate-400 text-sm leading-none">arrow_downward</span>
                            <span className="text-[10px] font-bold text-[#1f52cc] bg-blue-50 border border-blue-100 rounded-full px-2 py-0.2">
                              {conversionData.conversions[idx]}% conversion
                            </span>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-slate-400 animate-pulse">Loading stages...</div>
              )}
            </div>
          </Reveal>

          {/* Section 6: Pipeline Funnel Breakdown */}
          <Reveal className="os-card p-6 relative" ref={chartRefs.source}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold font-[Manrope] text-slate-800">Pipeline Funnel Analysis</h3>
              <div className="relative">
                <button className="material-symbols-outlined text-slate-400 hover:text-slate-600" onClick={() => setActiveMenuId(activeMenuId === 'source' ? null : 'source')}>more_vert</button>
                {activeMenuId === 'source' && (
                  <div className="absolute right-0 mt-1 z-30 w-32 bg-white border border-slate-200 rounded-xl shadow-lg p-1">
                    <button className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 rounded-lg" onClick={() => exportAsPng('source', 'pipeline_funnel_analysis')}>Export PNG</button>
                    <button className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 rounded-lg" onClick={() => exportAsCsv(pipelineDistributionData, 'pipeline_funnel_analysis')}>Export CSV</button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              
              {/* Donut Chart with count in center */}
              <div className="h-[180px] relative flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(value, name) => [value, name]} />
                    <Pie
                      data={pipelineDistributionData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={3}
                    >
                      {pipelineDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                
                {/* Center text */}
                <div className="absolute text-center flex flex-col items-center">
                  <span className="text-2xl font-bold font-[Manrope] text-slate-800">
                    {pipelineDistributionData.reduce((acc, curr) => acc + curr.value, 0)}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Total</span>
                </div>
              </div>

              {/* Legend details Table */}
              <div className="text-xs space-y-2 w-full">
                {pipelineDistributionData.map((s) => (
                  <div key={s.name} className="flex justify-between items-center border-b border-slate-100 pb-1.5 font-[Manrope]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="font-semibold text-slate-700">{s.name}</span>
                    </div>
                    <span className="font-mono text-slate-500 font-bold">{s.value} ({s.percentage}%)</span>
                  </div>
                ))}
              </div>

            </div>
          </Reveal>
        </div>

      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Analytics;
