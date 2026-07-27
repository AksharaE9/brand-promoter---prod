import React from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../../components/EnterpriseLayout';
import UserChip from '../../components/UserChip';
import SalesNotificationBell from '../../components/SalesNotificationBell';
import { getStoredUser } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

const salesNavItems = [
    { key: 'sales-dashboard', label: 'Dashboard', href: '/sales', icon: 'dashboard' },
    { key: 'sales-products', label: 'Products', href: '/sales/products', icon: 'inventory_2' },
    { key: 'sales-candidates', label: 'Candidates', href: '/sales/candidates', icon: 'group' },
    { key: 'sales-tracker', label: 'Sales Tracker', href: '/sales/tracker', icon: 'query_stats' },
    { key: 'sales-team', label: 'Team', href: '/sales/team', icon: 'badge' },
];

const SalesLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const currentUser = getStoredUser();

    const getActiveKey = () => {
        const path = location.pathname;
        if (path === '/sales') return 'sales-dashboard';
        if (path.startsWith('/sales/products')) return 'sales-products';
        if (path.startsWith('/sales/candidates')) return 'sales-candidates';
        if (path.startsWith('/sales/tracker')) return 'sales-tracker';
        if (path.startsWith('/sales/team')) return 'sales-team';
        return '';
    };

    return (
        <EnterpriseLayout
            sidebar={
                <EnterpriseSidebar
                    brand="SALES"
                    subtitle="Sales Workspace"
                    active={getActiveKey()}
                    items={salesNavItems}
                    hideHub={true}
                    footerLinks={[
                        { key: 'switch-workspace', label: 'Switch Workspace', href: '/workspaces', icon: 'apps' },
                        { key: 'settings', label: 'Settings', href: '/sales/settings', icon: 'settings' },
                        {
                            key: 'logout',
                            label: 'Logout',
                            href: '/login',
                            icon: 'logout',
                            onClick: () => {
                                useAuthStore.getState().clearAuth();
                            }
                        },
                    ]}
                />
            }
            topbar={
                <EnterpriseTopbar
                    searchPlaceholder="Search products or sales..."
                    tabs={[
                        { key: 'overview', label: 'Overview', href: '/sales', active: location.pathname === '/sales' },
                        { key: 'analysis', label: 'Analysis', href: '#', active: false },
                    ]}
                    right={
                        <>
                            <SalesNotificationBell />
                            <button className="os-btn-primary" onClick={() => navigate('/sales/products?add=true')}>
                                + New Product
                            </button>
                            <UserChip
                                fallbackName={currentUser?.fullName || 'Marcus Thorne'}
                                fallbackRole={String(currentUser?.role || 'Sales Lead').replace('_', ' ')}
                                avatarSeed="sales-user"
                            />
                        </>
                    }
                />
            }
        >
            <Outlet />
        </EnterpriseLayout>
    );
};

export default SalesLayout;
