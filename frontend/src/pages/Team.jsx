import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, apiPatch, apiPost, API_BASE_URL } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const fallbackMembers = [
  { id: '1', fullName: 'Alex Sterling', role: 'SUPER_ADMIN', status: 'ACTIVE', email: 'alex@talent-os.com' },
  { id: '2', fullName: 'Sarah Jenkins', role: 'RECRUITER', status: 'ACTIVE', email: 'sarah@talent-os.com' },
  { id: '3', fullName: 'David Chen', role: 'INTERVIEWER', status: 'ACTIVE', email: 'david@talent-os.com' },
];

const Team = () => {
  const navigate = useNavigate();
  const [members, setMembers] = useState(fallbackMembers);
  const [me, setMe] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);

  const loadAll = async () => {
    try {
      const [usersRes, meRes] = await Promise.all([
        apiGet('/users'),
        apiGet('/auth/me')
      ]);
      setMe(meRes.data || null);
      if (Array.isArray(usersRes.data) && usersRes.data.length > 0) {
        setMembers(usersRes.data);
      }
    } catch (_) {
      // Recruiters/interviewers may not have permission for users endpoint.
    }
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      await loadAll();
    };

    load();

    const token = localStorage.getItem('ats_token');
    let eventSource;
    if (token) {
      eventSource = new EventSource(`${API_BASE_URL}/notifications/stream?token=${token}`);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'USER_CREATED' || data.type === 'USER_UPDATED' || data.type === 'USER_STATUS_UPDATED') {
            if (mounted) loadAll();
          }
        } catch (err) {}
      };
    }

    return () => {
      mounted = false;
      if (eventSource) eventSource.close();
    };
  }, []);

  const onApproveUser = async (user) => {
    try {
      await apiPatch(`/users/${user.id}/status`, { status: 'ACTIVE' });
      await loadAll();
    } catch (err) {
      alert(err.message || 'Failed to approve user');
    }
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="pool" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} footerButton={me?.role === 'SUPER_ADMIN' ? <button className="os-btn-primary w-full" type="button" onClick={() => navigate('/settings')}>+ Invite Member</button> : null} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search team members, roles, or permissions..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="Alex Sterling" fallbackRole="Admin" avatarSeed="team-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="os-eyebrow">Enterprise Workspace</div>
              <h1 className="os-h1">Team Operations</h1>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <button 
                className="os-btn-primary" 
                type="button" 
                onClick={() => setShowAddMember(v => !v)}
              >
                {showAddMember ? 'Close Form' : '+ Add Recruiter'}
              </button>
            </div>
          </div>
        </div>

        {showAddMember && (
          <Reveal className="os-card mt-4 p-5">
            <form className="grid md:grid-cols-4 gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const fullName = e.target.name.value;
              const email = e.target.email.value;
              const role = e.target.role.value;
              const password = e.target.password.value;
              
              try {
                await apiPost('/users', { fullName, email, role, password });
                await loadAll();
                setShowAddMember(false);
                alert(`Member ${fullName} added successfully.`);
              } catch (err) {
                alert(err.message || 'Failed to add member');
              }
            }}>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Full Name</label>
                <input name="name" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="e.g. John Doe" required />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Email</label>
                <input name="email" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="e.g. john@example.com" required />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Initial Password</label>
                <input name="password" type="password" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Min 8 chars" required />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Role</label>
                <select name="role" className="mt-1 h-10 w-full rounded-xl border border-[#dbe4ee] px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#1f52cc]">
                  <option value="INTERVIEWER">INTERVIEWER</option>
                  <option value="SUPER_ADMIN">SUPER ADMIN</option>
                </select>
              </div>
              <div className="md:col-span-4 flex justify-end gap-2">
                <button className="os-btn-outline" type="button" onClick={() => setShowAddMember(false)}>Cancel</button>
                <button className="os-btn-primary" type="submit">Add Member</button>
              </div>
            </form>
          </Reveal>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          {members.map((member, i) => (
            <Reveal key={member.id || member.email || i} delay={i * 0.05}>
              <div className="os-card p-5 text-center">
                {member.profilePhotoFile?.storageKey ? (
                  <img className="w-20 h-20 rounded-2xl object-cover mx-auto" src={member.profilePhotoFile.storageKey} alt={member.fullName} />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-[#1f52cc] text-white flex items-center justify-center font-bold text-2xl mx-auto">
                    {(member.fullName || 'T').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                )}
                <h3 className="text-xl font-semibold font-[Manrope] mt-4">{member.fullName}</h3>
                <p className="text-xs uppercase tracking-[.1em] text-[#8391ab] mt-1">{String(member.role || 'USER').replace('_', ' ')}</p>
                <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#6f7d98]">
                  <span className={`h-2 w-2 rounded-full ${member.status === 'ACTIVE' ? 'bg-[#2fb56f]' : member.status === 'PENDING' ? 'bg-[#f2994a]' : 'bg-[#a6b1c8]'}`} />
                  {member.status || 'ACTIVE'}
                </div>
                <div className="mt-4 pt-4 border-t border-[#e9eef4] flex justify-center gap-2">
                  <button className="os-btn-outline !h-9 !px-3" type="button" onClick={() => { window.location.href = `mailto:${member.email || ''}`; }} title="Email">
                    <span className="material-symbols-outlined text-base">mail</span>
                  </button>
                  <button className="os-btn-outline !h-9 !px-3" type="button" onClick={() => { if (member.phone) window.location.href = `tel:${member.phone}`; }} title="Call">
                    <span className="material-symbols-outlined text-base">call</span>
                  </button>
                  {me?.role === 'SUPER_ADMIN' && member.status === 'PENDING' && (
                    <button className="os-btn-primary !h-9 !px-3 font-bold" type="button" onClick={() => onApproveUser(member)}>
                      Approve
                    </button>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <Reveal className="md:col-span-2"><div className="rounded-3xl bg-[#0b1b3d] text-white p-6"><div className="text-xs uppercase tracking-[.12em] text-[#9cb4ed]">Team Performance Flux</div><div className="flex items-center gap-8 mt-3"><div><div className="text-4xl font-bold font-[Manrope]">98.4%</div><div className="text-xs text-[#c4d2f5] uppercase tracking-[.1em] mt-1">Synchronization</div></div><div className="flex-1 h-2 rounded-full bg-white/15 overflow-hidden"><div className="h-full bg-[#4f8fff] rounded-full" style={{ width: '98%' }} /></div></div></div></Reveal>
          <Reveal delay={0.06}><div className="os-card p-6 text-center h-full flex flex-col justify-center"><div className="text-xs uppercase tracking-[.12em] text-[#8b97ad]">Active Sessions</div><div className="text-4xl font-bold font-[Manrope] mt-2">{Math.max(1, members.length - 1)}/{members.length || 1}</div><div className="text-xs uppercase tracking-[.1em] text-[#2fa96f] mt-2">Optimal Load</div></div></Reveal>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Team;

