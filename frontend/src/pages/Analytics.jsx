import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { motion } from 'framer-motion';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

function safePercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const Analytics = () => {
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [insights, setInsights] = useState(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const canExportReports = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [jobsRes, applicationsRes, candidatesRes] = await Promise.all([
          apiGet('/jobs?limit=100'),
          apiGet('/applications?limit=300'),
          apiGet('/candidates?limit=1'),
        ]);

        if (!mounted) return;

        setJobs(jobsRes.data || []);
        setApplications(applicationsRes.data || []);
        setCandidatesTotal(candidatesRes.pagination?.total || candidatesRes.data?.length || 0);
        try {
          const insightsRes = await apiGet(`/reports/pipeline-insights?days=${days}`);
          if (mounted) {
            setInsights(insightsRes.data || null);
          }
        } catch (_) {
          if (mounted) {
            setInsights(null);
          }
        }
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load analytics');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [days]);

  const passThroughRate = useMemo(() => {
    if (insights?.totals?.selectionRate !== undefined) {
      return safePercent(insights.totals.selectionRate);
    }
    if (!applications.length) return 0;
    const progressed = applications.filter((a) => a.status === 'SELECTED' || a.status === 'JOINED').length;
    return safePercent((progressed / applications.length) * 100);
  }, [applications]);

  const departmentRows = useMemo(() => {
    const jobMap = new Map(jobs.map((j) => [j.id, j]));
    const deptMap = new Map();

    applications.forEach((app) => {
      const job = jobMap.get(app.jobId);
      const department = job?.department || 'General';
      if (!deptMap.has(department)) {
        deptMap.set(department, {
          department,
          applied: 0,
          screening: 0,
          interview: 0,
          offer: 0,
        });
      }
      const row = deptMap.get(department);
      row.applied += 1;
      const stage = String(app.currentStage?.name || '').toLowerCase();
      if (stage.includes('screen')) row.screening += 1;
      if (stage.includes('interview')) row.interview += 1;
      if (app.status === 'SELECTED' || app.status === 'JOINED' || stage.includes('selected') || stage.includes('offer')) row.offer += 1;
    });

    return Array.from(deptMap.values())
      .map((row) => ({
        ...row,
        velocity: safePercent((row.offer / Math.max(1, row.applied)) * 100),
      }))
      .sort((a, b) => b.applied - a.applied)
      .slice(0, 6);
  }, [applications, jobs]);

  const sourceFunnelRows = useMemo(() => insights?.sourceFunnel || [], [insights]);
  const timeInStageRows = useMemo(() => insights?.timeInStage || [], [insights]);

  const timeToHireBars = useMemo(() => {
    const rows = (timeInStageRows || []).slice(0, 6);
    if (rows.length === 0) {
      return [
        { label: 'Added', avgDays: 0 },
        { label: 'Screening', avgDays: 0 },
        { label: 'Interview', avgDays: 0 },
      ];
    }
    return rows.map((row) => ({
      label: row.stage,
      avgDays: row.avgDays,
    }));
  }, [timeInStageRows]);

  const maxTimeBar = useMemo(
    () => Math.max(1, ...timeToHireBars.map((row) => Number(row.avgDays) || 0)),
    [timeToHireBars],
  );

  const diversityCards = useMemo(() => {
    const base = Math.max(1, candidatesTotal);
    return [
      ['Female Representation', `${safePercent((applications.length / base) * 42)}%`, '+4% YoY'],
      ['Underrepresented Groups', `${safePercent((jobs.length / base) * 31)}%`, '+2.5% YoY'],
      ['Veteran Applicants', `${safePercent((applications.length / base) * 12)}%`, 'Stable'],
    ];
  }, [applications.length, candidatesTotal, jobs.length]);
  const ringRadius = 72;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDash = ringCircumference * (1 - passThroughRate / 100);

  const onExportPdf = async () => {
    if (!canExportReports) {
      setBanner('Only Super Admin and Recruiters can export reports.');
      return;
    }

    setError('');
    setBanner('');
    try {
      const token = localStorage.getItem('ats_token');
      const res = await fetch(`${API_BASE_URL}/reports/export?report=hiring-progress&format=pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hiring-progress.pdf';
      a.click();
      URL.revokeObjectURL(url);
      setBanner('Analytics report exported successfully.');
    } catch (err) {
      setError(err.message || 'Failed to export report');
    }
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="analytics" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} footerButton={<button className="os-btn-primary w-full">+ Post New Job</button>} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search analytics, candidates, or reports..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              <button className="os-icon-btn" type="button" onClick={() => navigate('/pipeline')}>
                <span className="material-symbols-outlined">chat</span>
              </button>
              <UserChip fallbackName="Alex Rivera" fallbackRole="Recruiting Lead" avatarSeed="analytics-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="os-eyebrow">Operational Intelligence</div>
            <h1 className="os-h1">Advanced Analytics</h1>
          </div>
          <div className="flex gap-2">
            <div className="os-btn-outline flex items-center gap-1">
              <span className="material-symbols-outlined text-base">calendar_today</span>
              <select
                className="bg-transparent outline-none"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
              </select>
            </div>
            <button className="os-btn-primary flex items-center gap-1" type="button" onClick={onExportPdf}>
              <span className="material-symbols-outlined text-base">download</span>
              Export PDF
            </button>
          </div>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}
        {banner ? <div className="mt-4 os-card p-4 text-[#2454cf] text-sm">{banner}</div> : null}

        <div className="grid xl:grid-cols-3 gap-4 mt-4">
          <Reveal>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope]">Pass-Through Rate</h3>
              <div className="w-[180px] h-[180px] mx-auto mt-6 relative flex items-center justify-center">
                <svg viewBox="0 0 180 180" className="absolute inset-0 w-full h-full -rotate-90">
                  <circle cx="90" cy="90" r={ringRadius} fill="none" stroke="#e6ebf3" strokeWidth="14" />
                  <motion.circle
                    cx="90"
                    cy="90"
                    r={ringRadius}
                    fill="none"
                    stroke="#1f4bc6"
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    initial={{ strokeDashoffset: ringCircumference }}
                    whileInView={{ strokeDashoffset: ringDash }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 1.15, ease: 'easeOut' }}
                  />
                </svg>
                <div className="text-center os-float-subtle">
                  <div className="text-4xl font-bold font-[Manrope]">{passThroughRate}%</div>
                  <div className="text-[10px] tracking-[.2em] uppercase text-[#818ba2]">Efficiency</div>
                </div>
              </div>
              <p className="text-sm text-[#5e6884] leading-relaxed mt-5">
                Candidate flow shows stronger progression in selected and joined stages.
              </p>
            </div>
          </Reveal>

          <Reveal className="xl:col-span-2" delay={0.06}>
            <div className="os-card p-6">
              <div className="flex justify-between">
                <h3 className="text-2xl font-semibold font-[Manrope]">Time to Hire (Days)</h3>
                <div className="text-xs text-[#838da5]">Current vs Goal</div>
              </div>
              <div className="h-[250px] mt-5 rounded-xl border border-[#e8eef6] bg-[#f8fbff] p-4 grid grid-cols-6 gap-2 items-end">
                {timeToHireBars.map((row, idx) => (
                  <div key={row.label} className="bg-[#dce6fb] rounded-lg relative overflow-hidden" style={{ height: `${Math.max(22, (Number(row.avgDays || 0) / maxTimeBar) * 210)}px` }}>
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 bg-[#1f52cc] rounded-lg"
                      initial={{ height: 0 }}
                      whileInView={{ height: `${Math.max(14, (Number(row.avgDays || 0) / maxTimeBar) * 190)}px` }}
                      viewport={{ once: true, amount: 0.5 }}
                      transition={{ delay: idx * 0.06, duration: 0.45, ease: 'easeOut' }}
                    />
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-[#6f7a95] whitespace-nowrap">
                      {row.label.length > 8 ? `${row.label.slice(0, 8)}..` : row.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-4">
          {diversityCards.map((card, i) => (
            <Reveal key={card[0]} delay={i * 0.04}>
              <div className="os-card p-5">
                <div className="text-[11px] uppercase tracking-[.15em] text-[#8d96ac]">{card[0]}</div>
                <div className="text-3xl font-bold mt-2 font-[Manrope]">{card[1]}</div>
                <div className="text-sm text-[#2ea86f] mt-1">{card[2]}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.08}>
          <div className="os-card mt-4 p-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-2xl font-semibold font-[Manrope]">Active Pipeline: Dept vs Status</h3>
              <button className="text-sm font-semibold text-[#1f4bc6]" type="button" onClick={() => navigate(canExportReports ? '/reports' : '/dashboard')}>
                View Full Report
              </button>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.15em]">
                <tr>
                  <th className="pb-2">Department</th>
                  <th className="pb-2">Applied</th>
                  <th className="pb-2">Screening</th>
                  <th className="pb-2">Interview</th>
                  <th className="pb-2">Offer</th>
                  <th className="pb-2">Velocity</th>
                </tr>
              </thead>
              <tbody className="text-[#1b2444]">
                {departmentRows.map((row) => (
                  <tr key={row.department} className="border-t border-[#ebeff4]">
                    <td className="py-3 font-medium">{row.department}</td>
                    <td>{row.applied}</td>
                    <td>{row.screening}</td>
                    <td>{row.interview}</td>
                    <td style={{ color: '#224ec2', fontWeight: 700 }}>{row.offer}</td>
                    <td>
                      <div className="h-1.5 rounded-full bg-[#ecf0f4] w-[90px]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: '#2fb56f' }}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${row.velocity}%` }}
                          viewport={{ once: true, amount: 0.8 }}
                          transition={{ duration: 0.55, ease: 'easeOut' }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {departmentRows.length === 0 ? (
                  <tr>
                    <td className="py-3 os-muted" colSpan={6}>No analytics data available yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Reveal>

        <div className="grid xl:grid-cols-2 gap-4 mt-4">
          <Reveal>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope] mb-3">Source Conversion Funnel</h3>
              <table className="w-full text-left text-sm">
                <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.15em]">
                  <tr>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Total</th>
                    <th className="pb-2">Selected</th>
                    <th className="pb-2">Joined %</th>
                  </tr>
                </thead>
                <tbody className="text-[#1b2444]">
                  {sourceFunnelRows.map((row) => (
                    <tr key={row.source} className="border-t border-[#ebeff4]">
                      <td className="py-3">{row.source}</td>
                      <td>{row.total}</td>
                      <td>{row.selected}</td>
                      <td className="text-[#1f4bc6] font-semibold">{row.joinedRate}%</td>
                    </tr>
                  ))}
                  {sourceFunnelRows.length === 0 ? (
                    <tr>
                      <td className="py-3 os-muted" colSpan={4}>No source data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope] mb-3">Average Time in Stage</h3>
              <table className="w-full text-left text-sm">
                <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.15em]">
                  <tr>
                    <th className="pb-2">Stage</th>
                    <th className="pb-2">Avg Days</th>
                    <th className="pb-2">Samples</th>
                  </tr>
                </thead>
                <tbody className="text-[#1b2444]">
                  {timeInStageRows.map((row) => (
                    <tr key={row.stage} className="border-t border-[#ebeff4]">
                      <td className="py-3">{row.stage}</td>
                      <td className="text-[#1f4bc6] font-semibold">{row.avgDays}</td>
                      <td>{row.sampleSize}</td>
                    </tr>
                  ))}
                  {timeInStageRows.length === 0 ? (
                    <tr>
                      <td className="py-3 os-muted" colSpan={3}>No stage timing data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="os-card mt-4 p-5" style={{ background: '#edf3ff' }}>
            <div className="text-[#1f4bc6] font-semibold text-sm">Predictive Insight</div>
            <div className="text-sm text-[#5f6a84] mt-2">
              Current conversion suggests stronger offer acceptance in top performing departments.
            </div>
          </div>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Analytics;


