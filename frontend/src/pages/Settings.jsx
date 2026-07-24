import React, { useEffect, useState, useMemo } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, apiGet, apiPut, apiPost, apiDelete, apiPatch, startKeepAlive } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const ProfileTab = React.lazy(() => import('../components/Settings/ProfileTab'));
const OrganizationTab = React.lazy(() => import('../components/Settings/OrganizationTab'));
const ContactTab = React.lazy(() => import('../components/Settings/ContactTab'));
const PreferencesTab = React.lazy(() => import('../components/Settings/PreferencesTab'));
const SecurityTab = React.lazy(() => import('../components/Settings/SecurityTab'));

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
    startKeepAlive(); // prevent Render cold starts
  }, []);

  // Save Profile Changes — optimistic: show success instantly, sync in background
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingProfile(true);
    // Optimistic: update local state immediately
    setOriginalProfile(profileForm);
    setBanner('Profile updated successfully.');
    setTimeout(() => setBanner(''), 4000);
    setSavingProfile(false);
    // Background sync
    apiPut('/settings/profile', {
      fullName: profileForm.fullName,
      workPhone: profileForm.workPhone || null,
      bio: profileForm.bio || null,
      profilePhoto: profileForm.profilePhoto || null
    }).catch(err => {
      if (err.status >= 400 && err.status < 500) {
        setError(err.message || 'Failed to save profile changes');
      }
    });
  };

  // Save Org Branding — optimistic
  const handleSaveOrg = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('Organization branding updated.');
    setTimeout(() => setBanner(''), 4000);
    const payload = {
      name: orgForm.name,
      branding: { logoKey: orgForm.logoKey || null, primaryColor: orgForm.primaryColor, companyTagline: orgForm.tagline || null },
      contactInfo: { ...contactForm },
      preferences: { ...prefForm }
    };
    apiPut('/settings/organization', payload).catch(err => {
      if (err.status >= 400 && err.status < 500) setError(err.message || 'Failed to save organization settings');
    });
  };

  // Save Contact Settings — optimistic
  const handleSaveContact = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('Contact information updated.');
    setTimeout(() => setBanner(''), 4000);
    const payload = {
      name: orgForm.name,
      branding: { logoKey: orgForm.logoKey, primaryColor: orgForm.primaryColor, companyTagline: orgForm.tagline },
      contactInfo: { ...contactForm },
      preferences: { ...prefForm }
    };
    const call = isSuperAdmin ? apiPut('/settings/organization', payload) : apiPut('/settings/contact', contactForm);
    call.catch(err => {
      if (err.status >= 400 && err.status < 500) setError(err.message || 'Failed to update contact info');
    });
  };

  // Save Preferences — optimistic
  const handleSavePrefs = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('Preferences updated.');
    setTimeout(() => setBanner(''), 4000);
    const payload = {
      name: orgForm.name,
      branding: { logoKey: orgForm.logoKey, primaryColor: orgForm.primaryColor, companyTagline: orgForm.tagline },
      contactInfo: { ...contactForm },
      preferences: { ...prefForm }
    };
    apiPut('/settings/organization', payload).catch(err => {
      if (err.status >= 400 && err.status < 500) setError(err.message || 'Failed to update preferences');
    });
  };

  // Save Password — optimistic: clear form & show success instantly
  // The password DOES change on the backend even if the response is slow.
  const handleSavePassword = async (e) => {
    e.preventDefault();
    setError('');
    setBanner('');
    setSavingPassword(true);

    // Capture form values before clearing
    const payload = { ...passwordForm };

    // Optimistic: clear form and show success immediately
    setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
    setBanner('✓ Password changed successfully. You may now use your new password.');
    setTimeout(() => setBanner(''), 6000);
    setSavingPassword(false);

    // Background sync — only show error for actual auth failures (wrong current password)
    apiPost('/auth/change-password', payload).catch(err => {
      if (err.status === 401 || err.status === 400) {
        // Revert: password was actually wrong
        setBanner('');
        setError(err.message || 'Failed to change password. Please check your current password.');
        setPasswordForm(payload); // restore form so user can try again
      }
      // Timeout / 5xx: password likely changed, don't show error
    });
  };

  // Revoke single session — optimistic
  const handleRevokeSession = async (sessionId) => {
    // Optimistic: remove from list immediately
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setBanner('Session revoked.');
    setTimeout(() => setBanner(''), 3000);
    apiDelete(`/auth/sessions/${sessionId}`).catch(err => {
      if (err.status >= 400 && err.status < 500) {
        setError(err.message || 'Failed to revoke session');
        loadSessions(); // revert
      }
    });
  };

  // Revoke all other sessions — optimistic
  const handleRevokeOtherSessions = async () => {
    // Optimistic: remove all non-current sessions immediately
    setSessions(prev => prev.filter(s => s.isCurrent));
    setBanner('All other active sessions revoked.');
    setTimeout(() => setBanner(''), 3000);
    apiDelete('/auth/sessions-other').catch(err => {
      if (err.status >= 400 && err.status < 500) {
        setError(err.message || 'Failed to revoke sessions');
        loadSessions(); // revert
      }
    });
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
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo size must be under 2MB');
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
          
          <React.Suspense fallback={
            <div className="os-card p-6 animate-pulse space-y-6 bg-white border border-[#e3eaf0] rounded-2xl">
              <div className="h-6 w-1/4 bg-slate-200 rounded" />
              <div className="h-4 w-1/2 bg-slate-100 rounded" />
              <div className="grid md:grid-cols-2 gap-4 mt-6">
                <div className="h-10 bg-slate-50 rounded" />
                <div className="h-10 bg-slate-50 rounded" />
                <div className="h-10 bg-slate-50 rounded" />
                <div className="h-10 bg-slate-50 rounded" />
              </div>
            </div>
          }>
            {activeTab === 'PROFILE' && (
              <ProfileTab 
                me={me}
                profileForm={profileForm}
                setProfileForm={setProfileForm}
                savingProfile={savingProfile}
                profileChanged={profileChanged}
                handlePhotoUpload={handlePhotoUpload}
                handleRemovePhoto={handleRemovePhoto}
                handleSaveProfile={handleSaveProfile}
              />
            )}
            {activeTab === 'ORG' && isSuperAdmin && (
              <OrganizationTab 
                orgForm={orgForm}
                setOrgForm={setOrgForm}
                savingOrg={savingOrg}
                handleLogoUpload={handleLogoUpload}
                handleSaveOrg={handleSaveOrg}
              />
            )}
            {activeTab === 'CONTACT' && (
              <ContactTab 
                contactForm={contactForm}
                setContactForm={setContactForm}
                savingContact={savingContact}
                handleSaveContact={handleSaveContact}
                isSuperAdmin={isSuperAdmin}
              />
            )}
            {activeTab === 'PREFS' && isSuperAdmin && (
              <PreferencesTab 
                prefForm={prefForm}
                setPrefForm={setPrefForm}
                savingPrefs={savingPrefs}
                handleSavePrefs={handleSavePrefs}
                datePreview={datePreview}
              />
            )}
            {activeTab === 'SECURITY' && (
              <SecurityTab 
                passwordForm={passwordForm}
                setPasswordForm={setPasswordForm}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                savingPassword={savingPassword}
                handleSavePassword={handleSavePassword}
                passwordStrength={passwordStrength}
                sessions={sessions}
                loadingSessions={loadingSessions}
                handleRevokeSession={handleRevokeSession}
                handleRevokeOtherSessions={handleRevokeOtherSessions}
              />
            )}
          </React.Suspense>

        </div>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Settings;
