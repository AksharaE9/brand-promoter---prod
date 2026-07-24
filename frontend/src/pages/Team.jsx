import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, apiPatch, apiPost, apiDelete } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import EditRecruiterModal from '../components/Team/EditRecruiterModal';
import EditInterviewerModal from '../components/Team/EditInterviewerModal';
import { useToast } from '../hooks/useToast';
import { validatePasswordStrength } from '../lib/passwordValidation';
import { subscribeSSE } from '../lib/sse';

const userTypes = [
  { value: 'RECRUITER', label: 'Recruiter', color: 'bg-blue-100 text-blue-800' }
];

const Team = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [deletedMembers, setDeletedMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [activeTab, setActiveTab] = useState('RECRUITERS'); // RECRUITERS, SUPER_ADMINS, DELETED
  const [showAddMember, setShowAddMember] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserRole, setEditingUserRole] = useState(null);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [search, setSearch] = useState('');

  // Filters
  const [roleFilter, setRoleFilter] = useState('ALL'); // ALL, SUPER_ADMIN, RECRUITER
  const [typeFilter, setTypeFilter] = useState('ALL'); // ALL, DEVELOPER, etc.

  // Modals state
  const [deleteTarget, setDeleteTarget] = useState(null); // user doc
  const [deleteConfirmError, setDeleteConfirmError] = useState('');
  const [deletingActiveCandidatesCount, setDeletingActiveCandidatesCount] = useState(0);
  const [isDeletingLoading, setIsDeletingLoading] = useState(false);

  const [roleChangeTarget, setRoleChangeTarget] = useState(null); // { user, targetRole }
  const [roleChangeError, setRoleChangeError] = useState('');
  const [isRoleChangeLoading, setIsRoleChangeLoading] = useState(false);

  // Active / Deactivate toggle
  const [updatingStatusUserIds, setUpdatingStatusUserIds] = useState({});

  // Inline UserType dropdown
  const [activeTypeDropdownUserId, setActiveTypeDropdownUserId] = useState(null);

  const loadAll = async () => {
    try {
      const [usersRes, meRes] = await Promise.all([
        apiGet('/users', false),
        apiGet('/auth/me', false)
      ]);
      setMe(meRes.data || null);
      if (Array.isArray(usersRes.data)) {
        setMembers(usersRes.data);
      }
      
      // Load deleted members if SUPER_ADMIN
      if (meRes.data?.role === 'SUPER_ADMIN') {
        const deletedRes = await apiGet('/team/members/deleted?limit=50');
        if (deletedRes.success && Array.isArray(deletedRes.data)) {
          setDeletedMembers(deletedRes.data);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      await loadAll();
    };
    load();

    const handleTeamUpdate = () => {
      if (mounted) loadAll();
    };

    const unsub = subscribeSSE((data) => {
      if (
        data.type === 'USER_CREATED' ||
        data.type === 'USER_UPDATED' ||
        data.type === 'USER_STATUS_UPDATED' ||
        data.type === 'TEAM_UPDATE' ||
        data.type === 'TEAM_MEMBER_UPDATED' ||
        data.type === 'TEAM_MEMBER_DELETED' ||
        data.type === 'TEAM_MEMBER_RESTORED' ||
        data.type === 'TEAM_ROLE_CHANGED' ||
        data.type === 'TEAM_MEMBER_INVITED'
      ) {
        handleTeamUpdate();
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Filtered members list for active tabs (client-side filters applied)
  const filteredActiveMembers = useMemo(() => {
    let list = members;
    
    // Tab filter
    if (activeTab === 'RECRUITERS') {
      list = list.filter(m => m.role === 'RECRUITER');
    } else if (activeTab === 'SUPER_ADMINS') {
      list = list.filter(m => m.role === 'SUPER_ADMIN'); 
    }

    // Role Filter
    if (roleFilter !== 'ALL') {
      list = list.filter(m => m.role === roleFilter);
    }

    // User Type Filter
    if (typeFilter !== 'ALL') {
      list = list.filter(m => m.userType === typeFilter);
    }

    // Search filter
    if (search.trim()) {
      const key = search.trim().toLowerCase();
      list = list.filter(m => 
        [m.fullName, m.email, m.phone].some(v => String(v || '').toLowerCase().includes(key))
      );
    }

    return list;
  }, [members, activeTab, roleFilter, typeFilter, search]);

  const hasActiveFilters = roleFilter !== 'ALL' || typeFilter !== 'ALL';

  const clearFilters = () => {
    setRoleFilter('ALL');
    setTypeFilter('ALL');
  };

  const handleEditMember = (member) => {
    setEditingUserId(member.id);
    setEditingUserRole(member.role);
  };

  // Open soft-delete dialog
  const initiateDelete = async (member) => {
    setDeleteTarget(member);
    setDeleteConfirmError('');
    setDeletingActiveCandidatesCount(0);
    setIsDeletingLoading(false);

    // Fetch active candidates count for this recruiter via fast endpoint
    try {
      const res = await apiGet(`/team/members/${member.id}/active-candidates-count`);
      if (res.success) {
        setDeletingActiveCandidatesCount(res.count);
      }
    } catch (err) {
      console.error("Failed to check active candidates:", err);
    }
  };

  // Confirm soft delete
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    const targetName = deleteTarget.fullName;
    const previousMembers = [...members];

    // Optimistic UI update: Close modal and remove from state immediately
    setDeleteTarget(null);
    setMembers(prev => prev.filter(m => m.id !== targetId));

    try {
      const res = await apiDelete(`/team/members/${targetId}`);
      if (!res.success) {
        throw new Error(res.message || "Failed to delete member");
      }
      toast.success(`Member ${targetName} has been deleted successfully.`);
    } catch (err) {
      toast.error(err.message || "Failed to delete user");
      // Rollback
      setMembers(previousMembers);
    } finally {
      // Background sync
      await loadAll();
    }
  };

  // Restore user
  const handleRestore = async (memberId) => {
    try {
      const res = await apiPatch(`/team/members/${memberId}/restore`, {});
      if (res.success) {
        await loadAll();
        toast.success("Member has been restored successfully.");
      }
    } catch (err) {
      alert(err.message || "Failed to restore member");
    }
  };

  // Inline UserType change dropdown
  const handleUserTypeChange = async (userId, userType) => {
    // Optimistic Update
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, userType } : m));
    setActiveTypeDropdownUserId(null);

    try {
      const res = await apiPatch(`/team/members/${userId}`, { userType });
      if (!res.success) throw new Error("Failed to update user type");
      await loadAll();
      toast.success("User Type has been updated successfully.");
    } catch (err) {
      alert(err.message || "Failed to update User Type");
      await loadAll();
    }
  };

  // Approve a pending user
  const handleApproveMember = async (userId) => {
    try {
      // Optimistic Update
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, status: 'ACTIVE', isActive: true } : m));

      const res = await apiPatch(`/team/members/${userId}`, { status: 'ACTIVE', isActive: true });
      if (!res.success) throw new Error(res.message || "Failed to approve user");
      await loadAll();
      toast.success("Member account has been approved successfully.");
    } catch (err) {
      alert(err.message || "Failed to approve user");
      await loadAll();
    }
  };

  // Toggle Active / Deactivate — Optimized for screen (inline, optimistic update)
  const handleStatusToggle = async (member) => {
    const userId = member.id;
    const currentStatus = member.status;
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const targetName = member.fullName;

    // Track status updating for this user
    setUpdatingStatusUserIds(prev => ({ ...prev, [userId]: true }));

    // Optimistic local state update
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, status: newStatus, isActive: newStatus === 'ACTIVE' } : m));

    try {
      const res = await apiPatch(`/team/members/${userId}`, { status: newStatus, isActive: newStatus === 'ACTIVE' });
      if (!res.success) {
        throw new Error(res.message || `Failed to update status`);
      }
      toast.success(`Account for ${targetName} has been ${newStatus === 'ACTIVE' ? 'activated' : 'deactivated'} successfully.`);
    } catch (err) {
      toast.error(err.message || `Failed to update status`);
      // Revert optimistic update
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, status: currentStatus, isActive: currentStatus === 'ACTIVE' } : m));
    } finally {
      setUpdatingStatusUserIds(prev => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
      // Synchronize in the background
      await loadAll();
    }
  };

  // Initiate Role Change Modal
  const initiateRoleChange = (member, targetRole) => {
    setRoleChangeTarget({ user: member, targetRole });
    setRoleChangeError('');
    setIsRoleChangeLoading(false);
  };

  const confirmRoleChange = async () => {
    if (!roleChangeTarget) return;
    setIsRoleChangeLoading(true);
    setRoleChangeError('');

    const { user, targetRole } = roleChangeTarget;
    try {
      // Optimistic Update
      setMembers(prev => prev.map(m => m.id === user.id ? { ...m, role: targetRole } : m));

      const res = await apiPatch(`/team/members/${user.id}/role`, { role: targetRole });
      if (!res.success) {
        throw new Error(res.message || "Failed to change role");
      }
      
      setRoleChangeTarget(null);
      await loadAll();
      toast.success(`Role for ${user.fullName} has been updated to ${targetRole === 'SUPER_ADMIN' ? 'SUPER ADMIN' : targetRole} successfully.`);
    } catch (err) {
      setRoleChangeError(err.message || "Failed to change role");
      await loadAll();
    } finally {
      setIsRoleChangeLoading(false);
    }
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="pool" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} footerButton={me?.role === 'SUPER_ADMIN' ? <button className="os-btn-primary w-full" type="button" onClick={() => navigate('/settings')}>+ Invite Member</button> : null} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search team members..."
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="System Administrator" fallbackRole="SUPER_ADMIN" avatarSeed="team-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Header Section */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="os-eyebrow">Enterprise Workspace</div>
            <h1 className="os-h1">Team Operations</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              className="os-btn-primary" 
              type="button" 
              onClick={() => setShowAddMember(v => !v)}
            >
              {showAddMember ? 'Close Form' : '+ Add Team Member'}
            </button>
          </div>
        </div>

        {/* Add Member form */}
        {showAddMember && (
          <Reveal className="os-card mt-4 p-5">
            <form className="grid md:grid-cols-4 gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const fullName = e.target.name.value;
              const email = e.target.email.value;
              const role = e.target.role.value;
              const userType = e.target.userType.value;
              const password = e.target.password.value;
              
              const tempId = `temp_${Date.now()}`;
              const ghostMember = {
                id: tempId,
                fullName,
                email,
                role,
                userType,
                status: 'PENDING',
                isActive: true,
                isGhost: true,
              };

              const previousMembers = [...members];
              
              // Optimistic UI update: Close form and prepend ghost card instantly
              setMembers(prev => [ghostMember, ...prev]);
              setShowAddMember(false);
              toast.info(`Inviting ${fullName}...`);

              try {
                const res = await apiPost('/users', { fullName, email, role, userType, password });
                if (!res.success) {
                  throw new Error(res.message || "Failed to add member");
                }
                toast.success(`Member ${fullName} added successfully.`);
              } catch (err) {
                toast.error(err.message || 'Failed to add member');
                // Rollback
                setMembers(previousMembers);
              } finally {
                await loadAll();
              }
            }}>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Full Name</label>
                <input name="name" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="e.g. John Doe" required disabled={isAdding} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Email</label>
                <input name="email" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="e.g. john@example.com" required disabled={isAdding} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Initial Password</label>
                <input name="password" type="password" className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Min 8 chars" required disabled={isAdding} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">Role</label>
                <select name="role" className="mt-1 h-10 w-full rounded-xl border border-[#dbe4ee] px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#1f52cc]" disabled={isAdding}>
                  <option value="RECRUITER">RECRUITER</option>
                  <option value="SUPER_ADMIN">SUPER ADMIN</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">User Type</label>
                <select name="userType" className="mt-1 h-10 w-full rounded-xl border border-[#dbe4ee] px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#1f52cc]" disabled={isAdding}>
                  <option value="RECRUITER">Recruiter</option>
                </select>
              </div>
              <div className="md:col-span-4 flex justify-end gap-2 mt-2">
                <button className="os-btn-outline" type="button" onClick={() => setShowAddMember(false)} disabled={isAdding}>Cancel</button>
                <button className="os-btn-primary" type="submit" disabled={isAdding}>{isAdding ? 'Adding...' : 'Add Member'}</button>
              </div>
            </form>
          </Reveal>
        )}

        {/* Tab Controls & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-6 border-b border-[#e9eef4] pb-2">
          {/* Main Tabs */}
          <div className="flex gap-4">
            <button 
              className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'RECRUITERS' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setActiveTab('RECRUITERS'); clearFilters(); }}
            >
              Recruiters
            </button>
            <button 
              className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'SUPER_ADMINS' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setActiveTab('SUPER_ADMINS'); clearFilters(); }}
            >
              Super Admins
            </button>
            {me?.role === 'SUPER_ADMIN' && (
              <button 
                className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'DELETED' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                onClick={() => { setActiveTab('DELETED'); clearFilters(); }}
              >
                Deleted Members
              </button>
            )}
          </div>

          {/* Filters (Active Tabs only) */}
          {activeTab !== 'DELETED' && (
            <div className="flex items-center gap-3">
              {/* Role filter */}
              <select 
                className="h-9 rounded-lg border border-slate-200 px-3 text-xs bg-white font-semibold text-slate-600 outline-none"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="ALL">All Roles</option>
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="RECRUITER">Recruiter</option>
              </select>

              {/* Type filter */}
              <select 
                className="h-9 rounded-lg border border-slate-200 px-3 text-xs bg-white font-semibold text-slate-600 outline-none"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="ALL">All Types</option>
                <option value="RECRUITER">Recruiter</option>
              </select>

              {hasActiveFilters && (
                <button className="os-btn-outline !h-9 text-xs" onClick={clearFilters}>
                  Clear Filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Data Table */}
        <Reveal className="os-card mt-4 p-0 overflow-hidden">
          {activeTab !== 'DELETED' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e9eef4]">
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Email</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Role & User Type</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredActiveMembers.map((member) => (
                  <tr key={member.id} className={`border-b border-[#ebeff4] hover:bg-slate-50/50 ${member.isGhost ? 'opacity-50 pointer-events-none' : ''}`}>
                    {/* Name */}
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {member.profilePhotoFile?.storageKey ? (
                          <img className="w-10 h-10 rounded-xl object-cover" src={member.profilePhotoFile.storageKey} alt={member.fullName} />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-[#1f52cc] text-white flex items-center justify-center font-bold text-sm">
                            {(member.fullName || 'T').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                        )}
                        <span className="font-semibold text-slate-900" title={member.fullName}>{member.fullName}</span>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="p-4 text-sm text-slate-600">{member.email}</td>

                    {/* Role & Type badges */}
                    <td className="p-4 relative">
                      <div className="flex flex-col gap-1.5 items-start">
                        {/* Role Badges */}
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            member.role === 'SUPER_ADMIN' ? 'bg-[#0f1b3d] text-white' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {member.role}
                          </span>
                          
                          {/* Role Upgrade/Downgrade Button */}
                          {me?.role === 'SUPER_ADMIN' && member.id !== me.id && (
                            <button
                              className="text-[10px] font-bold text-[#1f52cc] hover:underline"
                              onClick={() => initiateRoleChange(member, member.role === 'SUPER_ADMIN' ? 'USER' : 'SUPER_ADMIN')}
                            >
                              {member.role === 'SUPER_ADMIN' ? '↓ Downgrade' : '↑ Make Admin'}
                            </button>
                          )}
                        </div>

                        {/* User Type Badge */}
                        <div className="relative">
                          <span 
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                              userTypes.find(t => t.value === member.userType)?.color || 'bg-slate-100 text-slate-700'
                            }`}
                            onClick={() => {
                              if (me?.role === 'SUPER_ADMIN') {
                                setActiveTypeDropdownUserId(activeTypeDropdownUserId === member.id ? null : member.id);
                              }
                            }}
                          >
                            {member.userType || 'RECRUITER'}
                            {me?.role === 'SUPER_ADMIN' && <span className="text-[8px] ml-1">▼</span>}
                          </span>

                          {/* Inline userType selection dropdown */}
                          {activeTypeDropdownUserId === member.id && (
                            <div className="absolute left-0 mt-1 z-30 w-44 bg-white border border-slate-200 rounded-xl shadow-lg p-1">
                              {userTypes.map((t) => (
                                <button
                                  key={t.value}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#1f52cc] rounded-lg transition-colors"
                                  onClick={() => handleUserTypeChange(member.id, t.value)}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="p-4 text-xs font-bold">
                      <div className="flex flex-col gap-1.5 items-start">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
                          member.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700'
                          : member.status === 'INACTIVE' ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            member.status === 'ACTIVE' ? 'bg-emerald-500'
                            : member.status === 'INACTIVE' ? 'bg-red-400'
                            : 'bg-amber-500'
                          }`} />
                          {member.status === 'INACTIVE' ? 'DEACTIVATED' : (member.status || 'ACTIVE')}
                        </span>
                        {me?.role === 'SUPER_ADMIN' && member.status === 'PENDING' && (
                          <button
                            type="button"
                            className="mt-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1 bg-emerald-50/50 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/50 transition-all"
                            onClick={() => handleApproveMember(member.id)}
                          >
                            <span className="material-symbols-outlined !text-[12px] leading-none">check_circle</span>
                            Approve
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="p-4">
                      <div className="flex gap-2 flex-wrap">
                        <button className="os-btn-outline !h-8 !px-2.5" onClick={() => { window.location.href = `mailto:${member.email}`; }} title="Email">
                          <span className="material-symbols-outlined text-sm">mail</span>
                        </button>
                        <button className="os-btn-outline !h-8 !px-2.5" onClick={() => { if (member.phone) window.location.href = `tel:${member.phone}`; }} title="Call" disabled={!member.phone}>
                          <span className="material-symbols-outlined text-sm">call</span>
                        </button>
                        {(me?.role === 'SUPER_ADMIN' || me?.id === member.id) && (member.role === 'RECRUITER' || member.role === 'SUPER_ADMIN') && (
                          <button className="os-btn-outline !h-8 !px-2.5" onClick={() => handleEditMember(member)} title="Edit Profile">
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                        )}
                        {me?.id === member.id && (
                          <button 
                            className="os-btn-primary !h-8 !px-3 flex items-center gap-1.5 text-xs font-bold shadow-sm" 
                            onClick={() => setShowChangePasswordModal(true)} 
                            title="Change Password"
                          >
                            <span className="material-symbols-outlined text-sm">key</span>
                            Password
                          </button>
                        )}
                        {/* Active / Deactivate toggle — SUPER_ADMIN only, not for self */}
                        {me?.role === 'SUPER_ADMIN' && member.id !== me.id && (member.status === 'ACTIVE' || member.status === 'INACTIVE') && (
                          <button
                            title={member.status === 'ACTIVE' ? 'Deactivate Account' : 'Activate Account'}
                            className={`os-btn-outline !h-8 !px-2.5 flex items-center gap-1 text-xs font-bold transition-all ${
                              updatingStatusUserIds[member.id]
                                ? '!text-slate-400 !border-slate-200 bg-slate-50 cursor-not-allowed'
                                : member.status === 'ACTIVE'
                                ? '!text-amber-600 !border-amber-200 hover:!bg-amber-50'
                                : '!text-emerald-600 !border-emerald-200 hover:!bg-emerald-50'
                            }`}
                            onClick={() => handleStatusToggle(member)}
                            disabled={!!updatingStatusUserIds[member.id]}
                          >
                            <span className={`material-symbols-outlined text-sm ${updatingStatusUserIds[member.id] ? 'animate-spin' : ''}`}>
                              {updatingStatusUserIds[member.id] ? 'sync' : member.status === 'ACTIVE' ? 'block' : 'check_circle'}
                            </span>
                            <span className="hidden sm:inline">
                              {updatingStatusUserIds[member.id]
                                ? 'Updating...'
                                : member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </span>
                          </button>
                        )}
                        {me?.role === 'SUPER_ADMIN' && member.id !== me.id && (
                          <button className="os-btn-outline !h-8 !px-2.5 !text-red-500 !border-red-100 hover:!bg-red-50" onClick={() => initiateDelete(member)} title="Delete Member">
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredActiveMembers.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-400 text-sm italic">No active team members match filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            /* DELETED MEMBERS TAB (SUPER_ADMIN only) */
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e9eef4]">
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Email</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Role</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Deleted On</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Deleted By</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500">Restore</th>
                </tr>
              </thead>
              <tbody>
                {deletedMembers.map((member) => (
                  <tr key={member.id} className="border-b border-[#ebeff4] hover:bg-slate-50/50">
                    <td className="p-4 font-semibold text-slate-900" title={member.fullName}>{member.fullName}</td>
                    <td className="p-4 text-sm text-slate-600">{member.email}</td>
                    <td className="p-4 text-xs font-bold text-slate-600">{member.role}</td>
                    <td className="p-4 text-sm text-slate-500">{member.deletedAt ? new Date(member.deletedAt).toLocaleDateString() : 'N/A'}</td>
                    <td className="p-4 text-sm text-slate-600">{member.deletedByName || 'System'}</td>
                    <td className="p-4">
                      <button className="os-btn-primary !h-8 text-xs font-bold bg-[#1f52cc]" onClick={() => handleRestore(member.id)}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
                {deletedMembers.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-400 text-sm italic">No soft-deleted team members.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Reveal>

        {/* MODALS */}

        {/* Active / Deactivate Confirmation Modal removed for inline screen optimization */}

        {/* Soft Delete Confirmation Modal */}
        {deleteTarget && createPortal(
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md modal-overlay-fade" onClick={() => setDeleteTarget(null)} />
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 relative z-50 modal-scale-up" onClick={(e) => e.stopPropagation()}>
              <div className="text-center">
                <span className="material-symbols-outlined text-red-500 text-5xl mb-3">warning</span>
                <h3 className="text-lg font-bold text-[#0f1b3d] font-[Manrope]">Delete Team Member</h3>
                
                <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                  You are about to delete <strong>{deleteTarget.fullName}</strong> ({deleteTarget.email}). 
                  This action will immediately log them out of all sessions and they will lose access to the platform.
                  This can be undone from the Deleted Members tab.
                </p>

                {/* Recruiter Active Candidates Warning */}
                {deletingActiveCandidatesCount > 0 && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-100 text-left">
                    <p className="text-xs font-semibold text-amber-800">
                      ⚠ This recruiter currently has {deletingActiveCandidatesCount} active candidates. 
                      Please reassign them before deleting.
                    </p>
                  </div>
                )}

                {deleteConfirmError && (
                  <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                    {deleteConfirmError}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button className="os-btn-outline" onClick={() => setDeleteTarget(null)}>
                    Cancel
                  </button>
                  <button 
                    className="os-btn-primary bg-red-600 hover:bg-red-700 shadow-md"
                    onClick={confirmDelete}
                    disabled={deletingActiveCandidatesCount > 0 || isDeletingLoading}
                  >
                    {isDeletingLoading ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Role Change Confirmation Modal (Upgrade/Downgrade) */}
        {roleChangeTarget && createPortal(
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md modal-overlay-fade" onClick={() => setRoleChangeTarget(null)} />
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 relative z-50 modal-scale-up" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-[#0f1b3d] font-[Manrope]">
                {roleChangeTarget.targetRole === 'SUPER_ADMIN' ? 'Upgrade to Super Admin' : 'Downgrade to User'}
              </h3>
              
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                {roleChangeTarget.targetRole === 'SUPER_ADMIN' ? (
                  `You are granting ${roleChangeTarget.user.fullName} full Super Admin access to the organization. They will be able to manage all users, projects, settings, and billing. This can be reversed at any time.`
                ) : (
                  `You are removing Super Admin access from ${roleChangeTarget.user.fullName}. They will no longer be able to manage users, settings, or view restricted data. They will retain access to their assigned projects and candidates.`
                )}
              </p>

              {roleChangeError && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                  {roleChangeError}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button className="os-btn-outline" onClick={() => setRoleChangeTarget(null)}>
                  Cancel
                </button>
                <button 
                  className={`os-btn-primary ${roleChangeTarget.targetRole === 'SUPER_ADMIN' ? 'bg-[#1f52cc]' : 'bg-amber-600 hover:bg-amber-700'}`}
                  onClick={confirmRoleChange}
                  disabled={isRoleChangeLoading}
                >
                  {isRoleChangeLoading ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Edit Modals (Preserved) */}
        <EditRecruiterModal
          isOpen={editingUserId !== null && (editingUserRole === 'RECRUITER' || editingUserRole === 'SUPER_ADMIN')}
          userId={editingUserId}
          onClose={() => { setEditingUserId(null); setEditingUserRole(null); }}
          onUpdate={loadAll}
        />
        <EditInterviewerModal
          isOpen={editingUserId !== null && editingUserRole === 'INTERVIEWER'}
          userId={editingUserId}
          onClose={() => { setEditingUserId(null); setEditingUserRole(null); }}
          onUpdate={loadAll}
        />
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
        />
      </PageEnter>
    </EnterpriseLayout>
  );
};

function ChangePasswordModal({ isOpen, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  // Real-time strength checks
  const { ok: isPolicyMet, issues } = useMemo(() => {
    return validatePasswordStrength(newPassword);
  }, [newPassword]);

  const confirmMatches = newPassword === confirmPassword;
  const canSubmit = currentPassword && isPolicyMet && confirmMatches;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    setSuccess('');

    try {
      await apiPost('/users/me/change-password', {
        currentPassword,
        newPassword
      });
      setSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        onClose();
        setSuccess('');
      }, 1500);
    } catch (err) {
      const payload = err.payload || {};
      if (payload.code === 'INVALID_CURRENT_PASSWORD') {
        setFieldErrors({ current: 'Current password is incorrect.' });
      } else if (payload.code === 'WEAK_PASSWORD') {
        setError('New password does not meet strength requirements.');
      } else if (payload.code === 'PASSWORD_UNCHANGED') {
        setFieldErrors({ new: 'New password cannot be the same as your current password.' });
      } else {
        setError(err.message || 'Failed to change password.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800 font-sans">Change Password</h2>
            <p className="text-xs text-slate-500 font-sans">Secure your account by updating your password</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 text-red-600 bg-red-50 border border-red-100 rounded-xl text-xs font-semibold">{error}</div>}
          {success && <div className="p-3 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-semibold">{success}</div>}

          {/* Current Password */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">Current Password</label>
            <input
              type="password"
              className={`w-full h-10 px-3 rounded-xl border focus:outline-none text-xs ${
                fieldErrors.current ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-[#1f52cc]'
              }`}
              value={currentPassword}
              onChange={e => {
                setCurrentPassword(e.target.value);
                setFieldErrors(prev => ({ ...prev, current: null }));
              }}
              required
            />
            {fieldErrors.current && <p className="text-[10px] text-red-500 font-semibold">{fieldErrors.current}</p>}
          </div>

          {/* New Password */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">New Password</label>
            <input
              type="password"
              className={`w-full h-10 px-3 rounded-xl border focus:outline-none text-xs ${
                fieldErrors.new ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-[#1f52cc]'
              }`}
              value={newPassword}
              onChange={e => {
                setNewPassword(e.target.value);
                setFieldErrors(prev => ({ ...prev, new: null }));
              }}
              required
            />
            {fieldErrors.new && <p className="text-[10px] text-red-500 font-semibold">{fieldErrors.new}</p>}

            {/* Real-time strength checks */}
            {newPassword && (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1 mt-1.5">
                <p className="text-[9px] uppercase font-black text-slate-400">Password Strength Requirements</p>
                <ul className="text-[10px] space-y-0.5 font-medium">
                  {[
                    { label: 'At least 12 characters', met: newPassword.length >= 12 },
                    { label: 'One uppercase letter (A-Z)', met: /[A-Z]/.test(newPassword) },
                    { label: 'One lowercase letter (a-z)', met: /[a-z]/.test(newPassword) },
                    { label: 'One number (0-9)', met: /\d/.test(newPassword) },
                    { label: 'One symbol/special character', met: /[^A-Za-z0-9]/.test(newPassword) },
                    { label: 'No 3+ repeated characters in a row', met: !/(.)\1{2,}/.test(newPassword) },
                  ].map((req, idx) => (
                    <li key={idx} className={`flex items-center gap-1.5 ${req.met ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <span className="material-symbols-outlined !text-xs leading-none">
                        {req.met ? 'check_circle' : 'circle'}
                      </span>
                      {req.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">Confirm New Password</label>
            <input
              type="password"
              className={`w-full h-10 px-3 rounded-xl border focus:outline-none text-xs ${
                confirmPassword && !confirmMatches ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-[#1f52cc]'
              }`}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
            />
            {confirmPassword && !confirmMatches && (
              <p className="text-[10px] text-red-500 font-semibold">Passwords do not match.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="w-full h-11 bg-[#1f52cc] hover:bg-[#163fa3] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-1.5 mt-2"
          >
            {submitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Team;
