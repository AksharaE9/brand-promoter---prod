import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const Referrals = () => {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [appRes, jobsRes] = await Promise.all([
          apiGet('/applications?limit=200'),
          apiGet('/jobs?limit=80'),
        ]);
        if (!mounted) return;
        setApplications(appRes.data || []);
        setJobs(jobsRes.data || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load referrals');
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const referralRows = useMemo(() => {
    const rows = applications.filter((app) => String(app?.candidate?.source || '').toLowerCase().includes('ref'));
    if (!selectedJobId) return rows.slice(0, 20);
    return rows.filter((app) => app.jobId === selectedJobId).slice(0, 20);
  }, [applications, selectedJobId]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="candidates" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={(
        <EnterpriseTopbar
          searchPlaceholder="Search referrals..."
          tabs={[
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals', active: true },
          ]}
          right={(
            <>
              <NotificationBell />
              <button className="os-btn-outline" type="button" onClick={() => navigate('/team')}>Team</button>
              <UserChip fallbackName="Referral Ops" fallbackRole="Recruiter" avatarSeed="referrals-user" />
            </>
          )}
        />
      )}
    >
      <PageEnter>
        <div>
          <div className="os-eyebrow">Community Hiring</div>
          <h1 className="os-h1">Referral Pipeline</h1>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}

        <div className="os-card mt-4 p-4 flex flex-wrap items-center gap-3">
          <select className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)}>
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
          <button className="os-btn-outline" type="button" onClick={() => setSelectedJobId('')}>Reset Filter</button>
          <button className="os-btn-primary" type="button" onClick={() => navigate('/candidates')}>Invite Referral</button>
        </div>

        <Reveal className="os-card mt-4 p-5">
          <div className="text-2xl font-semibold font-[Manrope] mb-4">Referral Candidates</div>
          <table className="w-full text-left text-sm">
            <thead className="text-[#8b95ad] text-[11px] uppercase tracking-[.15em]">
              <tr>
                <th className="pb-2">Candidate</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Stage</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody className="text-[#1b2444]">
              {referralRows.map((row) => (
                <tr key={row.id} className="border-t border-[#ebeff4]">
                  <td className="py-3">{row.candidate?.fullName || '-'}</td>
                  <td>{row.job?.title || '-'}</td>
                  <td>{row.currentStage?.name || '-'}</td>
                  <td>
                    <button className="os-btn-outline !h-8" type="button" onClick={() => navigate(`/candidate/${row.candidateId}`)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {referralRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 os-muted">No referral applications found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Referrals;
