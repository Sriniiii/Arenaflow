import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F4F7F6] text-[#172033] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full pro-card p-8 space-y-6 shadow-sm">
        <div className="w-14 h-14 bg-[#E8F5F0] border border-[#C4E9DC] text-[#14966B] rounded-xl flex items-center justify-center mx-auto text-2xl font-bold font-mono">
          404
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-[#172033]">Page Not Found</h1>
          <p className="text-[#667085] text-xs leading-relaxed">
            The tournament, match, or resource you are looking for does not exist or has been moved.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/dashboard"
            className="btn-primary block w-full py-2.5 text-xs font-semibold text-center"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
