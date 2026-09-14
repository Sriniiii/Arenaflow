'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../services/supabase';
import { useAuth } from '../../../context/AuthContext';

export default function SignupPage() {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'PLAYER' | 'ORGANIZER'>('PLAYER');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, authLoading, router]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role: role,
          },
        },
      });

      if (error) throw error;

      if (data?.session) {
        setMessage('Account created! Entering Dashboard...');
        setTimeout(() => {
          router.push('/dashboard');
        }, 300);
      } else if (data?.user) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        setMessage('Account created! Entering Dashboard...');
        setTimeout(() => {
          router.push('/dashboard');
        }, 300);
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Registration failed. Please check your information.');
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
            <h1 className="text-xl font-extrabold text-[#0F172A]">Create ArenaFlow Account</h1>
            <p className="text-xs text-[#64748B]">Join players and organizers across competitive badminton tournaments</p>
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

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5" htmlFor="name-input">
                Full Name
              </label>
              <input
                id="name-input"
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Alex Chen"
                className="arena-input w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5" htmlFor="signup-email">
                Email Address
              </label>
              <input
                id="signup-email"
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
              <label className="block text-xs font-semibold text-[#334155] mb-1.5" htmlFor="signup-password">
                Password
              </label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
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

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5" htmlFor="role-select">
                Account Purpose
              </label>
              <select
                id="role-select"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="arena-select w-full"
              >
                <option value="PLAYER">Player (Register & participate in brackets)</option>
                <option value="ORGANIZER">Organizer (Create & operate tournaments)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 min-h-[44px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-200/80 text-center text-xs text-[#64748B]">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-[#14966B] hover:underline font-semibold">
              Sign In
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-[#94A3B8]">
        ArenaFlow Tournament Platform • Secured Registration
      </footer>
    </div>
  );
}
