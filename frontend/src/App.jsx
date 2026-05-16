import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { getStoredUser } from './lib/api';

// Lazy loading components
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const RecruiterDashboard = lazy(() => import('./pages/RecruiterDashboard'));
// const Pipeline = lazy(() => import('./pages/Pipeline'));
const CandidateProfile = lazy(() => import('./pages/CandidateProfile'));
const Candidates = lazy(() => import('./pages/Candidates'));
const JobsManager = lazy(() => import('./pages/JobsManager'));
const JobDetailModule = lazy(() => import('./pages/JobDetailModule'));
const InterviewSchedule = lazy(() => import('./pages/InterviewSchedule'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Reports = lazy(() => import('./pages/Reports'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Settings = lazy(() => import('./pages/Settings'));
const PublicCareers = lazy(() => import('./pages/PublicCareers'));
const Team = lazy(() => import('./pages/Team'));
const Drives = lazy(() => import('./pages/Drives'));


// const Sourcing = lazy(() => import('./pages/Sourcing'));
// const Referrals = lazy(() => import('./pages/Referrals'));
const WorkspaceSelector = lazy(() => import('./pages/WorkspaceSelector'));

// Sales Module
const SalesLayout = lazy(() => import('./pages/Sales/SalesLayout'));
const SalesDashboard = lazy(() => import('./pages/Sales/SalesDashboard'));
const ProductList = lazy(() => import('./pages/Sales/ProductList'));
const SalesTracker = lazy(() => import('./pages/Sales/SalesTracker'));
const SalesSettings = lazy(() => import('./pages/Sales/SalesSettings'));
const SalesCandidates = lazy(() => import('./pages/Sales/SalesCandidates'));
const SalesTeam = lazy(() => import('./pages/Sales/SalesTeam'));

const ALL_ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-slate-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-slate-500 font-medium animate-pulse">Loading ATS Tracker...</p>
    </div>
  </div>
);

const protectedElement = (element, allowedRoles = ALL_ROLES) => (
  <ProtectedRoute allowedRoles={allowedRoles}>{element}</ProtectedRoute>
);

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30 seconds — data considered fresh
      gcTime: 5 * 60 * 1000,       // 5 minutes — keep in cache after unmount
      retry: 1,                     // retry failed queries once
      refetchOnWindowFocus: false,  // do not refetch on tab switch
      refetchOnMount: false,        // use cache if within staleTime
    },
    mutations: {
      retry: 0
    }
  }
});

const App = () => {
  const currentUser = getStoredUser();
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />


          <Route path="/workspaces" element={protectedElement(<WorkspaceSelector />)} />
          <Route path="/dashboard" element={
            currentUser?.role === 'RECRUITER' 
              ? protectedElement(<RecruiterDashboard />) 
              : protectedElement(<Dashboard />)
          } />
          {/* <Route path="/pipeline" element={protectedElement(<Pipeline />)} /> */}
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
    </QueryClientProvider>
  );
};

export default App;
