import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 font-[Inter]">
      <div className="bg-white p-10 rounded-3xl border border-slate-200/80 shadow-sm max-w-md text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 text-blue-600">
          <span className="material-symbols-outlined text-3xl">route</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">404 — Page Not Found</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            The page you are looking for doesn't exist, has been moved, or was typed incorrectly.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center gap-2 h-11 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-100 transition-all"
        >
          <span className="material-symbols-outlined text-sm">home</span>
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
