import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { getStoredUser } from './lib/api';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy loading with retry for chunk load errors
const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      const isChunkError =
        error.name === 'ChunkLoadError' ||
        /failed to fetch/i.test(error.message) ||
        /loading chunk/i.test(error.message) ||
        /dynamically imported module/i.test(error.message);

      if (isChunkError) {
        console.warn('Chunk load failed, reloading page to get the latest scripts...', error);
        window.location.reload();
        return new Promise(() => {}); // Keep in pending state until reload triggers
      }
      throw error;
    }
  });

// Lazy loading components with retry
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage'));
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const SignupPage = lazyWithRetry(() => import('./pages/SignupPage'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const CandidateProfile = lazyWithRetry(() => import('./pages/CandidateProfile'));
const Candidates = lazyWithRetry(() => import('./pages/Candidates'));
const JobsManager = lazyWithRetry(() => import('./pages/JobsManager'));
const JobDetailModule = lazyWithRetry(() => import('./pages/JobDetailModule'));
const InterviewSchedule = lazyWithRetry(() => import('./pages/InterviewSchedule'));
const Analytics = lazyWithRetry(() => import('./pages/Analytics'));
const Reports = lazyWithRetry(() => import('./pages/Reports'));
const AuditLogs = lazyWithRetry(() => import('./pages/AuditLogs'));
const Settings = lazyWithRetry(() => import('./pages/Settings'));
const PublicCareers = lazyWithRetry(() => import('./pages/PublicCareers'));
const Team = lazyWithRetry(() => import('./pages/Team'));
const Drives = lazyWithRetry(() => import('./pages/Drives'));
const WorkspaceSelector = lazyWithRetry(() => import('./pages/WorkspaceSelector'));

// Sales Module
const SalesLayout = lazyWithRetry(() => import('./pages/Sales/SalesLayout'));
const SalesDashboard = lazyWithRetry(() => import('./pages/Sales/SalesDashboard'));
const ProductList = lazyWithRetry(() => import('./pages/Sales/ProductList'));
const SalesTracker = lazyWithRetry(() => import('./pages/Sales/SalesTracker'));
const SalesSettings = lazyWithRetry(() => import('./pages/Sales/SalesSettings'));
const SalesCandidates = lazyWithRetry(() => import('./pages/Sales/SalesCandidates'));
const SalesTeam = lazyWithRetry(() => import('./pages/Sales/SalesTeam'));

const ALL_ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];

import PageSkeleton from './components/PageSkeleton';

const protectedElement = (element, allowedRoles = ALL_ROLES) => (
  <ProtectedRoute allowedRoles={allowedRoles}>{element}</ProtectedRoute>
);

import ToastContainer from './components/ToastContainer';

const App = () => {
  const currentUser = getStoredUser();
  return (
    <>
      <ToastContainer />
      <ErrorBoundary>
        <Router>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />

              <Route path="/workspaces" element={protectedElement(<WorkspaceSelector />)} />
              <Route path="/dashboard" element={protectedElement(<Dashboard />)} />
              <Route path="/candidates" element={protectedElement(<Candidates />)} />
              <Route path="/candidate/:id" element={protectedElement(<CandidateProfile />)} />
              <Route path="/jobs" element={protectedElement(<JobsManager />)} />
              <Route path="/jobs/:id" element={protectedElement(<JobDetailModule />)} />
              <Route path="/schedule" element={protectedElement(<InterviewSchedule />)} />
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
            </Routes>
          </Suspense>
        </Router>
      </ErrorBoundary>
    </>
  );
};

export default App;

