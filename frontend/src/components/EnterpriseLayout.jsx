import React from 'react';
import { Link } from 'react-router-dom';
import { clearAuth, getStoredUser } from '../lib/api';

function NavItem({ item, className }) {
  const handleClick = (event) => {
    if (typeof item.onClick === 'function') {
      item.onClick(event);
    }
  };

  if (item.href && item.href.startsWith('/')) {
    return (
      <Link className={className} to={item.href} onClick={handleClick}>
        <span className="material-symbols-outlined os-nav-icon">{item.icon}</span>
        {item.label}
      </Link>
    );
  }

  return (
    <a className={className} href={item.href || '#'} onClick={handleClick}>
      <span className="material-symbols-outlined os-nav-icon">{item.icon}</span>
      {item.label}
    </a>
  );
}

export function EnterpriseSidebar({
  brand = 'ATS',
  subtitle = 'Enterprise ATS',
  items = [],
  active = '',
  footerButton = null,
  footerLinks = [],
  hideHub = false,
}) {
  const role = getStoredUser()?.role;
  const roleFilter = (item) => !Array.isArray(item.roles) || !role || item.roles.includes(role);

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

  const visibleItems = items.filter(roleFilter);
  const visibleLinks = links.filter(roleFilter);

  return (
    <aside className="os-sidebar">
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
}

export function EnterpriseTopbar({ searchPlaceholder = 'Search...', tabs = [], right = null }) {
  return (
    <header className="os-topbar">
      <div className="os-search">
        <span className="material-symbols-outlined !text-[18px]">search</span>
        <input placeholder={searchPlaceholder} className="bg-transparent border-none outline-none w-full text-sm py-1.5" />
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
          className="ml-3 px-4 py-1.5 bg-gradient-to-r from-[#1f52cc] to-[#35b577] text-white text-[11px] font-bold uppercase rounded-lg shadow-lg hover:shadow-xl transition-all no-underline"
        >
          Sales Workspace
        </Link>
      </div>
    </header>
  );
}

export default function EnterpriseLayout({ sidebar, topbar, children, contentClassName = '' }) {
  return (
    <div className="os-shell">
      {sidebar}
      <div className="os-main">
        {topbar}
        <main className={`os-content ${contentClassName}`}>{children}</main>
      </div>
    </div>
  );
}
