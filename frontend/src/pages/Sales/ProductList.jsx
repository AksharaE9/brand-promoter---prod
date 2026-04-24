import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { API_BASE_URL, apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
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
    const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
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
        try {
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

    useEffect(() => {
        const fetchOnFilter = async () => {
            if (!loading) {
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

    const handleExport = (format = 'csv') => {
        const token = localStorage.getItem('ats_token');
        window.open(`${API_BASE_URL}/sales/export/products?token=${token}&format=${format}`, '_blank');
        setIsExportDropdownOpen(false);
    };

    return (
        <>
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
                        <div className="relative">
                            <button
                                onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                                className="os-btn-outline h-11 px-6 flex items-center gap-2 border-[#e2e8f0] text-[#5c6a84]"
                            >
                                <span className="material-symbols-outlined text-[20px]">download</span>
                                Export
                                <span className="material-symbols-outlined text-[16px] transition-transform duration-200" style={{ transform: isExportDropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}>expand_more</span>
                            </button>

                            <AnimatePresence>
                                {isExportDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-[#f1f5f9] p-2 z-[60]"
                                    >
                                        <button
                                            onClick={() => handleExport('csv')}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-[#5c6a84] hover:bg-blue-50 hover:text-[#1f52cc] rounded-xl transition-all"
                                        >
                                            <span className="material-symbols-outlined text-sm">csv</span>
                                            Export as CSV
                                        </button>
                                        <button
                                            onClick={() => handleExport('excel')}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-[#5c6a84] hover:bg-green-50 hover:text-green-600 rounded-xl transition-all"
                                        >
                                            <span className="material-symbols-outlined text-sm">grid_on</span>
                                            Export as Excel
                                        </button>
                                        <button
                                            onClick={() => handleExport('pdf')}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-[#5c6a84] hover:bg-red-50 hover:text-red-600 rounded-xl transition-all"
                                        >
                                            <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                                            Export as PDF
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
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

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? (
                        <div className="col-span-full py-20 text-center text-[#8b95ad]">Scanning product inventory...</div>
                    ) : products.length === 0 ? (
                        <div className="col-span-full py-20 text-center text-[#8b95ad]">No products matching your search. Add one to expand the catalog.</div>
                    ) : (
                        products.map((p) => (
                            <Reveal key={p.id}>
                                <div className="os-card p-0 group flex flex-col h-full hover:border-[#1f52cc] transition-all overflow-hidden">
                                    <div className="aspect-video bg-[#f8fafc] flex items-center justify-center relative overflow-hidden">
                                        {p.attachments?.imageUrl ? (
                                            <img src={p.attachments.imageUrl} alt={p.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                        ) : (
                                            <span className="material-symbols-outlined text-4xl text-[#e2e8f0]">inventory_2</span>
                                        )}
                                        <div className="absolute top-4 right-4 flex gap-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                                            <button onClick={() => openEdit(p)} className="os-icon-btn !bg-white/90 !backdrop-blur-md shadow-sm">
                                                <span className="material-symbols-outlined !text-[18px]">edit</span>
                                            </button>
                                            <button onClick={() => handleDelete(p.id)} className="os-icon-btn !bg-white/90 !backdrop-blur-md !text-red-500 shadow-sm">
                                                <span className="material-symbols-outlined !text-[18px]">delete</span>
                                            </button>
                                        </div>
                                        <div className="absolute top-4 left-4">
                                            <span className="px-3 py-1 bg-white/90 backdrop-blur-md text-[#1f52cc] rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm border border-blue-50">
                                                {p.category}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-6 flex flex-col flex-1">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-[#10193f] mb-1 group-hover:text-[#1f52cc] transition-colors">{p.name}</h3>
                                            <p className="text-sm text-[#5d6784] line-clamp-2 mb-4 h-10">{p.description || 'No description provided.'}</p>

                                            <div className="flex flex-wrap gap-2 mb-4">
                                                {(p.tags || []).slice(0, 3).map(tag => (
                                                    <span key={tag} className="px-2 py-0.5 bg-[#f1f5f9] text-[#5c6a84] rounded-md text-[10px] font-bold uppercase tracking-wider">{tag}</span>
                                                ))}
                                                {(p.tags || []).length > 3 && (
                                                    <span className="px-2 py-0.5 bg-[#f1f5f9] text-[#5c6a84] rounded-md text-[10px] font-bold uppercase tracking-wider">+{p.tags.length - 3}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t border-[#f1f5f9] flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-bold text-[#8b95ad] uppercase tracking-widest">Pricing</span>
                                                <span className="text-lg font-black text-[#10193f]">₹{p.price?.toLocaleString() || '0'}</span>
                                            </div>
                                            <button
                                                onClick={() => setTeamProductId(p.id)}
                                                className="os-btn-primary !px-4 !py-2 text-xs flex items-center gap-2 group/btn"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">groups</span>
                                                Manage Team
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </Reveal>
                        ))
                    )}
                </div>
            </PageEnter>

            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            className="absolute inset-0 bg-[#0f1b3e]/60 backdrop-blur-[8px]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsModalOpen(false)}
                        />
                        <motion.div
                            className="relative bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden"
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        >
                            <div className="p-8">
                                <div className="flex justify-between items-center mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-[#10193f]">{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
                                        <p className="text-sm text-[#8b95ad] mt-1">Enter product details below to track its sales progress.</p>
                                    </div>
                                    <button onClick={() => setIsModalOpen(false)} className="os-icon-btn">
                                        <span className="material-symbols-outlined">close</span>
                                    </button>
                                </div>

                                <form onSubmit={handleSave} className="space-y-5">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Product Name</label>
                                        <input
                                            required
                                            placeholder="e.g. Enterprise Cloud Suite"
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between px-1">
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
                                                    placeholder="Category name"
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
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Location</label>
                                            <input
                                                placeholder="e.g. Remote / Bangalore"
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.location}
                                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Price (₹)</label>
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                className="w-full h-11 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] focus:bg-white transition-all shadow-sm"
                                                value={formData.price}
                                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Coordinator</label>
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

                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Image URL</label>
                                        <input
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                                            placeholder="https://images.unsplash.com/..."
                                            value={formData.imageUrl}
                                            onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Tags (comma separated)</label>
                                        <input
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors"
                                            placeholder="e.g. High Priority, Hot Lead"
                                            value={formData.tags}
                                            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider px-1">Description</label>
                                        <textarea
                                            rows={3}
                                            placeholder="Add relevant product details..."
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc] transition-colors resize-none shadow-sm"
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex gap-4 pt-4">
                                        <button type="button" className="flex-1 h-12 rounded-2xl border border-[#e2e8f0] text-sm font-bold text-[#5c6a84] hover:bg-gray-50 transition-all" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                        <button type="submit" className="flex-1 h-12 bg-[#1f52cc] text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-100 hover:bg-[#1a47b0] transition-all">Save Product</button>
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
        </>
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
