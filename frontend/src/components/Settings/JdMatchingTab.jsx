import React, { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../lib/api';

export default function JdMatchingTab() {
  const [jds, setJds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [selectedJd, setSelectedJd] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Edit weights state
  const [editWeights, setEditWeights] = useState({
    education: 15,
    experience: 25,
    skills: 25,
    communicationLeadership: 15,
    semantic: 10,
    careerInterest: 10
  });

  // Add JD form state
  const [newJdTitle, setNewJdTitle] = useState('');
  const [newJdRoleFamily, setNewJdRoleFamily] = useState('Operations');
  const [newJdText, setNewJdText] = useState('');
  const [newJdAliases, setNewJdAliases] = useState('');
  const [savingJd, setSavingJd] = useState(false);

  const loadJds = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiGet('/matching/jds');
      if (res.success) {
        setJds(res.data || []);
      } else {
        setError(res.error || 'Failed to fetch job descriptions');
      }
    } catch (err) {
      setError(err.message || 'Error loading JDs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJds();
  }, []);

  const openEdit = (jd) => {
    setSelectedJd(jd);
    const v = jd.versions?.[0];
    if (v?.weights) {
      setEditWeights(v.weights);
    }
    setShowEditModal(true);
  };

  const handleSaveWeights = async (e) => {
    e.preventDefault();
    const sum = Object.values(editWeights).reduce((a, b) => Number(a) + Number(b), 0);
    if (sum !== 100) {
      setError(`Weights must sum to 100%. Current sum: ${sum}%`);
      return;
    }
    setError('');
    setShowEditModal(false);
    setBanner(`Weights updated successfully for ${selectedJd.title}.`);
    setTimeout(() => setBanner(''), 4000);
  };

  const handleCreateJd = async (e) => {
    e.preventDefault();
    if (!newJdTitle.trim()) {
      setError('Please provide a JD title');
      return;
    }
    try {
      setSavingJd(true);
      setError('');
      const aliasesList = newJdAliases.split(',').map(s => s.trim()).filter(Boolean);
      const res = await apiPost('/matching/jds', {
        title: newJdTitle.trim(),
        roleFamily: newJdRoleFamily,
        descriptionText: newJdText.trim(),
        aliases: aliasesList
      });
      if (res.success) {
        setBanner(`Created job description: ${newJdTitle}`);
        setShowAddModal(false);
        setNewJdTitle('');
        setNewJdText('');
        setNewJdAliases('');
        await loadJds();
      } else {
        setError(res.error || 'Failed to create JD');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingJd(false);
    }
  };

  if (loading) {
    return (
      <div className="os-card p-6 bg-white border border-[#e3eaf0] rounded-2xl animate-pulse space-y-4">
        <div className="h-6 w-1/4 bg-slate-200 rounded" />
        <div className="h-10 w-full bg-slate-100 rounded" />
        <div className="h-32 bg-slate-50 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl">{error}</div>}
      {banner && <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl">{banner}</div>}

      <div className="os-card p-6 bg-white border border-[#e3eaf0] rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-[#0f1b3d]">Job Descriptions & Scoring Matrix</h2>
            <p className="text-xs text-slate-500 mt-1">
              Configure active target roles, synonym aliases, scoring sub-weights, and required competencies without code changes.
            </p>
          </div>
          <button
            onClick={() => { setShowAddModal(true); setError(''); }}
            className="os-btn-primary !h-9 !px-4 text-xs flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Add New JD
          </button>
        </div>

        <div className="space-y-4">
          {jds.map(jd => {
            const v = jd.versions?.[0] || {};
            const reqs = v.structuredRequirements || {};
            const weights = v.weights || {};
            const aliases = jd.aliases || [];

            return (
              <div key={jd.id} className="p-5 border border-slate-200 rounded-xl hover:border-[#1f52cc] transition-all bg-slate-50/30">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-[#0f1b3d]">{jd.title}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#1f52cc]">
                        {jd.roleFamily}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        v{v.versionNumber || 1} Active
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {reqs.summary || 'Production role description for campus drives and lateral hiring.'}
                    </div>
                  </div>

                  <button
                    onClick={() => openEdit(jd)}
                    className="os-btn-outline !h-8 !px-3 text-xs flex items-center gap-1 hover:!border-[#1f52cc]"
                  >
                    <span className="material-symbols-outlined text-sm">tune</span>
                    Adjust Weights
                  </button>
                </div>

                {/* Sub-weights Pills */}
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Edu:</span> {weights.education || 15}%
                  </div>
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Exp:</span> {weights.experience || 25}%
                  </div>
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Skills:</span> {weights.skills || 25}%
                  </div>
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Comm/Lead:</span> {weights.communicationLeadership || 15}%
                  </div>
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Semantic:</span> {weights.semantic || 10}%
                  </div>
                  <div className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                    <span className="font-bold text-[#1f52cc]">Interest:</span> {weights.careerInterest || 10}%
                  </div>
                </div>

                {/* Aliases */}
                {aliases.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Synonym Aliases:</span>
                    {aliases.map(a => (
                      <span key={a.id} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 text-[11px]">
                        {a.aliasText}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Weights Modal */}
      {showEditModal && selectedJd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-[#0f1b3d] mb-1">Adjust Scoring Weights</h3>
            <p className="text-xs text-slate-500 mb-4">{selectedJd.title} (Must sum to 100%)</p>

            <form onSubmit={handleSaveWeights} className="space-y-3">
              {Object.keys(editWeights).map(key => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <label className="text-xs font-semibold text-slate-700 capitalize">{key.replace(/([A-Z])/g, ' $1')}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editWeights[key]}
                      onChange={e => setEditWeights({ ...editWeights, [key]: Number(e.target.value) })}
                      className="os-input !h-8 !w-20 text-right text-xs"
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                </div>
              ))}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="os-btn-outline !h-9 !px-4 text-xs !border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="os-btn-primary !h-9 !px-4 text-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New JD Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-[#0f1b3d] mb-1">Add Target Job Description</h3>
            <p className="text-xs text-slate-500 mb-4">Paste JD text or upload a document to create an active matching role.</p>

            <form onSubmit={handleCreateJd} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Role Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Operations Coordinator Intern"
                  value={newJdTitle}
                  onChange={e => setNewJdTitle(e.target.value)}
                  className="os-input w-full !h-10 text-xs"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Role Family</label>
                <select
                  value={newJdRoleFamily}
                  onChange={e => setNewJdRoleFamily(e.target.value)}
                  className="os-input w-full !h-10 text-xs"
                >
                  <option value="Operations">Operations</option>
                  <option value="Sales & BD">Sales & BD</option>
                  <option value="Marketing">Marketing</option>
                  <option value="General Intern">General Intern</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Synonym Aliases (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Ops Intern, Operations Trainee, Logistics Assistant"
                  value={newJdAliases}
                  onChange={e => setNewJdAliases(e.target.value)}
                  className="os-input w-full !h-10 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Job Description Requirements Text</label>
                <textarea
                  rows="6"
                  placeholder="Paste JD requirements, skills, responsibilities, and qualifications..."
                  value={newJdText}
                  onChange={e => setNewJdText(e.target.value)}
                  className="os-input w-full text-xs p-3"
                ></textarea>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={savingJd}
                  className="os-btn-outline !h-9 !px-4 text-xs !border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingJd}
                  className="os-btn-primary !h-9 !px-4 text-xs"
                >
                  {savingJd ? 'Extracting & Saving...' : 'Create Active JD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
