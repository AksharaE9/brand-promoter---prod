import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { getStoredUser } from './lib/api';
import ErrorBoundary from './components/ErrorBoundary';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import { lazyWithRetry } from './lib/lazyWithRetry';

// Lazy loading components with retry
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage'), 'LandingPage');
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'LoginPage');
const SignupPage = lazyWithRetry(() => import('./pages/SignupPage'), 'SignupPage');
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'), 'Dashboard');
const CandidateProfile = lazyWithRetry(() => import('./pages/CandidateProfile'), 'CandidateProfile');
const Candidates = lazyWithRetry(() => import('./pages/Candidates'), 'Candidates');
const JobsManager = lazyWithRetry(() => import('./pages/JobsManager'), 'JobsManager');
const JobDetailModule = lazyWithRetry(() => import('./pages/JobDetailModule'), 'JobDetailModule');
const InterviewSchedule = lazyWithRetry(() => import('./pages/InterviewSchedule'), 'InterviewSchedule');
const Analytics = lazyWithRetry(() => import('./pages/Analytics'), 'Analytics');
const Reports = lazyWithRetry(() => import('./pages/Reports'), 'Reports');
const AuditLogs = lazyWithRetry(() => import('./pages/AuditLogs'), 'AuditLogs');
const Settings = lazyWithRetry(() => import('./pages/Settings'), 'Settings');
const PublicCareers = lazyWithRetry(() => import('./pages/PublicCareers'), 'PublicCareers');
const Team = lazyWithRetry(() => import('./pages/Team'), 'Team');
const Drives = lazyWithRetry(() => import('./pages/Drives'), 'Drives');
const WorkspaceSelector = lazyWithRetry(() => import('./pages/WorkspaceSelector'), 'WorkspaceSelector');
const SchedulingPage = lazyWithRetry(() => import('./pages/Scheduling/SchedulingPage'), 'SchedulingPage');
const MemberProfilePage = lazyWithRetry(() => import('./pages/Scheduling/MemberProfilePage'), 'MemberProfilePage');
const NotFound = lazyWithRetry(() => import('./pages/NotFound'), 'NotFound');

// Sales Module
const SalesLayout = lazyWithRetry(() => import('./pages/Sales/SalesLayout'), 'SalesLayout');
const SalesDashboard = lazyWithRetry(() => import('./pages/Sales/SalesDashboard'), 'SalesDashboard');
const ProductList = lazyWithRetry(() => import('./pages/Sales/ProductList'), 'ProductList');
const SalesTracker = lazyWithRetry(() => import('./pages/Sales/SalesTracker'), 'SalesTracker');
const SalesSettings = lazyWithRetry(() => import('./pages/Sales/SalesSettings'), 'SalesSettings');
const SalesCandidates = lazyWithRetry(() => import('./pages/Sales/SalesCandidates'), 'SalesCandidates');
const SalesTeam = lazyWithRetry(() => import('./pages/Sales/SalesTeam'), 'SalesTeam');

const ALL_ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];

import PageSkeleton from './components/PageSkeleton';

const protectedElement = (element, allowedRoles = ALL_ROLES) => (
  <ProtectedRoute allowedRoles={allowedRoles}>{element}</ProtectedRoute>
);

import ToastContainer from './components/ToastContainer';

const App = () => {
  const currentUser = getStoredUser();

  React.useEffect(() => {
    const prefetchSecondaryRoutes = () => {
      const user = getStoredUser();
      if (user) {
        // Quietly download secondary route JS chunks in background
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
      window.requestIdleCallback(prefetchSecondaryRoutes, { timeout: 10_000 });
    } else {
      setTimeout(prefetchSecondaryRoutes, 2000);
    }
  }, []);

  return (
    <>
      <ToastContainer />
      <ErrorBoundary>
        <Router>
          <ChunkErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />

                <Route path="/workspaces" element={protectedElement(<WorkspaceSelector />)} />
                <Route path="/dashboard" element={protectedElement(<Dashboard />)} />
                <Route path="/candidates" element={protectedElement(<Candidates />)} />
                <Route path="/candidate/:id" element={protectedElement(<CandidateProfile />)} />
                <Route path="/candidates/:id" element={protectedElement(<CandidateProfile />)} />
                <Route path="/jobs" element={protectedElement(<JobsManager />)} />
                <Route path="/jobs/:id" element={protectedElement(<JobDetailModule />)} />
                <Route path="/schedule" element={protectedElement(<InterviewSchedule />)} />
                <Route path="/scheduling" element={protectedElement(<SchedulingPage />)} />
                <Route path="/scheduling/members/:memberId" element={protectedElement(<MemberProfilePage />)} />
                <Route path="/drives" element={protectedElement(<Drives />)} />

                <Route path="/analytics" element={protectedElement(<Analytics />, ['SUPER_ADMIN'])} />
                <Route path="/reports" element={protectedElement(<Reports />, ['SUPER_ADMIN'])} />
                <Route path="/audit" element={protectedElement(<AuditLogs />, ['SUPER_ADMIN'])} />
                <Route path="/settings" element={protectedElement(<Settings />)} />
                <Route path="/careers" element={<PublicCareers />} />
                <Route path="/team" element={protectedElement(<Team />, ['SUPER_ADMIN'])} />

                <Route path="/sales" element={protectedElement(<SalesLayout />, ADMIN_RECRUITER)}>
                  <Route index element={<SalesDashboard />} />
                  <Route path="products" element={<ProductList />} />
                  <Route path="candidates" element={<SalesCandidates />} />
                  <Route path="tracker" element={<SalesTracker />} />
                  <Route path="team" element={<SalesTeam />} />
                  <Route path="settings" element={<SalesSettings />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ChunkErrorBoundary>
        </Router>
      </ErrorBoundary>
    </>
  );
};

export default App;

