import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { hasToken } from '../lib/api';

const earthImage =
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1800&q=80";

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || 'Login failed. Please check credentials.');
      }

      localStorage.setItem('ats_token', result.data.token);
      localStorage.setItem('ats_user', JSON.stringify(result.data.user));
      navigate('/workspaces');
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <motion.section
        className="relative hidden lg:block overflow-hidden"
        initial={{ backgroundPosition: 'center 42%' }}
        animate={{ backgroundPosition: ['center 42%', 'center 56%', 'center 42%'] }}
        transition={{ duration: 42, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          backgroundImage:
            `linear-gradient(135deg, rgba(5, 29, 91, 0.96), rgba(20, 61, 182, 0.88)), url('${earthImage}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 42%',
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(120,160,255,.2),transparent_45%)]" />

        <div className="absolute inset-0 pointer-events-none">
          {[0, 1, 2, 3, 4].map((idx) => (
            <motion.span
              key={idx}
              className="absolute w-2 h-2 rounded-full bg-[#bdd2ff]/70"
              style={{ left: `${15 + idx * 14}%`, top: `${24 + (idx % 3) * 18}%` }}
              animate={{ y: [0, -10, 0], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 7 + idx, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>

        <div className="relative z-10 h-full p-16 text-white flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-12">
            <div className="h-10 w-10 rounded-lg bg-white text-[#1f52cc] flex items-center justify-center">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>hub</span>
            </div>
            <div className="text-5xl font-bold font-[Manrope]">ATS</div>
          </div>

          <h1 className="text-6xl leading-[1.1] font-bold font-[Manrope] max-w-xl">
            Architect the future of your <span className="text-[#b8c9ff]">global workforce.</span>
          </h1>

          <p className="mt-6 text-xl text-[#d7e2ff] max-w-xl leading-relaxed">
            The intelligence layer for high-growth enterprises to discover, nurture, and scale elite talent through data-driven insights.
          </p>

          <div className="grid grid-cols-2 gap-4 mt-10 max-w-xl">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5">
              <div className="text-4xl font-bold">98%</div>
              <div className="text-sm text-[#ccdaff] mt-1">Placement Accuracy</div>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5">
              <div className="text-4xl font-bold">12M+</div>
              <div className="text-sm text-[#ccdaff] mt-1">Verified Profiles</div>
            </div>
          </div>
        </div>
      </motion.section>

      <section className="flex items-center justify-center p-6 md:p-12 relative">
        <button
          className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-1 text-sm text-[#5d6784] hover:text-[#1f4bc6] transition-colors"
          type="button"
          onClick={() => navigate('/')}
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span> Home
        </button>
        <form className="w-full max-w-md" onSubmit={handleLogin}>
          <h2 className="text-5xl font-bold text-[#121a33] font-[Manrope]">Welcome Back</h2>
          <p className="mt-3 text-lg text-[#5d6784]">
            Enter your credentials to access the talent architecture console.
          </p>

          {hasToken() ? (
            <div className="mt-6 p-4 rounded-xl border border-[#dbe4ee] bg-[#f8fbff] text-center">
              <p className="text-sm text-[#0f1b3d] font-semibold mb-2">You already have an active session</p>
              <button className="os-btn-primary w-full h-11 text-base flex justify-center items-center gap-2" type="button" onClick={() => navigate('/workspaces')}>
                Enter System Workspace <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 mt-6">
            <button className="os-btn-outline flex items-center justify-center gap-2" type="button"><span className="text-xs">G</span> Google</button>
            <button className="os-btn-outline flex items-center justify-center gap-2" type="button"><span className="text-xs">GH</span> GitHub</button>
          </div>

          <div className="mt-6 text-center text-xs tracking-[.2em] uppercase text-[#8b94a9]">or continue with email</div>

          <div className="mt-6 space-y-4">
            <input
              className="w-full h-12 rounded-xl border border-[#e2e8ef] bg-[#f3f6f8] px-4 text-sm"
              placeholder="Email Address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="relative">
              <input
                className="w-full h-12 rounded-xl border border-[#e2e8ef] bg-[#f3f6f8] px-4 pr-10 text-sm"
                placeholder="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b86a1] cursor-pointer select-none"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </span>
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          <div className="mt-4 flex justify-between items-center text-sm text-[#4f5a77]">
            <label className="flex gap-2 items-center"><input type="checkbox" /> Remember device</label>
            <a href="#" className="text-[#1f4bc6] font-semibold">Forgot password?</a>
          </div>

          <button className="os-btn-primary w-full mt-5 h-12 text-base" type="submit" disabled={isLoading}>
            {isLoading ? 'Signing In...' : 'Sign In to OS'}
          </button>

          <div className="mt-6 text-center text-sm text-[#606b87]">
            New to ATS? <a className="text-[#1f4bc6] font-semibold" href="/signup">Request access</a>
          </div>

          <div className="mt-10 flex justify-center gap-6 text-xs text-[#9aa3b8]">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Security</a>
          </div>
        </form>
      </section>
    </div>
  );
};

export default LoginPage;
