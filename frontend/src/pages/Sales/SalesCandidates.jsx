import React, { useState, useEffect } from 'react';
import { apiGet, apiDelete, buildApiUrl, getStoredToken } from '../../lib/api';
import { PageEnter } from '../../components/PageMotion';
import BulkImportModal from '../../components/BulkImportModal';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';

const SalesCandidates = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [formData, setFormData] = useState({ fullName: '', email: '', phone: '', skills: '', source: 'Sales Workspace', resume: null });

    useEffect(() => {
        loadCandidates();
    }, []);

    const loadCandidates = async () => {
        setLoading(true);
        try {
            const res = await apiGet('/candidates?limit=50');
            setCandidates(res.data || []);
        } catch (error) {
            console.error('Failed to load candidates', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddCandidate = async (e) => {
        e.preventDefault();
        if (!formData.resume) {
            alert('Resume is required. Upload a PDF or Word document to create the candidate.');
            return;
        }
        setCreating(true);
        try {
            const body = new FormData();
            body.append('fullName', formData.fullName);
            body.append('email', formData.email);
            body.append('phone', formData.phone);
            body.append('source', formData.source || 'Sales Workspace');
            body.append('status', 'JOINED');
            body.append('resume', formData.resume);

            const token = getStoredToken();
            const res = await fetch(buildApiUrl('/candidates/with-resume-upload'), {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body,
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                throw new Error(json.message || json.error || 'Failed to add candidate');
            }

            setIsModalOpen(false);
            setFormData({ fullName: '', email: '', phone: '', skills: '', source: 'Sales Workspace', resume: null });
            await loadCandidates();
        } catch (error) {
            alert(error.message || 'Failed to add candidate');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to remove this candidate?')) return;
        try {
            await apiDelete(`/candidates/${id}`);
            loadCandidates();
        } catch (error) {
            alert('Failed to delete');
        }
    };

    return (
        <>
            <PageEnter>
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-[#10193f]">Sales Talent Pool</h1>
                        <p className="text-[#5d6784] mt-1">Manage onboarding candidates and talent available for product assignments.</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsImportModalOpen(true)}
                            className="os-btn-outline h-11 px-6 flex items-center gap-2 border-[#e2e8f0] text-[#5c6a84]"
                        >
                            <span className="material-symbols-outlined text-[20px]">upload_file</span>
                            Bulk Import
                        </button>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="os-btn-primary h-11 px-6 flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined text-[20px]">person_add</span>
                            Add Candidate
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? (
                        <div className="col-span-full py-20 text-center text-[#8b95ad]">Loading talent pool...</div>
                    ) : candidates.length === 0 ? (
                        <div className="col-span-full py-20 text-center text-[#8b95ad]">No candidates in the pool yet. Add your first talent to get started.</div>
                    ) : (
                        candidates.map((c) => (
                            <div
                                key={c.id}
                                className="os-card p-6 group hover:border-[#1f52cc] transition-all reveal-fade"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1f52cc] flex items-center justify-center font-bold text-xl uppercase">
                                        {c.fullName.charAt(0)}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="os-icon-btn !w-8 !h-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(c.id)}>
                                            <span className="material-symbols-outlined !text-[18px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                                <h3 className="text-lg font-bold text-[#10193f] mb-1">{c.fullName}</h3>
                                <div className="text-sm text-[#5c6a84] flex items-center gap-2 mb-4">
                                    <span className="material-symbols-outlined text-sm opacity-60">mail</span>
                                    {c.email}
                                </div>

                                <div className="flex flex-wrap gap-2 mb-4">
                                    {c.skills?.split(',').map(s => (
                                        <span key={s} className="px-2 py-0.5 bg-[#f1f5f9] text-[#5c6a84] rounded-md text-[10px] font-bold uppercase tracking-wider">{s.trim()}</span>
                                    ))}
                                </div>

                                <div className="border-t border-[#f1f5f9] pt-4 flex items-center justify-between">
                                    <div className="text-[10px] font-bold text-[#8b95ad] uppercase tracking-widest">Status</div>
                                    <span className="px-2.5 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase">{c.status}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </PageEnter>

            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-[#0f1b3e]/60 backdrop-blur-[8px] modal-overlay-fade"
                        onClick={() => setIsModalOpen(false)}
                    />
                    <div
                        className="relative bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden modal-scale-up"
                    >
                        <form onSubmit={handleAddCandidate} className="p-8">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-[#10193f]">Add New Talent</h2>
                                    <p className="text-sm text-[#8b95ad] mt-1">Create a new candidate record for your sales workspace pool.</p>
                                </div>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="os-icon-btn">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-5">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Full Name</label>
                                    <input
                                        required
                                        placeholder="e.g. John Doe"
                                        className="w-full h-12 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                        value={formData.fullName}
                                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Email</label>
                                        <input
                                            type="email"
                                            required
                                            placeholder="john@example.com"
                                            className="w-full h-12 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Phone</label>
                                        <input
                                            placeholder="+91 98765 43210"
                                            className="w-full h-12 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Skills (Comma Separated)</label>
                                    <input
                                        placeholder="e.g. Sales, CRM, Communication"
                                        className="w-full h-12 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                        value={formData.skills}
                                        onChange={(e) => setFormData({ ...formData, skills: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">
                                        Resume / Profile Document <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="file"
                                        required
                                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                        className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-[#eef3ff] file:text-[#1f52cc] file:font-bold"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file && file.size > MAX_UPLOAD_BYTES) {
                                                alert('File exceeds the 10 MB limit.');
                                                e.target.value = '';
                                                setFormData({ ...formData, resume: null });
                                                return;
                                            }
                                            setFormData({ ...formData, resume: file || null });
                                        }}
                                    />
                                    <p className="text-[11px] text-[#8b95ad] px-1">Resume is required to create the candidate.</p>
                                </div>
                            </div>

                            <div className="mt-8 flex gap-4">
                                <button
                                    type="button"
                                    className="flex-1 h-12 rounded-2xl border border-[#e2e8f0] text-sm font-bold text-[#5c6a84] hover:bg-[#f8fafc] transition-all"
                                    onClick={() => setIsModalOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating || !formData.resume}
                                    className="flex-1 h-12 bg-[#1f52cc] text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-100 hover:shadow-xl hover:bg-[#1a47b0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {creating ? 'Creating...' : 'Create Record'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <BulkImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportComplete={loadCandidates}
                title="Bulk Import Candidates"
                endpoint="/import/candidates"
                templateHeaders={['Full Name', 'Email', 'Phone', 'Category', 'Source', 'Company']}
            />
        </>
    );
};

export default SalesCandidates;
