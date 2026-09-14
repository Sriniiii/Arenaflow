export default function Loading() {
  return (
    <div className="min-h-screen bg-[#F4F7F6] flex flex-col items-center justify-center p-6" role="status" aria-label="Loading content">
      <div className="flex flex-col items-center space-y-3">
        <div className="relative flex items-center justify-center">
          <div className="w-10 h-10 rounded-full border-3 border-[#E4E7EC] border-t-[#14966B] animate-spin" />
        </div>
        <p className="text-[#667085] text-xs font-semibold tracking-wide">Loading ArenaFlow...</p>
      </div>
    </div>
  );
}
