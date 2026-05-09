import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const Sourcing = () => {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [candRes, jobsRes] = await Promise.all([
          apiGet('/candidates?limit=60'),
          apiGet('/jobs?limit=40&isActive=true'),
        ]);
        if (!mounted) return;
        setCandidates(candRes.data || []);
        setJobs(jobsRes.data || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load sourcing data');
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const key = query.trim().toLowerCase();
    if (!key) return candidates.slice(0, 12);
    return candidates.filter((c) =>
      [c.fullName, c.email, c.currentCompany, c.source].some((v) => String(v || '').toLowerCase().includes(key)))
      .slice(0, 12);
  }, [candidates, query]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="candidates" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={(
        <EnterpriseTopbar
          searchPlaceholder="Search sourced profiles..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing', active: true },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={(
            <>
              <NotificationBell />
              <button className="os-btn-outline" type="button" onClick={() => navigate('/candidates')}>Candidate Pool</button>
              <UserChip fallbackName="Sourcing Lead" fallbackRole="Recruiter" avatarSeed="sourcing-user" />
            </>
          )}
        />
      )}
    >
      <PageEnter>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="os-eyebrow">Talent Intelligence</div>
            <h1 className="os-h1">Sourcing Workspace</h1>
          </div>
          <button className="os-btn-primary" type="button" onClick={() => navigate('/candidates')}>Add Candidate</button>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}

        <div className="os-card mt-4 p-4">
          <input
            className="h-11 w-full rounded-xl border border-[#dbe4ee] px-3 text-sm"
            placeholder="Search by name, source, company, email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="grid xl:grid-cols-[1.4fr_.8fr] gap-4 mt-4">
          <Reveal>
            <div className="os-card p-5">
              <div className="text-2xl font-semibold font-[Manrope] mb-3">Suggested Profiles</div>
              <div className="space-y-2">
                {filtered.map((candidate) => (
                  <button
                    key={candidate.id}
                    className="w-full text-left border border-[#e6ecf4] rounded-xl p-3 hover:border-[#cdd9eb] transition-colors"
                    type="button"
                    onClick={() => navigate(`/candidate/${candidate.id}`)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{candidate.fullName}</div>
                      <span className="text-xs text-[#1f4bc6]">{candidate.source || 'Direct'}</span>
                    </div>
                    <div className="text-sm text-[#67748f] mt-1">{candidate.currentCompany || 'Candidate'}</div>
                  </button>
                ))}
                {filtered.length === 0 ? <div className="text-sm os-muted">No profiles found.</div> : null}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="os-card p-5">
              <div className="text-2xl font-semibold font-[Manrope] mb-3">Open Roles</div>
              <div className="space-y-2">
                {jobs.slice(0, 8).map((job) => (
                  <button
                    key={job.id}
                    className="w-full text-left border border-[#e6ecf4] rounded-xl p-3 hover:border-[#cdd9eb] transition-colors"
                    type="button"
                    onClick={() => navigate(`/pipeline?jobId=${job.id}`)}
                  >
                    <div className="font-semibold">{job.title}</div>
                    <div className="text-sm text-[#67748f] mt-1">{job.department || 'General'} • {job.location || 'Remote'}</div>
                  </button>
                ))}
                {jobs.length === 0 ? <div className="text-sm os-muted">No active jobs.</div> : null}
              </div>
            </div>
          </Reveal>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Sourcing;
