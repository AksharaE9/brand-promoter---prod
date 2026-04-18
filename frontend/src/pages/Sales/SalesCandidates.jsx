import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiGet, apiPost, apiDelete } from '../../lib/api';
import { PageEnter } from '../../components/PageMotion';
import BulkImportModal from '../../components/BulkImportModal';

const SalesCandidates = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [formData, setFormData] = useState({ fullName: '', email: '', phone: '', skills: '', source: 'Sales Workspace' });

    useEffect(() => {
        loadCandidates();
    }, []);

    const loadCandidates = async () => {
        setLoading(true);
        try {
            // Added limit to prevent over-fetching in dashboard views
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
        try {
            await apiPost('/candidates', { ...formData, status: 'JOINED' }); // Auto-join for sales workspace candidates
            setIsModalOpen(false);
            setFormData({ fullName: '', email: '', phone: '', skills: '', source: 'Sales Workspace' });
            await loadCandidates();
        } catch (error) {
            alert('Failed to add candidate');
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
                        <motion.div
                            key={c.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="os-card p-6 group hover:border-[#1f52cc] transition-all"
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
                        </motion.div>
                    ))
                )}
            </div>

            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            className="absolute inset-0 bg-[#0f1b3d]/70 backdrop-blur-[6px]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsModalOpen(false)}
                        />
                        <motion.div
                            className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        >
                            <form onSubmit={handleAddCandidate} className="p-8">
                                <h2 className="text-2xl font-bold text-[#10193f] mb-2">Add New Talent</h2>
                                <p className="text-sm text-[#8b95ad] mb-6">Create a new candidate record for your sales workspace pool.</p>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1.5 px-1">Full Name</label>
                                        <input
                                            required
                                            className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                            value={formData.fullName}
                                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1.5 px-1">Email</label>
                                            <input
                                                type="email"
                                                required
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1.5 px-1">Phone</label>
                                            <input
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1.5 px-1">Skills (Comma Separated)</label>
                                        <input
                                            placeholder="e.g. Sales, CRM, Communication"
                                            className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                            value={formData.skills}
                                            onChange={(e) => setFormData({ ...formData, skills: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="mt-8 flex gap-3">
                                    <button
                                        type="button"
                                        className="flex-1 h-11 px-6 rounded-xl border border-[#e2e8f0] text-sm font-bold text-[#5c6a84] hover:bg-[#f8fafc] transition-all"
                                        onClick={() => setIsModalOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 h-11 px-6 bg-[#1f52cc] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-200 hover:shadow-xl hover:bg-[#1a47b0] transition-all"
                                    >
                                        Create Record
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <BulkImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportComplete={loadCandidates}
                title="Bulk Import Candidates"
                endpoint="/import/candidates"
                templateHeaders={['Full Name', 'Email', 'Phone', 'Category', 'Source', 'Company']}
            />
        </PageEnter>
    );
};

export default SalesCandidates;
