'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import Navigation from '../../components/Navigation';
import {
  calculateTournamentStats,
  calculatePlayerStats,
  calculateFootballPlayerStats,
  calculateHeadToHead,
  calculateStandings,
  PlayerStats,
  FootballPlayerStats,
  HeadToHeadStats,
  StandingEntry
} from '@arena-flow/statistics-engine';

interface Tournament {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';
  start_date: string;
  end_date: string;
  registration_open?: string;
  registration_close?: string;
  sports: any;
  venues: any;
  categories?: any[];
  tournament_scorers?: { user_id: string }[];
}

interface TournamentMetrics {
  registeredPlayers: number;
  approvedParticipants: number;
  pendingRegistrations: number;
  totalMatches: number;
  liveMatches: number;
  completedMatches: number;
  assignedCourts: number;
  assignedScorers: number;
}

type PlayerTab = 'OVERVIEW' | 'TOURNAMENTS' | 'MATCHES' | 'HISTORY' | 'STATS';

export default function DashboardPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  // Organizer state
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [activeOrgTab, setActiveOrgTab] = useState<'ALL' | 'DRAFT' | 'PUBLISHED' | 'COMPLETED'>('ALL');

  // Player state
  const [playerTab, setPlayerTab] = useState<PlayerTab>('OVERVIEW');
  const [myRegistrations, setMyRegistrations] = useState<any[]>([]);
  const [playerMatches, setPlayerMatches] = useState<any[]>([]);
  const [playerStandings, setPlayerStandings] = useState<{ categoryName: string; format: string; isFootball?: boolean; entries: StandingEntry[] }[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [footballStats, setFootballStats] = useState<FootballPlayerStats | null>(null);
  const [h2hList, setH2hList] = useState<{ opponentName: string; opponentId: string; stats: HeadToHeadStats }[]>([]);
  const [loadingPlayerData, setLoadingPlayerData] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const fetchDashboardData = async () => {
      setError(null);
      const isOrg = profile?.role === 'ORGANIZER' || profile?.role === 'PLATFORM_ADMIN';

      if (isOrg) {
        setLoadingTournaments(true);
        try {
          const { data, error: fetchErr } = await supabase
            .from('tournaments')
            .select(`
              id,
              name,
              slug,
              status,
              start_date,
              end_date,
              sports ( name ),
              venues (
                name,
                courts ( id, name )
              ),
              categories (
                id,
                name,
                participants (
                  id,
                  status,
                  participant_members ( player_id )
                ),
                registrations ( id, status ),
                matches (
                  id,
                  status,
                  court_id,
                  court:courts ( name ),
                  participant_a:participants!participant_a_id (
                    id,
                    members:participant_members (
                      player:players ( full_name, display_name )
                    )
                  ),
                  participant_b:participants!participant_b_id (
                    id,
                    members:participant_members (
                      player:players ( full_name, display_name )
                    )
                  ),
                  games (
                    game_number,
                    participant_a_score,
                    participant_b_score,
                    status
                  )
                )
              ),
              tournament_scorers ( user_id )
            `)
            .eq('organizer_id', user.id)
            .order('created_at', { ascending: false });

          if (fetchErr) throw fetchErr;
          setTournaments(data || []);
        } catch (err: any) {
          console.error('Failed to load organizer dashboard:', err);
          setError(err.message || 'Error loading dashboard data');
        } finally {
          setLoadingTournaments(false);
        }
      } else {
        // Player Portal Data Loading
        setLoadingPlayerData(true);
        try {
          // 1. Fetch Registrations
          const { data: regData, error: regErr } = await supabase
            .from('registrations')
            .select(`
              id,
              created_at,
              status,
              participant:participants (
                id,
                status,
                seed,
                category:categories (
                  id,
                  name,
                  category_type,
                  match_type,
                  format,
                  tournament:tournaments (
                    id,
                    name,
                    slug,
                    status,
                    start_date,
                    end_date,
                    venues ( name, city, address )
                  )
                )
              )
            `)
            .order('created_at', { ascending: false });

          if (regErr) throw regErr;
          setMyRegistrations(regData || []);

          // 2. Fetch all participant IDs where the current user is a member
          const { data: memberData, error: memberErr } = await supabase
            .from('participant_members')
            .select('participant_id')
            .eq('player_id', user.id);

          if (memberErr) throw memberErr;
          const myParticipantIds = Array.from(
            new Set([
              ...(memberData?.map((m: any) => m.participant_id) || []),
              ...(regData?.map((r: any) => r.participant?.id).filter(Boolean) || [])
            ])
          );

          if (myParticipantIds.length > 0) {
            // 3. Fetch Matches involving the player's participant records
            const { data: matchData, error: matchErr } = await supabase
              .from('matches')
              .select(`
                id,
                category_id,
                participant_a_id,
                participant_b_id,
                status,
                outcome,
                winner_id,
                scheduled_at,
                started_at,
                ended_at,
                score_a,
                score_b,
                halftime_score,
                extra_time_score,
                shootout_score,
                outcome_details,
                match_phase,
                lineup_data,
                court:courts ( id, name ),
                round:rounds ( id, name, round_number ),
                category:categories (
                  id,
                  name,
                  category_type,
                  match_type,
                  format,
                  tournament:tournaments (
                    id,
                    name,
                    slug,
                    status,
                    venues ( name ),
                    sports:sports ( id, name )
                  )
                ),
                participant_a:participants!matches_participant_a_id_fkey (
                  id,
                  status,
                  seed,
                  members:participant_members (
                    member_order,
                    player:players ( id, full_name, display_name )
                  )
                ),
                participant_b:participants!matches_participant_b_id_fkey (
                  id,
                  status,
                  seed,
                  members:participant_members (
                    member_order,
                    player:players ( id, full_name, display_name )
                  )
                ),
                games (
                  id,
                  game_number,
                  participant_a_score,
                  participant_b_score,
                  status
                ),
                match_events (
                  id,
                  sequence_number,
                  event_type,
                  participant_id,
                  metadata,
                  server_player_id,
                  receiver_player_id,
                  created_at
                )
              `)
              .or(`participant_a_id.in.(${myParticipantIds.join(',')}),participant_b_id.in.(${myParticipantIds.join(',')})`)
              .order('scheduled_at', { ascending: true });

            if (matchErr) throw matchErr;
            const fetchedMatches = matchData || [];
            setPlayerMatches(fetchedMatches);

            // 4. Calculate Personal Statistics via @arena-flow/statistics-engine
            const stats = calculatePlayerStats(fetchedMatches as any, user.id);
            setPlayerStats(stats);
            const footStats = calculateFootballPlayerStats(fetchedMatches as any, user.id);
            setFootballStats(footStats);

            // 5. Calculate Head-to-Head against distinct opponents
            const opponentMap = new Map<string, { name: string; id: string }>();
            fetchedMatches.forEach((m: any) => {
              const inA = (m.participant_a?.members || []).some((mb: any) => mb.player?.id === user.id);
              const oppMembers = inA ? m.participant_b?.members : m.participant_a?.members;
              oppMembers?.forEach((mb: any) => {
                if (mb.player?.id && mb.player?.id !== user.id) {
                  opponentMap.set(mb.player.id, {
                    id: mb.player.id,
                    name: mb.player.display_name || mb.player.full_name || 'Opponent',
                  });
                }
              });
            });

            const computedH2H: { opponentName: string; opponentId: string; stats: HeadToHeadStats }[] = [];
            opponentMap.forEach((opp, oppId) => {
              const h2h = calculateHeadToHead(fetchedMatches as any, user.id, oppId);
              if (h2h.matchesPlayed > 0) {
                computedH2H.push({
                  opponentId: opp.id,
                  opponentName: opp.name,
                  stats: h2h,
                });
              }
            });
            setH2hList(computedH2H);

            // 6. Calculate category / group standings
            const categoryIds = Array.from(new Set(fetchedMatches.map((m: any) => m.category?.id).filter(Boolean)));
            const standingsResults: { categoryName: string; format: string; isFootball?: boolean; entries: StandingEntry[] }[] = [];

            for (const catId of categoryIds) {
              const catMatches = fetchedMatches.filter((m: any) => m.category?.id === catId);
              const catParticipants: any[] = [];
              catMatches.forEach((m: any) => {
                if (m.participant_a && !catParticipants.some(p => p.id === m.participant_a.id)) {
                  catParticipants.push(m.participant_a);
                }
                if (m.participant_b && !catParticipants.some(p => p.id === m.participant_b.id)) {
                  catParticipants.push(m.participant_b);
                }
              });

              if (catParticipants.length > 0) {
                const firstMatch = catMatches[0] as any;
                const catObj = Array.isArray(firstMatch?.category) ? firstMatch.category[0] : firstMatch?.category;
                const tourObj = Array.isArray(catObj?.tournament) ? catObj.tournament[0] : catObj?.tournament;
                const isFoot = tourObj?.sports?.name?.toUpperCase() === 'FOOTBALL' ||
                  catObj?.sports?.name?.toUpperCase() === 'FOOTBALL' ||
                  catMatches.some((m: any) => m.score_a !== undefined || m.match_phase !== undefined);

                const { sortedEntries } = calculateStandings(catParticipants, catMatches as any, { sport: isFoot ? 'FOOTBALL' : 'BADMINTON' });
                standingsResults.push({
                  categoryName: catObj?.name || 'Category',
                  format: catObj?.format || 'ROUND_ROBIN',
                  isFootball: isFoot,
                  entries: sortedEntries,
                });
              }
            }
            setPlayerStandings(standingsResults);
          } else {
            setPlayerMatches([]);
            setPlayerStats(calculatePlayerStats([], user.id));
            setFootballStats(calculateFootballPlayerStats([], user.id));
            setH2hList([]);
            setPlayerStandings([]);
          }
        } catch (err: any) {
          console.error('Failed to load player portal data:', err);
          setError(err.message || 'Error loading player portal data');
        } finally {
          setLoadingPlayerData(false);
        }
      }
    };

    fetchDashboardData();
  }, [user, profile]);

  const computeMetrics = (t: Tournament): TournamentMetrics => {
    const cats = t.categories || [];
    const playerIds = new Set<string>();
    let approvedParts = 0;
    let pendingRegs = 0;

    cats.forEach((c: any) => {
      c.participants?.forEach((p: any) => {
        p.participant_members?.forEach((m: any) => {
          if (m.player_id) playerIds.add(m.player_id);
        });
      });

      approvedParts += (c.participants || []).filter((p: any) => p.status === 'ACTIVE').length;
      pendingRegs += (c.registrations || []).filter((r: any) => r.status === 'PENDING').length;
    });

    const matchStats = calculateTournamentStats({ categories: cats });
    const assignedCourts = t.venues?.courts?.length || 0;
    const assignedScorers = t.tournament_scorers?.length || 0;

    return {
      registeredPlayers: playerIds.size,
      approvedParticipants: approvedParts,
      pendingRegistrations: pendingRegs,
      totalMatches: matchStats.totalMatches,
      liveMatches: matchStats.liveMatches,
      completedMatches: matchStats.completedMatches,
      assignedCourts,
      assignedScorers,
    };
  };

  const getPlayerNames = (participant: any) => {
    if (!participant?.members || participant.members.length === 0) return 'TBD';
    return participant.members
      .map((m: any) => m.player?.display_name || m.player?.full_name || 'Player')
      .join(' / ');
  };

  const isFootballMatch = (m: any) => {
    const catObj = Array.isArray(m?.category) ? m.category[0] : m?.category;
    const tourObj = Array.isArray(catObj?.tournament) ? catObj.tournament[0] : catObj?.tournament;
    const sportName = tourObj?.sports?.name || catObj?.sports?.name || m?.sports?.name;
    return sportName?.toUpperCase() === 'FOOTBALL' ||
      (m?.score_a !== undefined && m?.score_a !== null) ||
      (m?.match_phase !== undefined && m?.match_phase !== null);
  };

  const getMatchScoreDisplay = (m: any) => {
    if (isFootballMatch(m)) {
      const scoreA = m.score_a ?? 0;
      const scoreB = m.score_b ?? 0;
      let text = `${scoreA} - ${scoreB}`;
      if (m.shootout_score_a !== null && m.shootout_score_b !== null && (m.shootout_score_a !== undefined || m.shootout_score_b !== undefined)) {
        text += ` (${m.shootout_score_a}-${m.shootout_score_b} pens)`;
      } else if (m.match_phase === 'EXTRA_TIME_SECOND_HALF' || m.match_phase === 'EXTRA_TIME_FIRST_HALF' || m.match_phase === 'EXTRA_TIME_HALFTIME') {
        text += ' (AET)';
      }
      return text;
    }
    const games = [...(m.games || [])].sort((a: any, b: any) => a.game_number - b.game_number);
    if (games.length === 0) return '0 - 0';
    return games.map((g: any) => `${g.participant_a_score ?? 0}-${g.participant_b_score ?? 0}`).join(', ');
  };

  const isOrganizer = profile?.role === 'ORGANIZER' || profile?.role === 'PLATFORM_ADMIN';

  const filteredTournaments = tournaments.filter((t) => {
    if (activeOrgTab === 'ALL') return true;
    return t.status === activeOrgTab;
  });

  const orgStats = {
    total: tournaments.length,
    published: tournaments.filter((t) => t.status === 'PUBLISHED').length,
    drafts: tournaments.filter((t) => t.status === 'DRAFT').length,
    completed: tournaments.filter((t) => t.status === 'COMPLETED').length,
  };

  const allLiveMatches: { match: any; tournament: Tournament }[] = [];
  tournaments.forEach((t) => {
    (t.categories || []).forEach((c: any) => {
      (c.matches || []).forEach((m: any) => {
        if (m.status === 'LIVE' || m.status === 'UNDER_REVIEW') {
          allLiveMatches.push({ match: m, tournament: t });
        }
      });
    });
  });

  // Filter player matches by status
  const playerLiveMatches = playerMatches.filter(
    (m) => m.status === 'LIVE' || m.status === 'PAUSED' || m.status === 'UNDER_REVIEW'
  );
  const playerUpcomingMatches = playerMatches.filter(
    (m) => m.status === 'SCHEDULED' || m.status === 'READY'
  );
  const playerCompletedMatches = playerMatches.filter(
    (m) => m.status === 'COMPLETED' || m.status === 'FINAL'
  );

  return (
    <div className="min-h-screen bg-transparent text-[#0F172A] flex flex-col">
      <Navigation />

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 flex-1 space-y-8">
        {!isOrganizer ? (
          // ==========================================
          // COMPLETE PLAYER PORTAL (FEATURE 9)
          // ==========================================
          <div className="space-y-6">
            {/* Player Portal Header */}
            <div className="pro-glass-primary p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] animate-pulse" />
                  <span className="text-[11px] font-bold text-[#14966B] uppercase tracking-wider">Athlete Dashboard</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">
                  Player Portal
                </h1>
                <p className="text-xs sm:text-sm text-[#475467] mt-0.5">
                  Welcome back, <span className="font-semibold text-[#0F172A]">{profile?.displayName || profile?.fullName || user?.email}</span>. Track registrations, matches, live scores, and career statistics.
                </p>
              </div>
              <Link href="/" className="btn-primary shadow-sm flex items-center gap-2">
                <span>Explore Tournaments</span>
                <span>→</span>
              </Link>
            </div>

            {/* Navigation Tabs for Player Portal */}
            <div className="flex border-b border-slate-200/80 space-x-6 overflow-x-auto">
              {[
                { id: 'OVERVIEW', label: 'Overview' },
                { id: 'TOURNAMENTS', label: `My Tournaments (${myRegistrations.length})` },
                { id: 'MATCHES', label: `Matches & Schedule (${playerUpcomingMatches.length + playerLiveMatches.length})` },
                { id: 'HISTORY', label: `Match History (${playerCompletedMatches.length})` },
                { id: 'STATS', label: 'Standings & Statistics' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setPlayerTab(tab.id as PlayerTab)}
                  className={`pb-3 text-xs font-semibold tracking-wide border-b-2 whitespace-nowrap transition cursor-pointer ${
                    playerTab === tab.id
                      ? 'border-[#14966B] text-[#14966B] font-bold'
                      : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {loadingPlayerData ? (
              <div className="space-y-4">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-32 pro-card skeleton-shimmer rounded-xl" />
                ))}
              </div>
            ) : error ? (
              <div className="bg-[#FDEEEE]/90 backdrop-blur-md border border-[#FECDCA] text-[#C94A4A] rounded-xl p-4 text-xs font-medium" role="alert">
                {error}
              </div>
            ) : (
              <>
                {/* ------------------------------------------------------------- */}
                {/* TAB 1: OVERVIEW */}
                {/* ------------------------------------------------------------- */}
                {playerTab === 'OVERVIEW' && (
                  <div className="space-y-6">
                    {/* 4 Player Operational Summary Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[
                        { label: 'Registered Tournaments', count: myRegistrations.length, color: 'text-[#0F172A]', iconBg: 'bg-amber-50 text-amber-600 border border-amber-200/60', icon: '📋' },
                        { label: 'Matches Played', count: (footballStats?.matchesPlayed || 0) + (playerStats?.matchesPlayed || 0), color: 'text-[#2563EB]', iconBg: 'bg-blue-50 text-blue-600 border border-blue-200/60', icon: '⚔️' },
                        { label: 'Win Rate', count: `${Math.round(footballStats?.matchesPlayed ? footballStats.winPercentage : (playerStats?.winPercentage || 0))}%`, color: 'text-[#14966B]', iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-200/60', icon: '🎯' },
                        { label: 'Active / Live Matches', count: playerLiveMatches.length, color: playerLiveMatches.length > 0 ? 'text-[#14966B]' : 'text-[#64748B]', iconBg: 'bg-purple-50 text-purple-600 border border-purple-200/60', icon: '●' },
                      ].map((stat, i) => (
                        <div key={i} className="pro-stat-card">
                          <div className="flex justify-between items-start">
                            <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                              {stat.label}
                            </span>
                            <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs ${stat.iconBg}`}>{stat.icon}</span>
                          </div>
                          <span className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${stat.color} block mt-2`}>
                            {stat.count}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* LIVE MATCH HERO (if player has an active match right now) */}
                    {playerLiveMatches.length > 0 && (
                      <div className="pro-glass-primary p-6 space-y-4 border-2 border-[#14966B]/30 shadow-md">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200/80">
                          <div className="flex items-center gap-2">
                            <span className="live-dot-slow" />
                            <h2 className="text-sm font-bold text-[#14966B] uppercase tracking-wider">
                              ● LIVE MATCH IN PROGRESS
                            </h2>
                          </div>
                          <span className="text-xs text-[#64748B]">
                            {playerLiveMatches[0].category?.tournament?.name}
                          </span>
                        </div>

                        {playerLiveMatches.map((m) => {
                          const isFoot = isFootballMatch(m);
                          let scoreA = 0;
                          let scoreB = 0;
                          let extraBadge = '';

                          if (isFoot) {
                            scoreA = m.score_a ?? 0;
                            scoreB = m.score_b ?? 0;
                            if (m.match_phase) {
                              extraBadge = m.match_phase.replace(/_/g, ' ');
                            }
                          } else {
                            const games = m.games || [];
                            const activeGame = games.find((g: any) => !g.is_completed) || games[games.length - 1];
                            scoreA = activeGame ? activeGame.participant_a_score ?? 0 : 0;
                            scoreB = activeGame ? activeGame.participant_b_score ?? 0 : 0;
                          }

                          return (
                            <div key={m.id} className="pro-card p-4 flex flex-col md:flex-row justify-between items-center gap-4">
                              <div className="space-y-1 text-center md:text-left">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-[#2563EB] uppercase tracking-wider">
                                    {m.court?.name || 'Assigned Court'} • {m.round?.name || 'Active Round'}
                                  </span>
                                  {extraBadge && (
                                    <span className="text-[10px] font-bold bg-[#EEF4FF] text-[#2563EB] px-2 py-0.5 rounded border border-[#CFDEFB] uppercase">
                                      {extraBadge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-base font-bold text-[#0F172A] flex items-center gap-3">
                                  <span>{getPlayerNames(m.participant_a)}</span>
                                  <span className="font-mono text-xl text-[#14966B] bg-emerald-50 px-3 py-0.5 rounded-md border border-emerald-200">
                                    {scoreA} - {scoreB}
                                  </span>
                                  <span>{getPlayerNames(m.participant_b)}</span>
                                </div>
                                <p className="text-[11px] text-[#64748B]">
                                  Category: {m.category?.name} ({m.category?.category_type})
                                </p>
                              </div>

                              <Link
                                href={`/tournaments/${m.category?.tournament?.slug}`}
                                className="btn-primary text-xs"
                              >
                                View Live Spectator View →
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Upcoming Fixtures Quick List */}
                    <div className="pro-card p-6 space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/80">
                        <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
                          Next Upcoming Matches
                        </h2>
                        <button
                          onClick={() => setPlayerTab('MATCHES')}
                          className="text-xs font-semibold text-[#14966B] hover:underline"
                        >
                          View All Schedule →
                        </button>
                      </div>

                      {playerUpcomingMatches.length === 0 ? (
                        <p className="text-xs text-[#64748B] py-4 text-center">
                          No upcoming matches currently scheduled. Matches will appear once tournament draws are generated.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {playerUpcomingMatches.slice(0, 3).map((m) => (
                            <div key={m.id} className="pro-surface-subtle p-4 rounded-xl flex justify-between items-center">
                              <div>
                                <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider block">
                                  {m.category?.tournament?.name} • {m.round?.name || 'Upcoming Round'}
                                </span>
                                <h3 className="text-sm font-bold text-[#0F172A] mt-0.5">
                                  {getPlayerNames(m.participant_a)} vs {getPlayerNames(m.participant_b)}
                                </h3>
                                <p className="text-xs text-[#64748B] mt-0.5">
                                  Court: <span className="text-[#0F172A] font-medium">{m.court?.name || 'TBD'}</span>
                                  {m.scheduled_at && ` • Scheduled: ${new Date(m.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                                </p>
                              </div>
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                m.status === 'READY' ? 'badge-live' : 'badge-paused'
                              }`}>
                                {m.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* ------------------------------------------------------------- */}
                {/* TAB 2: MY TOURNAMENTS */}
                {/* ------------------------------------------------------------- */}
                {playerTab === 'TOURNAMENTS' && (
                  <div className="pro-card p-6 space-y-4">
                    <h2 className="text-base font-bold text-[#0F172A]">Registered Tournaments</h2>

                    {myRegistrations.length === 0 ? (
                      <div className="text-center py-10 pro-surface-subtle rounded-xl space-y-3">
                        <p className="text-[#64748B] text-xs">You have not registered for any tournament categories yet.</p>
                        <Link href="/" className="btn-primary inline-flex">
                          Find a Tournament
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {myRegistrations.map((reg) => {
                          const part = reg.participant;
                          const cat = part?.category;
                          const tour = cat?.tournament;
                          if (!tour) return null;

                          return (
                            <div key={reg.id} className="pro-surface-subtle rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                    tour.status === 'PUBLISHED' ? 'badge-live' : 'badge-paused'
                                  }`}>
                                    {tour.status === 'PUBLISHED' ? '● LIVE' : tour.status}
                                  </span>
                                  <span className="text-[10px] bg-[#EEF4FF] text-[#2563EB] font-semibold px-2 py-0.5 rounded border border-[#CFDEFB] uppercase">
                                    {cat.format}
                                  </span>
                                </div>
                                <h3 className="text-base font-bold text-[#0F172A]">{tour.name}</h3>
                                <p className="text-xs text-[#64748B]">
                                  Category: <span className="text-[#0F172A] font-semibold">{cat.name} ({cat.category_type} - {cat.match_type})</span>
                                </p>
                                <div className="text-[11px] text-[#94A3B8] flex gap-3">
                                  <span>Starts: {new Date(tour.start_date).toLocaleDateString()}</span>
                                  {tour.venues?.name && <span>Venue: {tour.venues.name}</span>}
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                                  part.status === 'ACTIVE' || reg.status === 'APPROVED'
                                    ? 'badge-live'
                                    : reg.status === 'REJECTED'
                                    ? 'badge-paused bg-[#FDEEEE] text-[#B42318] border-[#FDA29B]'
                                    : 'badge-paused'
                                }`}>
                                  {reg.status}
                                </span>
                                <Link
                                  href={`/tournaments/${tour.slug}`}
                                  className="bg-emerald-50 hover:bg-emerald-100 text-[#14966B] font-semibold text-xs px-3.5 py-2 rounded-lg border border-emerald-200 transition"
                                >
                                  View Draw & Bracket →
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ------------------------------------------------------------- */}
                {/* TAB 3: MATCHES & SCHEDULE */}
                {/* ------------------------------------------------------------- */}
                {playerTab === 'MATCHES' && (
                  <div className="space-y-6">
                    {/* Live Matches Section */}
                    {playerLiveMatches.length > 0 && (
                      <div className="pro-card p-6 space-y-4 border border-[#14966B]/40">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80">
                          <span className="live-dot-slow" />
                          <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
                            Live Matches Now
                          </h2>
                        </div>
                        <div className="space-y-3">
                          {playerLiveMatches.map((m) => (
                            <div key={m.id} className="pro-surface-subtle p-4 rounded-xl flex justify-between items-center">
                              <div>
                                <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider block">
                                  {m.category?.tournament?.name} • {m.court?.name || 'Court'}
                                </span>
                                <h3 className="text-sm font-bold text-[#0F172A] mt-0.5">
                                  {getPlayerNames(m.participant_a)} vs {getPlayerNames(m.participant_b)}
                                </h3>
                              </div>
                              <Link
                                href={`/tournaments/${m.category?.tournament?.slug}`}
                                className="btn-primary text-xs"
                              >
                                View Live Match →
                              </Link>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Upcoming Matches List */}
                    <div className="pro-card p-6 space-y-4">
                      <h2 className="text-base font-bold text-[#0F172A]">Upcoming Scheduled Matches</h2>

                      {playerUpcomingMatches.length === 0 ? (
                        <div className="text-center py-8 text-[#64748B] text-xs">
                          No upcoming matches scheduled.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {playerUpcomingMatches.map((m) => (
                            <div key={m.id} className="pro-surface-subtle p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                              <div>
                                <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider block">
                                  {m.category?.tournament?.name} • {m.category?.name}
                                </span>
                                <h3 className="text-sm font-bold text-[#0F172A] mt-0.5">
                                  {getPlayerNames(m.participant_a)} vs {getPlayerNames(m.participant_b)}
                                </h3>
                                <p className="text-xs text-[#64748B] mt-0.5">
                                  Stage: <span className="font-semibold text-[#0F172A]">{m.round?.name || 'Round'}</span>
                                  {m.court?.name && ` • Court: ${m.court.name}`}
                                  {m.scheduled_at && ` • Time: ${new Date(m.scheduled_at).toLocaleString()}`}
                                </p>
                              </div>
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                m.status === 'READY' ? 'badge-live' : 'badge-paused'
                              }`}>
                                {m.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------- */}
                {/* TAB 4: MATCH HISTORY */}
                {/* ------------------------------------------------------------- */}
                {playerTab === 'HISTORY' && (
                  <div className="pro-card p-6 space-y-4">
                    <h2 className="text-base font-bold text-[#0F172A]">Completed Match History</h2>

                    {playerCompletedMatches.length === 0 ? (
                      <div className="text-center py-8 text-[#64748B] text-xs">
                        No completed match records found.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {playerCompletedMatches.map((m) => {
                          const isWinner = (m.participant_a?.members || []).some((mb: any) => mb.player?.id === user?.id)
                            ? m.winner_id === m.participant_a?.id
                            : m.winner_id === m.participant_b?.id;

                          return (
                            <div key={m.id} className="pro-surface-subtle p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    isWinner ? 'bg-emerald-50 text-[#14966B] border border-emerald-200' : 'bg-[#FDEEEE] text-[#B42318] border border-[#FDA29B]'
                                  }`}>
                                    {isWinner ? 'WON' : 'LOST'}
                                  </span>
                                  <span className="text-xs text-[#64748B]">
                                    {m.category?.tournament?.name} • {m.round?.name || 'Completed Round'}
                                  </span>
                                </div>
                                <h3 className="text-sm font-bold text-[#0F172A]">
                                  {getPlayerNames(m.participant_a)} vs {getPlayerNames(m.participant_b)}
                                </h3>
                                <p className="text-xs text-[#64748B]">
                                  Score: <span className="font-mono font-bold text-[#0F172A]">{getMatchScoreDisplay(m)}</span>
                                  {m.outcome && m.outcome !== 'COMPLETED' && ` (${m.outcome})`}
                                </p>
                              </div>

                              <Link
                                href={`/tournaments/${m.category?.tournament?.slug}`}
                                className="text-xs font-semibold text-[#14966B] hover:underline"
                              >
                                View Tournament Bracket →
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ------------------------------------------------------------- */}
                {/* TAB 5: STANDINGS & STATISTICS */}
                {/* ------------------------------------------------------------- */}
                {playerTab === 'STATS' && (
                  <div className="space-y-6">
                    {/* Football Career Statistics Grid (if user has Football matches) */}
                    {footballStats && (footballStats.matchesPlayed > 0 || playerMatches.some(isFootballMatch)) && (
                      <div className="pro-card p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <h2 className="text-base font-bold text-[#0F172A]">Football Statistics Overview</h2>
                          {footballStats.recentForm && footballStats.recentForm.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-[#64748B] uppercase">Recent Form:</span>
                              <div className="flex items-center gap-1">
                                {footballStats.recentForm.map((formType, idx) => {
                                  const detail = footballStats.formDetails?.[idx];
                                  const isWin = formType === 'W';
                                  const isLoss = formType === 'L';
                                  const isDraw = formType === 'D';
                                  const isSpecial = ['W.O.', 'DEFAULT', 'RET', 'BYE'].includes(formType);
                                  
                                  return (
                                    <span
                                      key={idx}
                                      title={detail ? `${formType} vs ${detail.opponentName || 'Opponent'} (${detail.scoreDisplay || detail.outcome || ''})` : formType}
                                      className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold uppercase transition ${
                                        isWin
                                          ? 'bg-[#14966B] text-white'
                                          : isLoss
                                          ? 'bg-[#D92D20] text-white'
                                          : isDraw
                                          ? 'bg-[#64748B] text-white'
                                          : isSpecial
                                          ? 'bg-[#C98218] text-white'
                                          : 'bg-[#64748B] text-white'
                                      }`}
                                    >
                                      {formType}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Matches (W / D / L)</span>
                            <span className="text-xl font-bold text-[#0F172A] block mt-1">
                              {footballStats.matchesWon} - {footballStats.matchesDrawn} - {footballStats.matchesLost}
                            </span>
                            <span className="text-[10px] text-[#14966B] font-semibold block mt-0.5">
                              {footballStats.winPercentage.toFixed(1)}% Win Rate
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Goals & Assists</span>
                            <span className="text-xl font-bold text-[#14966B] block mt-1">
                              {footballStats.goals} G • {footballStats.assists} A
                            </span>
                            <span className="text-[10px] text-[#64748B] font-semibold block mt-0.5">
                              {footballStats.ownGoals > 0 ? `${footballStats.ownGoals} OG` : '0 OG'}
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Disciplinary & Clean Sheets</span>
                            <span className="text-xl font-bold text-[#2563EB] block mt-1">
                              {footballStats.yellowCards} 🟨 • {footballStats.redCards} 🟥
                            </span>
                            <span className="text-[10px] text-[#14966B] font-semibold block mt-0.5">
                              {footballStats.cleanSheetAppearances} Clean Sheets
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Appearances & Starts</span>
                            <span className="text-xl font-bold text-[#0F172A] block mt-1">
                              {footballStats.appearances} Apps ({footballStats.starts} Starts)
                            </span>
                            <span className="text-[10px] text-[#64748B] font-semibold block mt-0.5">
                              {footballStats.minutesPlayed !== null ? `${footballStats.minutesPlayed} mins` : `${footballStats.substitutionsIn} Subs In`}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Badminton Career Summary Statistics Grid */}
                    {(!footballStats || footballStats.matchesPlayed === 0 || playerStats?.matchesPlayed! > 0) && (
                      <div className="pro-card p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <h2 className="text-base font-bold text-[#0F172A]">Personal Statistics Overview</h2>
                          {playerStats && playerStats.recentForm && playerStats.recentForm.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-[#64748B] uppercase">Recent Form:</span>
                              <div className="flex items-center gap-1">
                                {playerStats.recentForm.map((formType, idx) => {
                                  const detail = playerStats.formDetails?.[idx];
                                  const isWin = formType === 'W';
                                  const isLoss = formType === 'L';
                                  const isSpecial = ['W.O.', 'DEFAULT', 'RET', 'BYE'].includes(formType);
                                  
                                  return (
                                    <span
                                      key={idx}
                                      title={detail ? `${formType} vs ${detail.opponentName || 'Opponent'} (${detail.scoreDisplay || detail.outcome || ''})` : formType}
                                      className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold uppercase transition ${
                                        isWin
                                          ? 'bg-[#14966B] text-white'
                                          : isLoss
                                          ? 'bg-[#D92D20] text-white'
                                          : isSpecial
                                          ? 'bg-[#C98218] text-white'
                                          : 'bg-[#64748B] text-white'
                                      }`}
                                    >
                                      {formType}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Matches Won / Lost</span>
                            <span className="text-xl font-bold text-[#0F172A] block mt-1">
                              {playerStats?.matchesWon || 0} - {playerStats?.matchesLost || 0}
                            </span>
                            <span className="text-[10px] text-[#14966B] font-semibold block mt-0.5">
                              {(playerStats?.winPercentage || 0).toFixed(1)}% Win Rate
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Games Won / Lost</span>
                            <span className="text-xl font-bold text-[#14966B] block mt-1">
                              {playerStats?.gamesWon || 0} - {playerStats?.gamesLost || 0}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-semibold block mt-0.5">
                              Diff: {(playerStats?.gameDifference || 0) > 0 ? `+${playerStats?.gameDifference}` : playerStats?.gameDifference || 0}
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Points Scored / Conceded</span>
                            <span className="text-xl font-bold text-[#2563EB] block mt-1">
                              {playerStats?.pointsScored || 0} - {playerStats?.pointsConceded || 0}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-semibold block mt-0.5">
                              Diff: {(playerStats?.pointDifference || 0) > 0 ? `+${playerStats?.pointDifference}` : playerStats?.pointDifference || 0}
                            </span>
                          </div>
                          <div className="pro-surface-subtle p-4 rounded-xl">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Winning / Losing Streak</span>
                            <span className="text-xl font-bold text-[#0F172A] block mt-1">
                              {playerStats?.currentWinningStreak ? `${playerStats.currentWinningStreak}W` : (playerStats?.currentLosingStreak ? `${playerStats.currentLosingStreak}L` : '0')}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-semibold block mt-0.5">
                              Max Win Streak: {playerStats?.longestWinningStreak || 0}W
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Head-to-Head Records */}
                    {h2hList.length > 0 && (
                      <div className="pro-card p-6 space-y-4">
                        <h2 className="text-base font-bold text-[#0F172A]">Head-to-Head Opponent Records</h2>
                        <div className="space-y-3">
                          {h2hList.map((h2h) => (
                            <div key={h2h.opponentId} className="pro-surface-subtle rounded-xl p-4 flex justify-between items-center">
                              <div>
                                <h3 className="text-sm font-bold text-[#0F172A]">vs {h2h.opponentName}</h3>
                                <p className="text-xs text-[#64748B] mt-0.5">
                                  Games: {h2h.stats.playerAGamesWon} - {h2h.stats.playerBGamesWon} • Points: {h2h.stats.playerAPoints} - {h2h.stats.playerBPoints}
                                </p>
                              </div>
                              <span className="font-mono text-sm font-bold text-[#14966B] bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                                {h2h.stats.playerAWins}W - {h2h.stats.playerBWins}L
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Category Standings */}
                    {playerStandings.length > 0 && (
                      <div className="space-y-4">
                        {playerStandings.map((st, i) => (
                          <div key={i} className="pro-card p-6 space-y-4">
                            <h2 className="text-base font-bold text-[#0F172A]">{st.categoryName} — Standings</h2>
                            <div className="overflow-x-auto">
                              {st.isFootball ? (
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-200/80 text-[#64748B] uppercase text-[10px]">
                                      <th className="py-2 pr-3">Rank</th>
                                      <th className="py-2 pr-3">Team / Participant</th>
                                      <th className="py-2 pr-3 text-center">P</th>
                                      <th className="py-2 pr-3 text-center">W</th>
                                      <th className="py-2 pr-3 text-center">D</th>
                                      <th className="py-2 pr-3 text-center">L</th>
                                      <th className="py-2 pr-3 text-center">GF</th>
                                      <th className="py-2 pr-3 text-center">GA</th>
                                      <th className="py-2 pr-3 text-center">GD</th>
                                      <th className="py-2 pr-3 text-center font-bold text-[#0F172A]">PTS</th>
                                      <th className="py-2 pr-3">Tie-Break Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {st.entries.map((e) => (
                                      <tr key={e.participant_id} className="border-b border-slate-100 hover:bg-emerald-50/30 transition">
                                        <td className="py-2.5 font-bold text-[#0F172A] pr-3">#{e.rank}</td>
                                        <td className="py-2.5 font-semibold text-[#0F172A] pr-3">
                                          {e.participant_name || (e.participant_id === user?.id ? `${profile?.displayName || 'You'} (You)` : 'Participant')}
                                        </td>
                                        <td className="py-2.5 text-center pr-3">{e.played}</td>
                                        <td className="py-2.5 text-center pr-3 font-semibold text-[#14966B]">{e.won}</td>
                                        <td className="py-2.5 text-center pr-3 font-semibold text-[#64748B]">{e.drawn ?? 0}</td>
                                        <td className="py-2.5 text-center pr-3 font-semibold text-[#64748B]">{e.lost}</td>
                                        <td className="py-2.5 text-center pr-3 font-mono">{e.goals_for ?? e.goalsFor ?? 0}</td>
                                        <td className="py-2.5 text-center pr-3 font-mono">{e.goals_against ?? e.goalsAgainst ?? 0}</td>
                                        <td className="py-2.5 text-center pr-3 font-mono font-bold">
                                          {(e.goal_difference ?? e.goalDifference ?? 0) > 0 ? `+${e.goal_difference ?? e.goalDifference}` : (e.goal_difference ?? e.goalDifference ?? 0)}
                                        </td>
                                        <td className="py-2.5 text-center pr-3 font-mono font-bold text-[#0F172A]">{e.points ?? 0}</td>
                                        <td className="py-2.5 text-[11px] text-[#64748B] pr-3">
                                          {e.tieBreakReason || '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-200/80 text-[#64748B] uppercase text-[10px]">
                                      <th className="py-2 pr-3">Rank</th>
                                      <th className="py-2 pr-3">Participant</th>
                                      <th className="py-2 pr-3 text-center">Played</th>
                                      <th className="py-2 pr-3 text-center">Won</th>
                                      <th className="py-2 pr-3 text-center">Lost</th>
                                      <th className="py-2 pr-3 text-center">Games (W/L)</th>
                                      <th className="py-2 pr-3 text-center">Points Diff</th>
                                      <th className="py-2 pr-3">Tie-Break Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {st.entries.map((e) => (
                                      <tr key={e.participant_id} className="border-b border-slate-100 hover:bg-emerald-50/30 transition">
                                        <td className="py-2.5 font-bold text-[#0F172A] pr-3">#{e.rank}</td>
                                        <td className="py-2.5 font-semibold text-[#0F172A] pr-3">
                                          {e.participant_id === user?.id ? `${profile?.displayName || 'You'} (You)` : 'Participant'}
                                        </td>
                                        <td className="py-2.5 text-center pr-3">{e.played}</td>
                                        <td className="py-2.5 text-center pr-3 font-semibold text-[#14966B]">{e.won}</td>
                                        <td className="py-2.5 text-center pr-3 font-semibold text-[#64748B]">{e.lost}</td>
                                        <td className="py-2.5 text-center pr-3 font-mono">{e.games_won ?? e.gamesWon ?? 0}-{e.games_lost ?? e.gamesLost ?? 0}</td>
                                        <td className="py-2.5 text-center pr-3 font-mono font-bold">
                                          {e.points_diff > 0 ? `+${e.points_diff}` : e.points_diff}
                                        </td>
                                        <td className="py-2.5 text-[11px] text-[#64748B] pr-3">
                                          {e.tieBreakReason || '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          // ==========================================
          // ORGANIZER OPERATIONS CONSOLE
          // ==========================================
          <div className="space-y-8">
            {/* Header */}
            <div className="pro-glass-primary p-6 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] animate-pulse" />
                  <span className="text-[11px] font-bold text-[#14966B] uppercase tracking-wider">Tournament Control Center</span>
                  <span className="bg-emerald-50 text-[#14966B] border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase">
                    ORGANIZER
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">
                  Tournament Operations
                </h1>
                <p className="text-xs sm:text-sm text-[#475467] mt-0.5">
                  Welcome back, <span className="font-semibold text-[#0F172A]">{profile?.fullName || profile?.displayName || user?.email}</span>. Manage competitions, brackets, courts, and real-time live match scoring.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/player"
                  className="glass-pill text-[#475467] hover:text-[#0F172A] px-3.5 py-2 text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <span>Athlete / Player View</span>
                  <span>→</span>
                </Link>
                <Link
                  href="/tournaments/create"
                  className="btn-primary shadow-sm flex items-center gap-2"
                >
                  <span>+</span>
                  <span>Create Tournament</span>
                </Link>
              </div>
            </div>

            {/* Quick Actions Toolbar */}
            <div className="pro-glass p-4 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A] uppercase tracking-wider">
                <span className="text-sm">⚡</span>
                <span>Quick Actions:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/tournaments/create"
                  className="bg-emerald-50 hover:bg-emerald-100 text-[#14966B] px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-emerald-200"
                >
                  + New Tournament
                </Link>
                <a
                  href="#tournaments"
                  className="glass-pill text-[#475467] px-3 py-1.5 text-xs font-semibold transition"
                >
                  Manage Tournaments ({orgStats.total})
                </a>
                <a
                  href="#matches"
                  className="glass-pill text-[#475467] px-3 py-1.5 text-xs font-semibold transition"
                >
                  Live Matches ({allLiveMatches.length})
                </a>
                <Link
                  href="/player"
                  className="glass-pill text-[#475467] px-3 py-1.5 text-xs font-semibold transition"
                >
                  Player Portal
                </Link>
              </div>
            </div>

            {/* Operational Overview Statistics */}
            <div id="stats">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Tournaments', count: orgStats.total, color: 'text-[#0F172A]', iconBg: 'bg-amber-50 text-amber-600 border border-amber-200/60', icon: '🏆' },
                  { label: 'Published / Live', count: orgStats.published, color: 'text-[#14966B]', iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-200/60', icon: '●' },
                  { label: 'Drafts', count: orgStats.drafts, color: 'text-[#C98218]', iconBg: 'bg-blue-50 text-blue-600 border border-blue-200/60', icon: '📝' },
                  { label: 'Completed', count: orgStats.completed, color: 'text-[#7C3AED]', iconBg: 'bg-purple-50 text-purple-600 border border-purple-200/60', icon: '🏁' },
                ].map((stat, i) => (
                  <div key={i} className="pro-stat-card">
                    <div className="flex justify-between items-start">
                      <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                        {stat.label}
                      </span>
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs ${stat.iconBg}`}>{stat.icon}</span>
                    </div>
                    <span className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${stat.color} block mt-2`}>
                      {stat.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* LIVE NOW Section (if active matches exist) */}
            {allLiveMatches.length > 0 && (
              <div id="matches" className="pro-glass-primary p-6 space-y-4 shadow-sm">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200/80">
                  <div className="flex items-center gap-2.5">
                    <span className="live-dot-slow" />
                    <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
                      LIVE NOW
                    </h2>
                  </div>
                  <span className="text-xs font-semibold text-[#14966B] bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {allLiveMatches.length} {allLiveMatches.length === 1 ? 'match' : 'matches'} in progress
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {allLiveMatches.map(({ match, tournament }) => {
                    const games = match.games || [];
                    const activeGame = games.find((g: any) => !g.is_completed) || games[games.length - 1];
                    const gameNum = activeGame ? activeGame.game_number : 1;
                    const scoreA = activeGame ? activeGame.participant_a_score ?? 0 : 0;
                    const scoreB = activeGame ? activeGame.participant_b_score ?? 0 : 0;
                    const isFoot = isFootballMatch(match);

                    return (
                      <div key={match.id} className="scoreboard-card p-4 flex flex-col justify-between gap-3 hover:border-emerald-300/80 transition">
                        <div className="flex justify-between items-center border-b border-slate-200/80 pb-2">
                          <span className="text-xs font-bold text-[#2563EB] uppercase tracking-wider flex items-center gap-1.5">
                            <span>{isFoot ? '⚽' : '🏸'}</span>
                            <span>{match.court?.name || 'Court'}</span>
                          </span>
                          <span className="badge-live text-[9px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#14966B]" />
                            <span>LIVE</span>
                          </span>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs font-semibold text-[#0F172A]">
                            <span className="truncate max-w-[140px]">{getPlayerNames(match.participant_a)}</span>
                            <span className="font-mono font-extrabold text-[#14966B] text-base tabular-nums bg-white/90 px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                              {isFoot ? (match.score_a ?? 0) : scoreA}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-semibold text-[#0F172A]">
                            <span className="truncate max-w-[140px]">{getPlayerNames(match.participant_b)}</span>
                            <span className="font-mono font-extrabold text-[#64748B] text-base tabular-nums bg-white/90 px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                              {isFoot ? (match.score_b ?? 0) : scoreB}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#64748B] pt-1 flex justify-between items-center">
                            <span>{isFoot ? (match.match_phase?.replace(/_/g, ' ') || 'Football') : `Game ${gameNum}`}</span>
                            <span className="truncate max-w-[130px] font-medium">{tournament.name}</span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-200/80">
                          <Link
                            href={`/matches/${match.id}/score`}
                            className="w-full block text-center bg-[#14966B] hover:bg-[#10805B] text-white font-semibold text-xs py-2 px-3 rounded-lg transition shadow-2xs"
                          >
                            Open Score Console →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tournaments Section */}
            <div id="tournaments" className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-[#0F172A]">
                  Your Tournaments
                </h2>
              </div>

              {/* Tabs Filter */}
              <div className="flex border-b border-slate-200/80 space-x-6">
                {(['ALL', 'DRAFT', 'PUBLISHED', 'COMPLETED'] as const).map((tab) => {
                  const count = tab === 'ALL' ? orgStats.total : tab === 'PUBLISHED' ? orgStats.published : tab === 'DRAFT' ? orgStats.drafts : orgStats.completed;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveOrgTab(tab)}
                      className={`pb-3 text-xs font-semibold tracking-wide border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                        activeOrgTab === tab
                          ? 'border-[#14966B] text-[#14966B]'
                          : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      <span>{tab}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        activeOrgTab === tab ? 'bg-emerald-50 text-[#14966B]' : 'bg-slate-100 text-[#64748B]'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Tournaments List */}
              {loadingTournaments ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-32 pro-card skeleton-shimmer rounded-xl" />
                  ))}
                </div>
              ) : error ? (
                <div className="bg-[#FDEEEE]/90 backdrop-blur-md border border-[#FECDCA] text-[#C94A4A] rounded-xl p-4 text-xs font-medium" role="alert">
                  {error}
                </div>
              ) : filteredTournaments.length === 0 ? (
                <div className="pro-card p-12 text-center text-[#64748B] space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-[#14966B] text-xl flex items-center justify-center mx-auto border border-emerald-200/60">
                    🏆
                  </div>
                  <span className="block text-base font-bold text-[#0F172A]">
                    No Tournaments Found
                  </span>
                  <p className="text-xs text-[#64748B] max-w-sm mx-auto">
                    {activeOrgTab === 'ALL'
                      ? "You haven't created any tournaments yet. Get started by setting up your first tournament."
                      : `No tournaments matching status '${activeOrgTab}'.`}
                  </p>
                  {activeOrgTab === 'ALL' && (
                    <Link
                      href="/tournaments/create"
                      className="btn-primary inline-flex mt-2"
                    >
                      + Create Your First Tournament
                    </Link>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredTournaments.map((t) => {
                    const metrics = computeMetrics(t);
                    const sportName = Array.isArray(t.sports) ? t.sports[0]?.name : t.sports?.name || 'Badminton';
                    const isFoot = sportName.toUpperCase() === 'FOOTBALL';

                    return (
                      <div
                        key={t.id}
                        className="pro-card pro-card-hover p-5 space-y-4"
                      >
                        {/* Tournament Card Header */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-200/80">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] bg-slate-100 text-[#475467] font-bold px-2 py-0.5 rounded border border-slate-200 uppercase flex items-center gap-1">
                                <span>{isFoot ? '⚽' : '🏸'}</span>
                                <span>{sportName}</span>
                              </span>
                              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                                t.status === 'PUBLISHED'
                                  ? 'badge-live'
                                  : t.status === 'COMPLETED'
                                  ? 'badge-completed'
                                  : 'badge-paused'
                              }`}>
                                {t.status === 'PUBLISHED' ? '● LIVE' : t.status}
                              </span>
                            </div>
                            <h3 className="text-lg font-bold text-[#0F172A]">
                              {t.name}
                            </h3>
                            <div className="text-xs text-[#64748B]">
                              <span>{Array.isArray(t.venues) ? t.venues[0]?.name : t.venues?.name || 'Venue Unassigned'}</span>
                              <span className="mx-2">•</span>
                              <span>{new Date(t.start_date).toLocaleDateString()} – {new Date(t.end_date).toLocaleDateString()}</span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/tournaments/${t.slug}/configure?tab=court_board`}
                              className="bg-emerald-50 hover:bg-emerald-100 text-[#14966B] font-semibold text-xs px-3 py-1.5 rounded-lg border border-emerald-200 transition shadow-2xs"
                            >
                              Court Status
                            </Link>
                            <Link
                              href={`/tournaments/${t.slug}/configure?tab=matches`}
                              className="bg-[#EEF4FF] hover:bg-[#CFDEFB] text-[#2563EB] font-semibold text-xs px-3 py-1.5 rounded-lg border border-[#CFDEFB] transition shadow-2xs"
                            >
                              Match Control
                            </Link>
                            <Link
                              href={`/tournaments/${t.slug}/configure`}
                              className="glass-pill text-[#334155] font-semibold text-xs px-3 py-1.5 transition shadow-2xs"
                            >
                              Configure
                            </Link>
                            {t.status === 'PUBLISHED' && (
                              <Link
                                href={`/tournaments/${t.slug}`}
                                className="bg-white/90 hover:bg-white text-[#0F172A] font-semibold text-xs px-3 py-1.5 rounded-lg border border-slate-200 transition shadow-2xs"
                              >
                                Public Live Page →
                              </Link>
                            )}
                          </div>
                        </div>

                        {/* 8 Operational Statistics Columns */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pro-surface-subtle rounded-xl p-3 text-center">
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Registered</span>
                            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{metrics.registeredPlayers}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Approved</span>
                            <span className="text-sm font-bold text-[#14966B] tabular-nums">{metrics.approvedParticipants}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Pending</span>
                            <span className="text-sm font-bold text-[#C98218] tabular-nums">{metrics.pendingRegistrations}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Matches</span>
                            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{metrics.totalMatches}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Live</span>
                            <span className="text-sm font-bold text-[#14966B] tabular-nums">{metrics.liveMatches}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Completed</span>
                            <span className="text-sm font-bold text-[#7C3AED] tabular-nums">{metrics.completedMatches}</span>
                          </div>
                          <div className="border-r border-slate-200/80 pr-1">
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Courts</span>
                            <span className="text-sm font-bold text-[#2563EB] tabular-nums">{metrics.assignedCourts}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Scorers</span>
                            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{metrics.assignedScorers}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
