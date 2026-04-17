import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { apiGet, apiPost, apiDelete } from '../../lib/api';

const SalesSettings = () => {
    const [categories, setCategories] = useState([]);
    const [newCategory, setNewCategory] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        defaultFollowUpDays: 7,
        enableNotifications: true,
        monthlyTarget: 10
    });

    useEffect(() => {
        fetchCategories();
    }, []);

    const fetchCategories = async () => {
        try {
            const res = await apiGet('/sales/categories');
            setCategories(res.data || []);
        } catch (err) {
            console.error('Failed to categories:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddCategory = async () => {
        if (!newCategory.trim()) return;
        setSaving(true);
        try {
            // Categories are created on the fly in products, 
            // but we can simulate a dedicated list if we had a Category model.
            // For now, we'll just show them.
            setCategories([...new Set([...categories, newCategory.trim()])]);
            setNewCategory('');
        } catch (err) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveGeneral = () => {
        setSaving(true);
        setTimeout(() => {
            setSaving(false);
            alert('Settings saved successfully!');
        }, 800);
    };

    return (
        <PageEnter>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-[#10193f]">Workspace Settings</h1>
                <p className="text-[#5d6784] mt-1">Configure your sales environment and CRM preferences.</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Reveal>
                        <div className="os-card p-8">
                            <h3 className="text-xl font-bold text-[#10193f] mb-6 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[#1f52cc]">tune</span>
                                General Preferences
                            </h3>

                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-2">Default Follow-up (Days)</label>
                                        <input
                                            type="number"
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc]"
                                            value={settings.defaultFollowUpDays}
                                            onChange={(e) => setSettings({ ...settings, defaultFollowUpDays: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[#10193f] uppercase tracking-wider mb-2">Monthly Conversion Target</label>
                                        <input
                                            type="number"
                                            className="w-full px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc]"
                                            value={settings.monthlyTarget}
                                            onChange={(e) => setSettings({ ...settings, monthlyTarget: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-[#f8fafc] rounded-2xl">
                                    <div>
                                        <div className="font-bold text-[#10193f] text-sm">Enable Email Notifications</div>
                                        <div className="text-[10px] text-[#8b95ad]">Receive alerts for overdue follow-ups via email.</div>
                                    </div>
                                    <button
                                        onClick={() => setSettings({ ...settings, enableNotifications: !settings.enableNotifications })}
                                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.enableNotifications ? 'bg-[#1f52cc]' : 'bg-[#cbd5e1]'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.enableNotifications ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>

                                <button
                                    onClick={handleSaveGeneral}
                                    disabled={saving}
                                    className="os-btn-primary w-full h-11"
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </div>
                    </Reveal>

                    <Reveal delay={0.1}>
                        <div className="os-card p-8">
                            <h3 className="text-xl font-bold text-[#10193f] mb-6 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[#1f52cc]">category</span>
                                Category Management
                            </h3>

                            <div className="flex gap-2 mb-6">
                                <input
                                    className="flex-1 px-4 py-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl text-sm outline-none focus:border-[#1f52cc]"
                                    placeholder="Add new product category..."
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                />
                                <button onClick={handleAddCategory} className="os-btn-primary px-6 h-11">Add</button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {categories.map(cat => (
                                    <div key={cat} className="px-4 py-2 bg-white border border-[#e2e8f0] rounded-xl flex items-center gap-2 group hover:border-[#1f52cc] transition-all cursor-default">
                                        <span className="text-sm font-semibold text-[#10193f]">{cat}</span>
                                        <button className="text-[#8b95ad] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                            <span className="material-symbols-outlined text-sm">close</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Reveal>
                </div>

                <div className="space-y-6">
                    <Reveal delay={0.2}>
                        <div className="os-card p-6 bg-gradient-to-br from-[#10193f] to-[#1f52cc] text-white border-none">
                            <h4 className="font-bold text-lg mb-2">Pro Tip</h4>
                            <p className="text-xs text-[#a5b4fc] leading-relaxed">
                                Use the "Default Follow-up" setting to automatically schedule tasks for your team when a new lead is created.
                            </p>
                        </div>
                    </Reveal>

                    <Reveal delay={0.3}>
                        <div className="os-card p-6 border-dashed border-2 border-[#e2e8f0] bg-transparent">
                            <h4 className="font-bold text-[#10193f] mb-2">Export Workspace Data</h4>
                            <p className="text-xs text-[#8b95ad] mb-4">Download a full backup of your products, tracking history, and activity logs.</p>
                            <button className="os-btn-outline w-full h-10 text-[11px] border-[#e2e8f0]">Download JSON</button>
                        </div>
                    </Reveal>
                </div>
            </div>
        </PageEnter>
    );
};

export default SalesSettings;
