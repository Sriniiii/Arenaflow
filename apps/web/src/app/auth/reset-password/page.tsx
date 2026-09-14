'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../services/supabase';
import { resetPasswordSchema } from '@arena-flow/validation';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyingSession, setVerifyingSession] = useState(true);
  const [isRecoverySessionValid, setIsRecoverySessionValid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    // Check for error parameters in URL query or hash
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const error = searchParams.get('error') || hashParams.get('error');
      const errorCode = searchParams.get('error_code') || hashParams.get('error_code');

      if (error || errorCode) {
        console.warn('Recovery URL contains error:', error, errorCode);
        if (isMounted) {
          setIsRecoverySessionValid(false);
          setVerifyingSession(false);
        }
        return;
      }
    }

    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
          // Listen for onAuthStateChange in case session is currently being established via hash/code
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
            if (!isMounted) return;
            if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && newSession)) {
              setIsRecoverySessionValid(true);
              setVerifyingSession(false);
            }
          });

          // Wait a short timeout before declaring invalid if no session event fires
          setTimeout(() => {
            if (isMounted && verifyingSession) {
              supabase.auth.getSession().then(({ data: { session: recheck } }) => {
                if (isMounted) {
                  setIsRecoverySessionValid(!!recheck);
                  setVerifyingSession(false);
                }
              });
            }
          }, 1200);

          return () => {
            subscription.unsubscribe();
          };
        } else {
          if (isMounted) {
            setIsRecoverySessionValid(true);
            setVerifyingSession(false);
          }
        }
      } catch (err) {
        console.error('Session verification error:', err);
        if (isMounted) {
          setIsRecoverySessionValid(false);
          setVerifyingSession(false);
        }
      }
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setMessage(null);
    setIsError(false);

    // Validate inputs
    const result = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
      setIsError(true);
      setMessage(result.error.errors[0]?.message || 'Please ensure passwords match and are at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      setIsSuccess(true);
      setMessage('Password updated successfully! Redirecting to sign in...');

      // Cleanly clear temporary recovery session
      await supabase.auth.signOut();

      setTimeout(() => {
        router.push('/auth/login');
      }, 1500);
    } catch (err: any) {
      console.error('Password update error:', err);
      setIsError(true);
      setMessage(err.message || 'Failed to update password. Please request a new recovery link.');
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
            <h1 className="text-xl font-extrabold text-[#0F172A]">Create New Password</h1>
            <p className="text-xs text-[#64748B]">
              Please choose a secure new password for your account
            </p>
          </div>

          {verifyingSession ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-6 h-6 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-[#64748B]">Verifying recovery link...</p>
            </div>
          ) : !isRecoverySessionValid ? (
            <div className="space-y-4">
              <div
                className="p-3.5 rounded-lg text-xs font-medium border bg-[#FDF0F0]/90 border-[#FDA29B] text-[#B42318] backdrop-blur-md"
                role="alert"
              >
                This password reset link is invalid or has expired. Please request a new one.
              </div>
              <Link
                href="/auth/forgot-password"
                className="btn-primary w-full py-2.5 min-h-[44px] flex items-center justify-center"
              >
                Request New Reset Link
              </Link>
            </div>
          ) : (
            <>
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

              {!isSuccess && (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label
                      className="block text-xs font-semibold text-[#334155] mb-1.5"
                      htmlFor="new-password-input"
                    >
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        id="new-password-input"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        className="arena-input w-full pr-12"
                        disabled={loading}
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
                    <label
                      className="block text-xs font-semibold text-[#334155] mb-1.5"
                      htmlFor="confirm-password-input"
                    >
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <input
                        id="confirm-password-input"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        className="arena-input w-full pr-12"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition"
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? 'Hide' : 'Show'}
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
                        Updating Password...
                      </>
                    ) : (
                      'Update Password'
                    )}
                  </button>
                </form>
              )}
            </>
          )}

          <div className="pt-4 border-t border-slate-200/80 text-center text-xs text-[#64748B]">
            <Link href="/auth/login" className="text-[#14966B] hover:underline font-semibold">
              Return to Sign In
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
