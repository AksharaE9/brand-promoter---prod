import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import Skeleton, { DashboardSkeleton } from '../components/Skeleton';
import LazySection from '../components/LazySection';
import { subscribeSSE } from '../lib/sse';

// SSE types that should trigger a dashboard refresh
const DASHBOARD_SSE_TYPES = [
  'CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'APPLICATION_STATUS_UPDATED',
  'INTERVIEW_SCHEDULED', 'INTERVIEW_UPDATED', 'INTERVIEW_FEEDBACK_SUBMITTED', 'PIPELINE_MOVED',
  'JOB_CREATED', 'JOB_UPDATED', 'JOB_STATUS_CHANGED',
  'TEAM_UPDATE', 'OFFER_DECISION', 'SCHEDULING_UPDATE', 'ROUND_CREATED', 'ROUND_DELETED',
  'INTERVIEW_PANELISTS_UPDATED'
];

// Minimum 1.5s between SSE-triggered refreshes
const SSE_DEBOUNCE_MS = 1500;

const fetchDashboardData = () => apiGet('/dashboard/summary');

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
  const queryClient = useQueryClient();
  const currentUser = useMemo(() => getStoredUser(), []);

  const lastRefreshRef = useRef(0);

  const greetingName = useMemo(() => {
    const name = currentUser?.fullName || currentUser?.email || 'there';
    return name.split(' ')[0];
  }, [currentUser]);

  // ── React Query: staleTime 2min means returning to dashboard within 2min
  // shows data INSTANTLY from cache without any network request or loading spinner.
  const {
    data: dashData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    staleTime: 2 * 60_000,        // 2 minutes — data served from cache on revisit
    gcTime: 10 * 60_000,          // 10 minutes — keep in memory after unmount
    refetchOnMount: 'always',     // always revalidate in background on mount
    refetchOnWindowFocus: false,
    select: (res) => res?.data ?? res,
  });

  const stats = dashData?.stats ?? { candidates: 0, activeJobs: 0, activeUsers: 0 };
  const recentApplications = dashData?.recentApplications ?? [];
  const upcomingInterviews = dashData?.upcomingInterviews ?? [];

  // SSE subscription — invalidate React Query cache on relevant events with debounce
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (!DASHBOARD_SSE_TYPES.includes(event.type)) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < SSE_DEBOUNCE_MS) return;
      lastRefreshRef.current = now;
      // Invalidate and refetch in background — UI stays visible (no spinner)
      queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' });
    });
    return unsub;
  }, [queryClient]);

  // interviewsTodayCount: real COUNT(*) from backend (not filtered from a capped 10-row array).
  // Falls back to the old client-side filter if the backend hasn't returned interviewsTodayCount yet.
  const interviewsToday = useMemo(() => {
    if (typeof dashData?.interviewsTodayCount === 'number') {
      return dashData.interviewsTodayCount;
    }
    // Legacy fallback: count today's interviews from the capped 10-row feed
    const todayStr = new Date().toDateString();
    return upcomingInterviews.filter(iv => {
      const d = iv.scheduledStart ? new Date(iv.scheduledStart) : null;
      return d && d.toDateString() === todayStr;
    }).length;
  }, [dashData?.interviewsTodayCount, upcomingInterviews]);

  const offerPending = useMemo(
    () => recentApplications.filter(a => a.status === 'OFFER_SENT' || a.status === 'SELECTED').length,
    [recentApplications],
  );

  const feedItems = useMemo(() => recentApplications.slice(0, 6), [recentApplications]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Show skeleton ONLY on first ever load (no cached data at all)
  if (isLoading && !dashData) {
    return (
      <EnterpriseLayout
        sidebar={<EnterpriseSidebar active="dashboard" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
        topbar={
          <EnterpriseTopbar
            searchPlaceholder="Search candidates..."
            onSearchChange={(e) => navigate(`/candidates?search=${encodeURIComponent(e.target.value)}`)}
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
          onSearchChange={(e) => navigate(`/candidates?search=${encodeURIComponent(e.target.value)}`)}
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
          {isError && (
            <div className={`mt-3 p-4 rounded-xl flex items-start gap-3 border ${
              error?.status === 503 
                ? 'bg-amber-50 border-amber-200 text-amber-800' 
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <span className="material-symbols-outlined text-xl mt-0.5 shrink-0">
                {error?.status === 503 ? 'hourglass_empty' : 'error'}
              </span>
              <div className="flex-1 text-sm font-medium">
                <div>{error?.message || 'Failed to load dashboard'}</div>
                {error?.status === 503 && (
                  <div className="text-xs text-amber-600 mt-1">
                    Auto-retry will initiate in a moment. You can also manually retry.
                  </div>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold underline block"
                  onClick={() => refetch()}
                >
                  Retry Now
                </button>
              </div>
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

        {/* Lower section - lazy loaded below the fold */}
        <LazySection height="320px">
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
        </LazySection>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Dashboard;
