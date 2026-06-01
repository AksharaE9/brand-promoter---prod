import React from 'react';
import { Reveal } from '../PageMotion';

const OrganizationTab = ({
  orgForm,
  setOrgForm,
  savingOrg,
  handleLogoUpload,
  handleSaveOrg
}) => {
  return (
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
  );
};

export default OrganizationTab;
