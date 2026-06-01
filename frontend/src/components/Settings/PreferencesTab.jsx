import React from 'react';
import { Reveal } from '../PageMotion';

const timezoneOptions = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST) - Asia/Kolkata' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
  { value: 'America/New_York', label: 'Eastern Standard Time (EST) - America/New_York' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT) - Europe/London' },
  { value: 'Asia/Singapore', label: 'Singapore Time (SGT) - Asia/Singapore' }
];

const PreferencesTab = ({
  prefForm,
  setPrefForm,
  savingPrefs,
  handleSavePrefs,
  datePreview
}) => {
  return (
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
  );
};

export default PreferencesTab;
