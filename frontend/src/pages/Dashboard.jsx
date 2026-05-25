import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import Skeleton, { DashboardSkeleton } from '../components/Skeleton';
import { subscribeSSE } from '../lib/sse';

const DASHBOARD_SSE_TYPES = [
  'CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'APPLICATION_STATUS_UPDATED',
  'INTERVIEW_SCHEDULED', 'INTERVIEW_FEEDBACK_SUBMITTED', 'PIPELINE_MOVED',
];
// Debounce: minimum 10s between SSE-triggered dashboard refreshes
const SSE_REFRESH_DEBOUNCE_MS = 10000;

const MetricCard = React.memo(({ metric, onClick, delay }) => (
  <Reveal delay={delay}>
    <button
      className="os-card p-5 w-full text-left hover:scale-[1.02] transition-transform"
      type="button"
      onClick={onClick}
    >
      <div className="flex justify-between items-center text-sm text-[#7c87a1]">
        <span>{metric.label}</span>
        <span className="text-[#29a86f] font-semibold text-xs">{metric.tag}</span>
      </div>
      <div className="mt-3 text-3xl font-bold text-[#10193f] font-[Manrope]">{metric.value}</div>
    </button>
  </Reveal>
));
MetricCard.displayName = 'MetricCard';

const FeedItem = React.memo(({ app, onClick, delay }) => (
  <motion.button
    className="flex gap-3 w-full text-left p-2 rounded-xl hover:bg-[#f8fafc] transition-colors"
    type="button"
    onClick={onClick}
    initial={{ opacity: 0, x: 8 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.25 }}
  >
    {app.candidate?.profilePhotoFile?.storageKey ? (
      <img className="w-10 h-10 rounded-full object-cover" src={app.candidate.profilePhotoFile.storageKey} alt="candidate" loading="lazy" />
    ) : (
      <div className="w-10 h-10 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-xs shrink-0">
        {(app.candidate?.fullName || 'C').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 1)}
      </div>
    )}
    <div>
      <div className="text-sm leading-snug">
        {app.candidate?.fullName || 'Candidate'} moved to {app.currentStage?.name || 'Pipeline'}
      </div>
      <div className="os-muted text-xs mt-1">Activity</div>
    </div>
  </motion.button>
));
FeedItem.displayName = 'FeedItem';

const Dashboard = () => {
  const navigate = useNavigate();
  const currentUser = useMemo(() => getStoredUser(), []);
  const [usersTotal, setUsersTotal] = useState(0);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [applications, setApplications] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Track last SSE-triggered refresh time to debounce
  const lastRefreshRef = useRef(0);

  const applyDashboardData = useCallback((data) => {
    const { stats, recentApplications, upcomingInterviews } = data;
    setCandidatesTotal(stats.candidates || 0);
    setJobsTotal(stats.activeJobs || 0);
    setApplications(recentApplications || []);
    setInterviews(upcomingInterviews || []);
    setUsersTotal(stats.activeUsers || 0);
  }, []);

  const canManageJobs = useMemo(() => ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role), [currentUser]);
  const greetingName = useMemo(() => (currentUser?.fullName || 'there').split(' ')[0], [currentUser]);

  // Initial load
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await apiGet('/dashboard/init');
        if (!mounted) return;
        applyDashboardData(res.data);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load dashboard data');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [applyDashboardData]);

  // Singleton SSE subscription — debounced refresh
  useEffect(() => {
    const unsub = subscribeSSE((data) => {
      if (!DASHBOARD_SSE_TYPES.includes(data.type)) return;
      const now = Date.now();
      if (now - lastRefreshRef.current < SSE_REFRESH_DEBOUNCE_MS) return;
      lastRefreshRef.current = now;
      apiGet('/dashboard/init')
        .then(res => applyDashboardData(res.data))
        .catch(() => {});
    }, DASHBOARD_SSE_TYPES);
    return unsub;
  }, [applyDashboardData]);

  const recentApplicants = useMemo(() => applications.slice(0, 6), [applications]);

  const metrics = useMemo(() => {
    const interviewsToday = interviews.filter(item => {
      const when = item?.scheduledStart ? new Date(item.scheduledStart) : null;
      return when && when.toDateString() === new Date().toDateString();
    }).length;
    const selected = applications.filter(a => a.status === 'SELECTED').length;
    return [
      { label: 'Total Candidates', value: candidatesTotal, tag: 'All time', href: '/candidates' },
      { label: 'Active Roles',     value: jobsTotal,       tag: 'Open now', href: '/jobs' },
      { label: 'Interviews Today', value: interviewsToday, tag: 'Scheduled', href: '/schedule' },
      { label: 'Offer Pending',    value: selected,        tag: '85% Rate', href: '/candidates?status=OFFER_SENT' },
    ];
  }, [applications, candidatesTotal, interviews, jobsTotal]);

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
        <PageEnter>
          <div className="mb-6">
            <Skeleton width="150px" height="12px" className="mb-2" />
            <Skeleton width="250px" height="32px" />
          </div>
          <DashboardSkeleton />
        </PageEnter>
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="os-eyebrow">Performance Overview</div>
            <h1 className="os-h1">Morning, {greetingName}.</h1>
          </div>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          {metrics.map((metric, idx) => (
            <MetricCard
              key={metric.label}
              metric={metric}
              onClick={() => navigate(metric.href)}
              delay={idx * 0.05}
            />
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4 mt-4">
          <Reveal className="lg:col-span-2">
            <div className="os-card p-6 h-full">
              <div className="text-2xl font-semibold font-[Manrope]">Pipeline Velocity</div>
              <div className="mt-4 text-slate-400 text-sm italic">Activity trends loaded from recent applications.</div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="os-card p-6">
              <div className="text-xl font-bold mb-4">Live Feed</div>
              <div className="space-y-2">
                {recentApplicants.length === 0 && (
                  <div className="text-slate-400 text-sm italic">No recent activity.</div>
                )}
                {recentApplicants.map((app, idx) => (
                  <FeedItem
                    key={app.id}
                    app={app}
                    onClick={() => navigate(`/candidate/${app.candidate?.id}`)}
                    delay={idx * 0.04}
                  />
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Dashboard;
