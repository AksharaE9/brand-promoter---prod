import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { apiGet, clearAuth, getStoredUser, hasToken } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

// Keep track of the single verification promise to prevent duplicate concurrent network requests
let _verifyPromise = null;

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const location = useLocation();
  const { isVerified, setVerified } = useAuthStore();

  const [status, setStatus] = useState(() => {
    if (isVerified) return 'authorized';
    if (!hasToken()) return 'unauthorized';
    return 'checking';
  });

  useEffect(() => {
    if (isVerified) {
      setStatus('authorized');
      return;
    }
    if (!hasToken()) {
      setStatus('unauthorized');
      return;
    }

    let mounted = true;

    // Start or reuse the auth verification promise
    if (!_verifyPromise) {
      _verifyPromise = apiGet('/auth/me')
        .then(() => {
          setVerified(true);
          _verifyPromise = null;
          return 'authorized';
        })
        .catch(() => {
          clearAuth();
          _verifyPromise = null;
          return 'unauthorized';
        });
    }

    _verifyPromise.then((result) => {
      if (mounted) setStatus(result);
    });

    return () => {
      mounted = false;
    };
  }, [isVerified, setVerified]);

  if (status === 'checking') {
    return (
      <div
        className="min-h-screen bg-[#eef3f3] flex items-center justify-center"
        aria-busy="true"
        aria-label="Loading page..."
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#1f52cc] flex items-center justify-center animate-pulse">
            <span className="material-symbols-outlined text-white text-xl">dashboard</span>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[#1f52cc] animate-bounce"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unauthorized') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const currentUser = getStoredUser();
  if (allowedRoles.length > 0 && !allowedRoles.includes(currentUser?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
