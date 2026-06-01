import React from 'react';
import { Reveal } from '../PageMotion';

const ProfileTab = ({
  me,
  profileForm,
  setProfileForm,
  savingProfile,
  profileChanged,
  handlePhotoUpload,
  handleRemovePhoto,
  handleSaveProfile
}) => {
  return (
    <Reveal className="os-card p-6">
      <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">Profile Settings</h3>
      <p className="text-xs text-slate-500 mt-1 mb-6">Manage user profiles, bio summaries, and photo assets.</p>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Profile photo uploader */}
        <div className="flex items-center gap-6">
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
  );
};

export default ProfileTab;
