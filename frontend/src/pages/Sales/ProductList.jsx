import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import BulkImportModal from '../../components/BulkImportModal';

const ProductList = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Filters
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('All');

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [teamProductId, setTeamProductId] = useState(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '', category: '', location: '', description: '',
        price: '', tags: '', coordinatorId: '', imageUrl: ''
    });
    const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
    const [newCategory, setNewCategory] = useState('');

    const [availableCategories, setAvailableCategories] = useState(['Software', 'Hardware', 'Service', 'Consulting']);
    const [coordinators, setCoordinators] = useState([]);

    const loadCoordinators = async () => {
        try {
            const res = await apiGet('/users/interviewers');
            setCoordinators(res.data);
        } catch (err) {
            console.error('Failed to load coordinators', err);
        }
    };

    const loadCategories = async () => {
        try {
            const res = await apiGet('/sales/categories');
            if (res.data && res.data.length > 0) {
                setAvailableCategories(res.data);
            }
        } catch (err) {
            console.error('Failed to load categories', err);
        }
    };

    const loadProducts = async () => {
        setLoading(true);
        try {
            const res = await apiGet(`/sales/products?search=${search}&category=${category}`);
            setProducts(res.data);
        } catch (err) {
            setError(err.message || 'Failed to load products');
        } finally {
            setLoading(false);
        }
    };

    const loadInitialData = async () => {
        setLoading(true);
        try {
            // Parallelize all initialization calls
            await Promise.all([
                loadCategories(),
                loadCoordinators(),
                loadProducts()
            ]);
        } catch (err) {
            console.error('Initialization failed', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadInitialData();
    }, []);

    // Also reload products when category changes (excluding initial load handled above)
    useEffect(() => {
        const fetchOnFilter = async () => {
            if (!loading) { // Avoid double call on mount
                await loadProducts();
            }
        };
        fetchOnFilter();
    }, [category]);

    useEffect(() => {
        if (searchParams.get('add') === 'true') {
            setEditingProduct(null);
            setFormData({ name: '', category: availableCategories[0] || 'Software', location: '', description: '' });
            setIsModalOpen(true);
            setSearchParams({});
        }
    }, [searchParams, availableCategories]);

    const handleSearch = (e) => {
        if (e.key === 'Enter') loadProducts();
    };

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            const finalData = {
                ...formData,
                price: formData.price ? parseFloat(formData.price) : null,
                tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(t => t) : [],
                attachments: formData.imageUrl ? { imageUrl: formData.imageUrl } : null
            };
            if (isAddingNewCategory && newCategory.trim()) {
                finalData.category = newCategory.trim();
            }

            if (editingProduct) {
                await apiPatch(`/sales/products/${editingProduct.id}`, finalData);
            } else {
                await apiPost('/sales/products', finalData);
            }
            setIsModalOpen(false);
            setEditingProduct(null);
            setIsAddingNewCategory(false);
            setNewCategory('');
            setFormData({ name: '', category: availableCategories[0] || 'Software', location: '', description: '' });
            await loadCategories();
            loadProducts();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this product?')) return;
        try {
            await apiDelete(`/sales/products/${id}`);
            loadProducts();
        } catch (err) {
            alert(err.message);
        }
    };

    const openEdit = (product) => {
        setEditingProduct(product);
        setFormData({
            name: product.name,
            category: product.category,
            location: product.location || '',
            description: product.description || '',
            price: product.price || '',
            tags: product.tags?.join(', ') || '',
            coordinatorId: product.coordinatorId || '',
            imageUrl: product.attachments?.imageUrl || '',
        });
        setIsModalOpen(true);
    };

    const handleExport = () => {
        const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
        const token = localStorage.getItem('ats_token');
        window.open(`${baseUrl}/sales/export/products?token=${token}`, '_blank');
    };

    return (
        <PageEnter>
            <div className="flex items-center justify-between mb-8 mt-2">
                <div>
                    <h1 className="text-3xl font-bold text-[#10193f]">Product Inventory</h1>
                    <p className="text-[#5d6784] mt-1">Manage and track your product catalog across regions.</p>
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
                        onClick={handleExport}
                        className="os-btn-outline h-11 px-6 flex items-center gap-2 border-[#e2e8f0] text-[#5c6a84]"
                    >
                        <span className="material-symbols-outlined text-[20px]">download</span>
                        Export CSV
                    </button>
                    <button
                        onClick={() => {
                            setEditingProduct(null);
                            setFormData({ name: '', category: '', location: '', description: '', price: '', tags: '', coordinatorId: '' });
                            setIsModalOpen(true);
                        }}
                        className="os-btn-primary h-11 px-6 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        Add Product
                    </button>
                </div>
            </div>

            <div className="os-card p-4 mb-6 flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px] relative">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#8b95ad] text-sm">search</span>
                    <input
                        className="w-full pl-9 pr-4 py-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                        placeholder="Search products by name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={handleSearch}
                    />
                </div>
                <select
                    className="px-4 py-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors cursor-pointer"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                >
                    <option value="All">All Categories</option>
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="os-btn-outline" onClick={loadProducts}>Apply Filters</button>
            </div>

            <div className="os-card overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-[#f8fafc] text-[#8b95ad] text-[11px] uppercase tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Product Name</th>
                            <th className="px-6 py-4">Category</th>
                            <th className="px-6 py-4 text-right">Price</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Coordinators & Team</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f1f5f9]">
                        {products.map((p) => (
                            <tr key={p.id} className="hover:bg-[#fbfcfe] transition-colors">
                                <td className="px-6 py-4 font-semibold text-[#10193f]">{p.name}</td>
                                <td className="px-6 py-4 text-[#5c6a84]">
                                    <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-[10px] font-bold uppercase">{p.category}</span>
                                </td>
                                <td className="px-6 py-4 text-right font-bold text-[#10193f]">
                                    {p.price ? `₹${p.price.toLocaleString()}` : '-'}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${p.tracking?.status === 'CONVERTED' ? 'bg-green-50 text-green-600' :
                                        p.tracking?.status === 'REJECTED' ? 'bg-red-50 text-red-600' :
                                            p.tracking?.status === 'INTERESTED' ? 'bg-yellow-50 text-yellow-600' :
                                                'bg-gray-50 text-gray-500'
                                        }`}>
                                        {p.tracking?.status || 'LEAD'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-[#5c6a84] text-xs">
                                    <div className="flex -space-x-1.5 overflow-hidden">
                                        {p.candidateAssignments?.slice(0, 3).map((asgn, i) => (
                                            <div key={asgn.id} className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white" title={asgn.candidate.fullName}>
                                                {asgn.candidate.fullName.charAt(0)}
                                            </div>
                                        ))}
                                        {p.candidateAssignments?.length > 3 && (
                                            <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-bold border-2 border-white">
                                                +{p.candidateAssignments.length - 3}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end items-center gap-1.5">
                                        <button className="os-icon-btn !w-9 !h-9 text-[#1f52cc]" title="Manage Team" onClick={() => setTeamProductId(p.id)}>
                                            <span className="material-symbols-outlined !text-[18px]">group_add</span>
                                        </button>
                                        <button className="os-icon-btn !w-9 !h-9 text-[#1f52cc]" onClick={() => openEdit(p)}>
                                            <span className="material-symbols-outlined !text-[18px]">edit</span>
                                        </button>
                                        <button className="os-icon-btn !w-9 !h-9 text-red-500 hover:bg-red-50 hover:border-red-100" onClick={() => handleDelete(p.id)}>
                                            <span className="material-symbols-outlined !text-[18px]">delete</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {products.length === 0 && !loading && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-[#8b95ad]">No products found matching your criteria.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
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
                            <div className="p-8">
                                <h2 className="text-2xl font-bold text-[#10193f] mb-2">{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
                                <p className="text-sm text-[#8b95ad] mb-6">Enter product details below to track its sales progress.</p>

                                <form onSubmit={handleSave} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1">Product Name</label>
                                        <input
                                            required
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="flex flex-col">
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider">Category</label>
                                                <button
                                                    type="button"
                                                    className="text-[10px] font-bold text-[#1f52cc] hover:underline"
                                                    onClick={() => setIsAddingNewCategory(!isAddingNewCategory)}
                                                >
                                                    {isAddingNewCategory ? 'Cancel' : '+ New'}
                                                </button>
                                            </div>
                                            {isAddingNewCategory ? (
                                                <input
                                                    autoFocus
                                                    placeholder="Enter category name"
                                                    className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                    value={newCategory}
                                                    onChange={(e) => setNewCategory(e.target.value)}
                                                />
                                            ) : (
                                                <select
                                                    className="w-full h-11 px-4 py-0 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all cursor-pointer shadow-sm appearance-none"
                                                    value={formData.category}
                                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                >
                                                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1">Location</label>
                                            <input
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.location}
                                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1 px-1">Price (₹)</label>
                                            <input
                                                type="number"
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.price}
                                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1 px-1">Coordinator</label>
                                            <select
                                                className="w-full h-11 px-4 py-0 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all cursor-pointer shadow-sm appearance-none"
                                                value={formData.coordinatorId}
                                                onChange={(e) => setFormData({ ...formData, coordinatorId: e.target.value })}
                                            >
                                                <option value="">Select Coordinator</option>
                                                {coordinators.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1">Image URL</label>
                                        <input
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                                            placeholder="https://images.unsplash.com/..."
                                            value={formData.imageUrl}
                                            onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1">Tags (comma separated)</label>
                                        <input
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                                            placeholder="e.g. High Priority, Hot Lead"
                                            value={formData.tags}
                                            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-1">Description</label>
                                        <textarea
                                            rows={3}
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors resize-none"
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex gap-3 pt-4">
                                        <button type="button" className="flex-1 os-btn-outline" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                        <button type="submit" className="flex-1 os-btn-primary">Save Product</button>
                                    </div>
                                </form>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AssignTeamModal
                productId={teamProductId}
                isOpen={!!teamProductId}
                onClose={() => setTeamProductId(null)}
                onSuccess={loadProducts}
            />

            <BulkImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportComplete={loadProducts}
                title="Bulk Import Products"
                endpoint="/import/products"
                templateHeaders={['Name', 'Category', 'Location', 'Description', 'Price', 'Tags']}
            />
        </PageEnter>
    );
};

const AssignTeamModal = ({ productId, isOpen, onClose, onSuccess }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchEligible();
        }
    }, [isOpen]);

    const fetchEligible = async () => {
        try {
            const res = await apiGet('/sales/eligible-candidates');
            setCandidates(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAssign = async (candidateId) => {
        setSaving(true);
        try {
            await apiPost(`/sales/products/${productId}/assign-candidate`, { candidateId });
            onSuccess();
            onClose();
        } catch (err) {
            alert(err.message || 'Assignment failed');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-[#10193f]/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden p-8 text-left">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-[#10193f]">Assign Working Team</h2>
                        <p className="text-[10px] text-[#8b95ad] font-bold uppercase tracking-widest mt-1">Hired Candidates Only</p>
                    </div>
                    <button onClick={onClose} className="os-icon-btn"><span className="material-symbols-outlined">close</span></button>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                    {loading ? <div className="p-4 os-muted text-center italic">Scanning pool...</div> :
                        candidates.map(c => (
                            <div key={c.id} className="p-4 bg-[#f8fafc] rounded-2xl flex items-center justify-between group hover:bg-blue-50 transition-all border border-transparent hover:border-blue-200">
                                <div>
                                    <div className="font-bold text-[#10193f] group-hover:text-blue-600 transition-colors">{c.fullName}</div>
                                    <div className="text-[9px] text-[#8b95ad] font-bold uppercase">{c.email}</div>
                                </div>
                                <button
                                    onClick={() => handleAssign(c.id)}
                                    disabled={saving}
                                    className="os-btn-primary px-3 py-1.5 text-[10px]"
                                >
                                    Assign
                                </button>
                            </div>
                        ))
                    }
                    {!loading && candidates.length === 0 && (
                        <div className="text-center py-8 text-[#8b95ad] text-xs bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100 italic">
                            No candidates currently in onboarding phase (Joined).
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default ProductList;
