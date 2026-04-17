import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

function getRecentDates(days) {
  const now = new Date();
  return Array.from({ length: days }).map((_, index) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - index));
    d.setHours(0, 0, 0, 0);
    return d;
  });
}

function toChartPath(values, width = 620, height = 240, padding = 20) {
  if (!values.length) return '';
  const maxVal = Math.max(1, ...values);
  const stepX = (width - padding * 2) / Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = padding + index * stepX;
      const y = height - padding - (value / maxVal) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

const Dashboard = () => {
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const [usersTotal, setUsersTotal] = useState(0);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [applications, setApplications] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [error, setError] = useState('');

  const canManageJobs = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);
  const greetingName = (currentUser?.fullName || 'Marcus').split(' ')[0];

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const res = await apiGet('/dashboard/init');
        const { stats, recentApplications, upcomingInterviews } = res.data;

        if (!mounted) return;

        setCandidatesTotal(stats.candidates || 0);
        setJobsTotal(stats.activeJobs || 0);
        setApplications(recentApplications || []);
        setInterviews(upcomingInterviews || []);

        setUsersTotal(stats.activeUsers || 0);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load dashboard data');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [currentUser?.role]);

  const recentApplicants = applications.slice(0, 6);

  const pipelineChart = useMemo(() => {
    const recentDays = getRecentDates(7);

    const getLocalYMD = (dateObj) => {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const keyed = new Map(
      recentDays.map((d) => [getLocalYMD(d), { sourced: 0, hired: 0 }]),
    );

    applications.forEach((app) => {
      const created = app?.createdAt ? new Date(app.createdAt) : null;
      if (!created || Number.isNaN(created.getTime())) return;
      const key = getLocalYMD(created);
      if (!keyed.has(key)) return;
      const row = keyed.get(key);
      row.sourced += 1;
      if (app.status === 'SELECTED' || app.status === 'JOINED') {
        row.hired += 1;
      }
    });

    const labels = recentDays.map((d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
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
      if (!when) return false;
      const now = new Date();
      return when.toDateString() === now.toDateString();
    }).length;

    const selected = applications.filter((a) => a.status === 'SELECTED').length;
    const joined = applications.filter((a) => a.status === 'JOINED').length;
    const activeRecruiters = interviews.filter((item) => item?.interviewers?.length > 0).length;

    if (currentUser?.role === 'INTERVIEWER') {
      const myInterviews = interviews.filter((item) => item.interviewers?.some(u => u.id === currentUser.id));
      const pendingFeedback = myInterviews.filter((item) => !item.mandatoryFeedbackSubmitted).length;
      return [
        { label: 'My Interviews', value: myInterviews.length, tag: 'Assigned', href: '/schedule' },
        { label: 'Feedback Pending', value: pendingFeedback, tag: 'Action', href: '/schedule' },
        { label: 'Candidates In Pipeline', value: applications.filter((a) => a.status === 'IN_PIPELINE').length, tag: 'Live', href: '/pipeline' },
        { label: 'Joined Candidates', value: joined, tag: 'Outcome', href: '/reports' },
      ];
    }

    if (currentUser?.role === 'SUPER_ADMIN') {
      return [
        { label: 'Total Users', value: usersTotal, tag: 'Access', href: '/settings' },
        { label: 'Active Roles', value: jobsTotal, tag: 'Open', href: '/jobs' },
        { label: 'Interviews Today', value: interviewsToday, tag: 'Live', href: '/schedule' },
        { label: 'Selected Candidates', value: selected, tag: 'Progress', href: '/reports' },
      ];
    }

    return [
      { label: 'Total Candidates', value: candidatesTotal, tag: '+12%', href: '/candidates' },
      { label: 'Active Roles', value: jobsTotal, tag: '+4', href: '/jobs' },
      { label: 'Interviews Today', value: interviewsToday, tag: 'Busy Day', href: '/schedule' },
      { label: 'Offer Pending', value: selected, tag: '85% Rate', href: '/pipeline' },
      { label: 'Joined', value: joined, tag: 'Finalized', href: '/reports' },
      { label: 'Interviewer Activity', value: activeRecruiters, tag: 'Coverage', href: '/team' },
    ].slice(0, 4);
  }, [applications, candidatesTotal, currentUser, interviews, jobsTotal, usersTotal]);

  const nextPersonalInterview = useMemo(() => {
    if (!interviews.length) return null;
    const now = new Date();
    const upcoming = interviews
      .filter((iv) => {
        const start = new Date(iv.scheduledStart);
        const isAssigned = iv.interviewers?.some((u) => u.id === currentUser?.id);
        return isAssigned && start > now && !iv.mandatoryFeedbackSubmitted;
      })
      .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));

    return upcoming[0] || null;
  }, [interviews, currentUser?.id]);

  const isInterviewSoon = useMemo(() => {
    if (!nextPersonalInterview) return false;
    const start = new Date(nextPersonalInterview.scheduledStart);
    const now = new Date();
    const diffMs = start - now;
    return diffMs > 0 && diffMs < 1000 * 60 * 60; // Less than 1 hour
  }, [nextPersonalInterview]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="dashboard" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidates, jobs, or tasks..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              {canManageJobs ? (
                <button className="os-btn-primary" type="button" onClick={() => navigate('/jobs')}>
                  + Create Job
                </button>
              ) : null}
              <UserChip fallbackName={currentUser?.fullName || 'Marcus Thorne'} fallbackRole={String(currentUser?.role || 'Head of Talent').replace('_', ' ')} avatarSeed="dashboard-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {nextPersonalInterview && (
          <Reveal delay={0}>
            <div 
              className={`mb-6 p-1 rounded-2xl ${isInterviewSoon ? 'bg-gradient-to-r from-[#ff4d4d] to-[#f31262] animate-pulse shadow-[0_0_20px_rgba(243,18,98,0.3)]' : 'bg-gradient-to-r from-[#1f52cc] to-[#35b577]'} cursor-pointer`}
              onClick={() => navigate('/schedule')}
            >
              <div className="bg-white/90 backdrop-blur-md rounded-[14px] p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${isInterviewSoon ? 'bg-[#ff4d4d]' : 'bg-[#1f52cc]'} flex items-center justify-center text-white`}>
                    <span className="material-symbols-outlined text-2xl">event_upcoming</span>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#8b95ad]">Next Scheduled Interview</div>
                    <div className="text-lg font-bold text-[#10193f]">
                      {nextPersonalInterview.application?.candidate?.fullName} - {nextPersonalInterview.round}
                    </div>
                    <div className="text-xs text-[#5f6a84]">
                      {new Date(nextPersonalInterview.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {isInterviewSoon ? `Starting in ${Math.round((new Date(nextPersonalInterview.scheduledStart) - new Date()) / 60000)} mins` : new Date(nextPersonalInterview.scheduledStart).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="hidden sm:block text-right">
                    <div className="text-[10px] uppercase font-bold text-[#1f52cc]">{nextPersonalInterview.mode}</div>
                    <div className="text-[11px] text-[#8b95ad]">{nextPersonalInterview.interviewers?.length} Interviewers</div>
                  </div>
                  <span className="material-symbols-outlined text-[#10193f]">chevron_right</span>
                </div>
              </div>
            </div>
          </Reveal>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="os-eyebrow">Performance Overview</div>
            <h1 className="os-h1">Morning, {greetingName}.</h1>
          </div>
          <div className="flex gap-2">
            <button className="os-btn-outline flex items-center gap-1" type="button">
              <span className="material-symbols-outlined text-base">calendar_today</span>
              Today
            </button>
            <button className="os-btn-outline" type="button" onClick={() => navigate('/analytics')}>7 Days</button>
            <button className="os-btn-outline flex items-center gap-1" type="button" onClick={() => navigate('/reports')}>
              <span className="material-symbols-outlined text-base">download</span>
              Reports
            </button>
          </div>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          {metrics.map((metric, idx) => (
            <Reveal key={metric.label} delay={idx * 0.04}>
              <button
                className="os-card p-5 w-full text-left"
                type="button"
                onClick={() => navigate(metric.href)}
              >
                <div className="flex justify-between items-center text-sm text-[#7c87a1]">
                  <span>{metric.label}</span>
                  <span className="text-[#29a86f] font-semibold text-xs">{metric.tag}</span>
                </div>
                <div className="mt-3 text-3xl font-bold text-[#10193f] font-[Manrope]">{metric.value}</div>
              </button>
            </Reveal>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4 mt-4">
          <Reveal className="lg:col-span-2">
            <button className="os-card p-6 w-full text-left" type="button" onClick={() => navigate('/pipeline')}>
              <div className="text-2xl font-semibold font-[Manrope]">Pipeline Velocity</div>
              <div className="text-sm text-[#6f7a95] mt-1">Sourced vs selected candidates over the last 7 days</div>
              <div className="mt-5 h-[280px] rounded-xl border border-[#e9eff5] bg-[#fbfdff] relative overflow-hidden">
                <svg viewBox="0 0 640 320" className="absolute inset-0 w-full h-full">
                  <defs>
                    <linearGradient id="velocityLine" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3562d8" />
                      <stop offset="100%" stopColor="#1f4bc6" />
                    </linearGradient>
                    <linearGradient id="hiredLine" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#35b577" />
                      <stop offset="100%" stopColor="#1f8f66" />
                    </linearGradient>
                  </defs>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <line key={idx} x1="24" x2="616" y1={58 + idx * 54} y2={58 + idx * 54} stroke="#edf2fa" strokeWidth="1" />
                  ))}
                  <motion.path
                    d={pipelineChart.sourcedPath}
                    fill="none"
                    stroke="url(#velocityLine)"
                    strokeWidth="4"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                  <motion.path
                    d={pipelineChart.hiredPath}
                    fill="none"
                    stroke="url(#hiredLine)"
                    strokeWidth="3"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.12 }}
                  />
                </svg>
                <motion.div
                  className="absolute right-14 top-24 bg-[#0e2458] text-white rounded-xl px-4 py-3 text-sm font-semibold"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ delay: 0.45, duration: 0.35 }}
                >
                  {pipelineChart.labels[pipelineChart.maxIndex] || 'Today'}
                  <br />
                  {pipelineChart.maxSourced} sourced
                </motion.div>
                <motion.div
                  className="absolute h-4 w-4 rounded-full bg-[#1f4bc6] shadow-[0_0_0_8px_rgba(31,75,198,0.12)]"
                  style={{
                    left: `${24 + pipelineChart.maxIndex * (592 / Math.max(1, pipelineChart.labels.length - 1))}px`,
                    top: `${240 - (pipelineChart.maxSourced / Math.max(1, ...pipelineChart.sourced)) * 190}px`,
                  }}
                  animate={{ scale: [1, 1.15, 1], opacity: [1, 0.88, 1] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="absolute left-5 right-5 bottom-3 flex items-center justify-between text-[11px] text-[#8a95ad]">
                  {pipelineChart.labels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              </div>
            </button>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="os-card p-6">
              <div className="flex justify-between items-center">
                <div className="text-2xl font-semibold font-[Manrope]">Live Feed</div>
                <span className="material-symbols-outlined text-[#1f4bc6]">podcasts</span>
              </div>
              <div className="mt-4 space-y-4">
                {recentApplicants.map((app, idx) => (
                  <motion.button
                    key={app.id}
                    className="flex gap-3 w-full text-left"
                    type="button"
                    onClick={() => navigate(`/candidate/${app.candidate?.id || ''}`)}
                    initial={{ opacity: 0, x: 8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ delay: idx * 0.04, duration: 0.3 }}
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
                      <div className="os-muted text-xs mt-1">{idx === 0 ? 'Just now' : `${idx} hour ago`}</div>
                    </div>
                  </motion.button>
                ))}
                {recentApplicants.length === 0 ? <div className="text-sm os-muted">No activity yet.</div> : null}
              </div>
              <button className="os-btn-outline w-full mt-5" type="button" onClick={() => navigate('/pipeline')}>View All Activity</button>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.08}>
          <div className="os-card mt-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-2xl font-semibold font-[Manrope]">Recent Applicants</div>
              <div className="flex gap-2 text-[#78829b]">
                <button className="os-icon-btn !h-8 !w-8" type="button" onClick={() => navigate('/candidates')}>
                  <span className="material-symbols-outlined">filter_alt</span>
                </button>
                <button className="os-icon-btn !h-8 !w-8" type="button" onClick={() => navigate('/pipeline')}>
                  <span className="material-symbols-outlined">more_horiz</span>
                </button>
              </div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.14em]">
                <tr>
                  <th className="pb-2">Candidate</th>
                  <th className="pb-2">Applied Role</th>
                  <th className="pb-2">Stage</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="text-[#1b2444]">
                {recentApplicants.map((app) => (
                  <tr key={app.id} className="border-t border-[#ebeff4] cursor-pointer" onClick={() => navigate(`/candidate/${app.candidate?.id || ''}`)}>
                    <td className="py-3">{app.candidate?.fullName || '-'}</td>
                    <td>{app.job?.title || '-'}</td>
                    <td>{app.currentStage?.name || '-'}</td>
                    <td className="text-[#2f5fd3]">{app.status}</td>
                  </tr>
                ))}
                {recentApplicants.length === 0 ? (
                  <tr>
                    <td className="py-3 os-muted" colSpan={4}>No applications found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Dashboard;
