import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import CandidateProfile from './pages/CandidateProfile';
import Candidates from './pages/Candidates';
import JobsManager from './pages/JobsManager';
import InterviewSchedule from './pages/InterviewSchedule';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import PublicCareers from './pages/PublicCareers';
import Team from './pages/Team';
import SignupPage from './pages/SignupPage';
import Sourcing from './pages/Sourcing';
import Referrals from './pages/Referrals';
import ProtectedRoute from './components/ProtectedRoute';
import SalesLayout from './pages/Sales/SalesLayout';
import SalesDashboard from './pages/Sales/SalesDashboard';
import ProductList from './pages/Sales/ProductList';
import SalesTracker from './pages/Sales/SalesTracker';
import SalesSettings from './pages/Sales/SalesSettings';
import SalesCandidates from './pages/Sales/SalesCandidates';
import SalesTeam from './pages/Sales/SalesTeam';
import WorkspaceSelector from './pages/WorkspaceSelector';

const ALL_ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'];
const ADMIN_RECRUITER = ['SUPER_ADMIN', 'RECRUITER'];
const protectedElement = (element, allowedRoles = ALL_ROLES) => <ProtectedRoute allowedRoles={allowedRoles}>{element}</ProtectedRoute>;

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route path="/workspaces" element={protectedElement(<WorkspaceSelector />)} />
        <Route path="/dashboard" element={protectedElement(<Dashboard />)} />
        <Route path="/pipeline" element={protectedElement(<Pipeline />)} />
        <Route path="/candidates" element={protectedElement(<Candidates />)} />
        <Route path="/candidate/:id" element={protectedElement(<CandidateProfile />)} />
        <Route path="/jobs" element={protectedElement(<JobsManager />)} />
        <Route path="/schedule" element={protectedElement(<InterviewSchedule />)} />
        <Route path="/analytics" element={protectedElement(<Analytics />)} />
        <Route path="/sourcing" element={protectedElement(<Sourcing />)} />
        <Route path="/referrals" element={protectedElement(<Referrals />)} />
        <Route path="/reports" element={protectedElement(<Reports />, ADMIN_RECRUITER)} />
        <Route path="/settings" element={protectedElement(<Settings />)} />
        <Route path="/careers" element={<PublicCareers />} />
        <Route path="/team" element={protectedElement(<Team />, ADMIN_RECRUITER)} />

        <Route path="/sales" element={protectedElement(<SalesLayout />, ADMIN_RECRUITER)}>
          <Route index element={<SalesDashboard />} />
          <Route path="products" element={<ProductList />} />
          <Route path="candidates" element={<SalesCandidates />} />
          <Route path="tracker" element={<SalesTracker />} />
          <Route path="team" element={<SalesTeam />} />
          <Route path="settings" element={<SalesSettings />} />
        </Route>
      </Routes>
    </Router>
  );
};

export default App;
