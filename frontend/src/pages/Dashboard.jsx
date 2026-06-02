import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import Skeleton, { DashboardSkeleton } from '../components/Skeleton';
import { subscribeSSE } from '../lib/sse';

// SSE types that should trigger a dashboard refresh
const DASHBOARD_SSE_TYPES = [
  'CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'APPLICATION_STATUS_UPDATED',
  'INTERVIEW_SCHEDULED', 'INTERVIEW_UPDATED', 'INTERVIEW_FEEDBACK_SUBMITTED', 'PIPELINE_MOVED',
  'JOB_CREATED', 'JOB_UPDATED', 'JOB_STATUS_UPDATED',
  'TEAM_UPDATE', 'OFFER_DECISION'
];

// Minimum 1s between SSE-triggered refreshes
const SSE_DEBOUNCE_MS = 1000;

const MetricCard = React.memo(({ label, value, tag, tagColor = '#29a86f', onClick, delay }) => (
  <Reveal delay={delay}>
    <button
      className="os-card p-5 w-full text-left"
      style={{ cursor: 'pointer' }}
      type="button"
      onClick={onClick}
    >
      <div className="flex justify-between items-center text-sm text-[#7c87a1]">
        <span>{label}</span>
        <span className="font-semibold text-xs" style={{ color: tagColor }}>{tag}</span>
      </div>
      <div className="mt-3 text-3xl font-bold text-[#10193f]" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {value}
      </div>
    </button>
  </Reveal>
));
MetricCard.displayName = 'MetricCard';

const FeedItem = React.memo(({ app, onClick, delay }) => {
  const initial = (app.candidate?.fullName || 'C')[0].toUpperCase();
  return (
    <button
      className="flex gap-3 w-full text-left p-2 rounded-xl reveal-fade"
      style={{
        background: 'transparent',
        cursor: 'pointer',
        animationDelay: `${delay}s`
      }}
      type="button"
      onClick={onClick}
    >
      <div className="w-10 h-10 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-sm shrink-0">
        {initial}
      </div>
      <div className="overflow-hidden">
        <div className="text-sm font-medium leading-snug truncate">
          {app.candidate?.fullName || 'Candidate'}
        </div>
        <div className="text-xs text-slate-400 mt-0.5 truncate">
          {app.status ? app.status.replace(/_/g, ' ') : 'Pipeline Update'}
        </div>
      </div>
    </button>
  );
});
FeedItem.displayName = 'FeedItem';

const Dashboard = () => {
  const navigate = useNavigate();
  const currentUser = useMemo(() => getStoredUser(), []);

  // Dashboard data state
  const [stats, setStats] = useState({ candidates: 0, activeJobs: 0, activeUsers: 0 });
  const [recentApplications, setRecentApplications] = useState([]);
  const [upcomingInterviews, setUpcomingInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const lastRefreshRef = useRef(0);
  const mountedRef = useRef(true);

  const greetingName = useMemo(() => {
    const name = currentUser?.fullName || currentUser?.email || 'there';
    return name.split(' ')[0];
  }, [currentUser]);

  const applyData = useCallback((data) => {
    if (!data) return;
    if (data.stats) setStats(data.stats);
    if (Array.isArray(data.recentApplications)) setRecentApplications(data.recentApplications);
    if (Array.isArray(data.upcomingInterviews)) setUpcomingInterviews(data.upcomingInterviews);
  }, []);

  const fetchDashboard = useCallback(async (bypassCache = false) => {
    try {
      const res = await apiGet('/dashboard/init', !bypassCache);
      if (!mountedRef.current) return;
      if (res?.success && res?.data) {
        applyData(res.data);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (!bypassCache) setError(err.message || 'Failed to load dashboard');
    }
  }, [applyData]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchDashboard(false).finally(() => {
      if (mountedRef.current) setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [fetchDashboard]);

  // SSE subscription — refresh on relevant events with debounce
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (!DASHBOARD_SSE_TYPES.includes(event.type)) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < SSE_DEBOUNCE_MS) return;
      lastRefreshRef.current = now;
      fetchDashboard(true); // bypass cache for real-time feel
    });
    return unsub;
  }, [fetchDashboard]);

  // Metrics computed from state
  const interviewsToday = useMemo(() => {
    const todayStr = new Date().toDateString();
    return upcomingInterviews.filter(iv => {
      const d = iv.scheduledStart ? new Date(iv.scheduledStart) : null;
      return d && d.toDateString() === todayStr;
    }).length;
  }, [upcomingInterviews]);

  const offerPending = useMemo(
    () => recentApplications.filter(a => a.status === 'OFFER_SENT' || a.status === 'SELECTED').length,
    [recentApplications],
  );

  const feedItems = useMemo(() => recentApplications.slice(0, 6), [recentApplications]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <EnterpriseLayout
        sidebar={<EnterpriseSidebar active="dashboard" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
        topbar={
          <EnterpriseTopbar
            searchPlaceholder="Search candidates..."
            tabs={[]}
            right={<><NotificationBell /><UserChip avatarSeed="dashboard" /></>}
          />
        }
      >
        <div className="mb-6">
          <Skeleton width="120px" height="12px" className="mb-2" />
          <Skeleton width="280px" height="36px" />
        </div>
        <DashboardSkeleton />
      </EnterpriseLayout>
    );
  }

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="dashboard" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidates..."
          tabs={[]}
          right={<><NotificationBell /><UserChip avatarSeed="dashboard" /></>}
        />
      }
    >
      <PageEnter>
        {/* Header */}
        <div className="mb-6">
          <div className="os-eyebrow">Performance Overview</div>
          <h1 className="os-h1">{greeting}, {greetingName}.</h1>
          {error && (
            <div className="mt-2 text-sm text-red-500 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">warning</span>
              {error}
              <button
                type="button"
                className="underline ml-1"
                onClick={() => { setError(''); fetchDashboard(true); }}
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            label="Total Candidates"
            value={stats.candidates ?? 0}
            tag="All time"
            delay={0}
            onClick={() => navigate('/candidates')}
          />
          <MetricCard
            label="Active Roles"
            value={stats.activeJobs ?? 0}
            tag="Open now"
            delay={0.05}
            onClick={() => navigate('/jobs')}
          />
          <MetricCard
            label="Interviews Today"
            value={interviewsToday}
            tag="Scheduled"
            tagColor="#3b82f6"
            delay={0.1}
            onClick={() => navigate('/schedule')}
          />
          <MetricCard
            label="Offer Pending"
            value={offerPending}
            tag="Awaiting"
            tagColor="#f59e0b"
            delay={0.15}
            onClick={() => navigate('/candidates')}
          />
        </div>

        {/* Lower section */}
        <div className="grid lg:grid-cols-3 gap-4 mt-4">
          {/* Pipeline Summary */}
          <Reveal className="lg:col-span-2">
            <div className="os-card p-6 h-full">
              <div className="text-xl font-bold mb-4">Pipeline Summary</div>
              {stats.funnel ? (
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(stats.funnel).map(([status, count]) => (
                    <div key={status} className="bg-slate-50 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-[#10193f]">{count}</div>
                      <div className="text-xs text-slate-500 mt-1">{status.replace(/_/g, ' ')}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm italic">No pipeline data yet.</div>
              )}
            </div>
          </Reveal>

          {/* Live Feed */}
          <Reveal delay={0.1}>
            <div className="os-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xl font-bold">Live Feed</div>
                {recentApplications.length > 0 && (
                  <span className="text-xs text-[#29a86f] font-semibold bg-[#f0fdf4] px-2 py-0.5 rounded-full">
                    Live
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {feedItems.length === 0 ? (
                  <div className="text-slate-400 text-sm italic">No recent activity.</div>
                ) : (
                  feedItems.map((app, idx) => (
                    <FeedItem
                      key={app.id}
                      app={app}
                      onClick={() => navigate(`/candidate/${app.candidateId || app.candidate?.id}`)}
                      delay={idx * 0.04}
                    />
                  ))
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Dashboard;
