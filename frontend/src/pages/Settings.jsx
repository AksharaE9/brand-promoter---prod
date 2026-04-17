import React, { useEffect, useMemo, useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const emptyUserForm = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
  role: 'RECRUITER',
};

const Settings = () => {
  const [me, setMe] = useState(null);
  const [team, setTeam] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [editingId, setEditingId] = useState('');
  const [editForm, setEditForm] = useState({ fullName: '', email: '', phone: '', role: 'RECRUITER' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [userPhotoFile, setUserPhotoFile] = useState(null);
  const [uploadingUserPhoto, setUploadingUserPhoto] = useState(false);
  const [preferences, setPreferences] = useState({
    emailDigests: true,
    pushAlerts: true,
    slackConnect: false,
  });

  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const loadAll = async () => {
    const meRes = await apiGet('/auth/me');
    const meData = meRes.data || null;
    setMe(meData);

    if (meData?.role === 'SUPER_ADMIN') {
      const [usersRes, logsRes] = await Promise.all([
        apiGet('/users'),
        apiGet('/users/audit-logs?limit=20'),
      ]);
      setTeam(usersRes.data || []);
      setAuditLogs(logsRes.data || []);
      return;
    }

    setTeam(meData ? [meData] : []);
    setAuditLogs([]);
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setError('');
        await loadAll();
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load settings');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ats_notification_preferences');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setPreferences((prev) => ({ ...prev, ...parsed }));
    } catch (_) {
      // noop
    }
  }, []);

  const onTogglePreference = (key) => {
    setPreferences((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('ats_notification_preferences', JSON.stringify(next));
      return next;
    });
    setBanner('Notification preferences updated.');
  };

  const onCreateUser = async (event) => {
    event.preventDefault();
    setError('');
    setBanner('');

    try {
      setSavingCreate(true);
      await apiPost('/users', {
        fullName: userForm.fullName.trim(),
        email: userForm.email.trim(),
        phone: userForm.phone.trim() || null,
        password: userForm.password,
        role: userForm.role,
      });
      await loadAll();
      setUserForm(emptyUserForm);
      setShowCreate(false);
      setBanner('User created successfully.');
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setSavingCreate(false);
    }
  };

  const onStartEdit = (member) => {
    setEditingId(member.id);
    setEditForm({
      fullName: member.fullName || '',
      email: member.email || '',
      phone: member.phone || '',
      role: member.role || 'RECRUITER',
    });
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setError('');
    setBanner('');
    try {
      setSavingEdit(true);
      await apiPatch(`/users/${editingId}`, {
        fullName: editForm.fullName.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        role: editForm.role,
      });
      await loadAll();
      setEditingId('');
      setBanner('User details updated.');
    } catch (err) {
      setError(err.message || 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const onToggleStatus = async (member) => {
    setError('');
    setBanner('');
    try {
      await apiPatch(`/users/${member.id}/status`, {
        status: member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      await loadAll();
      setBanner(`User "${member.fullName}" status updated.`);
    } catch (err) {
      setError(err.message || 'Failed to update user status');
    }
  };

  const onDeleteUser = async (member) => {
    if (!window.confirm(`Are you sure you want to COMPLETELY delete the account for "${member.fullName}"? This action cannot be undone.`)) {
      return;
    }

    setError('');
    setBanner('');
    try {
      await apiDelete(`/users/${member.id}`);
      await loadAll();
      setBanner(`User "${member.fullName}" has been permanently deleted.`);
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    }
  };

  const uploadUserPhoto = async () => {
    if (!userPhotoFile) return;
    setError('');
    const token = localStorage.getItem('ats_token');
    const formData = new FormData();
    formData.append('file', userPhotoFile);

    try {
      setUploadingUserPhoto(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/users/me/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Photo upload failed');
      
      await loadAll();
      setUserPhotoFile(null);
      setBanner('Your profile photo has been updated.');
    } catch (err) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setUploadingUserPhoto(false);
    }
  };

  useEffect(() => {
    if (userPhotoFile) uploadUserPhoto();
  }, [userPhotoFile]);

  const integrationRows = useMemo(
    () => [
      ['Slack', 'Connected'],
      ['Zoom', 'Connected'],
      ['G-Calendar', 'Disconnected'],
    ],
    [],
  );

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="settings" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search settings..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="Alex Rivera" fallbackRole="Admin" avatarSeed="settings-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        <div>
          <div className="os-eyebrow">Configuration Center</div>
          <h1 className="os-h1">Unified Settings</h1>
          <p className="os-muted max-w-3xl mt-2">
            Manage workspace identity, connection protocols, and team permissions.
          </p>
        </div>

        {error ? <div className="mt-4 os-card p-4 text-red-600 text-sm">{error}</div> : null}
        {banner ? <div className="mt-4 os-card p-4 text-[#2454cf] text-sm">{banner}</div> : null}

        <div className="grid lg:grid-cols-[1.6fr_.9fr] gap-4 mt-5">
          <Reveal>
            <div className="os-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-semibold font-[Manrope]">Profile Management</h3>
                  <p className="os-muted text-sm mt-1">Update your branding and contact details.</p>
                </div>
                <button className="os-btn-primary" type="button" onClick={() => setBanner('Profile details saved.')}>Save Changes</button>
              </div>

              <div className="grid md:grid-cols-[120px_1fr] gap-5 mt-5">
                <div className="relative group w-[120px] h-[120px]">
                  {me?.profilePhotoFile?.storageKey ? (
                    <img className="w-full h-full rounded-2xl object-cover" src={me.profilePhotoFile.storageKey} alt="profile" />
                  ) : (
                    <div className="w-full h-full rounded-2xl bg-[#1f52cc] text-white flex items-center justify-center font-bold text-3xl">
                      {me?.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl cursor-pointer">
                    <span className="material-symbols-outlined text-white text-3xl">photo_camera</span>
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => setUserPhotoFile(e.target.files?.[0])} />
                  </label>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <input className="h-11 rounded-lg border border-[#dce4ec] bg-[#f1f5f8] px-3" value={me?.fullName || 'Alex Rivera'} readOnly />
                  <input className="h-11 rounded-lg border border-[#dce4ec] bg-[#f1f5f8] px-3" value={me?.email || 'alex.rivera@ats.ai'} readOnly />
                  <input className="h-11 rounded-lg border border-[#dce4ec] bg-[#f1f5f8] px-3" value={String(me?.role || 'ADMIN').replace('_', ' ')} readOnly />
                  <select className="h-11 rounded-lg border border-[#dce4ec] bg-[#f1f5f8] px-3"><option>Pacific Time (PT)</option></select>
                </div>
              </div>

              <div className="mt-4 text-sm text-[#4f5a77] flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-[#1f52cc]">verified</span>
                Your account is secured with Two-Factor Authentication.
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope]">Notifications</h3>
              <p className="os-muted text-sm mt-1">Control your focus environment.</p>
              <div className="space-y-3 mt-5">
                {[
                  ['Email Digests', 'emailDigests', 'Daily summaries'],
                  ['Push Alerts', 'pushAlerts', 'Real-time updates'],
                  ['Slack Connect', 'slackConnect', 'Channel updates'],
                ].map(([item, key, help]) => (
                  <div key={item} className="rounded-xl bg-[#f6f9fb] border border-[#e7edf3] p-4 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">{item}</div>
                      <div className="text-xs text-[#7a859f]">{help}</div>
                    </div>
                    <button className={`w-11 h-6 rounded-full relative ${preferences[key] ? 'bg-[#1f52cc]' : 'bg-[#d9e1ea]'}`} type="button" onClick={() => onTogglePreference(key)}>
                      <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full ${preferences[key] ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        {isSuperAdmin ? (
          <Reveal className="os-card mt-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-semibold font-[Manrope]">User Management</h3>
                <p className="os-muted text-sm mt-1">Create, edit, and activate/deactivate internal users.</p>
              </div>
              <button className="os-btn-primary" onClick={() => setShowCreate((value) => !value)} type="button">
                {showCreate ? 'Close Form' : 'Create User'}
              </button>
            </div>

            {showCreate ? (
              <form className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4" onSubmit={onCreateUser}>
                <input className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Full Name" value={userForm.fullName} onChange={(event) => setUserForm((prev) => ({ ...prev, fullName: event.target.value }))} required />
                <input className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Email" type="email" value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} required />
                <input className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Phone" value={userForm.phone} onChange={(event) => setUserForm((prev) => ({ ...prev, phone: event.target.value }))} />
                <input className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" placeholder="Password" type="password" value={userForm.password} onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))} required />
                <select className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm" value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}>
                  <option value="RECRUITER">Internal User (Recruiter/Team)</option>
                  <option value="SUPER_ADMIN">System Administrator</option>
                </select>
                <div className="flex justify-end">
                  <button className="os-btn-primary" type="submit" disabled={savingCreate}>{savingCreate ? 'Saving...' : 'Save User'}</button>
                </div>
              </form>
            ) : null}

            <div className="space-y-3">
              {team.map((member) => (
                <div key={member.id} className="border border-[#e9edf4] rounded-xl p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {member.profilePhotoFile?.storageKey ? (
                        <img className="w-10 h-10 rounded-lg object-cover" src={member.profilePhotoFile.storageKey} alt={member.fullName || 'member'} />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[#6b7280] text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {(member.fullName || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{member.fullName || 'Team Member'}</div>
                        <div className="text-xs text-[#7c88a1] truncate">{member.email || '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs uppercase tracking-[.1em] rounded-full px-3 py-1 ${member.status === 'ACTIVE' ? 'bg-[#e8fff1] text-[#208f58]' : 'bg-[#f3f5f8] text-[#8b95ad]'}`}>
                        {member.status}
                      </span>
                      <button className="os-btn-outline !h-9" type="button" onClick={() => onStartEdit(member)}>Edit</button>
                      <button className="os-btn-outline !h-9" type="button" onClick={() => onToggleStatus(member)}>
                        {member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="os-btn-outline !h-9 !text-red-600 hover:!bg-red-50 hover:!border-red-200" type="button" onClick={() => onDeleteUser(member)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {editingId === member.id ? (
                    <div className="grid md:grid-cols-4 gap-2 mt-3">
                      <input className="h-9 rounded-lg border border-[#dbe4ee] px-2 text-sm" value={editForm.fullName} onChange={(event) => setEditForm((prev) => ({ ...prev, fullName: event.target.value }))} />
                      <input className="h-9 rounded-lg border border-[#dbe4ee] px-2 text-sm" value={editForm.email} onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))} />
                      <input className="h-9 rounded-lg border border-[#dbe4ee] px-2 text-sm" value={editForm.phone} onChange={(event) => setEditForm((prev) => ({ ...prev, phone: event.target.value }))} />
                      <div className="flex gap-2">
                        <select className="h-9 rounded-lg border border-[#dbe4ee] px-2 text-sm flex-1" value={editForm.role} onChange={(event) => setEditForm((prev) => ({ ...prev, role: event.target.value }))}>
                          <option value="RECRUITER">Internal User</option>
                          <option value="SUPER_ADMIN">System Administrator</option>
                        </select>
                        <button className="os-btn-primary !h-9" type="button" onClick={onSaveEdit} disabled={savingEdit}>
                          {savingEdit ? '...' : 'Save'}
                        </button>
                        <button className="os-btn-outline !h-9" type="button" onClick={() => setEditingId('')}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Reveal>
        ) : null}

        <div className="grid lg:grid-cols-[.95fr_1.55fr] gap-4 mt-4">
          <Reveal>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope]">Integrations</h3>
              <p className="os-muted text-sm mt-1">Extend your talent ecosystem.</p>
              <div className="space-y-3 mt-5 text-sm">
                {integrationRows.map((item) => (
                  <div key={item[0]} className="border border-[#e6ecf2] rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{item[0]}</div>
                      <div className={`text-xs ${item[1] === 'Connected' ? 'text-[#2fa96f]' : 'text-[#8f99ad]'}`}>{item[1]}</div>
                    </div>
                    <button className="text-xs text-[#6f7d98]" type="button" onClick={() => setBanner(`${item[0]} ${item[1] === 'Connected' ? 'disconnect' : 'connect'} requested.`)}>
                      {item[1] === 'Connected' ? 'Revoke' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="os-card p-6">
              <h3 className="text-2xl font-semibold font-[Manrope]">Audit Logs</h3>
              <p className="os-muted text-sm mt-1">Recent system actions {isSuperAdmin ? 'for all users' : 'for your account'}.</p>

              {isSuperAdmin ? (
                <div className="space-y-2 mt-5">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="border border-[#e9edf4] rounded-xl p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-[#18254a]">{log.action}</div>
                        <div className="text-xs text-[#7c88a1]">{new Date(log.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-[#5f6b86] mt-1">
                        {log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)}...)` : ''}
                        {log.actor?.fullName ? ` by ${log.actor.fullName}` : ''}
                      </div>
                    </div>
                  ))}
                  {auditLogs.length === 0 ? <div className="text-sm os-muted">No logs found.</div> : null}
                </div>
              ) : (
                <div className="mt-5 text-sm os-muted">Audit logs are available only for Super Admin.</div>
              )}
            </div>
          </Reveal>
        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Settings;
