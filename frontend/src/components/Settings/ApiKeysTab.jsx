import React, { useState, useEffect } from 'react';
import { Reveal } from '../PageMotion';
import { apiGet, apiPost } from '../../lib/api';

const AVAILABLE_SCOPES = [
  { id: 'candidates:read', label: 'candidates:read', desc: 'Read candidates profile and status (without phone and email)' },
  { id: 'candidates:read:pii', label: 'candidates:read:pii', desc: 'Grants access to candidate phone, email, and signed resume download URLs', isPii: true },
  { id: 'interviews:read', label: 'interviews:read', desc: 'Read scheduled and completed interviews, ratings, panelist names, and feedback' },
  { id: 'drives:read', label: 'drives:read', desc: 'Read campus hiring drives, colleges, and enrollment metrics' },
  { id: 'jobs:read', label: 'jobs:read', desc: 'Read active job postings and role details' },
  { id: 'team:read', label: 'team:read', desc: 'Read telecalling and recruitment team members' },
  { id: 'stats:read', label: 'stats:read', desc: 'Read aggregate ATS statistics and performance metrics' },
];

const ApiKeysTab = ({ isSuperAdmin }) => {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShowOnceModal, setShowShowOnceModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);

  // Active item
  const [activeKey, setActiveKey] = useState(null);
  const [generatedKey, setGeneratedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: '',
    environment: 'live',
    expiresInDays: 90,
    rateLimitPerMinute: 60,
    allowedIps: '',
    scopes: ['candidates:read', 'interviews:read', 'drives:read'],
  });
  const [creating, setCreating] = useState(false);

  // Revoke form
  const [revokeReason, setRevokeReason] = useState('No longer needed');
  const [revoking, setRevoking] = useState(false);

  // Rotate form
  const [gracePeriodHours, setGracePeriodHours] = useState(24);
  const [rotating, setRotating] = useState(false);

  // Usage stats
  const [usageStats, setUsageStats] = useState([]);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const loadKeys = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiGet('/settings/api-keys');
      if (res.success) {
        setKeys(res.data || []);
      } else {
        setError(res.message || 'Failed to load API keys');
      }
    } catch (err) {
      setError(err.message || 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleToggleScope = (scopeId) => {
    setCreateForm(prev => {
      const exists = prev.scopes.includes(scopeId);
      if (exists) {
        return { ...prev, scopes: prev.scopes.filter(s => s !== scopeId) };
      } else {
        return { ...prev, scopes: [...prev.scopes, scopeId] };
      }
    });
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;

    try {
      setCreating(true);
      setError('');

      const allowedIpsArray = createForm.allowedIps.trim()
        ? createForm.allowedIps.split(',').map(s => s.trim()).filter(Boolean)
        : null;

      const payload = {
        name: createForm.name.trim(),
        environment: createForm.environment,
        expiresInDays: parseInt(createForm.expiresInDays, 10),
        rateLimitPerMinute: parseInt(createForm.rateLimitPerMinute, 10) || 60,
        allowedIps: allowedIpsArray,
        scopes: createForm.scopes,
      };

      const res = await apiPost('/settings/api-keys', payload);
      if (res.success && res.data) {
        setGeneratedKey(res.data.fullKey);
        setShowCreateModal(false);
        setShowShowOnceModal(true);
        loadKeys();
      } else {
        setError(res.message || 'Failed to create API key');
      }
    } catch (err) {
      setError(err.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (e) => {
    e.preventDefault();
    if (!activeKey) return;

    try {
      setRevoking(true);
      const res = await apiPost(`/settings/api-keys/${activeKey.id}/revoke`, { reason: revokeReason });
      if (res.success) {
        setSuccess(`API key "${activeKey.name}" has been revoked.`);
        setTimeout(() => setSuccess(''), 4000);
        setShowRevokeModal(false);
        setActiveKey(null);
        loadKeys();
      } else {
        setError(res.message || 'Failed to revoke API key');
      }
    } catch (err) {
      setError(err.message || 'Failed to revoke API key');
    } finally {
      setRevoking(false);
    }
  };

  const handleRotateKey = async (e) => {
    e.preventDefault();
    if (!activeKey) return;

    try {
      setRotating(true);
      const res = await apiPost(`/settings/api-keys/${activeKey.id}/rotate`, { gracePeriodHours });
      if (res.success && res.data?.newKey?.fullKey) {
        setGeneratedKey(res.data.newKey.fullKey);
        setShowRotateModal(false);
        setActiveKey(null);
        setShowShowOnceModal(true);
        loadKeys();
      } else {
        setError(res.message || 'Failed to rotate API key');
      }
    } catch (err) {
      setError(err.message || 'Failed to rotate API key');
    } finally {
      setRotating(false);
    }
  };

  const handleViewUsage = async (key) => {
    setActiveKey(key);
    setShowUsageModal(true);
    setLoadingUsage(true);
    try {
      const res = await apiGet(`/settings/api-keys/${key.id}/usage`);
      if (res.success) {
        setUsageStats(res.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsage(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 3000);
  };

  return (
    <Reveal className="space-y-6">
      {/* Notifications */}
      {error && <div className="os-card p-4 text-red-600 text-sm font-semibold bg-red-50 border-red-200">{error}</div>}
      {success && <div className="os-card p-4 text-emerald-700 text-sm font-semibold bg-emerald-50 border-emerald-200">{success}</div>}

      {/* Header Card */}
      <div className="os-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold font-[Manrope] text-[#0f1b3d]">API Access Keys</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Secure, read-only credentials for server-to-server integration with external applications (ERP, BI tools, and data pipelines).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2.5 rounded-lg border border-[#dce4ec] text-[#0f1b3d] text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2"
            onClick={() => setShowDocsModal(true)}
          >
            <span className="material-symbols-outlined text-base">menu_book</span>
            API Documentation
          </button>
          <button
            type="button"
            className="px-4 py-2.5 rounded-lg bg-[#1f52cc] text-white text-sm font-semibold hover:bg-[#1844ad] transition-colors shadow-sm flex items-center gap-2"
            onClick={() => {
              setCreateForm({
                name: '',
                environment: 'live',
                expiresInDays: 90,
                rateLimitPerMinute: 60,
                allowedIps: '',
                scopes: ['candidates:read', 'interviews:read', 'drives:read'],
              });
              setShowCreateModal(true);
            }}
          >
            <span className="material-symbols-outlined text-base">add</span>
            Create API Key
          </button>
        </div>
      </div>

      {/* Keys List Table */}
      <div className="os-card overflow-hidden">
        <div className="p-4 border-b border-[#e9eef4] flex items-center justify-between bg-slate-50/50">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Active & Configured Keys ({keys.length})</span>
          <button
            type="button"
            onClick={loadKeys}
            className="text-xs text-[#1f52cc] hover:underline flex items-center gap-1 font-semibold"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading API keys...</div>
        ) : keys.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">vpn_key_off</span>
            <p className="text-sm font-semibold text-slate-600">No API keys created yet</p>
            <p className="text-xs text-slate-400 mt-1">Create an API key to allow external systems to pull candidates, rounds, and drive data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-[#e9eef4]">
                <tr>
                  <th className="py-3 px-4">Name & Prefix</th>
                  <th className="py-3 px-4">Environment</th>
                  <th className="py-3 px-4">Scopes</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Used</th>
                  <th className="py-3 px-4">Expires</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9eef4] text-[#0f1b3d]">
                {keys.map((k) => {
                  const isRevoked = k.status === 'REVOKED';
                  const isExpired = k.status === 'EXPIRED';
                  const scopesList = Array.isArray(k.scopes) ? k.scopes : [];

                  return (
                    <tr key={k.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-sm text-[#0f1b3d]">{k.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <code className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{k.prefix}</code>
                          <button
                            type="button"
                            title="Copy prefix"
                            onClick={() => copyToClipboard(k.prefix)}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            <span className="material-symbols-outlined text-xs">content_copy</span>
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          k.environment === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'
                        }`}>
                          {k.environment}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {scopesList.map(s => {
                            const isPii = s.includes('pii');
                            return (
                              <span
                                key={s}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                  isPii ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {s}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isRevoked ? 'bg-red-100 text-red-700' : isExpired ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isRevoked ? 'bg-red-500' : isExpired ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          {k.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-IN') : 'Never'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('en-IN') : 'Never'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewUsage(k)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                            title="View daily usage & metrics"
                          >
                            <span className="material-symbols-outlined text-base">bar_chart</span>
                          </button>
                          {!isRevoked && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveKey(k);
                                  setShowRotateModal(true);
                                }}
                                className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                title="Rotate API Key (24h grace period)"
                              >
                                <span className="material-symbols-outlined text-base">autorenew</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveKey(k);
                                  setShowRevokeModal(true);
                                }}
                                className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                title="Revoke API Key"
                              >
                                <span className="material-symbols-outlined text-base">block</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE API KEY MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-[#e9eef4]">
            <h3 className="text-lg font-bold font-[Manrope] text-[#0f1b3d]">Create New API Key</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">Provision a new external API credential with scoped permissions.</p>

            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Key Name / Consumer</label>
                <input
                  type="text"
                  placeholder="e.g. Akshara ERP Production, BI Dashboard"
                  value={createForm.name}
                  onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                  required
                  className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] focus:border-[#1f52cc] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Environment</label>
                  <select
                    value={createForm.environment}
                    onChange={e => setCreateForm(p => ({ ...p, environment: e.target.value }))}
                    className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] focus:border-[#1f52cc] outline-none"
                  >
                    <option value="live">Live (Production)</option>
                    <option value="test">Test (Staging/Dev)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Key Expiration</label>
                  <select
                    value={createForm.expiresInDays}
                    onChange={e => setCreateForm(p => ({ ...p, expiresInDays: e.target.value }))}
                    className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] focus:border-[#1f52cc] outline-none"
                  >
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days (Recommended)</option>
                    <option value={180}>180 Days</option>
                    <option value={0}>Never (Discouraged)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Access Scopes</label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-[#dce4ec] rounded-lg p-2.5">
                  {AVAILABLE_SCOPES.map(s => {
                    const checked = createForm.scopes.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-start gap-2.5 p-1.5 rounded cursor-pointer transition-colors ${
                          s.isPii ? 'hover:bg-amber-50/50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleScope(s.id)}
                          className="mt-0.5 rounded text-[#1f52cc]"
                        />
                        <div>
                          <div className="text-xs font-mono font-bold text-[#0f1b3d] flex items-center gap-1.5">
                            {s.label}
                            {s.isPii && (
                              <span className="text-[10px] px-1.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-sans font-semibold">
                                Sensitive PII
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{s.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {createForm.scopes.includes('candidates:read:pii') && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                  <span className="material-symbols-outlined text-base text-amber-700">warning</span>
                  <div>
                    <strong>PII Scope Granted:</strong> This API key will have permission to read candidate phone numbers, personal email addresses, and download resume files.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Rate Limit (req/min)</label>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={createForm.rateLimitPerMinute}
                    onChange={e => setCreateForm(p => ({ ...p, rateLimitPerMinute: e.target.value }))}
                    className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] focus:border-[#1f52cc] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Allowed IPs (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 203.0.113.1, 10.0.0.*"
                    value={createForm.allowedIps}
                    onChange={e => setCreateForm(p => ({ ...p, allowedIps: e.target.value }))}
                    className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] focus:border-[#1f52cc] outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e9eef4]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#1f52cc] text-white hover:bg-[#1844ad] disabled:opacity-50"
                >
                  {creating ? 'Generating...' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SHOW ONCE GENERATED KEY MODAL */}
      {showShowOnceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-[#e9eef4]">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <span className="material-symbols-outlined text-2xl">key</span>
              <h3 className="text-lg font-bold font-[Manrope] text-[#0f1b3d]">Save Your API Key Now</h3>
            </div>

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mb-4">
              <strong>Important:</strong> This secret key will <strong>never be shown again</strong>. TalentOS only stores an irreversible cryptographic hash. If you lose this key, you must rotate it.
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">Full API Key</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedKey}
                  className="w-full h-11 px-3 text-sm font-mono rounded-lg border border-[#dce4ec] bg-slate-50 select-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(generatedKey)}
                  className="px-4 h-11 bg-[#1f52cc] hover:bg-[#1844ad] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-base">
                    {copiedKey ? 'check' : 'content_copy'}
                  </span>
                  {copiedKey ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-500 mb-6">
              Pass this key in the HTTP header of your server requests:
              <pre className="mt-1.5 p-2.5 rounded bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                Authorization: Bearer {generatedKey.slice(0, 18)}...
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#e9eef4]">
              <button
                type="button"
                onClick={() => {
                  setShowShowOnceModal(false);
                  setGeneratedKey('');
                }}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-colors"
              >
                I have saved my key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REVOKE KEY MODAL */}
      {showRevokeModal && activeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#e9eef4]">
            <h3 className="text-lg font-bold font-[Manrope] text-red-600 flex items-center gap-2">
              <span className="material-symbols-outlined">warning</span>
              Revoke API Key
            </h3>
            <p className="text-xs text-slate-600 mt-2">
              Are you sure you want to revoke <strong>"{activeKey.name}"</strong> (<code className="font-mono text-slate-700">{activeKey.prefix}</code>)?
              Any applications using this key will be denied access with <strong>401 API_KEY_REVOKED</strong> immediately.
            </p>

            <form onSubmit={handleRevokeKey} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Revocation Reason</label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                  placeholder="e.g. Key leaked, consumer decommissioned"
                  required
                  className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRevokeModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={revoking}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {revoking ? 'Revoking...' : 'Revoke Immediately'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROTATE KEY MODAL */}
      {showRotateModal && activeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-[#e9eef4]">
            <h3 className="text-lg font-bold font-[Manrope] text-[#0f1b3d] flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-600">autorenew</span>
              Rotate API Key
            </h3>
            <p className="text-xs text-slate-600 mt-2">
              Rotating generates a new secret key while keeping the existing key active for a temporary grace period so your consumer application can update without downtime.
            </p>

            <form onSubmit={handleRotateKey} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Old Key Grace Period (Hours)</label>
                <select
                  value={gracePeriodHours}
                  onChange={e => setGracePeriodHours(parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 text-sm rounded-lg border border-[#dce4ec] outline-none focus:border-[#1f52cc]"
                >
                  <option value={12}>12 Hours</option>
                  <option value={24}>24 Hours (Default)</option>
                  <option value={48}>48 Hours</option>
                  <option value={72}>72 Hours</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRotateModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rotating}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#1f52cc] text-white hover:bg-[#1844ad] disabled:opacity-50"
                >
                  {rotating ? 'Rotating...' : 'Generate New Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* USAGE METRICS MODAL */}
      {showUsageModal && activeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 border border-[#e9eef4]">
            <div className="flex items-center justify-between pb-3 border-b border-[#e9eef4]">
              <div>
                <h3 className="text-base font-bold font-[Manrope] text-[#0f1b3d]">Daily Usage & Performance</h3>
                <p className="text-xs text-slate-500">{activeKey.name} ({activeKey.prefix})</p>
              </div>
              <button
                type="button"
                onClick={() => setShowUsageModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="mt-4 max-h-96 overflow-y-auto">
              {loadingUsage ? (
                <div className="p-8 text-center text-slate-400 text-xs">Loading metrics...</div>
              ) : usageStats.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">No recorded API requests for this key yet.</div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-[#e9eef4]">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Endpoint Route</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Total Requests</th>
                      <th className="py-2.5 px-3 text-right">P95 Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9eef4]">
                    {usageStats.map((u, i) => (
                      <tr key={u.id || i} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 font-mono">{u.date}</td>
                        <td className="py-2 px-3 font-mono text-slate-700">{u.route}</td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            u.statusClass === '2xx' ? 'bg-emerald-100 text-emerald-800' : u.statusClass === '4xx' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {u.statusClass}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-semibold">{u.count}</td>
                        <td className="py-2 px-3 text-right text-slate-500 font-mono">{Math.round(u.p95LatencyMs)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-[#e9eef4] flex justify-end">
              <button
                type="button"
                onClick={() => setShowUsageModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENTATION MODAL */}
      {showDocsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 border border-[#e9eef4] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#e9eef4]">
              <div>
                <h3 className="text-base font-bold font-[Manrope] text-[#0f1b3d]">TalentOS External API Documentation</h3>
                <p className="text-xs text-slate-500">API specification, authentication, and endpoint contracts</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="mt-4 overflow-y-auto space-y-4 text-xs text-slate-600 pr-1">
              <div>
                <h4 className="font-bold text-slate-900 mb-1">1. Authentication</h4>
                <p>Pass your generated API key as a Bearer token in the <code>Authorization</code> header:</p>
                <pre className="mt-1 p-2.5 rounded bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                  curl -H "Authorization: Bearer tos_live_..." https://brandpromoter-backend.onrender.com/api/v1/ext/me
                </pre>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1">2. Endpoint Reference</h4>
                <div className="border border-[#e9eef4] rounded-lg divide-y divide-[#e9eef4]">
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/me</div>
                    <span className="text-slate-500 text-[10px]">Any Key</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/candidates</div>
                    <span className="text-slate-500 text-[10px]">candidates:read</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/interviews</div>
                    <span className="text-slate-500 text-[10px]">interviews:read</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/drives</div>
                    <span className="text-slate-500 text-[10px]">drives:read</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/jobs</div>
                    <span className="text-slate-500 text-[10px]">jobs:read</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 font-mono text-[11px] flex items-center justify-between">
                    <div><span className="text-emerald-700 font-bold">GET</span> /api/v1/ext/changes?since=&lt;iso&gt;</div>
                    <span className="text-slate-500 text-[10px]">Resource Scopes</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1">3. Keyset (Cursor) Pagination</h4>
                <p>Lists use keyset cursor pagination for high performance. Pass <code>limit</code> (max 100) and <code>cursor</code> from <code>page.nextCursor</code>.</p>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1">4. OpenAPI Specification</h4>
                <p>
                  Download complete OpenAPI 3.1 schema at:{' '}
                  <a
                    href="/api/v1/ext/openapi.json"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#1f52cc] font-mono underline"
                  >
                    /api/v1/ext/openapi.json
                  </a>
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#e9eef4] flex justify-end">
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Reveal>
  );
};

export default ApiKeysTab;
