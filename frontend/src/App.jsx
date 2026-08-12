import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { getStoredUser } from './lib/api';
import ErrorBoundary from './components/ErrorBoundary';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { RouteTransition } from './components/PageMotion';

// ─── Lazy-loaded pages with chunk-retry ────────────────────────────────────────
const LandingPage         = lazyWithRetry(() => import('./pages/LandingPage'),                    'LandingPage');
const LoginPage           = lazyWithRetry(() => import('./pages/LoginPage'),                      'LoginPage');
const SignupPage          = lazyWithRetry(() => import('./pages/SignupPage'),                      'SignupPage');
const Dashboard           = lazyWithRetry(() => import('./pages/Dashboard'),                      'Dashboard');
const CandidateProfile    = lazyWithRetry(() => import('./pages/CandidateProfile'),               'CandidateProfile');
const Candidates          = lazyWithRetry(() => import('./pages/Candidates'),                     'Candidates');
const JobsManager         = lazyWithRetry(() => import('./pages/JobsManager'),                    'JobsManager');
const JobDetailModule     = lazyWithRetry(() => import('./pages/JobDetailModule'),                'JobDetailModule');
const InterviewSchedule   = lazyWithRetry(() => import('./pages/InterviewSchedule'),              'InterviewSchedule');
const Analytics           = lazyWithRetry(() => import('./pages/Analytics'),                      'Analytics');
const Reports             = lazyWithRetry(() => import('./pages/Reports'),                        'Reports');
const AuditLogs           = lazyWithRetry(() => import('./pages/AuditLogs'),                     'AuditLogs');
const Settings            = lazyWithRetry(() => import('./pages/Settings'),                       'Settings');
const PublicCareers       = lazyWithRetry(() => import('./pages/PublicCareers'),                  'PublicCareers');
const Team                = lazyWithRetry(() => import('./pages/Team'),                           'Team');
const Drives              = lazyWithRetry(() => import('./pages/Drives'),                         'Drives');
const WorkspaceSelector   = lazyWithRetry(() => import('./pages/WorkspaceSelector'),              'WorkspaceSelector');
const SchedulingPage      = lazyWithRetry(() => import('./pages/Scheduling/SchedulingPage'),      'SchedulingPage');
const MemberProfilePage   = lazyWithRetry(() => import('./pages/Scheduling/MemberProfilePage'),  'MemberProfilePage');
const NotFound            = lazyWithRetry(() => import('./pages/NotFound'),                       'NotFound');
const Sourcing            = lazyWithRetry(() => import('./pages/Sourcing'),                       'Sourcing');
const Referrals           = lazyWithRetry(() => import('./pages/Referrals'),                      'Referrals');
const Posted              = lazyWithRetry(() => import('./pages/Posted'),                         'Posted');

// Sales Module
const SalesLayout         = lazyWithRetry(() => import('./pages/Sales/SalesLayout'),      'SalesLayout');
const SalesDashboard      = lazyWithRetry(() => import('./pages/Sales/SalesDashboard'),   'SalesDashboard');
const ProductList         = lazyWithRetry(() => import('./pages/Sales/ProductList'),       'ProductList');
const SalesTracker        = lazyWithRetry(() => import('./pages/Sales/SalesTracker'),     'SalesTracker');
const SalesSettings       = lazyWithRetry(() => import('./pages/Sales/SalesSettings'),    'SalesSettings');
const SalesCandidates     = lazyWithRetry(() => import('./pages/Sales/SalesCandidates'), 'SalesCandidates');
const SalesTeam           = lazyWithRetry(() => import('./pages/Sales/SalesTeam'),        'SalesTeam');

const ALL_ROLES      = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];

import PageSkeleton from './components/PageSkeleton';
import ToastContainer from './components/ToastContainer';

// ─── Smooth per-route Suspense skeleton ────────────────────────────────────────
/**
 * RouteSuspense — wraps each protected route in its own Suspense boundary with
 * an appropriate skeleton type.  Using one global <Suspense> around all <Routes>
 * caused React to "freeze" the old route on screen while the new chunk loaded,
 * making it look like navigation was broken.  Per-route boundaries avoid that.
 */
function RouteSuspense({ children, type = 'table' }) {
  return (
    <Suspense fallback={<PageSkeleton type={type} />}>
      {children}
    </Suspense>
  );
}

const protectedElement = (element, allowedRoles = ALL_ROLES, skeletonType = 'table') => (
  <ProtectedRoute allowedRoles={allowedRoles}>
    <RouteSuspense type={skeletonType}>
      {element}
    </RouteSuspense>
  </ProtectedRoute>
);

// ─── Inner app (needs Router context for useLocation) ─────────────────────────
function AppRoutes() {
  // Prefetch secondary route chunks once user is confirmed logged in
  React.useEffect(() => {
    const prefetch = () => {
      const user = getStoredUser();
      if (user) {
        import('./pages/Dashboard');
        import('./pages/Candidates');
        import('./pages/InterviewSchedule');
        import('./pages/Scheduling/SchedulingPage');
        import('./pages/JobsManager');
        import('./pages/JobDetailModule');
        import('./pages/CandidateProfile');
        import('./pages/Analytics');
        import('./pages/Reports');
        import('./pages/AuditLogs');
        import('./pages/Team');
        import('./pages/Drives');
        import('./pages/Settings');
      } else {
        import('./pages/LoginPage');
        import('./pages/SignupPage');
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(prefetch, { timeout: 10_000 });
    } else {
      setTimeout(prefetch, 2000);
    }
  }, []);

  return (
    <Routes>
      {/* Public */}
      <Route path="/"       element={<Suspense fallback={<PageSkeleton />}><RouteTransition><LandingPage /></RouteTransition></Suspense>} />
      <Route path="/login"  element={<Suspense fallback={<PageSkeleton />}><RouteTransition><LoginPage /></RouteTransition></Suspense>} />
      <Route path="/signup" element={<Suspense fallback={<PageSkeleton />}><RouteTransition><SignupPage /></RouteTransition></Suspense>} />
      <Route path="/careers" element={<Suspense fallback={<PageSkeleton />}><RouteTransition><PublicCareers /></RouteTransition></Suspense>} />

      {/* Protected — ATS */}
      <Route path="/workspaces"                element={protectedElement(<WorkspaceSelector />)} />
      <Route path="/dashboard"                 element={protectedElement(<Dashboard />, ALL_ROLES, 'dashboard')} />
      <Route path="/candidates"                element={protectedElement(<Candidates />)} />
      <Route path="/candidate/:id"             element={protectedElement(<CandidateProfile />, ALL_ROLES, 'profile')} />
      <Route path="/candidates/:id"            element={protectedElement(<CandidateProfile />, ALL_ROLES, 'profile')} />
      <Route path="/jobs"                      element={protectedElement(<JobsManager />)} />
      <Route path="/jobs/:id"                  element={protectedElement(<JobDetailModule />)} />
      <Route path="/schedule"                  element={protectedElement(<InterviewSchedule />)} />
      <Route path="/scheduling"                element={protectedElement(<SchedulingPage />)} />
      <Route path="/scheduling/members/:memberId" element={protectedElement(<MemberProfilePage />)} />
      <Route path="/drives"                    element={protectedElement(<Drives />)} />
      <Route path="/posted"                    element={protectedElement(<Posted />)} />
      <Route path="/sourcing"                  element={protectedElement(<Sourcing />)} />
      <Route path="/referrals"                 element={protectedElement(<Referrals />)} />

      {/* Admin-only */}
      <Route path="/analytics" element={protectedElement(<Analytics />, ['SUPER_ADMIN'], 'dashboard')} />
      <Route path="/reports"   element={protectedElement(<Reports />,   ['SUPER_ADMIN'])} />
      <Route path="/audit"     element={protectedElement(<AuditLogs />, ['SUPER_ADMIN'])} />
      <Route path="/team"      element={protectedElement(<Team />,      ['SUPER_ADMIN'])} />
      <Route path="/settings"  element={protectedElement(<Settings />)} />

      {/* Sales module (nested routes) */}
      <Route path="/sales" element={protectedElement(<SalesLayout />, ADMIN_RECRUITER)}>
        <Route index           element={<Suspense fallback={null}><SalesDashboard /></Suspense>} />
        <Route path="products" element={<Suspense fallback={null}><ProductList /></Suspense>} />
        <Route path="candidates" element={<Suspense fallback={null}><SalesCandidates /></Suspense>} />
        <Route path="tracker"  element={<Suspense fallback={null}><SalesTracker /></Suspense>} />
        <Route path="team"     element={<Suspense fallback={null}><SalesTeam /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={null}><SalesSettings /></Suspense>} />
      </Route>

      <Route path="*" element={<Suspense fallback={<PageSkeleton />}><RouteTransition><NotFound /></RouteTransition></Suspense>} />
    </Routes>
  );
}

// ─── Root App ──────────────────────────────────────────────────────────────────
const App = () => (
  <>
    <ToastContainer />
    <ErrorBoundary>
      <Router>
        <ChunkErrorBoundary>
          <AppRoutes />
        </ChunkErrorBoundary>
      </Router>
    </ErrorBoundary>
  </>
);

export default App;
