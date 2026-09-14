'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../services/supabase';
import { forgotPasswordSchema } from '@arena-flow/validation';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setMessage(null);
    setIsError(false);

    // Validate email
    const result = forgotPasswordSchema.safeParse({ email: email.trim() });
    if (!result.success) {
      setIsError(true);
      setMessage(result.error.errors[0]?.message || 'Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const redirectUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/auth/reset-password`
          : 'http://localhost:3000/auth/reset-password';

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      });

      if (error) {
        // Log error internally but return generic safe message to prevent enumeration unless rate limit
        console.warn('Password recovery request status:', error.message);
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
          setIsError(true);
          setMessage('Too many requests. Please wait a few minutes before trying again.');
          return;
        }
      }

      // Always show generic safe response to prevent user enumeration
      setSubmitted(true);
      setIsError(false);
      setMessage('If an account exists for this email, a password reset link has been sent.');
    } catch (err: any) {
      console.error('Password reset error:', err);
      // Even on non-rate-limit error, display safe response
      setSubmitted(true);
      setIsError(false);
      setMessage('If an account exists for this email, a password reset link has been sent.');
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
          href="/auth/login"
          className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition"
        >
          ← Back to Sign In
        </Link>
      </header>

      {/* Main Form Card */}
      <main className="w-full max-w-md mx-auto my-auto py-8">
        <div className="pro-glass-primary p-8 space-y-6 shadow-sm rounded-2xl">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-extrabold text-[#0F172A]">Reset Your Password</h1>
            <p className="text-xs text-[#64748B]">
              Enter your account email and we will send a password reset link
            </p>
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

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  className="block text-xs font-semibold text-[#334155] mb-1.5"
                  htmlFor="forgot-email-input"
                >
                  Email Address
                </label>
                <input
                  id="forgot-email-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="arena-input w-full"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5 min-h-[44px] flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending Reset Link...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-[#64748B] leading-relaxed">
                Please check your inbox for instructions to reset your password. If you don&apos;t see the email, check your spam or junk folder.
              </p>
              <div className="pt-2">
                <Link
                  href="/auth/login"
                  className="btn-primary w-full py-2.5 min-h-[44px] flex items-center justify-center"
                >
                  Return to Sign In
                </Link>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200/80 text-center text-xs text-[#64748B]">
            Remember your password?{' '}
            <Link href="/auth/login" className="text-[#14966B] hover:underline font-semibold">
              Sign In
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-[#94A3B8]">
        ArenaFlow Tournament Platform • Account Recovery & Security
      </footer>
    </div>
  );
}
