import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageEnter, Reveal } from '../../components/PageMotion';
import { apiGet } from '../../lib/api';

const SalesDashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const loadStats = async () => {
            try {
                const res = await apiGet('/sales/dashboard');
                setStats(res.data);
            } catch (err) {
                setError(err.message || 'Failed to load sales stats');
            } finally {
                setLoading(false);
            }
        };
        loadStats();
    }, []);

    if (loading) return <div className="p-8 os-muted animate-pulse">Loading workspace analytics...</div>;
    if (error) return <div className="p-8 text-red-500 os-card">{error}</div>;

    const metrics = [
        { label: 'Total Products', value: stats.totalProducts, tag: 'Inventory', icon: 'inventory_2' },
        { label: 'Converted Leads', value: stats.conversions, tag: 'Success', icon: 'verified' },
        { label: 'Conversion Rate', value: `${stats.conversionRate}%`, tag: 'Performance', icon: 'trending_up' },
        { label: 'Added Today', value: stats.addedToday, tag: 'Growth', icon: 'add_chart' },
        { label: 'Pending Follow-ups', value: stats.pendingFollowups, tag: 'Action Required', icon: 'notification_important' },
    ];

    const statusColors = {
        LEAD: '#8b95ad',
        CONTACTED: '#1f52cc',
        INTERESTED: '#eab308',
        CONVERTED: '#22c55e',
        REJECTED: '#ef4444',
        NEGOTIATION: '#a855f7',
    };

    return (
        <PageEnter>
            <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                    <div className="os-eyebrow">Sales & CRM Analytics</div>
                    <h1 className="os-h1">Workspace Dashboard</h1>
                </div>
                <div className="flex gap-2">
                    <div className="os-card px-4 py-2 flex items-center gap-2 border-[#e9eff5]">
                        <span className="material-symbols-outlined text-green-500">stars</span>
                        <div className="text-xs">
                            <div className="text-[#8b95ad] uppercase font-bold text-[9px]">Top Performer</div>
                            <div className="font-bold text-[#10193f]">{stats.topSalesperson?.name || 'No data yet'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-3 xl:grid-cols-5 gap-4">
                {metrics.map((m, idx) => (
                    <Reveal key={m.label} delay={idx * 0.05}>
                        <div className="os-card p-6 relative overflow-hidden group border-none !bg-white">
                            <div className="absolute top-0 right-0 p-4 text-[#f0f4f8] group-hover:text-[#e2e8f0] transition-colors">
                                <span className="material-symbols-outlined text-5xl opacity-40">{m.icon}</span>
                            </div>
                            <div className="relative z-10">
                                <div className="flex justify-between items-center text-xs text-[#7c87a1] font-bold uppercase tracking-wider">
                                    <span>{m.label}</span>
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] ${m.tag === 'Action Required' && stats.pendingFollowups > 0 ? 'bg-red-50 text-red-500' : 'bg-[#f0f4f8] text-[#5c6a84]'}`}>
                                        {m.tag}
                                    </span>
                                </div>
                                <div className="mt-4 text-3xl font-bold text-[#10193f] font-[Manrope] tracking-tight">{m.value}</div>
                            </div>
                        </div>
                    </Reveal>
                ))}
            </div>

            <div className="grid lg:grid-cols-3 gap-6 mt-6">
                <Reveal className="lg:col-span-2">
                    <div className="os-card p-6 h-full border-none bg-gradient-to-br from-[#ffffff] to-[#f8fafc]">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-xl font-bold text-[#10193f]">Urgent Follow-ups</h3>
                                <p className="text-xs text-[#8b95ad]">Actionable tasks requiring immediate attention.</p>
                            </div>
                            <span className="material-symbols-outlined text-orange-500 bg-orange-50 p-2 rounded-xl">alarm</span>
                        </div>

                        <div className="space-y-3">
                            {stats.upcomingFollowups?.map(p => (
                                <div key={p.id} className="os-card p-4 flex items-center justify-between border-[#f0f4f8] hover:border-[#1f52cc] transition-all group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-[#f1f5f9] flex items-center justify-center font-bold text-[#1f52cc]">
                                            {p.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-bold text-[#10193f] group-hover:text-[#1f52cc] transition-colors">{p.name}</div>
                                            <div className="text-[10px] text-[#8b95ad] font-bold uppercase tracking-wider">{p.category} • Due: {new Date(p.tracking.followUpDate).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                    <div className="px-3 py-1 bg-red-50 text-red-500 text-[10px] font-bold rounded-lg uppercase">
                                        High Priority
                                    </div>
                                </div>
                            ))}
                            {stats.upcomingFollowups?.length === 0 && (
                                <div className="text-sm py-8 text-center text-[#8b95ad] border-2 border-dashed border-[#f0f4f8] rounded-2xl">
                                    No pending follow-ups for today.
                                </div>
                            )}
                        </div>

                        <div className="mt-8">
                            <h3 className="text-xl font-bold text-[#10193f] mb-4">Pipeline Hot-Leads</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {stats.priorityLeads?.map(p => (
                                    <div key={p.id} className="os-card p-4 border-none bg-[#f1f5f9]/50">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-bold text-sm text-[#10193f]">{p.name}</div>
                                            <div className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${p.tracking.status === 'NEGOTIATION' ? 'bg-purple-100 text-purple-600' : 'bg-yellow-100 text-yellow-600'}`}>
                                                {p.tracking.status}
                                            </div>
                                        </div>
                                        <div className="text-xs text-[#5c6a84] truncate">{p.description || 'No description provided'}</div>
                                        <div className="mt-3 text-[10px] font-bold text-[#1f52cc]">₹ {p.price?.toLocaleString() || '0'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={0.1}>
                    <div className="os-card p-6 h-full">
                        <div className="flex items-center gap-2 mb-6">
                            <span className="material-symbols-outlined text-[#1f52cc]">history</span>
                            <div className="text-xl font-bold text-[#10193f]">Live Activity</div>
                        </div>

                        <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-[#edf2f7]">
                            {stats.recentActivity?.slice(0, 6).map((activity, idx) => (
                                <div key={activity.id} className="relative pl-8">
                                    <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-white border-2 border-[#1f52cc] flex items-center justify-center z-10">
                                        <span className="material-symbols-outlined text-[12px] text-[#1f52cc] font-bold">
                                            {activity.action === 'PRODUCT_CREATED' ? 'add' : 'sync'}
                                        </span>
                                    </div>
                                    <div className="text-[13px] font-bold text-[#10193f]">
                                        {activity.action.replace('_', ' ')}
                                    </div>
                                    <div className="text-xs text-[#5c6a84] mt-1 leading-relaxed">
                                        {activity.details}
                                    </div>
                                    <div className="text-[10px] text-[#8b95ad] mt-1.5 font-bold uppercase tracking-wider">
                                        {new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            ))}
                            {stats.recentActivity?.length === 0 && (
                                <div className="text-sm os-muted py-8 text-center bg-[#f8fafc] rounded-2xl border-2 border-dashed border-[#edf2f7]">
                                    No activity records.
                                </div>
                            )}
                        </div>

                        <button className="os-btn-outline w-full mt-auto h-11 text-xs font-bold uppercase tracking-wider" type="button">View Activity History</button>
                    </div>
                </Reveal>
            </div>
        </PageEnter>
    );
};

export default SalesDashboard;
