import React from 'react';
import { Reveal } from '../PageMotion';

const ContactTab = ({
  contactForm,
  setContactForm,
  savingContact,
  handleSaveContact,
  isSuperAdmin
}) => {
  return (
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
  );
};

export default ContactTab;
