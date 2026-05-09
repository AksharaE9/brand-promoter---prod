import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import Loader from '../components/Loader';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import Skeleton, { DashboardSkeleton } from '../components/Skeleton';

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

const FeedItem = React.memo(({ app, onClick, delay }) => (
  <motion.button
    className="flex gap-3 w-full text-left p-2 rounded-xl hover:bg-[#f8fafc] transition-colors"
    type="button"
    onClick={onClick}
    initial={{ opacity: 0, x: 8 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: true, amount: 0.6 }}
    transition={{ delay, duration: 0.3 }}
  >
    {app.candidate?.profilePhotoFile?.storageKey ? (
      <img className="w-10 h-10 rounded-full object-cover" src={app.candidate.profilePhotoFile.storageKey} alt="candidate" />
    ) : (
      <div className="w-10 h-10 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-xs">
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

  const getRecentDates = (days) => {
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d);
    }
    return dates;
  };

  const toChartPath = (data) => {
    if (!data.length) return '';
    const max = Math.max(...data, 1);
    const height = 40;
    const width = 200;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
  };


  const canManageJobs = useMemo(() => ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role), [currentUser]);
  const greetingName = useMemo(() => (currentUser?.fullName || 'Marcus').split(' ')[0], [currentUser]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await apiGet('/dashboard/init');
        if (!mounted) return;
        const { stats, recentApplications, upcomingInterviews } = res.data;
        setCandidatesTotal(stats.candidates || 0);
        setJobsTotal(stats.activeJobs || 0);
        setApplications(recentApplications || []);
        setInterviews(upcomingInterviews || []);
        setUsersTotal(stats.activeUsers || 0);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load dashboard data');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [currentUser?.role]);

  const recentApplicants = useMemo(() => applications.slice(0, 6), [applications]);

  const pipelineChart = useMemo(() => {
    const recentDays = getRecentDates(7);
    const getLocalYMD = (dateObj) => {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const keyed = new Map(recentDays.map((d) => [getLocalYMD(d), { sourced: 0, hired: 0 }]));
    applications.forEach((app) => {
      const created = app?.createdAt ? new Date(app.createdAt) : null;
      if (!created || Number.isNaN(created.getTime())) return;
      const key = getLocalYMD(created);
      if (!keyed.has(key)) return;
      const row = keyed.get(key);
      row.sourced += 1;
      if (app.status === 'SELECTED' || app.status === 'JOINED') row.hired += 1;
    });

    const labels = recentDays.map((d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Unknown');

    const sourced = labels.map((_, idx) => keyed.get(getLocalYMD(recentDays[idx]))?.sourced || 0);
    const hired = labels.map((_, idx) => keyed.get(getLocalYMD(recentDays[idx]))?.hired || 0);
    const sourcedPath = toChartPath(sourced);
    const hiredPath = toChartPath(hired);
    const maxSourced = Math.max(...sourced, 0);
    const maxIndex = Math.max(0, sourced.findIndex((value) => value === maxSourced));
    return { labels, sourced, hired, sourcedPath, hiredPath, maxSourced, maxIndex };
  }, [applications]);

  const metrics = useMemo(() => {
    const interviewsToday = interviews.filter((item) => {
      const when = item?.scheduledStart ? new Date(item.scheduledStart) : null;
      return when && when.toDateString() === new Date().toDateString();
    }).length;

    const selected = applications.filter((a) => a.status === 'SELECTED').length;
    const joined = applications.filter((a) => a.status === 'JOINED').length;
    const activeRecruiters = interviews.filter((item) => item?.interviewers?.length > 0).length;

    const items = [
      { label: 'Total Candidates', value: candidatesTotal, tag: '+12%', href: '/candidates' },
      { label: 'Active Roles', value: jobsTotal, tag: '+4', href: '/jobs' },
      { label: 'Interviews Today', value: interviewsToday, tag: 'Busy Day', href: '/schedule' },
      { label: 'Offer Pending', value: selected, tag: '85% Rate', href: '/candidates?status=OFFER_SENT' },
    ];
    return items;
  }, [applications, candidatesTotal, interviews, jobsTotal]);


  if (loading) {
    return (
      <EnterpriseLayout
        header={
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
              {/* SVG logic here ... */}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="os-card p-6">
              <div className="text-xl font-bold mb-4">Live Feed</div>
              <div className="space-y-2">
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
