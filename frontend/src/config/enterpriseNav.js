import { clearAuth } from '../lib/api';

const ALL_ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];
const APPROVER_ROLES = ['QUALITY_APPROVER', 'SUPER_ADMIN', 'ADMIN'];

export const enterpriseNavItems = [
  { key: 'quality-check', label: 'Second Round Quality Check', href: '/quality-check', icon: 'fact_check', roles: APPROVER_ROLES },
  { key: 'dashboard',  label: 'Dashboard',           href: '/dashboard',               icon: 'dashboard',      roles: ALL_ROLES },
  { key: 'candidates', label: 'All Candidates',       href: '/candidates',              icon: 'group',          roles: ALL_ROLES },
  { key: 'passed',     label: 'Offer Sent',           href: '/candidates?status=OFFER_SENT', icon: 'check_circle', roles: ALL_ROLES },
  { key: 'joined',     label: 'Joined Candidates',    href: '/candidates?status=JOINED',     icon: 'person_add',   roles: ALL_ROLES },
  { key: 'rejected',   label: 'Rejected Candidates',  href: '/candidates?status=REJECTED',   icon: 'block',        roles: ALL_ROLES },
  { key: 'jobs',       label: 'Jobs',                 href: '/jobs',                    icon: 'work',           roles: ALL_ROLES },
  { key: 'interviews', label: 'Interviews',           href: '/schedule',                icon: 'calendar_month', roles: ALL_ROLES },
  { key: 'scheduling', label: 'Scheduling',           href: '/scheduling',              icon: 'assignment',     roles: ALL_ROLES },
  { key: 'drives',     label: 'College Drives',       href: '/drives',                  icon: 'campaign',       roles: ALL_ROLES },
  { key: 'posted',     label: 'Posted',               href: '/posted',                  icon: 'folder',         roles: ALL_ROLES },

  { key: 'analytics',  label: 'Analytics',            href: '/analytics',               icon: 'bar_chart',      roles: ['SUPER_ADMIN'] },
  { key: 'reports',    label: 'Reports',              href: '/reports',                 icon: 'description',    roles: ['SUPER_ADMIN'] },
  { key: 'audit',      label: 'Audit Logs',           href: '/audit',                   icon: 'policy',         roles: ['SUPER_ADMIN'] },
  { key: 'pool',       label: 'Team',                 href: '/team',                    icon: 'groups',         roles: ['SUPER_ADMIN'] },
];

export const enterpriseFooterLinks = [
  { key: 'settings', label: 'Settings', href: '/settings', icon: 'settings', roles: ALL_ROLES },
  {
    key: 'logout',
    label: 'Logout',
    href: '/login',
    icon: 'logout',
    roles: [...ALL_ROLES, 'QUALITY_APPROVER'],
    onClick: () => clearAuth(),
  },
];
