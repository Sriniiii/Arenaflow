'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PlayerPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center">
      <div className="pro-glass-primary p-6 rounded-2xl text-center space-y-3 shadow-xs">
        <div className="w-6 h-6 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs font-semibold text-[#64748B]">Redirecting to Player Portal...</p>
      </div>
    </div>
  );
}
