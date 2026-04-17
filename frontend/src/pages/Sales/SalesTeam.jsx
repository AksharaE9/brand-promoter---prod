import React, { useState, useEffect } from 'react';
import { apiGet } from '../../lib/api';
import { PageEnter } from '../../components/PageMotion';

const SalesTeam = () => {
    const [team, setTeam] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            // Fetch coordinators and limited products to keep it snappy
            const usersRes = await apiGet('/users'); 
            const prodsRes = await apiGet('/sales/products?limit=100');
            
            const users = usersRes.data || [];
            const prods = prodsRes.data || [];
            
            setTeam(users.filter(u => u.role === 'SUPER_ADMIN' || u.role === 'RECRUITER'));
            setProducts(prods);
        } catch (error) {
            console.error('Failed to load team data', error);
        } finally {
            setLoading(false);
        }
    };

    const getAssignedProducts = (userId) => {
        return products.filter(p => p.coordinatorId === userId);
    };

    return (
        <PageEnter>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-[#10193f]">Sales Coordinators</h1>
                    <p className="text-[#5d6784] mt-1">Oversee team members managing product tracking and conversions.</p>
                </div>
            </div>

            <div className="os-card overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-[#f8fafc] text-[#8b95ad] text-[11px] uppercase tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Coordinator</th>
                            <th className="px-6 py-4">Role</th>
                            <th className="px-6 py-4">Active Assignments</th>
                            <th className="px-6 py-4">Products</th>
                            <th className="px-6 py-4">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f1f5f9]">
                        {loading ? (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-[#8b95ad]">Loading team data...</td></tr>
                        ) : team.map((member) => {
                            const assigned = getAssignedProducts(member.id);
                            return (
                                <tr key={member.id} className="hover:bg-[#fbfcfe] transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-xs">
                                                {member.fullName.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="font-bold text-[#10193f]">{member.fullName}</div>
                                                <div className="text-[10px] text-[#8b95ad]">{member.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 bg-[#f1f5f9] text-[#5c6a84] rounded-md text-[10px] font-bold uppercase tracking-wider">{member.role.replace('_', ' ')}</span>
                                    </td>
                                    <td className="px-6 py-4 font-bold text-[#10193f]">{assigned.length}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                                            {assigned.length > 0 ? assigned.slice(0, 2).map(p => (
                                                <span key={p.id} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">{p.name}</span>
                                            )) : <span className="text-[#8b95ad] italic text-xs">No products assigned</span>}
                                            {assigned.length > 2 && <span className="text-[9px] text-[#8b95ad]">+{assigned.length - 2} more</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full ${member.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                            <span className="text-xs font-bold text-[#10193f]">{member.status}</span>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </PageEnter>
    );
};

export default SalesTeam;
