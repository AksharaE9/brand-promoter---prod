import React, { useEffect, useMemo, useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const Reports = () => {
  const [recruiterActivity, setRecruiterActivity] = useState([]);
  const [hiringProgress, setHiringProgress] = useState([]);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const currentUser = getStoredUser();
  const canExportReports = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [recruiterRes, hiringRes] = await Promise.all([
          apiGet('/reports/recruiter-activity'),
          apiGet('/reports/hiring-progress'),
        ]);
        if (!mounted) return;
        setRecruiterActivity(recruiterRes.data || []);
        setHiringProgress(hiringRes.data || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load reports');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const weekly = useMemo(() => {
    const rows = recruiterActivity.slice(0, 7);
    const values = rows.map((row) => (row.candidatesCreated || 0) + (row.interviewsScheduled || 0));
    const max = Math.max(1, ...values);
    return rows.map((row) => ({
      day: row.recruiterName.split(' ')[0] || 'R',
      value: (row.candidatesCreated || 0) + (row.interviewsScheduled || 0),
      height: Math.max(18, Math.round((((row.candidatesCreated || 0) + (row.interviewsScheduled || 0)) / max) * 100)),
    }));
  }, [recruiterActivity]);

  const quality = useMemo(() => {
    if (!hiringProgress.length) return 0;
    const total = hiringProgress.reduce((acc, row) => acc + (row.totalApplications || 0), 0);
    const joined = hiringProgress.reduce((acc, row) => acc + (row.joined || 0), 0);
    if (!total) return 0;
    return Math.round((joined / total) * 1000) / 10;
  }, [hiringProgress]);

  const efficiency = useMemo(() => {
    if (!hiringProgress.length) return 0;
    const total = hiringProgress.reduce((acc, row) => acc + (row.totalApplications || 0), 0);
    const selected = hiringProgress.reduce((acc, row) => acc + (row.selected || 0), 0);
    if (!total) return 0;
    return Math.round((selected / total) * 100);
  }, [hiringProgress]);

  const downloadReport = async (report, format) => {
    setError('');
    setBanner('');
    try {
      const token = localStorage.getItem('ats_token');
      const res = await fetch(`${API_BASE_URL}/reports/export?report=${report}&format=${format}`, {
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
      a.download = `${report}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);

      setBanner(`${report} exported as ${format.toUpperCase()}.`);
    } catch (err) {
      setError(err.message || 'Failed to export report');
    }
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="reports" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search reports, departments, or trends..."
          right={
            <>
              <NotificationBell />
              {canExportReports ? (
                <>
                  <button className="os-btn-outline" type="button" onClick={() => downloadReport('recruiter-activity', 'excel')}>Recruiter Excel</button>
                  <button className="os-btn-outline" type="button" onClick={() => downloadReport('hiring-progress', 'excel')}>Hiring Excel</button>
                  <button className="os-btn-primary" type="button" onClick={() => downloadReport('hiring-progress', 'pdf')}>Export PDF</button>
                </>
              ) : null}
              <UserChip fallbackName="Alex Rivera" fallbackRole="Recruiting Lead" avatarSeed="reports-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div>
          <div className="os-eyebrow">Enterprise Metrics</div>
          <h1 className="os-h1">Recruitment Reports</h1>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}
        {banner ? <div className="mt-4 os-card p-4 text-[#2454cf] text-sm">{banner}</div> : null}

        <div className="grid xl:grid-cols-12 gap-4 mt-4">
          <Reveal className="xl:col-span-8">
            <div className="os-card p-6">
              <h3 className="text-sm font-semibold text-[#5f6f8f] mb-5">Recruiter Candidate Contribution</h3>
              <div className="h-[280px] flex items-end gap-2">
                {weekly.map((item) => (
                  <div key={item.day} className="flex-1 bg-[#edf2f8] rounded-xl overflow-hidden relative group">
                    <div className="w-full bg-[#1f52cc] rounded-xl transition-all duration-500" style={{ height: `${item.height}%` }} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-2 opacity-0 group-hover:opacity-100 text-[10px] text-[#1f4bc6] font-semibold bg-white px-1.5 py-0.5 rounded">
                      {item.value}
                    </div>
                  </div>
                ))}
                {weekly.length === 0 ? <div className="text-sm os-muted">No recruiter activity data.</div> : null}
              </div>
              <div className="mt-4 flex justify-between text-xs text-[#8b97ad] uppercase tracking-[.1em]">
                {weekly.map((item) => (
                  <span key={item.day}>{item.day}</span>
                ))}
              </div>
            </div>
          </Reveal>

          <div className="xl:col-span-4 space-y-4">
            <Reveal>
              <div className="rounded-3xl bg-[#0b1b3d] text-white p-6">
                <div className="text-xs uppercase tracking-[.12em] text-[#9cb4ed]">Quality of Hire</div>
                <div className="text-4xl font-bold font-[Manrope] mt-2">{quality || 0}%</div>
                <p className="text-sm text-[#c4d2f5] mt-3">Joined candidates out of total job applications.</p>
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <div className="os-card p-6">
                <div className="text-xs uppercase tracking-[.12em] text-[#8a95ac]">Selection Efficiency</div>
                <div className="text-3xl font-bold mt-2 font-[Manrope]">{efficiency}%</div>
                <div className="h-2 w-full bg-[#edf2f8] rounded-full mt-4 overflow-hidden">
                  <div className="h-full bg-[#2fb56f] rounded-full" style={{ width: `${Math.max(0, Math.min(100, efficiency))}%` }} />
                </div>
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal className="os-card mt-4 p-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-2xl font-semibold font-[Manrope]">Hiring Progress by Job</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.15em]">
              <tr>
                <th className="pb-2">Job</th>
                <th className="pb-2">Department</th>
                <th className="pb-2">Applications</th>
                <th className="pb-2">In Pipeline</th>
                <th className="pb-2">Selected</th>
                <th className="pb-2">Joined</th>
              </tr>
            </thead>
            <tbody className="text-[#1b2444]">
              {hiringProgress.map((row) => (
                <tr key={row.jobId} className="border-t border-[#ebeff4]">
                  <td className="py-3 font-medium">{row.title}</td>
                  <td>{row.department}</td>
                  <td>{row.totalApplications}</td>
                  <td>{row.inPipeline}</td>
                  <td>{row.selected}</td>
                  <td>{row.joined}</td>
                </tr>
              ))}
              {hiringProgress.length === 0 ? (
                <tr>
                  <td className="py-3 os-muted" colSpan={6}>No report data available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Reports;
