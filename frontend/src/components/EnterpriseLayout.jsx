import React from 'react';
import { Link } from 'react-router-dom';
import { clearAuth, getStoredUser } from '../lib/api';

const NavItem = React.memo(({ item, className }) => {
  const handleClick = (event) => {
    if (typeof item.onClick === 'function') {
      item.onClick(event);
    }
  };

  const iconEl = item.icon ? (
    <span className="material-symbols-outlined os-nav-icon">{item.icon}</span>
  ) : null;

  if (item.href && item.href.startsWith('/')) {
    return (
      <Link className={className} to={item.href} onClick={handleClick}>
        {iconEl}
        {item.label}
      </Link>
    );
  }

  return (
    <a className={className} href={item.href || '#'} onClick={handleClick}>
      {iconEl}
      {item.label}
    </a>
  );
});
NavItem.displayName = 'NavItem';

export const EnterpriseSidebar = React.memo(({
  brand = 'ATS',
  subtitle = 'Enterprise ATS',
  items = [],
  active = '',
  footerButton = null,
  footerLinks = [],
  hideHub = false,
}) => {
  const role = getStoredUser()?.role;
  const roleFilter = (item) => {
    if (!item.roles || !Array.isArray(item.roles)) return true;
    if (!role) return false;
    return item.roles.includes(role);
  };

  const links = footerLinks.length
    ? footerLinks
    : [
      { key: 'switch', label: 'Switch Workspace', href: '/workspaces', icon: 'apps' },
      { key: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
      {
        key: 'logout',
        label: 'Logout',
        href: '/login',
        icon: 'logout',
        onClick: () => clearAuth(),
      },
    ];

  const visibleItems = React.useMemo(() => items.filter(roleFilter), [items, role]);
  const visibleLinks = React.useMemo(() => links.filter(roleFilter), [links, role]);

  return (
    <aside className="app-sidebar os-sidebar">
      <div className="os-brand">
        <div className="os-brand-title">{brand}</div>
        <div className="os-brand-sub">{subtitle}</div>
      </div>

      <nav className="os-nav">
        {visibleItems.map((item) => (
          <NavItem key={item.key} item={item} className={`os-nav-item ${active === item.key ? 'active' : ''}`} />
        ))}
      </nav>

      <div className="os-sidebar-footer">
        {role !== 'INTERVIEWER' && !hideHub && (
          <Link to="/schedule" className="os-btn-primary w-full text-center h-11 mb-3 flex items-center justify-center gap-2 no-underline text-white">
            <span className="material-symbols-outlined text-xl">hub</span>
            Interview Hub
          </Link>
        )}
        {footerButton}
        {visibleLinks.map((link) => (
          <NavItem key={link.key} item={link} className="os-footer-link" />
        ))}
      </div>
    </aside>
  );
});
EnterpriseSidebar.displayName = 'EnterpriseSidebar';

export const EnterpriseTopbar = React.memo(({ searchPlaceholder = 'Search...', searchValue, onSearchChange, tabs = [], right = null }) => {
  return (
    <header className="os-topbar">
      <div className="os-search">
        <span className="material-symbols-outlined !text-[18px]">search</span>
        <input 
          placeholder={searchPlaceholder} 
          className="bg-transparent border-none outline-none w-full text-sm py-1.5" 
          value={searchValue !== undefined ? searchValue : undefined}
          onChange={onSearchChange}
        />
      </div>

      <div className="os-top-tabs">
        {tabs.map((tab) => (
          <Link key={tab.key} to={tab.href || '#'} className={`os-top-tab ${tab.active ? 'active' : ''}`}>
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="os-top-right">
        {right}
        <Link
          to="/sales"
          className="os-sales-btn"
        >
          Sales Workspace
        </Link>
      </div>
    </header>
  );
});
EnterpriseTopbar.displayName = 'EnterpriseTopbar';

import { useRealtimeUpdates } from '../hooks/useRealtimeUpdates';

export default React.memo(function EnterpriseLayout({ sidebar, topbar, children, contentClassName = '' }) {
  useRealtimeUpdates();

  return (
    <div className="app-layout os-shell page-transition">
      {sidebar}
      <div className="main-content os-main">
        {topbar}
        <main className={`os-content ${contentClassName}`}>{children}</main>
      </div>
    </div>
  );
});
