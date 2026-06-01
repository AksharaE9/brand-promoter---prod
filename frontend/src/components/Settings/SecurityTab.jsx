import React from 'react';
import { Reveal } from '../PageMotion';

const SecurityTab = ({
  passwordForm,
  setPasswordForm,
  showPassword,
  setShowPassword,
  savingPassword,
  handleSavePassword,
  passwordStrength,
  sessions,
  loadingSessions,
  handleRevokeSession,
  handleRevokeOtherSessions
}) => {
  return (
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
  );
};

export default SecurityTab;
