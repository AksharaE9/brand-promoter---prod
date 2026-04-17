import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { apiGet, apiPatch } from '../../lib/api';

const SalesTracker = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Detail/Action Modal
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [trackingData, setTrackingData] = useState({ status: '', notes: '', followUpDate: '' });

    const statusOptions = [
        { value: 'LEAD', label: 'Lead', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
        { value: 'CONTACTED', label: 'Contacted', color: 'bg-blue-100 text-blue-600', dot: 'bg-blue-500' },
        { value: 'INTERESTED', label: 'Interested', color: 'bg-yellow-100 text-yellow-600', dot: 'bg-yellow-500' },
        { value: 'NEGOTIATION', label: 'Negotiation', color: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
        { value: 'CONVERTED', label: 'Converted', color: 'bg-green-100 text-green-600', dot: 'bg-green-500' },
        { value: 'REJECTED', label: 'Rejected', color: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
    ];

    const loadProducts = async () => {
        try {
            const res = await apiGet('/sales/products');
            setProducts(res.data);
        } catch (err) {
            setError(err.message || 'Failed to load tracking data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProducts();
    }, []);

    const openTracking = (product) => {
        setSelectedProduct(product);
        setTrackingData({
            status: product.tracking?.status || 'LEAD',
            notes: '', // Notes are added as fresh comments
            followUpDate: product.tracking?.followUpDate ? new Date(product.tracking.followUpDate).toISOString().split('T')[0] : '',
        });
        setIsModalOpen(true);
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        try {
            await apiPatch(`/sales/tracking/${selectedProduct.id}`, trackingData);
            setIsModalOpen(false);
            loadProducts();
        } catch (err) {
            alert(err.message);
        }
    };

    const isOverdue = (date) => {
        if (!date) return false;
        return new Date(date) < new Date().setHours(0, 0, 0, 0);
    };

    return (
        <PageEnter>
            <div className="mb-6">
                <div className="os-eyebrow">Pipeline Management</div>
                <h1 className="os-h1">Sales Tracker</h1>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
                {products.map((p, idx) => (
                    <Reveal key={p.id} delay={idx * 0.04}>
                        <div className="os-card p-5 group hover:border-[#1f52cc] transition-all cursor-pointer" onClick={() => openTracking(p)}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-[#10193f]">{p.name}</h3>
                                    <p className="text-xs text-[#8b95ad]">{p.category} • {p.price ? `₹${p.price.toLocaleString()}` : 'Price not set'}</p>
                                    <p className="text-[10px] text-[#1f52cc] font-bold mt-1 uppercase tracking-widest">Coordinator: {p.coordinator?.fullName || 'Unassigned'}</p>
                                </div>
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusOptions.find(o => o.value === (p.tracking?.status || 'LEAD'))?.color}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${statusOptions.find(o => o.value === (p.tracking?.status || 'LEAD'))?.dot}`}></div>
                                    {p.tracking?.status || 'LEAD'}
                                </div>
                            </div>

                            {p.tracking?.notes && (
                                <div className="bg-[#f8fafc] p-3 rounded-xl mb-4 text-xs text-[#5c6a84] line-clamp-2 italic">
                                    "{p.tracking.notes}"
                                </div>
                            )}

                            <div className="flex items-center justify-between border-t border-[#f1f5f9] pt-4">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-[#8b95ad] text-xl opacity-60">event</span>
                                    <div className="text-xs">
                                        <div className="text-[#8b95ad] uppercase font-bold text-[9px] tracking-widest mb-0.5">Follow-up</div>
                                        <div className={`font-bold ${isOverdue(p.tracking?.followUpDate) ? 'text-red-500' : 'text-[#10193f]'}`}>
                                            {p.tracking?.followUpDate ? new Date(p.tracking.followUpDate).toLocaleDateString() : 'Not scheduled'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-[#1f52cc] font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                                    Track Life-cycle
                                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                                </div>
                            </div>
                        </div>
                    </Reveal>
                ))}
                {products.length === 0 && !loading && (
                    <div className="lg:col-span-2 os-card p-12 text-center os-muted">
                        No active sales tracks. Start by adding a product!
                    </div>
                )}
            </div>

            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-end">
                        <motion.div
                            className="absolute inset-0 bg-[#10193f]/20 backdrop-blur-sm"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsModalOpen(false)}
                        />
                        <motion.div
                            className="relative bg-white w-full max-w-lg h-full shadow-2xl flex flex-col"
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        >
                            <div className="p-8 flex-1 overflow-y-auto">
                                <div className="flex justify-between items-start mb-8">
                                    <div>
                                        <div className="os-eyebrow">Sales Detail</div>
                                        <h2 className="text-3xl font-bold text-[#10193f]">{selectedProduct?.name}</h2>
                                    </div>
                                    <button className="os-icon-btn" onClick={() => setIsModalOpen(false)}>
                                        <span className="material-symbols-outlined">close</span>
                                    </button>
                                </div>

                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="os-card p-4 bg-[#f8fafc] border-none">
                                            <div className="text-[#8b95ad] uppercase font-bold text-[10px] mb-1">Current Status</div>
                                            <div className="text-sm font-bold text-[#10193f]">{selectedProduct?.tracking?.status}</div>
                                        </div>
                                        <div className="os-card p-4 bg-[#f8fafc] border-none">
                                            <div className="text-[#8b95ad] uppercase font-bold text-[10px] mb-1">Price</div>
                                            <div className="text-sm font-bold text-[#10193f]">
                                                {selectedProduct?.price ? `₹${selectedProduct.price.toLocaleString()}` : 'N/A'}
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-4 px-1">
                                            <span className="material-symbols-outlined text-[#1f52cc] text-xl">history</span>
                                            <h4 className="text-sm font-bold text-[#10193f]">Activity History</h4>
                                        </div>
                                        <div className="space-y-4 border-l-2 border-[#f1f5f9] ml-3 pl-6 py-2">
                                            {selectedProduct?.activities?.length > 0 ? selectedProduct.activities.map((act, i) => (
                                                <div key={act.id} className="relative">
                                                    <div className="absolute -left-[31px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#1f52cc]"></div>
                                                    <div className="text-xs font-bold text-[#10193f] mb-0.5">{act.details}</div>
                                                    <div className="text-[10px] text-[#8b95ad] flex items-center gap-2">
                                                        <span>{new Date(act.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                                        <span>•</span>
                                                        <span className="uppercase tracking-widest font-bold text-[9px] text-[#1f52cc]">{act.action.replace('_', ' ')}</span>
                                                    </div>
                                                </div>
                                            )) : (
                                                <div className="text-xs text-[#8b95ad] italic">No activity recorded yet</div>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 className="text-sm font-bold text-[#10193f] mb-4 px-1">Lead Details</h4>
                                        <div className="os-card p-4 bg-[#f8fafc] border-none space-y-4">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-[#8b95ad]">Category</span>
                                                <span className="font-bold text-[#10193f]">{selectedProduct?.category}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-[#8b95ad]">Follow-up Required</span>
                                                <span className={`font-bold ${isOverdue(selectedProduct?.tracking?.followUpDate) ? 'text-red-500' : 'text-[#10193f]'}`}>
                                                    {selectedProduct?.tracking?.followUpDate ? new Date(selectedProduct.tracking.followUpDate).toLocaleDateString() : 'Not set'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-start text-xs border-t border-[#e2e8f0] pt-4">
                                                <span className="text-[#8b95ad]">Latest Note</span>
                                                <span className="font-medium text-[#5c6a84] text-right max-w-[150px] italic">
                                                    "{selectedProduct?.tracking?.notes || 'No recent notes'}"
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {selectedProduct?.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-8">
                                        {selectedProduct.tags.map(tag => (
                                            <span key={tag} className="px-2 py-1 bg-[#f1f5f9] text-[#5c6a84] text-[9px] font-bold rounded-md uppercase border border-[#e2e8f0]">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {selectedProduct?.candidateAssignments?.length > 0 && (
                                    <div className="mb-8 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                                        <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-3">Assigned Working Team</div>
                                        <div className="space-y-2">
                                            {selectedProduct.candidateAssignments.map(asgn => (
                                                <div key={asgn.id} className="flex items-center gap-3">
                                                    <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold">
                                                        {asgn.candidate.fullName.charAt(0)}
                                                    </div>
                                                    <span className="text-xs font-semibold text-[#10193f]">{asgn.candidate.fullName}</span>
                                                    <span className="text-[9px] text-blue-400 font-bold uppercase ml-auto">Onboarding</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <form onSubmit={handleUpdate} className="space-y-6">
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-2">Update Pipeline Status</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {statusOptions.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setTrackingData({ ...trackingData, status: opt.value })}
                                                    className={`p-3 rounded-xl border-2 text-left transition-all ${trackingData.status === opt.value
                                                        ? 'border-[#1f52cc] bg-blue-50'
                                                        : 'border-[#f1f5f9] hover:border-[#e2e8f0]'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2 h-2 rounded-full ${opt.dot}`}></div>
                                                        <div className="text-xs font-bold text-[#10193f]">{opt.label}</div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-2">Follow-up Date</label>
                                        <input
                                            type="date"
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc]"
                                            value={trackingData.followUpDate}
                                            onChange={(e) => setTrackingData({ ...trackingData, followUpDate: e.target.value })}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-2">New Note / Comment</label>
                                        <textarea
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] resize-none"
                                            rows={4}
                                            placeholder="Add latest update or feedback from the lead..."
                                            value={trackingData.notes}
                                            onChange={(e) => setTrackingData({ ...trackingData, notes: e.target.value })}
                                        />
                                    </div>

                                    <div className="pt-4">
                                        <button type="submit" className="w-full os-btn-primary py-4 rounded-2xl shadow-lg shadow-blue-200">
                                            Update tracking status
                                        </button>
                                    </div>
                                </form>

                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </PageEnter>
    );
};

export default SalesTracker;
