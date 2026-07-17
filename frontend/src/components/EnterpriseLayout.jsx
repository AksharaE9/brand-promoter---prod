import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { clearAuth, getStoredUser, apiGet } from '../lib/api';

// ── Prefetch map: href → { queryKey, queryFn }
// When user hovers a nav link for 150ms, we start fetching data for the destination.
// By the time they click, the data is already in React Query cache → instant render.
const PREFETCH_MAP = {
  '/dashboard': {
    queryKey: ['dashboard'],
    queryFn:  () => apiGet('/dashboard/init'),
    staleTime: 2 * 60_000,
  },
  '/candidates': {
    queryKey: ['candidates', 'prefetch'],
    queryFn:  () => apiGet('/candidates?limit=30'),
    staleTime: 2 * 60_000,
  },
  '/schedule': {
    queryKey: ['scheduling', 'rounds', { limit: 50 }],
    queryFn:  () => apiGet('/interviews?limit=50'),
    staleTime: 2 * 60_000,
  },
  '/jobs': {
    queryKey: ['jobs', 'prefetch'],
    queryFn:  () => apiGet('/jobs?limit=30&isActive=true'),
    staleTime: 2 * 60_000,
  },
};

const NavItem = React.memo(({ item, className, onMouseEnter }) => {
  const handleClick = (event) => {
    if (typeof item.onClick === 'function') {
      item.onClick(event);
    }
  };

  const iconEl = item.icon ? (
    <span className="material-symbols-outlined os-nav-icon">{item.icon}</span>
  ) : null;

  if (item.href && item.href.startsWith('/')) {
    // Extract base path for prefetch lookup (strip query string)
    const basePath = item.href.split('?')[0];
    const hasPrefetch = !!PREFETCH_MAP[basePath];
    return (
      <Link
        className={className}
        to={item.href}
        onClick={handleClick}
        onMouseEnter={hasPrefetch ? () => onMouseEnter(basePath) : undefined}
      >
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
  const queryClient = useQueryClient();

  // Hover timers: prevent prefetch on accidental hover
  const hoverTimers = React.useRef({});

  const handleNavMouseEnter = useCallback((basePath) => {
    const config = PREFETCH_MAP[basePath];
    if (!config) return;

    // 150ms delay — only prefetch if user actually pauses on the link
    hoverTimers.current[basePath] = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: config.queryKey,
        queryFn:  config.queryFn,
        staleTime: config.staleTime,
      });
    }, 150);
  }, [queryClient]);

  const handleNavMouseLeave = useCallback((basePath) => {
    if (hoverTimers.current[basePath]) {
      clearTimeout(hoverTimers.current[basePath]);
      delete hoverTimers.current[basePath];
    }
  }, []);

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
        {visibleItems.map((item) => {
          const basePath = item.href?.split('?')[0];
          return (
            <NavItem
              key={item.key}
              item={item}
              className={`os-nav-item ${active === item.key ? 'active' : ''}`}
              onMouseEnter={handleNavMouseEnter}
              onMouseLeave={basePath ? () => handleNavMouseLeave(basePath) : undefined}
            />
          );
        })}
      </nav>

      <div className="os-sidebar-footer">
        {role !== 'INTERVIEWER' && !hideHub && (
          <Link
            to="/schedule"
            className="os-btn-primary w-full text-center h-11 mb-3 flex items-center justify-center gap-2 no-underline text-white"
            onMouseEnter={() => handleNavMouseEnter('/schedule')}
            onMouseLeave={() => handleNavMouseLeave('/schedule')}
          >
            <span className="material-symbols-outlined text-xl">hub</span>
            Interview Hub
          </Link>
        )}
        {footerButton}
        {visibleLinks.map((link) => (
          <NavItem key={link.key} item={link} className="os-footer-link" onMouseEnter={handleNavMouseEnter} />
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
