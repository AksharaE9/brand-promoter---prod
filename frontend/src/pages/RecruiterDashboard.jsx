import React, { useEffect, useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import { apiGet, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { CandidateCardSkeleton } from '../components/Skeleton';

const RecruiterDashboard = () => {
  const [candidates, setCandidates] = useState([]);
  const [stats, setStats] = useState({ active: 0, pendingOffer: 0, joined: 0 });
  const [loading, setLoading] = useState(true);
  const user = getStoredUser();

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        // Fetch candidates where I am mentor or coordinator
        const res = await apiGet(`/candidates?assignedToMe=true&limit=50`);
        if (res.success) {
          setCandidates(res.data);
          
          const active = res.data.filter(c => c.applications?.some(a => ['SCREENING', 'INTERVIEWING', 'PENDING'].includes(a.status))).length;
          const joined = res.data.filter(c => c.applications?.some(a => a.status === 'JOINED')).length;
          const pendingOffer = res.data.filter(c => c.applications?.some(a => a.status === 'OFFER_SENT')).length;
          
          setStats({ active, pendingOffer, joined });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadDashboard();
  }, []);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="dashboard" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search my candidates..."
          right={
            <>
              <NotificationBell />
              <UserChip />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="os-eyebrow">Recruiter Workspace</div>
            <h1 className="os-h1">My Recruitment Hub</h1>
          </div>
          <div className="text-sm text-slate-500">Welcome back, {user?.fullName}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Reveal className="os-card p-6 border-l-4 border-blue-500">
            <div className="text-slate-500 text-xs uppercase font-bold tracking-wider">Interviewing</div>
            <div className="text-3xl font-bold mt-2">{stats.active}</div>
            <div className="text-[10px] text-slate-400 mt-1">Candidates in active stages</div>
          </Reveal>
          <Reveal delay={0.1} className="os-card p-6 border-l-4 border-amber-500">
            <div className="text-slate-500 text-xs uppercase font-bold tracking-wider">Offer Phase</div>
            <div className="text-3xl font-bold mt-2">{stats.pendingOffer}</div>
            <div className="text-[10px] text-slate-400 mt-1">Offers sent to candidates</div>
          </Reveal>
          <Reveal delay={0.2} className="os-card p-6 border-l-4 border-emerald-500">
            <div className="text-slate-500 text-xs uppercase font-bold tracking-wider">Successful Joins</div>
            <div className="text-3xl font-bold mt-2">{stats.joined}</div>
            <div className="text-[10px] text-slate-400 mt-1">Total onboarded candidates</div>
          </Reveal>
        </div>

        <div className="mt-10">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Assigned Candidates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <CandidateCardSkeleton key={i} />)
            ) : candidates.length > 0 ? (
              candidates.map((candidate, idx) => (
                <Reveal key={candidate.id} delay={idx * 0.05}>
                  <div className="os-card p-5 group cursor-pointer hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      {candidate.profilePhotoFile?.storageKey ? (
                        <img 
                          className="w-12 h-12 rounded-xl object-cover" 
                          src={candidate.profilePhotoFile.storageKey} 
                          alt="" 
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-400">
                          {candidate.fullName.charAt(0)}
                        </div>
                      )}
                      <div>
                        <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{candidate.fullName}</h3>
                        <p className="text-xs text-slate-500">{candidate.currentCompany || 'No Company'}</p>
                      </div>
                    </div>
                    
                    <div className="mt-4 flex flex-col gap-2">
                      {candidate.applications?.[0] ? (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[10px] uppercase font-bold text-slate-400">Current Stage</span>
                            <span className="text-xs font-semibold text-blue-600">{candidate.applications[0].currentStage?.name || 'Initial'}</span>
                          </div>
                          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 ${
                                candidate.applications[0].status === 'REJECTED' ? 'bg-rose-500' : 
                                candidate.applications[0].status === 'JOINED' ? 'bg-emerald-500' : 'bg-blue-500'
                              }`} 
                              style={{ 
                                width: candidate.applications[0].status === 'JOINED' || candidate.applications[0].status === 'REJECTED' ? '100%' :
                                       candidate.applications[0].status === 'OFFER_SENT' ? '85%' :
                                       candidate.applications[0].status === 'INTERVIEWING' ? '65%' :
                                       candidate.applications[0].status === 'SCREENING' ? '35%' : '15%'
                              }}
                            ></div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic">No active applications</div>
                      )}
                      
                      {candidate.doj && (
                        <div className="flex items-center gap-2 mt-2 px-1">
                          <span className="material-symbols-outlined text-sm text-emerald-500">event_available</span>
                          <span className="text-xs text-slate-600">Joining Date: <b>{new Date(candidate.doj).toLocaleDateString('en-IN')}</b></span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        candidate.mentorId === user?.id ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'
                      }`}>
                        {candidate.mentorId === user?.id ? 'Mentor' : 'Coordinator'}
                      </span>
                      <a href={`/candidate/${candidate.id}`} className="text-xs text-blue-500 hover:underline">View Details</a>
                    </div>
                  </div>
                </Reveal>
              ))
            ) : (
              <div className="os-card p-10 text-center col-span-full">
                <div className="text-slate-300 mb-2">
                  <span className="material-symbols-outlined text-4xl">person_search</span>
                </div>
                <p className="text-slate-500">No candidates assigned to you yet.</p>
              </div>
            )}
          </div>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default RecruiterDashboard;
