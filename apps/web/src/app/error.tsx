'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled Application Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#F4F7F6] text-[#172033] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full pro-card p-8 space-y-6 shadow-sm">
        <div className="w-14 h-14 bg-[#FDF0F0] border border-[#FDA29B] text-[#B42318] rounded-xl flex items-center justify-center mx-auto text-2xl">
          ⚠️
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-[#172033]">Something went wrong</h1>
          <p className="text-[#667085] text-xs leading-relaxed">
            An unexpected error occurred while loading this page. Please try again or return to the dashboard.
          </p>
          {error.message && (
            <p className="text-xs font-mono bg-[#F9FAFB] text-[#B42318] p-3 rounded-md border border-[#EAECF0] overflow-x-auto text-left">
              {error.message}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 btn-primary py-2.5 text-xs font-semibold"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="flex-1 btn-secondary py-2.5 text-xs font-semibold text-center flex items-center justify-center"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
