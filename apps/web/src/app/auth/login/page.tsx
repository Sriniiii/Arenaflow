'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../services/supabase';
import { useAuth } from '../../../context/AuthContext';

export default function LoginPage() {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(redirectTarget);
    }
  }, [user, authLoading, router, redirectTarget]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      setMessage('Login successful! Redirecting...');
      router.push(redirectTarget);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-transparent text-[#0F172A] px-4 py-8">
      {/* Top Header */}
      <header className="max-w-7xl mx-auto w-full flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[#14966B] flex items-center justify-center font-bold text-white text-xs shadow-xs">
            AF
          </div>
          <span className="text-base font-bold tracking-tight text-[#0F172A]">
            ARENAFLOW
          </span>
        </Link>
        <Link
          href="/"
          className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition"
        >
          ← Back to Home
        </Link>
      </header>

      {/* Main Form Card */}
      <main className="w-full max-w-md mx-auto my-auto py-8">
        <div className="pro-glass-primary p-8 space-y-6 shadow-sm rounded-2xl">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-extrabold text-[#0F172A]">Sign In to ArenaFlow</h1>
            <p className="text-xs text-[#64748B]">Access tournament operations and live scoring consoles</p>
          </div>

          {message && (
            <div
              className={`p-3 rounded-lg text-xs font-medium border backdrop-blur-md ${
                isError
                  ? 'bg-[#FDF0F0]/90 border-[#FDA29B] text-[#B42318]'
                  : 'bg-emerald-50/90 border-emerald-200 text-[#14966B]'
              }`}
              role="alert"
            >
              {message}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5" htmlFor="email-input">
                Email Address
              </label>
              <input
                id="email-input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="arena-input w-full"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-[#334155]" htmlFor="password-input">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-semibold text-[#14966B] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="arena-input w-full pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 min-h-[44px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-200/80 text-center text-xs text-[#64748B]">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-[#14966B] hover:underline font-semibold">
              Create an account
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-[#94A3B8]">
        ArenaFlow Tournament Platform • Secured Authentication
      </footer>
    </div>
  );
}
