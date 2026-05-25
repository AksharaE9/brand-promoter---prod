import React, { useEffect, useState, useMemo } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, apiGet, apiPut, apiPost, apiDelete } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const timezoneOptions = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST) - Asia/Kolkata' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
  { value: 'America/New_York', label: 'Eastern Standard Time (EST) - America/New_York' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT) - Europe/London' },
  { value: 'Asia/Singapore', label: 'Singapore Time (SGT) - Asia/Singapore' }
];

const Settings = () => {
  const [me, setMe] = useState(null);
  const [org, setOrg] = useState(null);
  const [activeTab, setActiveTab] = useState('PROFILE'); // PROFILE, ORG, CONTACT, PREFS, SECURITY
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  // Profile fields state
  const [profileForm, setProfileForm] = useState({ fullName: '', workPhone: '', bio: '', profilePhoto: null, profilePhotoUrl: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [originalProfile, setOriginalProfile] = useState({});

  // Org fields state
  const [orgForm, setOrgForm] = useState({ name: '', tagline: '', logoKey: '', primaryColor: '#3B82F6' });
  const [savingOrg, setSavingOrg] = useState(false);

  // Contact fields state
  const [contactForm, setContactForm] = useState({ primaryEmail: '', secondaryEmail: '', primaryPhone: '', secondaryPhone: '', website: '', address: '', city: '', state: '', country: '', pincode: '' });
  const [savingContact, setSavingContact] = useState(false);

  // Preferences fields state
  const [prefForm, setPrefForm] = useState({ timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY', currency: 'INR', language: 'en' });
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Security (password change) state
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
  const [showPassword, setShowPassword] = useState({ current: false, new: false, confirm: false });
  const [savingPassword, setSavingPassword] = useState(false);

  // Active Sessions
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const loadData = async () => {
    try {
      setError('');
      const meRes = await apiGet('/auth/me');
      setMe(meRes.data);
      if (meRes.data) {
        const u = meRes.data;
        const profData = {
          fullName: u.fullName || '',
          workPhone: u.workPhone || u.phone || '',
          bio: u.bio || '',
          profilePhoto: u.profilePhotoFileId || null,
          profilePhotoUrl: u.profilePhotoFile?.storageKey || ''
        };
        setProfileForm(profData);
        setOriginalProfile(profData);
      }

      // Load organization settings
      if (meRes.data?.role === 'SUPER_ADMIN') {
        const orgRes = await apiGet('/settings/organization');
        if (orgRes.success && orgRes.data) {
          const o = orgRes.data;
          setOrg(o);
          setOrgForm({
            name: o.name || '',
            tagline: o.branding?.companyTagline || '',
            logoKey: o.branding?.logoKey || '',
            primaryColor: o.branding?.primaryColor || '#3B82F6'
          });
          setContactForm({
            primaryEmail: o.contactInfo?.primaryEmail || '',
            secondaryEmail: o.contactInfo?.secondaryEmail || '',
            primaryPhone: o.contactInfo?.primaryPhone || '',
            secondaryPhone: o.contactInfo?.secondaryPhone || '',
            website: o.contactInfo?.website || '',
            address: o.contactInfo?.address || '',
            city: o.contactInfo?.city || '',
            state: o.contactInfo?.state || '',
            country: o.contactInfo?.country || '',
            pincode: o.contactInfo?.pincode || ''
          });
          setPrefForm({
            timezone: o.preferences?.timezone || 'Asia/Kolkata',
            dateFormat: o.preferences?.dateFormat || 'DD/MM/YYYY',
            currency: o.preferences?.currency || 'INR',
            language: o.preferences?.language || 'en'
          });
        }
      } else {
        // Users can fetch org contact info
        const contactRes = await apiGet('/settings/contact');
        if (contactRes.success && contactRes.data) {
          setContactForm(contactRes.data);
        }
      }

      // Load Sessions
      loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to load settings data');
    }
  };

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      const res = await apiGet('/auth/sessions');
      if (res.success) {
        setSessions(res.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save Profile Changes
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingProfile(true);
    try {
      const res = await apiPut('/settings/profile', {
        fullName: profileForm.fullName,
        workPhone: profileForm.workPhone || null,
        bio: profileForm.bio || null,
        profilePhoto: profileForm.profilePhoto || null
      });
      if (res.success) {
        setBanner('Profile updated successfully.');
        setOriginalProfile(profileForm);
        loadData();
      }
    } catch (err) {
      setError(err.message || 'Failed to save profile changes');
    } finally {
      setSavingProfile(false);
    }
  };

  // Save Org Branding
  const handleSaveOrg = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingOrg(true);
    try {
      const res = await apiPut('/settings/organization', {
        name: orgForm.name,
        branding: {
          logoKey: orgForm.logoKey || null,
          primaryColor: orgForm.primaryColor,
          companyTagline: orgForm.tagline || null
        },
        contactInfo: { ...contactForm },
        preferences: { ...prefForm }
      });
      if (res.success) {
        setBanner('Organization branding updated.');
        loadData();
      }
    } catch (err) {
      setError(err.message || 'Failed to save organization settings');
    } finally {
      setSavingOrg(false);
    }
  };

  // Save Contact Settings
  const handleSaveContact = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingContact(true);
    try {
      let res;
      if (isSuperAdmin) {
        res = await apiPut('/settings/organization', {
          name: orgForm.name,
          branding: {
            logoKey: orgForm.logoKey,
            primaryColor: orgForm.primaryColor,
            companyTagline: orgForm.tagline
          },
          contactInfo: { ...contactForm },
          preferences: { ...prefForm }
        });
      } else {
        res = await apiPut('/settings/contact', contactForm);
      }
      if (res.success) {
        setBanner('Contact information updated.');
        loadData();
      }
    } catch (err) {
      setError(err.message || 'Failed to update contact info');
    } finally {
      setSavingContact(false);
    }
  };

  // Save Preferences settings
  const handleSavePrefs = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingPrefs(true);
    try {
      const res = await apiPut('/settings/organization', {
        name: orgForm.name,
        branding: {
          logoKey: orgForm.logoKey,
          primaryColor: orgForm.primaryColor,
          companyTagline: orgForm.tagline
        },
        contactInfo: { ...contactForm },
        preferences: { ...prefForm }
      });
      if (res.success) {
        setBanner('Preferences updated.');
        loadData();
      }
    } catch (err) {
      setError(err.message || 'Failed to update preferences');
    } finally {
      setSavingPrefs(false);
    }
  };

  // Save Password
  const handleSavePassword = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingPassword(true);
    try {
      const res = await apiPost('/auth/change-password', passwordForm);
      if (res.success) {
        setBanner('Password changed successfully.');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
      }
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  // Revoke single session
  const handleRevokeSession = async (sessionId) => {
    try {
      const res = await apiDelete(`/auth/sessions/${sessionId}`);
      if (res.success) {
        loadSessions();
        setBanner('Session revoked.');
      }
    } catch (err) {
      setError(err.message || 'Failed to revoke session');
    }
  };

  // Revoke all other sessions
  const handleRevokeOtherSessions = async () => {
    try {
      const res = await apiDelete('/auth/sessions-other');
      if (res.success) {
        loadSessions();
        setBanner('All other active sessions revoked.');
      }
    } catch (err) {
      setError(err.message || 'Failed to revoke sessions');
    }
  };

  // Profile Photo Upload Handler
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('File size must be under 2MB');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('ats_token');

    try {
      const res = await fetch(`${API_BASE_URL}/files/profile-photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Upload failed');
      
      setProfileForm(prev => ({
        ...prev,
        profilePhoto: json.fileId,
        profilePhotoUrl: json.url
      }));
    } catch (err) {
      setError(err.message || 'Failed to upload photo');
    }
  };

  // Remove photo handler
  const handleRemovePhoto = () => {
    setProfileForm(prev => ({ ...prev, profilePhoto: null, profilePhotoUrl: '' }));
  };

  // Org Logo Upload Handler
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('ats_token');

    try {
      const res = await fetch(`${API_BASE_URL}/files/profile-photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Logo upload failed');

      setOrgForm(prev => ({ ...prev, logoKey: json.url }));
    } catch (err) {
      setError(err.message || 'Failed to upload logo');
    }
  };

  // Password strength logic
  const passwordStrength = useMemo(() => {
    const p = passwordForm.newPassword;
    if (!p) return 0;
    if (p.length < 8) return 1; // weak
    const hasSpecial = /[\W_]/.test(p);
    const hasNumber = /\d/.test(p);
    const hasUpper = /[A-Z]/.test(p);
    
    if (p.length >= 12 && hasSpecial && hasNumber && hasUpper) return 4; // strong
    if (p.length >= 8 && hasSpecial) return 3; // good
    return 2; // fair
  }, [passwordForm.newPassword]);

  // Today Date Preview
  const datePreview = useMemo(() => {
    const today = new Date();
    const d = String(today.getDate()).padStart(2, '0');
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const y = today.getFullYear();
    if (prefForm.dateFormat === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
    if (prefForm.dateFormat === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    return `${d}/${m}/${y}`;
  }, [prefForm.dateFormat]);

  const profileChanged = useMemo(() => {
    return profileForm.fullName !== originalProfile.fullName ||
           profileForm.workPhone !== originalProfile.workPhone ||
           profileForm.bio !== originalProfile.bio ||
           profileForm.profilePhoto !== originalProfile.profilePhoto;
  }, [profileForm, originalProfile]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="settings" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search configuration settings..."
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="System Administrator" fallbackRole="Admin" avatarSeed="settings-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Title */}
        <div>
          <div className="os-eyebrow">Configuration Center</div>
          <h1 className="os-h1">Unified Settings</h1>
          <p className="os-muted max-w-3xl mt-2">
            Manage workspace identity, profiles, timezone, security, and active sessions.
          </p>
        </div>

        {/* Global Notifications */}
        {error && <div className="mt-4 os-card p-4 text-red-600 text-sm font-semibold bg-red-50 border-red-200">{error}</div>}
        {banner && <div className="mt-4 os-card p-4 text-blue-700 text-sm font-semibold bg-blue-50 border-blue-200">{banner}</div>}

        {/* Tab Controls */}
        <div className="flex gap-6 mt-6 border-b border-[#e9eef4] pb-2">
          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'PROFILE' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => { setActiveTab('PROFILE'); setError(''); setBanner(''); }}
          >
            Profile
          </button>
          {isSuperAdmin && (
            <button 
              className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'ORG' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setActiveTab('ORG'); setError(''); setBanner(''); }}
            >
              Organization
            </button>
          )}
          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'CONTACT' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => { setActiveTab('CONTACT'); setError(''); setBanner(''); }}
          >
            Contact Details
          </button>
          {isSuperAdmin && (
            <button 
              className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'PREFS' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setActiveTab('PREFS'); setError(''); setBanner(''); }}
            >
              Preferences
            </button>
          )}
          <button 
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'SECURITY' ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            onClick={() => { setActiveTab('SECURITY'); setError(''); setBanner(''); }}
          >
            Security & Sessions
          </button>
        </div>

        {/* Tab Contents */}
        <div className="mt-5">
          
          {/* PROFILE TAB */}
          {activeTab === 'PROFILE' && (
            <Reveal className="os-card p-6">
              <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Profile Settings</h3>
              <p className="text-xs text-slate-500 mt-1 mb-6">Manage your avatar and personal profile info.</p>

              <form onSubmit={handleSaveProfile} className="space-y-6">
                {/* Photo uploader */}
                <div className="flex flex-col items-start gap-3">
                  <div className="relative w-24 h-24">
                    {profileForm.profilePhotoUrl ? (
                      <img className="w-24 h-24 rounded-full object-cover border border-slate-200" src={profileForm.profilePhotoUrl} alt="profile" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-3xl">
                        {(profileForm.fullName || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )}
                    <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#1f52cc] text-white flex items-center justify-center cursor-pointer shadow-md hover:bg-[#1546ba] transition-colors border-2 border-white">
                      <span className="material-symbols-outlined text-base">photo_camera</span>
                      <input type="file" className="hidden" accept="image/png, image/jpeg" onChange={handlePhotoUpload} />
                    </label>
                  </div>
                  {profileForm.profilePhotoUrl && (
                    <button type="button" className="text-xs font-semibold text-red-500 hover:underline" onClick={handleRemovePhoto}>
                      Remove Photo
                    </button>
                  )}
                </div>

                {/* Form fields */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Full Name <span className="text-red-500">*</span></label>
                    <input 
                      type="text"
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                      value={profileForm.fullName}
                      onChange={e => setProfileForm(p => ({ ...p, fullName: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Email Address</label>
                    <div className="relative">
                      <input 
                        type="email"
                        className="h-11 w-full rounded-lg border border-[#dce4ec] bg-slate-50 px-3 text-sm text-slate-500 cursor-not-allowed outline-none"
                        value={me?.email || ''}
                        readOnly
                      />
                      <span className="material-symbols-outlined absolute right-3 top-3 text-slate-400 text-sm">lock</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Contact your Super Admin to change your email address</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Work Phone</label>
                    <input 
                      type="text"
                      maxLength="10"
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                      placeholder="10-digit number"
                      value={profileForm.workPhone}
                      onChange={e => setProfileForm(p => ({ ...p, workPhone: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>

                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-semibold text-[#7b86a0]">Bio</label>
                    <textarea 
                      maxLength="500"
                      rows="4"
                      className="rounded-lg border border-[#dce4ec] p-3 text-sm focus:border-[#1f52cc] outline-none resize-none"
                      placeholder="Tell us about yourself..."
                      value={profileForm.bio}
                      onChange={e => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                    />
                    <span className="text-[10px] text-slate-400 text-right">
                      {profileForm.bio.length} / 500 characters
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button 
                    type="submit" 
                    className="os-btn-primary" 
                    disabled={!profileChanged || savingProfile}
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            </Reveal>
          )}

          {/* ORGANIZATION TAB (SUPER_ADMIN only) */}
          {activeTab === 'ORG' && isSuperAdmin && (
            <Reveal className="os-card p-6">
              <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Organization Branding</h3>
              <p className="text-xs text-slate-500 mt-1 mb-6">Manage organization identity, tags, and logo keys.</p>

              <form onSubmit={handleSaveOrg} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Organization Name <span className="text-red-500">*</span></label>
                    <input 
                      type="text"
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                      value={orgForm.name}
                      onChange={e => setOrgForm(o => ({ ...o, name: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Company Tagline</label>
                    <input 
                      type="text"
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                      value={orgForm.tagline}
                      onChange={e => setOrgForm(o => ({ ...o, tagline: e.target.value }))}
                    />
                  </div>

                  {/* Logo uploader */}
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-semibold text-[#7b86a0]">Organization Logo</label>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="w-[200px] h-[80px] rounded-xl border border-dashed border-slate-300 flex items-center justify-center overflow-hidden bg-slate-50">
                        {orgForm.logoKey ? (
                          <img className="max-w-full max-h-full object-contain" src={orgForm.logoKey} alt="Logo" />
                        ) : (
                          <span className="text-xs text-slate-400">200x80px logo</span>
                        )}
                      </div>
                      <label className="os-btn-outline cursor-pointer !h-10">
                        Upload Logo
                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                      </label>
                    </div>
                  </div>

                  {/* Theme Color Picker */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Primary Branding Color</label>
                    <div className="flex items-center gap-3 mt-1">
                      <input 
                        type="color"
                        className="w-11 h-11 border-none cursor-pointer rounded-lg bg-transparent"
                        value={orgForm.primaryColor}
                        onChange={e => setOrgForm(o => ({ ...o, primaryColor: e.target.value }))}
                      />
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm outline-none focus:border-[#1f52cc]"
                        value={orgForm.primaryColor}
                        onChange={e => setOrgForm(o => ({ ...o, primaryColor: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button type="submit" className="os-btn-primary" disabled={savingOrg}>
                    {savingOrg ? 'Saving...' : 'Save Organization'}
                  </button>
                </div>
              </form>
            </Reveal>
          )}

          {/* CONTACT DETAILS TAB */}
          {activeTab === 'CONTACT' && (
            <Reveal className="os-card p-6">
              <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Organization Contact Details</h3>
              <p className="text-xs text-slate-500 mt-1 mb-6">Manage global addresses, phones, emails, and website records.</p>

              <form onSubmit={handleSaveContact} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Primary Email */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Primary Email</label>
                    {isSuperAdmin ? (
                      <input 
                        type="email"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.primaryEmail}
                        onChange={e => setContactForm(c => ({ ...c, primaryEmail: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.primaryEmail || 'N/A'}</p>
                    )}
                  </div>

                  {/* Secondary Email */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Secondary Email</label>
                    {isSuperAdmin ? (
                      <input 
                        type="email"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.secondaryEmail}
                        onChange={e => setContactForm(c => ({ ...c, secondaryEmail: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.secondaryEmail || 'N/A'}</p>
                    )}
                  </div>

                  {/* Primary Phone */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Primary Phone</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.primaryPhone}
                        onChange={e => setContactForm(c => ({ ...c, primaryPhone: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.primaryPhone || 'N/A'}</p>
                    )}
                  </div>

                  {/* Secondary Phone */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Secondary Phone</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.secondaryPhone}
                        onChange={e => setContactForm(c => ({ ...c, secondaryPhone: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.secondaryPhone || 'N/A'}</p>
                    )}
                  </div>

                  {/* Website */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Website URL</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        placeholder="https://example.com"
                        value={contactForm.website}
                        onChange={e => setContactForm(c => ({ ...c, website: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.website || 'N/A'}</p>
                    )}
                  </div>

                  {/* Pincode */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Pincode</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.pincode}
                        onChange={e => setContactForm(c => ({ ...c, pincode: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.pincode || 'N/A'}</p>
                    )}
                  </div>

                  {/* Address */}
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-xs font-semibold text-[#7b86a0]">Address</label>
                    {isSuperAdmin ? (
                      <textarea 
                        rows="3"
                        className="rounded-lg border border-[#dce4ec] p-3 text-sm focus:border-[#1f52cc] outline-none resize-none"
                        value={contactForm.address}
                        onChange={e => setContactForm(c => ({ ...c, address: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700 min-h-[70px]">{contactForm.address || 'N/A'}</p>
                    )}
                  </div>

                  {/* City */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">City</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.city}
                        onChange={e => setContactForm(c => ({ ...c, city: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.city || 'N/A'}</p>
                    )}
                  </div>

                  {/* State */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">State</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.state}
                        onChange={e => setContactForm(c => ({ ...c, state: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.state || 'N/A'}</p>
                    )}
                  </div>

                  {/* Country */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Country</label>
                    {isSuperAdmin ? (
                      <input 
                        type="text"
                        className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm focus:border-[#1f52cc] outline-none"
                        value={contactForm.country}
                        onChange={e => setContactForm(c => ({ ...c, country: e.target.value }))}
                      />
                    ) : (
                      <p className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-700">{contactForm.country || 'N/A'}</p>
                    )}
                  </div>
                </div>

                {isSuperAdmin && (
                  <div className="flex justify-end">
                    <button type="submit" className="os-btn-primary" disabled={savingContact}>
                      {savingContact ? 'Saving...' : 'Save Contact Info'}
                    </button>
                  </div>
                )}
              </form>
            </Reveal>
          )}

          {/* PREFERENCES TAB (SUPER_ADMIN only) */}
          {activeTab === 'PREFS' && isSuperAdmin && (
            <Reveal className="os-card p-6">
              <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Localization Preferences</h3>
              <p className="text-xs text-slate-500 mt-1 mb-6">Manage standard timezones, currencies, and languages.</p>

              <form onSubmit={handleSavePrefs} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Timezone */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Timezone</label>
                    <select 
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm outline-none font-bold text-slate-700"
                      value={prefForm.timezone}
                      onChange={e => setPrefForm(p => ({ ...p, timezone: e.target.value }))}
                    >
                      {timezoneOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Currency */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Currency</label>
                    <select 
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm outline-none font-bold text-slate-700"
                      value={prefForm.currency}
                      onChange={e => setPrefForm(p => ({ ...p, currency: e.target.value }))}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="AED">AED (د.إ)</option>
                    </select>
                  </div>

                  {/* Language */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[#7b86a0]">Language</label>
                    <select 
                      className="h-11 rounded-lg border border-[#dce4ec] px-3 text-sm outline-none font-bold text-slate-700"
                      value={prefForm.language}
                      onChange={e => setPrefForm(p => ({ ...p, language: e.target.value }))}
                    >
                      <option value="en">English (US)</option>
                    </select>
                  </div>

                  {/* Date format */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[#7b86a0]">Date Format</label>
                    <div className="flex items-center gap-6 mt-1">
                      {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(f => (
                        <label key={f} className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                          <input 
                            type="radio" 
                            name="dateFormat"
                            className="w-4 h-4 accent-[#1f52cc]"
                            checked={prefForm.dateFormat === f}
                            onChange={() => setPrefForm(p => ({ ...p, dateFormat: f }))}
                          />
                          {f}
                        </label>
                      ))}
                    </div>
                    <span className="text-[10px] text-[#1f52cc] font-semibold mt-1">
                      Live Preview: {datePreview}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button type="submit" className="os-btn-primary" disabled={savingPrefs}>
                    {savingPrefs ? 'Saving...' : 'Save Preferences'}
                  </button>
                </div>
              </form>
            </Reveal>
          )}

          {/* SECURITY & SESSIONS TAB */}
          {activeTab === 'SECURITY' && (
            <Reveal className="space-y-6">
              
              {/* Change password */}
              <div className="os-card p-6">
                <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Update Credentials</h3>
                <p className="text-xs text-slate-500 mt-1 mb-6">Modify system authorization passwords.</p>

                <form onSubmit={handleSavePassword} className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    {/* Current password */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-[#7b86a0]">Current Password</label>
                      <div className="relative">
                        <input 
                          type={showPassword.current ? 'text' : 'password'}
                          className="h-11 w-full rounded-lg border border-[#dce4ec] px-3 pr-10 text-sm outline-none focus:border-[#1f52cc]"
                          value={passwordForm.currentPassword}
                          onChange={e => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))}
                          required
                        />
                        <span 
                          className="material-symbols-outlined absolute right-3 top-3 text-slate-400 cursor-pointer text-base"
                          onClick={() => setShowPassword(p => ({ ...p, current: !p.current }))}
                        >
                          {showPassword.current ? 'visibility_off' : 'visibility'}
                        </span>
                      </div>
                    </div>

                    {/* New password */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-[#7b86a0]">New Password</label>
                      <div className="relative">
                        <input 
                          type={showPassword.new ? 'text' : 'password'}
                          className="h-11 w-full rounded-lg border border-[#dce4ec] px-3 pr-10 text-sm outline-none focus:border-[#1f52cc]"
                          value={passwordForm.newPassword}
                          onChange={e => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))}
                          required
                        />
                        <span 
                          className="material-symbols-outlined absolute right-3 top-3 text-slate-400 cursor-pointer text-base"
                          onClick={() => setShowPassword(p => ({ ...p, new: !p.new }))}
                        >
                          {showPassword.new ? 'visibility_off' : 'visibility'}
                        </span>
                      </div>
                    </div>

                    {/* Confirm new password */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-[#7b86a0]">Confirm New Password</label>
                      <div className="relative">
                        <input 
                          type={showPassword.confirm ? 'text' : 'password'}
                          className="h-11 w-full rounded-lg border border-[#dce4ec] px-3 pr-10 text-sm outline-none focus:border-[#1f52cc]"
                          value={passwordForm.confirmNewPassword}
                          onChange={e => setPasswordForm(p => ({ ...p, confirmNewPassword: e.target.value }))}
                          required
                        />
                        <span 
                          className="material-symbols-outlined absolute right-3 top-3 text-slate-400 cursor-pointer text-base"
                          onClick={() => setShowPassword(p => ({ ...p, confirm: !p.confirm }))}
                        >
                          {showPassword.confirm ? 'visibility_off' : 'visibility'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Password strength bar */}
                  {passwordForm.newPassword && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <div className="flex gap-1 h-1.5 w-full max-w-[200px] rounded bg-slate-100 overflow-hidden">
                        <div className={`h-full ${passwordStrength >= 1 ? 'bg-red-500' : ''} flex-1`} />
                        <div className={`h-full ${passwordStrength >= 2 ? 'bg-orange-400' : ''} flex-1`} />
                        <div className={`h-full ${passwordStrength >= 3 ? 'bg-yellow-400' : ''} flex-1`} />
                        <div className={`h-full ${passwordStrength >= 4 ? 'bg-emerald-500' : ''} flex-1`} />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500">
                        Strength:{' '}
                        {passwordStrength === 1 && <span className="text-red-500">Weak</span>}
                        {passwordStrength === 2 && <span className="text-orange-400">Fair</span>}
                        {passwordStrength === 3 && <span className="text-yellow-500">Good</span>}
                        {passwordStrength === 4 && <span className="text-emerald-500">Strong</span>}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button 
                      type="submit" 
                      className="os-btn-primary"
                      disabled={
                        !passwordForm.currentPassword || 
                        !passwordForm.newPassword || 
                        passwordForm.newPassword !== passwordForm.confirmNewPassword || 
                        savingPassword
                      }
                    >
                      {savingPassword ? 'Updating...' : 'Save New Password'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Active Sessions */}
              <div className="os-card p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Active User Sessions</h3>
                    <p className="text-xs text-slate-500 mt-1">Review and revoke active connections to your account.</p>
                  </div>
                  {sessions.filter(s => !s.isCurrent).length > 0 && (
                    <button className="os-btn-outline !h-9 text-xs text-red-500 border-red-200" onClick={handleRevokeOtherSessions}>
                      Revoke All Others
                    </button>
                  )}
                </div>

                <Reveal className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#f8fafc] border-b border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">
                        <th className="p-4">Device</th>
                        <th className="p-4">IP Address</th>
                        <th className="p-4">Location</th>
                        <th className="p-4">Last Active</th>
                        <th className="p-4">Revoke</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingSessions ? (
                        <tr>
                          <td colSpan="5" className="p-8 text-center text-slate-400 animate-pulse">Syncing active connections...</td>
                        </tr>
                      ) : sessions.length > 0 ? (
                        sessions.map((s) => (
                          <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="p-4 font-semibold text-slate-800 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[#1f52cc] text-base">
                                {s.device?.toLowerCase().includes('mobile') || s.device?.toLowerCase().includes('iphone') ? 'smartphone' : 'laptop_mac'}
                              </span>
                              {s.device || 'Unknown Device'}
                              {s.isCurrent && (
                                <span className="bg-blue-100 text-[#1f52cc] font-bold text-[9px] uppercase px-1.5 py-0.5 rounded-full">Current</span>
                              )}
                            </td>
                            <td className="p-4 font-mono text-xs text-slate-500">{s.ipAddress}</td>
                            <td className="p-4 text-slate-600">{s.location || 'Local Session'}</td>
                            <td className="p-4 text-xs text-slate-500">{new Date(s.lastActive || s.createdAt).toLocaleString()}</td>
                            <td className="p-4">
                              {!s.isCurrent ? (
                                <button className="text-red-500 font-bold text-xs hover:underline" onClick={() => handleRevokeSession(s.id)}>
                                  Revoke
                                </button>
                              ) : (
                                <span className="text-slate-400 text-xs font-semibold">Active</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="p-8 text-center text-slate-400 italic">No session history found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Reveal>
              </div>

            </Reveal>
          )}

        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Settings;
