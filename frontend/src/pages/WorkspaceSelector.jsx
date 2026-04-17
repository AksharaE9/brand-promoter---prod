import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageEnter, Reveal } from '../components/PageMotion';
import { getStoredUser } from '../lib/api';

const WorkspaceSelector = () => {
    const navigate = useNavigate();
    const user = getStoredUser();

    const workspaces = [
        {
            id: 'ats',
            title: 'ATS Platform',
            description: 'Manage talent pipeline, jobs, and interviews.',
            icon: 'hub',
            color: 'bg-blue-600',
            gradient: 'from-blue-600 to-indigo-700',
            path: '/dashboard',
        },
        {
            id: 'sales',
            title: 'Sales Workspace',
            description: 'Track products, CRM pipeline, and sales metrics.',
            icon: 'point_of_sale',
            color: 'bg-emerald-600',
            gradient: 'from-emerald-600 to-teal-700',
            path: '/sales',
        },
    ];

    return (
        <div className="min-h-screen bg-[#f8fbff] flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_20%_20%,#eef2ff_0,transparent_25%),radial-gradient(circle_at_80%_80%,#ecfdf5_0,transparent_25%)]">
            <PageEnter>
                <div className="text-center mb-12">
                    <motion.div
                        className="inline-flex items-center gap-3 mb-6"
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                    >
                        <div className="h-10 w-10 rounded-lg bg-[#1f52cc] text-white flex items-center justify-center shadow-lg">
                            <span className="material-symbols-outlined font-bold">hub</span>
                        </div>
                        <div className="text-3xl font-bold text-[#10193f] font-[Manrope]">Enterprise OS</div>
                    </motion.div>
                    <h1 className="text-4xl font-bold text-[#10193f] mb-4">Welcome back, {user?.fullName?.split(' ')[0] || 'User'}</h1>
                    <p className="text-lg text-[#5d6784] max-w-md mx-auto">
                        Choose a specialized environment to start your workflow.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-10 w-full max-w-5xl">
                    {workspaces.map((ws, idx) => (
                        <Reveal key={ws.id} delay={idx * 0.1}>
                            <motion.div
                                whileHover={{ y: -10, scale: 1.02 }}
                                onClick={() => navigate(ws.path)}
                                className="os-card p-1.5 cursor-pointer group bg-white border-none shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] hover:shadow-[0_48px_80px_-16px_rgba(0,0,0,0.12)] transition-all rounded-[40px] overflow-hidden"
                            >
                                <div className="p-10 flex flex-col h-full bg-white rounded-[32px]">
                                    <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${ws.gradient} text-white flex items-center justify-center mb-8 shadow-2xl group-hover:scale-105 transition-transform duration-500`}>
                                        <span className="material-symbols-outlined text-4xl font-bold">{ws.icon}</span>
                                    </div>
                                    <h3 className="text-3xl font-bold text-[#10193f] mb-4 tracking-tight">{ws.title}</h3>
                                    <p className="text-[#5d6784] text-base leading-relaxed mb-10 flex-1 opacity-80">
                                        {ws.description}
                                    </p>
                                    <div className="flex items-center gap-3 text-[#1f52cc] font-bold text-xs tracking-[0.15em] uppercase">
                                        Enter Workspace
                                        <div className="h-px flex-1 bg-gradient-to-r from-[#1f52cc]/20 to-transparent"></div>
                                        <span className="material-symbols-outlined text-xl group-hover:translate-x-2 transition-transform">arrow_right_alt</span>
                                    </div>
                                </div>
                            </motion.div>
                        </Reveal>
                    ))}
                </div>

                <div className="mt-16 text-center">
                    <button
                        onClick={() => {
                            localStorage.clear();
                            navigate('/login');
                        }}
                        className="text-sm text-[#8b95ad] hover:text-red-500 font-bold uppercase tracking-wider flex items-center gap-2 mx-auto"
                    >
                        <span className="material-symbols-outlined text-base">logout</span>
                        Sign Out from System
                    </button>
                </div>
            </PageEnter>
        </div>
    );
};

export default WorkspaceSelector;
