import React, { useEffect, useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const Reports = () => {
  const [hiringProgress, setHiringProgress] = useState([]);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const currentUser = getStoredUser();
  const canExportReports = ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const hiringRes = await apiGet('/reports/hiring-progress');
        if (!mounted) return;
        const newData = hiringRes.data || [];
        setHiringProgress(prev => {
          if (JSON.stringify(prev) === JSON.stringify(newData)) {
            return prev;
          }
          return newData;
        });
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load reports');
      }
    };

    load();
    const interval = setInterval(load, 10000); // 10s real-time sync

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

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

        <Reveal className="os-card mt-4 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-semibold font-[Manrope]">Hiring Progress by Job</h3>
            <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-[10px] uppercase font-bold text-slate-400">Live Syncing</span>
            </div>
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
