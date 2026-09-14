'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';

const ThreeCanvas = dynamic(() => import('../components/ThreeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[260px] flex items-center justify-center bg-[#0B111E] text-slate-400 text-xs font-medium">
      Loading 3D Arena Simulation...
    </div>
  ),
});

export default function Home() {
  const { user, profile, signOut } = useAuth();
  const [publicTournaments, setPublicTournaments] = useState<any[]>([]);
  const [loadingPub, setLoadingPub] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [arenaSport, setArenaSport] = useState<'BADMINTON' | 'FOOTBALL'>('BADMINTON');

  useEffect(() => {
    const fetchPublicTournaments = async () => {
      try {
        const { data } = await supabase
          .from('tournaments')
          .select(`
            id,
            name,
            slug,
            start_date,
            end_date,
            status,
            sports ( name ),
            venues ( name, city, country )
          `)
          .eq('status', 'PUBLISHED')
          .order('start_date', { ascending: true })
          .limit(6);
        setPublicTournaments(data || []);
      } catch (err) {
        console.error('Failed to load published tournaments:', err);
      } finally {
        setLoadingPub(false);
      }
    };
    fetchPublicTournaments();
  }, []);

  return (
    <div className="min-h-screen landing-atmosphere text-[#0F172A] flex flex-col selection:bg-emerald-100 selection:text-[#14966B]">
      {/* Floating Light Glass Navigation Header */}
      <header className="sticky top-0 z-50 pt-4 sm:pt-5 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <nav
          className="landing-glass-nav rounded-2xl px-5 sm:px-6 py-3 flex items-center justify-between"
          role="navigation"
          aria-label="Landing Page Navigation"
        >
          {/* Brand Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 group"
            aria-label="ArenaFlow Home"
          >
            <div className="w-8 h-8 rounded-lg bg-[#14966B] flex items-center justify-center font-bold text-white text-xs shadow-xs group-hover:bg-[#10805B] transition">
              AF
            </div>
            <span className="text-base font-bold tracking-tight text-[#0F172A]">
              ARENAFLOW
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center space-x-1 lg:space-x-2">
            <a
              href="#overview"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#0F172A] hover:bg-white/60 transition duration-150"
            >
              Overview
            </a>
            <a
              href="#built-for-competition"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#0F172A] hover:bg-white/60 transition duration-150"
            >
              Capabilities
            </a>
            <a
              href="#live-tournaments"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#0F172A] hover:bg-white/60 transition duration-150"
            >
              Tournaments
            </a>
            <a
              href="#features"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#0F172A] hover:bg-white/60 transition duration-150"
            >
              Operations
            </a>
            <a
              href="#workflow"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#0F172A] hover:bg-white/60 transition duration-150"
            >
              Workflow
            </a>
          </div>

          {/* Right Side: Auth controls */}
          <div className="hidden md:flex items-center space-x-3">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden lg:block">
                  <span className="block text-xs font-semibold text-[#0F172A] max-w-[140px] truncate">
                    {profile?.fullName || user.email}
                  </span>
                  <span className="inline-block bg-emerald-50 text-[#14966B] px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border border-emerald-200">
                    {profile?.role || 'PLAYER'}
                  </span>
                </div>
                <Link
                  href="/dashboard"
                  className="bg-[#14966B] hover:bg-[#10805B] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Go to Dashboard</span>
                  <span>→</span>
                </Link>
                {(profile?.role === 'ORGANIZER' || profile?.role === 'PLATFORM_ADMIN') && (
                  <Link
                    href="/tournaments/create"
                    className="bg-white hover:bg-slate-50 text-[#0F172A] px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 transition shadow-xs"
                  >
                    + Create
                  </Link>
                )}
                <button
                  onClick={signOut}
                  className="text-xs text-slate-500 hover:text-[#DC2626] px-2.5 py-1.5 rounded-lg hover:bg-white/60 transition cursor-pointer"
                  aria-label="Sign Out"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2.5">
                <Link
                  href="/auth/login"
                  className="text-xs font-semibold text-slate-700 hover:text-[#0F172A] px-3.5 py-1.5 rounded-lg hover:bg-white/60 transition"
                >
                  Sign In
                </Link>
                <Link
                  href="/tournaments/create"
                  className="btn-primary text-xs px-4 py-1.5"
                >
                  Create Tournament
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Hamburger Button */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 min-h-[44px] min-w-[44px] rounded-xl bg-white/80 border border-slate-200 text-slate-700 hover:text-[#0F172A] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#14966B]"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-2 landing-glass-nav rounded-2xl p-4 shadow-lg space-y-3">
            <div className="flex flex-col space-y-1">
              <a
                href="#overview"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white/60 min-h-[44px] flex items-center"
              >
                Overview
              </a>
              <a
                href="#built-for-competition"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white/60 min-h-[44px] flex items-center"
              >
                Capabilities
              </a>
              <a
                href="#live-tournaments"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white/60 min-h-[44px] flex items-center"
              >
                Tournaments
              </a>
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white/60 min-h-[44px] flex items-center"
              >
                Operations
              </a>
              <a
                href="#workflow"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white/60 min-h-[44px] flex items-center"
              >
                Workflow
              </a>
            </div>

            <div className="pt-3 border-t border-slate-200/80 flex flex-col space-y-2">
              {user ? (
                <>
                  <div className="px-3 py-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0F172A] truncate max-w-[180px]">
                      {profile?.fullName || user.email}
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase bg-emerald-50 text-[#14966B] px-1.5 py-0.2 rounded border border-emerald-200">
                      {profile?.role || 'PLAYER'}
                    </span>
                  </div>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full text-center btn-primary text-xs py-2.5 min-h-[44px] flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span>Go to Dashboard</span>
                    <span>→</span>
                  </Link>
                  <button
                    onClick={() => {
                      signOut();
                      setMobileMenuOpen(false);
                    }}
                    className="w-full text-center text-xs text-[#DC2626] py-2.5 rounded-lg hover:bg-white/60 min-h-[44px] flex items-center justify-center cursor-pointer font-semibold"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full text-center bg-white/90 text-slate-700 py-2.5 rounded-lg text-xs font-semibold border border-slate-200 min-h-[44px] flex items-center justify-center"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/tournaments/create"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full text-center btn-primary text-xs py-2.5 min-h-[44px] flex items-center justify-center shadow-xs"
                  >
                    Create Tournament
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero Section — 2-Column Balanced Light Composition */}
      <section id="overview" className="pt-8 sm:pt-12 pb-16 lg:pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          
          {/* Left Column: Balanced Editorial Hero (~48%) */}
          <div className="lg:col-span-6 space-y-6 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full landing-glass-pill text-emerald-800 text-xs font-bold tracking-wide border border-emerald-500/20 bg-emerald-50/70 shadow-2xs">
              <span className="live-dot-slow" />
              <span>SPORTS MEET TECHNOLOGY</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[58px] font-extrabold tracking-tight text-[#0F172A] leading-[1.08]">
              Play. Organize. <br />
              Experience. <br />
              <span className="text-[#14966B]">ArenaFlow.</span>
            </h1>

            <p className="text-base sm:text-[17px] text-slate-600 leading-relaxed max-w-[540px]">
              Manage draws, court and pitch scheduling, rosters, certified scorers, and live matches from one connected system engineered for competitive badminton and football championships.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={user ? '/tournaments/create' : '/auth/login?redirect=/tournaments/create'}
                className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold shadow-sm hover:shadow transition duration-150 min-h-[44px] inline-flex items-center justify-center gap-2"
              >
                <span>Get Started</span>
                <span>→</span>
              </Link>
              <a
                href="#live-tournaments"
                className="bg-white/80 hover:bg-white text-[#0F172A] px-6 py-3 rounded-xl text-sm font-semibold border border-slate-200 shadow-2xs transition duration-150 min-h-[44px] inline-flex items-center justify-center gap-1.5"
              >
                <span>Explore Tournaments</span>
                <span>→</span>
              </a>
            </div>

            {/* Continuous Light Glass Capability Strip */}
            <div className="landing-glass-card rounded-2xl p-3.5 sm:p-4 grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 text-left max-w-[560px] shadow-2xs">
              <div className="p-2 sm:px-3 sm:py-0.5">
                <div className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">100%</div>
                <div className="text-[11px] text-slate-500 font-medium">Real-time Sync</div>
              </div>
              <div className="p-2 sm:px-3 sm:py-0.5 pt-2.5 sm:pt-0.5">
                <div className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">BWF Rules</div>
                <div className="text-[11px] text-slate-500 font-medium">Scoring Engine</div>
              </div>
              <div className="p-2 sm:px-3 sm:py-0.5 pt-2.5 sm:pt-0.5">
                <div className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">Multi-Court</div>
                <div className="text-[11px] text-slate-500 font-medium">3D Live Arena</div>
              </div>
              <div className="p-2 sm:px-3 sm:py-0.5 pt-2.5 sm:pt-0.5">
                <div className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">Secure</div>
                <div className="text-[11px] text-slate-500 font-medium">Role-Based Access</div>
              </div>
            </div>
          </div>

          {/* Right Column: 3D Arena Container (~52%) — Light Glass Outer Frame */}
          <div className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="landing-glass-hero p-5 sm:p-6 rounded-3xl w-full max-w-[560px] space-y-4 shadow-xl">
              {/* Light Glass Card Header */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-200/70">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] live-dot-slow" />
                    <span className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                      3D LIVE ARENA
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Interactive • Real-time Multi-Court Map
                  </p>
                </div>

                {/* Segmented Sport Selector Control (Light Glass) */}
                <div className="flex items-center bg-slate-100/90 rounded-lg p-0.5 border border-slate-200 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setArenaSport('BADMINTON')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-md transition ${
                      arenaSport === 'BADMINTON'
                        ? 'bg-[#14966B] text-white shadow-xs'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Badminton
                  </button>
                  <button
                    type="button"
                    onClick={() => setArenaSport('FOOTBALL')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-md transition ${
                      arenaSport === 'FOOTBALL'
                        ? 'bg-[#14966B] text-white shadow-xs'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Football
                  </button>
                </div>
              </div>

              {/* 3D Viewport (Dark Sports Arena Interior) */}
              <div className="h-[340px] sm:h-[360px] md:h-[380px] rounded-2xl overflow-hidden border border-slate-900/30 bg-[#0B111E] shadow-inner relative">
                <ThreeCanvas sport={arenaSport} showSportToggle={false} />
              </div>

              {/* Arena Card Footer */}
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 pt-0.5">
                <span className="flex items-center gap-1.5 font-medium">
                  <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  <span>Drag to rotate · Scroll to zoom</span>
                </span>
                <span className="text-[10px] text-slate-400 font-semibold tracking-wide">
                  Sport-Aware 3D Engine
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BUILT FOR COMPETITION — 3 Clean Light Feature Blocks */}
      <section id="built-for-competition" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="text-center max-w-3xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-bold text-[#14966B] uppercase tracking-wider block">
            BUILT FOR COMPETITION
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-[#0F172A]">
            Everything your tournament needs in one control layer.
          </h2>
          <p className="text-sm sm:text-base text-slate-600 max-w-2xl mx-auto">
            From court scheduling and certified umpire scoring to real-time public brackets and spatial 3D maps.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Block 1: Live Scoring */}
          <div className="bg-white/80 backdrop-blur-md rounded-2xl p-7 border border-slate-200/90 shadow-sm space-y-4 hover:shadow-md transition duration-200">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#14966B] flex items-center justify-center font-bold text-sm border border-emerald-200">
              01
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-[#14966B] uppercase tracking-wider block">
                LIVE SCORING
              </span>
              <h3 className="text-lg font-bold text-[#0F172A]">Real-time Match Control</h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Touch-optimized digital umpire console with instant score updates, full undo history, official BWF and Football rules, server/receiver tracking, and sub-second spectator synchronization.
            </p>
          </div>

          {/* Block 2: Tournament Engine */}
          <div className="bg-white/80 backdrop-blur-md rounded-2xl p-7 border border-slate-200/90 shadow-sm space-y-4 hover:shadow-md transition duration-200">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-200">
              02
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">
                TOURNAMENT ENGINE
              </span>
              <h3 className="text-lg font-bold text-[#0F172A]">Draws, Groups & Brackets</h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Automated single elimination, double elimination, and round-robin group stages with seed balancing, bye allocations, and atomic match progression upon referee finalization.
            </p>
          </div>

          {/* Block 3: Athlete Experience */}
          <div className="bg-white/80 backdrop-blur-md rounded-2xl p-7 border border-slate-200/90 shadow-sm space-y-4 hover:shadow-md transition duration-200">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-sm border border-purple-200">
              03
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">
                ATHLETE EXPERIENCE
              </span>
              <h3 className="text-lg font-bold text-[#0F172A]">Performance & History</h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Dedicated player portal for registration verification, live fixture alerts, tournament standing summaries, and verifiable career match histories.
            </p>
          </div>
        </div>
      </section>

      {/* Public Spectator Directory Section */}
      <section id="live-tournaments" className="py-16 sm:py-20 bg-white/40 backdrop-blur-md border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <span className="text-xs font-bold text-[#14966B] uppercase tracking-wider block mb-1">
                Public Spectator Directory
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                Live & Upcoming Tournaments
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Real-time court scores, brackets, and match schedules
            </span>
          </div>

          {loadingPub ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(n => (
                <div key={n} className="landing-glass-card p-6 h-48 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : publicTournaments.length === 0 ? (
            <div className="landing-glass-card p-10 text-center space-y-3 rounded-2xl">
              <span className="text-sm font-semibold text-slate-700">No published tournaments currently in progress.</span>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Organizers can create and publish tournaments to showcase their live matches and 3D arena maps.
              </p>
              {user && (
                <Link
                  href="/tournaments/create"
                  className="btn-primary text-xs px-5 py-2.5 inline-block"
                >
                  Create Tournament
                </Link>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {publicTournaments.map(t => (
                <div key={t.id} className="landing-glass-card p-6 flex flex-col justify-between rounded-2xl hover:shadow-md transition duration-200">
                  <div className="space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white text-slate-700 border border-slate-200 uppercase">
                        {t.sports?.name || 'Badminton'}
                      </span>
                      <span className="badge-live text-[10px] font-bold px-2 py-0.5 rounded-md uppercase">
                        {t.status}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-[#0F172A] leading-snug">
                      {t.name}
                    </h3>

                    <div className="text-xs text-slate-500 space-y-1">
                      <div><span className="font-semibold text-slate-700">Venue:</span> {t.venues?.name || 'Main Sports Complex'}</div>
                      <div><span className="font-semibold text-slate-700">Location:</span> {t.venues?.city || 'Delhi'}, {t.venues?.country || 'India'}</div>
                      <div><span className="font-semibold text-slate-700">Dates:</span> {new Date(t.start_date).toLocaleDateString()} – {new Date(t.end_date).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-200/80">
                    <Link
                      href={`/tournaments/${t.slug}`}
                      className="w-full text-center block bg-white hover:bg-slate-50 text-[#0F172A] font-semibold text-xs py-2.5 px-3 rounded-xl border border-slate-200 shadow-2xs transition"
                    >
                      View Live Arena →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Complete Operations Suite */}
      <section id="features" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold text-[#14966B] uppercase tracking-wider block mb-1">
            Complete Operations Suite
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
            Built for Serious Tournaments
          </h2>
          <p className="text-sm text-slate-500 mt-2">
            Everything tournament directors, certified umpires, and national federations need to execute flawless competitions.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              01
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">Draws & Bracket Automation</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Knockout and Round Robin bracket generation with automatic seeding, bye handling, and atomic progression upon match completion.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              02
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">Live Scorer Console</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Touch-optimized digital umpire console with instant +1 points, event sourcing, full undo history, server/receiver tracking, and deuce logic.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              03
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">Multi-Court Status Board</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Control room overview of all venue courts simultaneously. Start, pause, resume, and finalize matches with real-time referee triggers.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              04
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">3D Live Arena Map</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Spatial multi-court visualization showing active scores, court occupancy, and camera focus for spectators on mobile and desktop.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              05
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">Participant Eligibility & RLS</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Automated age group (U19/Adult/O40) and gender validation for singles and doubles, backed by row-level security.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 space-y-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition duration-200">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#14966B] flex items-center justify-center font-mono font-bold text-xs border border-emerald-200">
              06
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">Realtime Postgres Sync</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Sub-second live score distribution across umpires, organizers, and public spectator screens with presence indicators.
            </p>
          </div>
        </div>
      </section>

      {/* Streamlined Workflow Section */}
      <section id="workflow" className="py-16 sm:py-20 bg-white/40 backdrop-blur-md border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-12">
            <span className="text-xs font-bold text-[#14966B] uppercase tracking-wider block mb-1">
              Streamlined Operations
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
              From Registration to Championship Point
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { step: '01', title: 'Create Tournament', desc: 'Set dates, venue, rules, and categories.' },
              { step: '02', title: 'Approve Registrations', desc: 'Verify player eligibility and seed brackets.' },
              { step: '03', title: 'Schedule & Assign', desc: 'Book courts and assign certified scorers.' },
              { step: '04', title: 'Score Matches Live', desc: 'Umpires score points with instant undo.' },
              { step: '05', title: 'Publish Results', desc: 'Spectators follow in 3D and brackets advance.' },
            ].map((s, idx) => (
              <div key={idx} className="bg-white/80 backdrop-blur-md rounded-2xl p-5 border border-slate-200/90 shadow-2xs space-y-2">
                <span className="text-xs font-mono font-bold text-[#14966B] block">{s.step}</span>
                <h3 className="text-sm font-bold text-[#0F172A]">{s.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action Section */}
      <section id="cta" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full text-center">
        <div className="landing-glass-hero p-10 sm:p-14 space-y-6 max-w-4xl mx-auto rounded-3xl shadow-lg border border-white/90">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#0F172A] tracking-tight">
            Ready to run your next tournament?
          </h2>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
            Join badminton clubs, organizers, and academies running verified, real-time competitions on ArenaFlow.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href={user ? '/tournaments/create' : '/auth/login?redirect=/tournaments/create'}
              className="btn-primary px-7 py-3 rounded-xl text-sm font-semibold shadow-sm hover:shadow min-h-[44px] inline-flex items-center justify-center gap-2"
            >
              <span>Create Tournament</span>
              <span>→</span>
            </Link>
            <Link
              href="/auth/signup"
              className="bg-white/90 hover:bg-white text-[#0F172A] px-7 py-3 rounded-xl text-sm font-semibold border border-slate-200 shadow-2xs transition min-h-[44px] inline-flex items-center justify-center"
            >
              Sign Up as Player
            </Link>
          </div>
        </div>
      </section>

      {/* Clean Light Glass Footer */}
      <footer className="mt-auto bg-white/60 backdrop-blur-md border-t border-slate-200/80 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-500 font-medium">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#14966B] flex items-center justify-center font-bold text-white text-[10px]">
              AF
            </div>
            <span className="font-bold text-[#0F172A]">ArenaFlow</span>
            <span>— Competitive Sports Tournament Platform</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#overview" className="hover:text-[#0F172A] transition">Overview</a>
            <a href="#built-for-competition" className="hover:text-[#0F172A] transition">Capabilities</a>
            <a href="#live-tournaments" className="hover:text-[#0F172A] transition">Tournaments</a>
            <a href="#features" className="hover:text-[#0F172A] transition">Operations</a>
            <Link href="/auth/login" className="hover:text-[#0F172A] transition">Sign In</Link>
            <Link href="/auth/signup" className="hover:text-[#0F172A] transition">Sign Up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

