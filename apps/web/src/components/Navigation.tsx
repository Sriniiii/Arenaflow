'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import NotificationDropdown from './NotificationDropdown';

export default function Navigation() {
  const { user, profile, signOut } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => pathname === path;
  const isOrganizer = profile?.role === 'ORGANIZER' || profile?.role === 'PLATFORM_ADMIN';

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
    window.location.href = '/auth/login';
  };

  const userInitial = (profile?.fullName || profile?.displayName || user?.email || 'U')
    .trim()
    .charAt(0)
    .toUpperCase();

  const roleLabel = profile?.role || (user ? 'PLAYER' : '');

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'ORGANIZER':
      case 'PLATFORM_ADMIN':
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
      case 'SCORER':
      case 'TOURNAMENT_ADMIN':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      default:
        return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
    }
  };

  return (
    <nav
      className="bg-white/75 backdrop-blur-xl border-b border-white/80 sticky top-0 z-50 px-4 sm:px-6 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.035)]"
      role="navigation"
      aria-label="Main Navigation"
    >
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* Brand Logo & Context */}
        <div className="flex items-center space-x-6 sm:space-x-8">
          <Link
            href={user ? '/dashboard' : '/'}
            className="flex items-center gap-2.5 group"
            aria-label={user ? 'ArenaFlow Application Home' : 'ArenaFlow Marketing Home'}
          >
            <div className="w-8 h-8 rounded-xl bg-[#14966B] flex items-center justify-center font-bold text-white text-xs shadow-sm group-hover:bg-[#10805B] transition duration-150">
              AF
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-[#0F172A]">
                ARENAFLOW
              </span>
              {user && (
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-slate-100/80 text-slate-600 border border-slate-200/80">
                  APP
                </span>
              )}
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center space-x-1">
            {user ? (
              // --------------------------------------------------
              // AUTHENTICATED APPLICATION NAVIGATION
              // --------------------------------------------------
              <>
                <Link
                  href="/dashboard"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 ${
                    isActive('/dashboard')
                      ? 'bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/20 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  Dashboard
                </Link>
                <Link
                  href="/dashboard#tournaments"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/80 transition duration-150"
                >
                  Tournaments
                </Link>
                <Link
                  href="/dashboard#matches"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/80 transition duration-150"
                >
                  Live Matches
                </Link>
                <Link
                  href="/player"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 ${
                    isActive('/player')
                      ? 'bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/20 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  Player Portal
                </Link>
                {isOrganizer && (
                  <Link
                    href="/tournaments/create"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 ${
                      isActive('/tournaments/create')
                        ? 'bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/20 shadow-2xs'
                        : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/70 font-semibold'
                    }`}
                  >
                    + Create Tournament
                  </Link>
                )}
                <div className="h-4 w-[1px] bg-slate-200/80 mx-1" />
                <Link
                  href="/"
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-800 hover:bg-white/80 transition duration-150"
                  title="View Public Marketing Website"
                >
                  Website
                </Link>
              </>
            ) : (
              // --------------------------------------------------
              // PUBLIC MARKETING NAVIGATION
              // --------------------------------------------------
              <>
                <Link
                  href="/"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 ${
                    isActive('/')
                      ? 'bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/20 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  Explore
                </Link>
                <Link
                  href="/#live-tournaments"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/80 transition duration-150"
                >
                  Live Tournaments
                </Link>
                <Link
                  href="/#features"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/80 transition duration-150"
                >
                  Features
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Right Side Controls */}
        <div className="hidden md:flex items-center space-x-3">
          {user ? (
            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <NotificationDropdown />

              {/* User Profile Pill */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200/80">
                <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 font-bold text-xs flex items-center justify-center border border-emerald-200 shadow-2xs">
                  {userInitial}
                </div>
                <div className="text-left">
                  <span className="block text-xs font-semibold text-[#0F172A] max-w-[140px] truncate leading-tight">
                    {profile?.fullName || profile?.displayName || user.email}
                  </span>
                  <span
                    className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border ${getRoleBadgeStyle(
                      roleLabel
                    )}`}
                  >
                    {roleLabel}
                  </span>
                </div>
              </div>

              {/* Sign Out Button */}
              <button
                onClick={handleSignOut}
                className="bg-white/80 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 transition duration-150 shadow-2xs cursor-pointer ml-1"
                aria-label="Sign Out"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2.5">
              <Link
                href="/auth/login"
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 px-3.5 py-1.5 rounded-lg hover:bg-white/80 border border-transparent transition duration-150"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="bg-[#14966B] hover:bg-[#10805B] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition duration-150 shadow-xs"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Hamburger Button + Notification Icon */}
        <div className="flex md:hidden items-center gap-2">
          {user && <NotificationDropdown />}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 min-h-[44px] min-w-[44px] rounded-xl bg-white/80 border border-white/90 text-slate-700 hover:text-slate-900 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#14966B] cursor-pointer shadow-2xs"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-[#E4E7EC] flex flex-col space-y-1.5 pb-2">
          {user ? (
            <>
              {/* Authenticated User Banner */}
              <div className="p-3 bg-[#F8FAF9] rounded-xl border border-[#E4E7EC] flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#E8F6F0] text-[#14966B] font-bold text-xs flex items-center justify-center border border-[#C4E9DC]">
                    {userInitial}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#172033] truncate max-w-[180px]">
                      {profile?.fullName || profile?.displayName || user.email}
                    </div>
                    <div className="text-[10px] text-[#667085] truncate max-w-[180px]">
                      {user.email}
                    </div>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${getRoleBadgeStyle(
                    roleLabel
                  )}`}
                >
                  {roleLabel}
                </span>
              </div>

              {/* Navigation Links */}
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2.5 rounded-lg text-sm font-semibold transition flex items-center min-h-[44px] ${
                  isActive('/dashboard') ? 'bg-[#E8F6F0] text-[#14966B] font-bold' : 'text-[#475467]'
                }`}
              >
                Dashboard Home
              </Link>
              <Link
                href="/dashboard#tournaments"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold text-[#475467] hover:bg-[#F8FAF9] transition flex items-center min-h-[44px]"
              >
                Tournaments Directory
              </Link>
              <Link
                href="/dashboard#matches"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold text-[#475467] hover:bg-[#F8FAF9] transition flex items-center min-h-[44px]"
              >
                Live Matches
              </Link>
              <Link
                href="/player"
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2.5 rounded-lg text-sm font-semibold transition flex items-center min-h-[44px] ${
                  isActive('/player') ? 'bg-[#E8F6F0] text-[#14966B] font-bold' : 'text-[#475467]'
                }`}
              >
                Athlete / Player Portal
              </Link>
              {isOrganizer && (
                <Link
                  href="/tournaments/create"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-semibold transition flex items-center min-h-[44px] ${
                    isActive('/tournaments/create') ? 'bg-[#E8F6F0] text-[#14966B] font-bold' : 'text-[#14966B]'
                  }`}
                >
                  + Create Tournament
                </Link>
              )}
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold text-[#8C9BAE] hover:bg-[#F8FAF9] transition flex items-center min-h-[44px]"
              >
                Public Website
              </Link>

              <div className="pt-2 border-t border-[#E4E7EC] mt-2">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleSignOut();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-[#C94A4A] hover:bg-[#FDEEEE] transition min-h-[44px] flex items-center cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <>
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2.5 rounded-lg text-sm font-semibold transition flex items-center min-h-[44px] ${
                  isActive('/') ? 'bg-[#E8F6F0] text-[#14966B] font-bold' : 'text-[#475467]'
                }`}
              >
                Explore
              </Link>
              <Link
                href="/#live-tournaments"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold text-[#475467] hover:bg-[#F8FAF9] transition flex items-center min-h-[44px]"
              >
                Live Tournaments
              </Link>
              <Link
                href="/#features"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm font-semibold text-[#475467] hover:bg-[#F8FAF9] transition flex items-center min-h-[44px]"
              >
                Features
              </Link>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E4E7EC] mt-2">
                <Link
                  href="/auth/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-center py-2.5 rounded-lg text-sm font-semibold border border-[#D9DEE7] bg-white text-[#344054] min-h-[44px] flex items-center justify-center"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-center py-2.5 rounded-lg text-sm font-semibold bg-[#14966B] text-white min-h-[44px] flex items-center justify-center"
                >
                  Sign Up
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </nav>
  );
}

