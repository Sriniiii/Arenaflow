'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../services/supabase';
import Navigation from '../../../components/Navigation';
import dynamic from 'next/dynamic';
import { BadmintonRules, FootballRules } from '@arena-flow/sport-engine';
import {
  sortStandings,
  calculatePlayerStats,
  calculateFootballPlayerStats,
  calculateTournamentStats,
  calculateTournamentRecords,
  calculateLeaderboards,
  calculateFootballLeaderboards,
  calculateBadmintonAnalytics,
  calculateFootballAnalytics,
  calculateMatchAnalytics,
  FootballPlayerStats
} from '@arena-flow/statistics-engine';
import {
  ReportType,
  ExportFormat,
  buildResultsReportData,
  buildStandingsReportData,
  buildScheduleReportData,
  buildDrawReportData,
  exportTournamentReport,
  triggerBrowserDownload
} from '../../../services/reports';

const LiveVenueMap = dynamic(() => import('../../../components/LiveVenueMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] flex items-center justify-center bg-slate-900 border border-slate-800 rounded-2xl text-gray-400 font-semibold uppercase tracking-wider">
      Loading 3D Live Arena...
    </div>
  ),
});

interface Sport {
  id: string;
  name: string;
}

interface Venue {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
}

interface Tournament {
  id: string;
  name: string;
  description: string;
  slug: string;
  sport_id: string;
  venue_id: string | null;
  start_date: string;
  end_date: string;
  registration_open: string;
  registration_close: string;
  status: 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';
  rules: string;
  organizer_id: string;
  sports: Sport | null;
  venues: Venue | null;
}

interface Category {
  id: string;
  name: string;
  category_type: 'SINGLES' | 'DOUBLES';
  match_type: 'MENS' | 'WOMENS' | 'MIXED';
  format: 'KNOCKOUT' | 'ROUND_ROBIN' | 'GROUP_KNOCKOUT';
  age_group?: string;
  skill_level?: string;
  registration_fee: number;
}

interface Player {
  id: string;
  full_name: string;
  display_name?: string;
}

interface Participant {
  id: string;
  participant_type: 'INDIVIDUAL' | 'TEAM';
  status: 'ACTIVE' | 'WITHDRAWN';
  category: {
    id: string;
    name: string;
  };
  members: {
    player: Player;
  }[];
}

export default function PublicTournamentPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allCourts, setAllCourts] = useState<any[]>([]);

  const [draws, setDraws] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [drawNodes, setDrawNodes] = useState<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [standingsEntries, setStandingsEntries] = useState<any[]>([]);
  
  const [loadingPage, setLoadingPage] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Phase 7 States
  const [activeScorers, setActiveScorers] = useState<Record<string, any>>({});
  const [connStatus, setConnStatus] = useState<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  const [viewMode, setViewMode] = useState<'LIST' | '3D'>('3D');
  const [exportingReport, setExportingReport] = useState(false);
  const liveEventsRef = useRef<Record<string, any[]>>({});
  const [selectedCourtMatch, setSelectedCourtMatch] = useState<any | null>(null);
  const [hasWebGL, setHasWebGL] = useState(true);

  // Feature 11 Spectator Enhancement States
  const [selectedMatchDetail, setSelectedMatchDetail] = useState<any | null>(null);
  const selectedMatchDetailRef = useRef<any | null>(null);
  const [matchTimelineEvents, setMatchTimelineEvents] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  useEffect(() => {
    selectedMatchDetailRef.current = selectedMatchDetail;
  }, [selectedMatchDetail]);

  const openMatchDetail = async (match: any) => {
    if (!match || !match.id || match.id.startsWith('empty-')) return;
    setSelectedMatchDetail(match);
    setLoadingTimeline(true);
    try {
      const { data, error } = await supabase
        .from('match_events')
        .select('*')
        .eq('match_id', match.id)
        .order('sequence_number', { ascending: true });
      if (!error && data) {
        setMatchTimelineEvents(data);
      } else {
        setMatchTimelineEvents([]);
      }
    } catch (err) {
      console.error('Error fetching match timeline:', err);
      setMatchTimelineEvents([]);
    } finally {
      setLoadingTimeline(false);
    }
  };

  const closeMatchDetail = () => {
    setSelectedMatchDetail(null);
    setMatchTimelineEvents([]);
  };

  const isFootballMatch = (m: any) => {
    return tournament?.sports?.name?.toUpperCase() === 'FOOTBALL' ||
      m?.category?.sport?.name?.toUpperCase() === 'FOOTBALL' ||
      (m?.score_a !== undefined && m?.score_a !== null) ||
      (m?.match_phase !== undefined && m?.match_phase !== null);
  };

  const getEventPlayerName = (playerIdOrEv?: any, fieldNameOrMatch?: any, match?: any) => {
    let pId: string | undefined;
    let matchContext: any = match;

    if (typeof playerIdOrEv === 'string') {
      pId = playerIdOrEv;
      matchContext = fieldNameOrMatch;
    } else if (playerIdOrEv && typeof playerIdOrEv === 'object') {
      const ev = playerIdOrEv;
      const fieldName = typeof fieldNameOrMatch === 'string' ? fieldNameOrMatch : undefined;
      pId = fieldName && ev.detail ? ev.detail[fieldName] : (ev.player_id || (fieldName ? ev[fieldName] : undefined));
      if (!matchContext && typeof fieldNameOrMatch === 'object' && fieldNameOrMatch !== null) {
        matchContext = fieldNameOrMatch;
      }
    }

    if (!pId) return 'Player';

    // Check match context lineup data
    if (matchContext?.lineup_data) {
      const teamAxi = matchContext.lineup_data.teamA?.startingXI || [];
      const teamAsubs = matchContext.lineup_data.teamA?.substitutes || [];
      const teamBxi = matchContext.lineup_data.teamB?.startingXI || [];
      const teamBsubs = matchContext.lineup_data.teamB?.substitutes || [];
      const found = [...teamAxi, ...teamAsubs, ...teamBxi, ...teamBsubs].find((pl: any) => pl.playerId === pId);
      if (found?.playerName) return found.playerName;
    }

    const allMembers = [
      ...(matchContext?.participant_a?.members || []),
      ...(matchContext?.participant_b?.members || []),
      ...participants.flatMap((p: any) => p.members || [])
    ];
    const found = allMembers.find((m: any) => m.player?.id === pId || m.player_id === pId);
    return found?.player?.display_name || found?.player?.full_name || 'Player';
  };

  const formatOutcomeScore = (m: any) => {
    if (!m) return { text: '', outcomeLabel: undefined };
    if (m.outcome === 'BYE') {
      return { text: 'Bye (Advances)', outcomeLabel: 'BYE' };
    }
    if (m.outcome === 'WALKOVER') {
      return { text: 'Walkover (W.O.)', outcomeLabel: 'WALKOVER' };
    }
    if (m.outcome === 'DEFAULT') {
      return { text: 'Default (Def.)', outcomeLabel: 'DEFAULT' };
    }
    if (m.outcome === 'ABANDONED') {
      const score = (m.score_a !== undefined && m.score_b !== undefined) ? `${m.score_a}-${m.score_b} ` : '';
      return { text: `${score}(Abandoned)`, outcomeLabel: 'ABANDONED' };
    }

    // Check if Football match
    if (m.score_a !== undefined && m.score_a !== null && m.score_b !== undefined && m.score_b !== null && (m.games === undefined || m.games.length === 0 || m.match_phase !== undefined)) {
      let footScore = `${m.score_a}-${m.score_b}`;
      const shA = m.shootout_score_a ?? m.shootout_score?.score_a;
      const shB = m.shootout_score_b ?? m.shootout_score?.score_b;
      if (shA !== undefined && shA !== null && shB !== undefined && shB !== null) {
        footScore += ` (${shA}-${shB} pens)`;
      } else if (m.extra_time_score || m.extra_time_score_a !== undefined || m.match_phase === 'EXTRA_TIME_SECOND_HALF') {
        footScore += ' (A.E.T.)';
      }

      if (m.outcome === 'RETIREMENT') {
        return { text: `${footScore} (Ret.)`, outcomeLabel: 'RETIREMENT' };
      }
      return { text: footScore, outcomeLabel: undefined };
    }

    const gameScores = [...(m.games || [])].sort((a: any, b: any) => a.game_number - b.game_number);
    const scoreBase = gameScores.length > 0
      ? gameScores.map((g: any) => `${g.participant_a_score ?? 0}-${g.participant_b_score ?? 0}`).join(', ')
      : '';

    if (m.outcome === 'RETIREMENT') {
      return {
        text: gameScores.length > 0 ? `${scoreBase} (Ret.)` : 'Retired',
        outcomeLabel: 'RETIREMENT'
      };
    }
    return { text: scoreBase || '0-0', outcomeLabel: undefined };
  };

  const handleExportPublicReport = (reportType: 'results' | 'standings' | 'schedule' | 'draw', format: ExportFormat) => {
    if (!tournament) return;
    try {
      setExportingReport(true);
      let tableData;
      let filenameBase = `${tournament.slug || tournament.name}_${reportType}`;

      switch (reportType) {
        case 'results':
          tableData = buildResultsReportData(tournament, categories, matches, [], allCourts);
          break;
        case 'standings':
          tableData = buildStandingsReportData(tournament, categories, participants, matches);
          break;
        case 'schedule':
          tableData = buildScheduleReportData(tournament, categories, matches, [], allCourts);
          break;
        case 'draw': {
          const firstCat = categories[0];
          const draw = draws.find(d => d.category_id === firstCat?.id);
          const catRounds = rounds.filter(r => r.draw_id === draw?.id);
          const catDrawNodes = drawNodes.filter(n => n.draw_id === draw?.id);
          tableData = buildDrawReportData(tournament, firstCat, draw, catRounds, catDrawNodes, matches);
          filenameBase = `${tournament.slug || tournament.name}_draw_${firstCat?.name || 'bracket'}`;
          break;
        }
      }

      if (tableData) {
        const { filename, mimeType, content } = exportTournamentReport(tableData, format, filenameBase);
        triggerBrowserDownload(content, filename, mimeType);
      }
    } catch (err: any) {
      console.error('Export error:', err);
    } finally {
      setExportingReport(false);
    }
  };

  const getPlayerNames = (participant: any) => {
    if (!participant?.members) return 'TBD';
    return participant.members.map((m: any) => m.player?.display_name || m.player?.full_name || 'Player').join(' / ');
  };

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const glSupport = !!window.WebGLRenderingContext &&
        (!!canvas.getContext('webgl') || !!canvas.getContext('experimental-webgl'));
      setHasWebGL(glSupport);
      if (!glSupport) {
        setViewMode('LIST');
      }
    } catch (e) {
      setHasWebGL(false);
      setViewMode('LIST');
    }
  }, []);

  const fetchLiveEvents = async (liveMatchIds: string[]) => {
    if (liveMatchIds.length === 0) return;
    const { data } = await supabase
      .from('match_events')
      .select('*')
      .in('match_id', liveMatchIds)
      .order('sequence_number', { ascending: true });
    
    const groups: Record<string, any[]> = {};
    for (const mid of liveMatchIds) {
      groups[mid] = [];
    }
    if (data) {
      for (const ev of data) {
        if (!groups[ev.match_id]) groups[ev.match_id] = [];
        groups[ev.match_id].push(ev);
      }
    }
    liveEventsRef.current = { ...liveEventsRef.current, ...groups };
  };

  // Player registration state
  const [regCategoryId, setRegCategoryId] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [registering, setRegistering] = useState(false);
  const [myRegistrations, setMyRegistrations] = useState<any[]>([]);
  const [playerGender, setPlayerGender] = useState('');
  const [playerDob, setPlayerDob] = useState('');
  const [partnerGender, setPartnerGender] = useState('');
  const [partnerDob, setPartnerDob] = useState('');

  const fetchTournamentData = async () => {
    try {
      setLoadingPage(true);
      setErrorMsg(null);
      setNotFound(false);

      // 1. Fetch tournament by slug
      const { data: tourney, error: tErr } = await supabase
        .from('tournaments')
        .select('*, sports(*), venues(*)')
        .eq('slug', slug)
        .maybeSingle();

      if (tErr) throw tErr;
      if (!tourney) {
        setNotFound(true);
        return;
      }

      // Privacy Enforcement:
      const isOwner = user && tourney.organizer_id === user.id;
      const isAdmin = profile?.role === 'PLATFORM_ADMIN';
      if (tourney.status === 'DRAFT' && !isOwner && !isAdmin) {
        setNotFound(true);
        return;
      }

      setTournament(tourney);

      // 2. Fetch categories
      const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .eq('tournament_id', tourney.id);
      setCategories(cats || []);
      if (cats && cats.length > 0) {
        setRegCategoryId(cats[0].id);
      }

      // 3. Fetch participants
      const { data: parts } = await supabase
        .from('participants')
        .select(`
          id,
          participant_type,
          status,
          category: categories ( id, name ),
          members: participant_members (
            player: players ( id, full_name, display_name )
          )
        `)
        .in('category_id', cats?.map(c => c.id) || []);
      setParticipants((parts as any) || []);

      // 3.5. Fetch all courts for the venue if it exists
      if (tourney.venue_id) {
        const { data: crts } = await supabase
          .from('courts')
          .select('*')
          .eq('venue_id', tourney.venue_id)
          .order('name', { ascending: true });
        setAllCourts(crts || []);
      } else {
        setAllCourts([]);
      }

      // 4. Fetch logged in player's registrations
      if (user) {
        const { data: myRegs } = await supabase
          .from('registrations')
          .select(`
            id,
            status,
            category_id,
            participant_id,
            created_at,
            participant: participants (
              members: participant_members (
                player_id
              )
            )
          `)
          .in('category_id', cats?.map(c => c.id) || []);

        const filteredRegs = myRegs?.filter((r: any) =>
          r.participant?.members?.some((m: any) => m.player_id === user.id)
        ) || [];
        setMyRegistrations(filteredRegs);
      } else {
        setMyRegistrations([]);
      }

      const catIds = cats?.map(c => c.id) || [];
      if (catIds.length > 0) {
        const { data: drawsData } = await supabase
          .from('draws')
          .select('*')
          .in('category_id', catIds)
          .eq('status', 'PUBLISHED');
        const fetchedDraws = drawsData || [];
        setDraws(fetchedDraws);

        const drawIds = fetchedDraws.map(d => d.id);
        if (drawIds.length > 0) {
          const { data: roundsData } = await supabase
            .from('rounds')
            .select('*')
            .in('draw_id', drawIds)
            .order('round_number', { ascending: true });
          setRounds(roundsData || []);

          const { data: drawNodesData } = await supabase
            .from('draw_nodes')
            .select('*')
            .in('draw_id', drawIds)
            .order('round_number', { ascending: true })
            .order('position', { ascending: true });
          setDrawNodes(drawNodesData || []);
        } else {
          setRounds([]);
          setDrawNodes([]);
        }

        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            id,
            category_id,
            round_id,
            participant_a_id,
            participant_b_id,
            court_id,
            scheduled_at,
            status,
            winner_id,
            outcome,
            duration_minutes,
            service_state,
            score_a,
            score_b,
            halftime_score,
            extra_time_score,
            shootout_score,
            match_phase,
            lineup_data,
            outcome_details,
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            court: courts ( id, name ),
            games ( id, game_number, participant_a_score, participant_b_score, service_state, status )
          `)
          .in('category_id', catIds);
        setMatches(matchesData || []);

        const liveMatchIds = (matchesData || [])
          .filter((m: any) => m.status === 'LIVE' || m.status === 'UNDER_REVIEW')
          .map((m: any) => m.id);
        if (liveMatchIds.length > 0) {
          await fetchLiveEvents(liveMatchIds);
        }

        const { data: standingsData } = await supabase
          .from('standings')
          .select('*')
          .in('category_id', catIds);
        const fetchedStandings = standingsData || [];
        setStandings(fetchedStandings);

        const standingsIds = fetchedStandings.map(s => s.id);
        if (standingsIds.length > 0) {
          const { data: standingsEntriesData } = await supabase
            .from('standings_entries')
            .select('*')
            .in('standings_id', standingsIds);
          setStandingsEntries(standingsEntriesData || []);
        } else {
          setStandingsEntries([]);
        }
      } else {
        setDraws([]);
        setRounds([]);
        setMatches([]);
        setDrawNodes([]);
        setStandings([]);
        setStandingsEntries([]);
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to load tournament info.');
    } finally {
      setLoadingPage(false);
    }
  };

  useEffect(() => {
    // Only load once auth states are checked
    if (!loading) {
      fetchTournamentData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user, loading]);

  const matchesRef = useRef<any[]>([]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  useEffect(() => {
    if (!tournament) return;

    // 1. Subscribe to connection status and lightweight table changes
    const channel = supabase
      .channel(`tournament_spectator:${tournament.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_events' },
        async (payload: any) => {
          const newEvent = payload.new;
          const matchId = newEvent.match_id;

          // Ignore events for matches not belonging to this tournament
          const matchExists = matchesRef.current.some(m => m.id === matchId);
          if (!matchExists) return;

          // Lazily load the event history if we don't have it yet
          if (!liveEventsRef.current[matchId]) {
            await fetchLiveEvents([matchId]);
          } else {
            // Check to avoid inserting duplicate events if realtime triggers twice
            const exists = liveEventsRef.current[matchId].some(e => e.id === newEvent.id);
            if (!exists) {
              liveEventsRef.current[matchId] = [...liveEventsRef.current[matchId], newEvent];
            }
          }

          // Reconstruct the score using sport-engine rules
          const targetMatch = matchesRef.current.find(m => m.id === matchId);
          const isFoot = tournament?.sports?.name?.toUpperCase() === 'FOOTBALL' ||
            (targetMatch?.score_a !== undefined && targetMatch?.score_a !== null) ||
            (targetMatch?.match_phase !== undefined && targetMatch?.match_phase !== null);

          if (isFoot) {
            const fRules = new FootballRules();
            let fState = fRules.getInitialState();
            for (const ev of liveEventsRef.current[matchId]) {
              fState = fRules.applyEvent(fState, ev);
            }

            // If the selected match detail modal is open for this match, sync timeline
            if (selectedMatchDetailRef.current?.id === matchId) {
              setMatchTimelineEvents(prev => {
                if (prev.some(e => e.id === newEvent.id)) return prev;
                return [...prev, newEvent].sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
              });
            }

            // Update only the affected match in the React state
            setMatches(prevMatches => {
              return prevMatches.map(m => {
                if (m.id !== matchId) return m;

                const updatedMatchObj = {
                  ...m,
                  score_a: fState.scoreA,
                  score_b: fState.scoreB,
                  match_phase: fState.phase,
                  current_period: fState.phase,
                  halftime_score_a: fState.halftimeScore?.scoreA ?? m.halftime_score_a,
                  halftime_score_b: fState.halftimeScore?.scoreB ?? m.halftime_score_b,
                  extra_time_score_a: fState.extraTimeScore?.scoreA ?? m.extra_time_score_a,
                  extra_time_score_b: fState.extraTimeScore?.scoreB ?? m.extra_time_score_b,
                  shootout_score_a: fState.shootoutState?.scoreA ?? m.shootout_score_a,
                  shootout_score_b: fState.shootoutState?.scoreB ?? m.shootout_score_b,
                };

                if (selectedMatchDetailRef.current?.id === matchId) {
                  setSelectedMatchDetail(updatedMatchObj);
                }

                return updatedMatchObj;
              });
            });
          } else {
            // Reconstruct the score using sport-engine rules
            const rules = new BadmintonRules();
            let nextState = rules.getInitialState();
            for (const ev of liveEventsRef.current[matchId]) {
              nextState = rules.applyEvent(nextState, ev);
            }

            // If the selected match detail modal is open for this match, sync timeline
            if (selectedMatchDetailRef.current?.id === matchId) {
              setMatchTimelineEvents(prev => {
                if (prev.some(e => e.id === newEvent.id)) return prev;
                return [...prev, newEvent].sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
              });
            }

            // Update only the affected match in the React state
            setMatches(prevMatches => {
              return prevMatches.map(m => {
                if (m.id !== matchId) return m;

                const updatedGames = nextState.games.map((g, idx) => ({
                  id: m.games?.[idx]?.id || `temp-g-${matchId}-${idx}`,
                  game_number: idx + 1,
                  participant_a_score: g.scoreA,
                  participant_b_score: g.scoreB,
                  status: g.isCompleted ? 'COMPLETED' : 'LIVE'
                }));

                const updatedMatchObj = {
                  ...m,
                  games: updatedGames,
                  service_state: nextState.currentServiceState || m.service_state
                };

                if (selectedMatchDetailRef.current?.id === matchId) {
                  setSelectedMatchDetail(updatedMatchObj);
                }

                return updatedMatchObj;
              });
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        async (payload: any) => {
          const updatedGame = payload.new;
          const matchId = updatedGame.match_id;

          const matchExists = matchesRef.current.some(m => m.id === matchId);
          if (!matchExists) return;

          setMatches(prevMatches => {
            return prevMatches.map(m => {
              if (m.id !== matchId) return m;

              const existingGames = m.games || [];
              const gameIndex = existingGames.findIndex((g: any) => g.id === updatedGame.id || g.game_number === updatedGame.game_number);
              let newGames = [...existingGames];
              if (gameIndex >= 0) {
                newGames[gameIndex] = { ...newGames[gameIndex], ...updatedGame };
              } else {
                newGames.push(updatedGame);
              }

              const updatedMatchObj = {
                ...m,
                games: newGames
              };

              if (selectedMatchDetailRef.current?.id === matchId) {
                setSelectedMatchDetail(updatedMatchObj);
              }

              return updatedMatchObj;
            });
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches' },
        async (payload: any) => {
          const updatedMatch = payload.new;
          const matchId = updatedMatch.id;

          const matchExists = matchesRef.current.some(m => m.id === matchId);
          if (!matchExists) return;

          // If the match status transitioned (e.g. from READY to LIVE or COMPLETED to FINAL),
          // this changes standings, draws, or eligibility. Perform a full data reload.
          const oldMatch = matchesRef.current.find(m => m.id === matchId);
          if (oldMatch && oldMatch.status !== updatedMatch.status) {
            fetchTournamentData();
            return;
          }

          // Update local metadata without database refresh
          setMatches(prevMatches => {
            return prevMatches.map(m => {
              if (m.id !== matchId) return m;
              const updatedObj = {
                ...m,
                court_id: updatedMatch.court_id,
                scheduled_at: updatedMatch.scheduled_at,
                winner_id: updatedMatch.winner_id,
                outcome: updatedMatch.outcome,
                score_a: updatedMatch.score_a ?? m.score_a,
                score_b: updatedMatch.score_b ?? m.score_b,
                match_phase: updatedMatch.match_phase || m.match_phase,
                halftime_score: updatedMatch.halftime_score || m.halftime_score,
                extra_time_score: updatedMatch.extra_time_score || m.extra_time_score,
                shootout_score: updatedMatch.shootout_score || m.shootout_score,
                lineup_data: updatedMatch.lineup_data || m.lineup_data,
                outcome_details: updatedMatch.outcome_details || m.outcome_details,
                service_state: updatedMatch.service_state || m.service_state
              };
              if (selectedMatchDetailRef.current?.id === matchId) {
                setSelectedMatchDetail(updatedObj);
              }
              return updatedObj;
            });
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'matches' },
        () => {
          fetchTournamentData();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'matches' },
        () => {
          fetchTournamentData();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnStatus('CONNECTED');
        } else if (status === 'TIMED_OUT') {
          setConnStatus('RECONNECTING');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnStatus('DISCONNECTED');
        }
      });

    // 2. Subscribe to Presence to track active scorers
    const presenceChannel = supabase
      .channel(`tournament_presence:${tournament.id}`)
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const active: Record<string, any> = {};
        for (const key of Object.keys(state)) {
          const presences = state[key] as any[];
          for (const pres of presences) {
            if (pres.role === 'SCORER' && pres.match_id) {
              active[pres.match_id] = pres;
            }
          }
        }
        setActiveScorers(active);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
    };
  }, [tournament]);

  useEffect(() => {
    if (tournament?.name) {
      document.title = `${tournament.name} | ArenaFlow Live Tournament`;
    }
  }, [tournament?.name]);

  useEffect(() => {
    if (user) {
      supabase
        .from('players')
        .select('gender, date_of_birth')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            if (data.gender) setPlayerGender(data.gender);
            if (data.date_of_birth) setPlayerDob(data.date_of_birth);
          }
        });
    }
  }, [user]);

  useEffect(() => {
    if (partnerEmail) {
      const delayDebounceFn = setTimeout(async () => {
        try {
          const partnerId = await getPlayerIdByEmailOrName(partnerEmail);
          const { data } = await supabase
            .from('players')
            .select('gender, date_of_birth')
            .eq('id', partnerId)
            .maybeSingle();
          if (data) {
            if (data.gender) setPartnerGender(data.gender);
            if (data.date_of_birth) setPartnerDob(data.date_of_birth);
          }
        } catch (e) {
          // ignore transient search errors
        }
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setPartnerGender('');
      setPartnerDob('');
    }
  }, [partnerEmail]);

  const validateEligibility = (
    category: any,
    player: { gender: string; dob: string },
    partner?: { gender: string; dob: string } | null,
    tournamentStartDate?: string
  ): string | null => {
    const refDate = tournamentStartDate || new Date().toISOString();
    
    // Helper to calculate age
    const calculateAge = (dobStr: string): number => {
      const dob = new Date(dobStr);
      const ref = new Date(refDate);
      let age = ref.getFullYear() - dob.getFullYear();
      const m = ref.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) {
        age--;
      }
      return age;
    };

    const p1Age = calculateAge(player.dob);
    const p1Gender = player.gender;

    // 1. Gender Validation
    if (category.match_type === 'MENS') {
      if (p1Gender !== 'MALE') return 'Only male players are eligible for Men\'s division.';
      if (partner && partner.gender !== 'MALE') return 'Partner must be male for Men\'s division.';
    } else if (category.match_type === 'WOMENS') {
      if (p1Gender !== 'FEMALE') return 'Only female players are eligible for Women\'s division.';
      if (partner && partner.gender !== 'FEMALE') return 'Partner must be female for Women\'s division.';
    } else if (category.match_type === 'MIXED') {
      if (!partner) {
        return 'Mixed division is only available for doubles categories.';
      }
      const hasMale = p1Gender === 'MALE' || partner.gender === 'MALE';
      const hasFemale = p1Gender === 'FEMALE' || partner.gender === 'FEMALE';
      if (!hasMale || !hasFemale || p1Gender === partner.gender) {
        return 'Mixed Doubles requires one male and one female player.';
      }
    }

    // 2. Age Group Validation
    if (category.age_group === 'U19') {
      if (p1Age >= 19) return `You must be under 19 years old (current age is ${p1Age}).`;
      if (partner) {
        const p2Age = calculateAge(partner.dob);
        if (p2Age >= 19) return `Partner must be under 19 years old (current age is ${p2Age}).`;
      }
    } else if (category.age_group === 'ADULT') {
      if (p1Age < 18) return `You must be at least 18 years old (current age is ${p1Age}).`;
      if (partner) {
        const p2Age = calculateAge(partner.dob);
        if (p2Age < 18) return `Partner must be at least 18 years old (current age is ${p2Age}).`;
      }
    } else if (category.age_group === 'O40') {
      if (p1Age < 40) return `You must be 40 years of age or older (current age is ${p1Age}).`;
      if (partner) {
        const p2Age = calculateAge(partner.dob);
        if (p2Age < 40) return `Partner must be 40 years of age or older (current age is ${p2Age}).`;
      }
    }

    return null;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      router.push('/auth/login');
      return;
    }

    if (!regCategoryId) return;
    setRegistering(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const category = categories.find(c => c.id === regCategoryId);
    if (!category) {
      setRegistering(false);
      return;
    }

    // Check if registration date has closed
    if (tournament && new Date() > new Date(tournament.registration_close)) {
      setErrorMsg('Registration has closed for this tournament.');
      setRegistering(false);
      return;
    }

    const isDoubles = category.category_type === 'DOUBLES';
    let partnerProfile: any = null;

    try {
      if (isDoubles) {
        if (!partnerEmail) {
          throw new Error('Partner email is required for doubles category.');
        }

        // Query partner profile
        const partnerId = await getPlayerIdByEmailOrName(partnerEmail);
        const { data: searchPartner } = await supabase
          .from('players')
          .select('id, full_name, gender, date_of_birth')
          .eq('id', partnerId)
          .maybeSingle();

        if (!searchPartner) {
          throw new Error('Partner player profile not found. Partner must be registered on ArenaFlow.');
        }
        partnerProfile = searchPartner;

        if (partnerProfile.id === user.id) {
          throw new Error('You cannot pair with yourself as a doubles partner.');
        }
      }

      // Check eligibility
      const playerDetails = { gender: playerGender, dob: playerDob };
      const partnerDetails = isDoubles ? { gender: partnerGender, dob: partnerDob } : null;
      
      if (!playerDetails.gender || !playerDetails.dob) {
        throw new Error('Please select your gender and enter your date of birth.');
      }
      if (isDoubles && (!partnerDetails?.gender || !partnerDetails?.dob)) {
        throw new Error('Please select partner gender and enter partner date of birth.');
      }

      const eligibilityError = validateEligibility(
        category,
        playerDetails,
        partnerDetails,
        tournament?.start_date
      );

      if (eligibilityError) {
        throw new Error(eligibilityError);
      }

      // 0. Update player profiles in DB
      const { error: updP1Err } = await supabase
        .from('players')
        .update({ gender: playerGender, date_of_birth: playerDob })
        .eq('id', user.id);
      if (updP1Err) throw updP1Err;

      const { error: updP1ProfErr } = await supabase
        .from('profiles')
        .update({ gender: playerGender, date_of_birth: playerDob })
        .eq('id', user.id);
      if (updP1ProfErr) throw updP1ProfErr;

      if (isDoubles && partnerProfile) {
        const { error: updP2Err } = await supabase
          .from('players')
          .update({ gender: partnerGender, date_of_birth: partnerDob })
          .eq('id', partnerProfile.id);
        if (updP2Err) throw updP2Err;

        const { error: updP2ProfErr } = await supabase
          .from('profiles')
          .update({ gender: partnerGender, date_of_birth: partnerDob })
          .eq('id', partnerProfile.id);
        if (updP2ProfErr) throw updP2ProfErr;
      }

      // 1. Create Participant
      const { data: part, error: pErr } = await supabase
        .from('participants')
        .insert({
          category_id: regCategoryId,
          participant_type: isDoubles ? 'TEAM' : 'INDIVIDUAL',
          status: 'WITHDRAWN' // Starts inactive until registration is approved
        })
        .select('id')
        .single();
      
      if (pErr) throw pErr;

      // 2. Add members
      const members = isDoubles
        ? [
            { participant_id: part.id, player_id: user.id, member_order: 1 },
            { participant_id: part.id, player_id: partnerProfile.id, member_order: 2 }
          ]
        : [{ participant_id: part.id, player_id: user.id, member_order: 1 }];

      const { error: mErr } = await supabase
        .from('participant_members')
        .insert(members);
      if (mErr) throw mErr;

      // 3. Add Registration
      const { error: rErr } = await supabase
        .from('registrations')
        .insert({
          category_id: regCategoryId,
          participant_id: part.id,
          status: 'PENDING'
        });
      
      if (rErr) throw rErr;

      setSuccessMsg('Registration request submitted successfully! Pending organizer approval.');
      fetchTournamentData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed.');
    } finally {
      setRegistering(false);
    }
  };

  const handleCancelRegistration = async (regId: string) => {
    try {
      setRegistering(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const { error } = await supabase
        .from('registrations')
        .update({ status: 'CANCELLED' })
        .eq('id', regId);

      if (error) throw error;

      setSuccessMsg('Registration cancelled successfully.');
      fetchTournamentData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to cancel registration.');
    } finally {
      setRegistering(false);
    }
  };

  const getPlayerIdByEmailOrName = async (term: string): Promise<string> => {
    // Search profile by full_name or display_name
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(1)
      .maybeSingle();

    if (!data) throw new Error(`No player profile matches search term "${term}".`);
    return data.id;
  };

  const eligibleCategories = categories.filter(c => {
    const existing = myRegistrations.find(r => r.category_id === c.id);
    if (!existing) return true;
    return existing.status === 'REJECTED' || existing.status === 'CANCELLED';
  });

  useEffect(() => {
    if (eligibleCategories.length > 0 && !eligibleCategories.some(c => c.id === regCategoryId)) {
      setRegCategoryId(eligibleCategories[0].id);
    }
  }, [eligibleCategories, regCategoryId]);

  if (loading || loadingPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F7F6] text-[#667085]">
        <div className="flex items-center gap-2.5 text-xs font-semibold">
          <span className="w-4 h-4 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin" />
          Loading tournament details...
        </div>
      </div>
    );
  }

  if (notFound || !tournament) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] text-[#172033] flex flex-col">
        <Navigation />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="pro-card p-8 max-w-md w-full text-center space-y-4 shadow-sm">
            <h2 className="text-3xl font-extrabold text-[#C94A4A]">404</h2>
            <h3 className="text-lg font-bold text-[#172033]">Tournament Not Found</h3>
            <p className="text-xs text-[#667085] leading-relaxed">
              The tournament page you are looking for does not exist or has not been published by the organizer.
            </p>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-primary w-full py-2.5 text-xs"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isRegistrationOpen = new Date() >= new Date(tournament.registration_open) &&
                             new Date() <= new Date(tournament.registration_close);

  return (
    <div className="min-h-screen bg-transparent text-[#0F172A]">
      <Navigation />

      {/* Dynamic Navigation Bar for Organizers & Spectators */}
      <div className="pro-glass-primary border-b border-white/80 px-6 py-3 sticky top-16 z-20 shadow-xs">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <button
              onClick={() => {
                if (user && tournament.organizer_id === user.id) {
                  router.push(`/tournaments/${tournament.slug}/configure`);
                } else {
                  router.push('/dashboard');
                }
              }}
              className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>←</span>
              {user && tournament.organizer_id === user.id ? 'Back to Organizer Console' : 'Back to Dashboard'}
            </button>
          </div>
          {user && tournament.organizer_id === user.id && (
            <div>
              <button
                onClick={() => router.push(`/tournaments/${tournament.slug}/configure`)}
                className="bg-emerald-50 hover:bg-emerald-100 text-[#14966B] font-bold text-xs uppercase tracking-wider px-3.5 py-1.5 rounded-md border border-emerald-200 transition shadow-xs cursor-pointer"
              >
                Organizer Dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tournament Banner */}
      <div className="pro-glass border-b border-slate-200/80 px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <span className="badge-live text-[10px] font-bold px-2.5 py-0.5 rounded uppercase tracking-wider">
              {tournament.sports?.name || 'Badminton'}
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#0F172A] mt-2">
              {tournament.name}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-[#64748B] font-medium">
              <div>
                <span className="font-semibold text-[#334155]">Venue:</span> {tournament.venues?.name || 'Unassigned'}
              </div>
              <div>
                <span className="font-semibold text-[#334155]">Location:</span> {tournament.venues?.address ? `${tournament.venues.address}, ` : ''}{tournament.venues?.city || 'Delhi'}
              </div>
              <div>
                <span className="font-semibold text-[#334155]">Dates:</span> {new Date(tournament.start_date).toLocaleDateString()} – {new Date(tournament.end_date).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Tournament Overview Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="pro-stat-card p-3 text-center">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Status</span>
            <span className={`text-xs font-bold uppercase mt-1 inline-block px-2 py-0.5 rounded ${
              tournament.status === 'PUBLISHED' ? 'badge-live' :
              tournament.status === 'COMPLETED' ? 'badge-completed' : 'badge-ready'
            }`}>
              {tournament.status}
            </span>
          </div>
          <div className="pro-stat-card p-3 text-center">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Categories</span>
            <span className="text-xl font-bold text-[#0F172A] mt-0.5 block tabular-nums">{categories.length}</span>
          </div>
          <div className="pro-stat-card p-3 text-center">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Active Players</span>
            <span className="text-xl font-bold text-[#0F172A] mt-0.5 block tabular-nums">
              {participants.filter(p => p.status === 'ACTIVE').length}
            </span>
          </div>
          <div className="pro-stat-card p-3 text-center border-t-2 border-t-[#14966B]">
            <span className="text-[10px] font-bold text-[#14966B] uppercase tracking-wider block">Live Matches</span>
            <span className="text-xl font-bold text-[#14966B] mt-0.5 block tabular-nums">
              {matches.filter(m => m.status === 'LIVE' || m.status === 'UNDER_REVIEW').length}
            </span>
          </div>
          <div className="pro-stat-card p-3 text-center border-t-2 border-t-[#2563EB]">
            <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider block">Upcoming</span>
            <span className="text-xl font-bold text-[#2563EB] mt-0.5 block tabular-nums">
              {matches.filter(m => m.status === 'READY' || m.status === 'SCHEDULED').length}
            </span>
          </div>
          <div className="pro-stat-card p-3 text-center">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Completed</span>
            <span className="text-xl font-bold text-[#64748B] mt-0.5 block tabular-nums">
              {matches.filter(m => m.status === 'COMPLETED' || m.status === 'FINAL').length}
            </span>
          </div>
        </div>

        {/* Realtime Connection & Visualizer Toggle Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-center pro-glass p-3.5 gap-4 rounded-xl shadow-xs">
          <div className="flex items-center gap-3">
            {/* Connection Status Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold tracking-wider uppercase text-[#14966B]">
              <span className={`w-2 h-2 rounded-full ${
                connStatus === 'CONNECTED' ? 'bg-[#14966B] animate-pulse' :
                connStatus === 'RECONNECTING' ? 'bg-[#C98218]' : 'bg-[#C94A4A]'
              }`} />
              <span>
                {connStatus === 'CONNECTED' ? 'Live Sync Active' : connStatus}
              </span>
            </div>
            <span className="text-xs text-[#64748B] hidden sm:inline">
              Point scoring and bracket advancements update in real time.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('LIST')}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-lg border transition min-h-[36px] btn-press cursor-pointer ${
                viewMode === 'LIST'
                  ? 'bg-[#14966B] border-[#14966B] text-white shadow-xs font-bold'
                  : 'glass-pill text-[#334155]'
              }`}
            >
              List View
            </button>
            <button
              disabled={!hasWebGL}
              onClick={() => setViewMode('3D')}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 min-h-[36px] btn-press cursor-pointer ${
                !hasWebGL ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200 text-[#94A3B8]' :
                viewMode === '3D'
                  ? 'bg-[#14966B] border-[#14966B] text-white shadow-xs font-bold'
                  : 'glass-pill text-[#334155]'
              }`}
            >
              3D Live Map {!hasWebGL && '(Unsupported)'}
            </button>

            {/* Public Reports Export Quick Actions */}
            <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-slate-200/80">
              <span className="text-[10px] text-[#64748B] font-semibold uppercase mr-1">Export:</span>
              <button
                onClick={() => handleExportPublicReport('results', 'pdf')}
                disabled={exportingReport}
                className="text-[10px] font-bold px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-[#14966B] border border-emerald-200 transition btn-press cursor-pointer"
                title="Download Results PDF"
              >
                Results PDF
              </button>
              <button
                onClick={() => handleExportPublicReport('standings', 'pdf')}
                disabled={exportingReport}
                className="text-[10px] font-bold px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-[#14966B] border border-emerald-200 transition btn-press cursor-pointer"
                title="Download Standings PDF"
              >
                Standings PDF
              </button>
              <button
                onClick={() => handleExportPublicReport('schedule', 'pdf')}
                disabled={exportingReport}
                className="text-[10px] font-bold px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-[#14966B] border border-emerald-200 transition btn-press cursor-pointer"
                title="Download Schedule PDF"
              >
                Schedule PDF
              </button>
            </div>
          </div>
        </div>

        {/* Dedicated LIVE MATCHES Section */}
        <div className="pro-card p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-2">
            <h2 className="text-base font-bold text-[#172033] flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] animate-pulse" />
              LIVE MATCHES
            </h2>
            <span className="text-[10px] font-bold font-mono text-[#14966B] uppercase tracking-wider bg-[#E8F6F0] px-2.5 py-0.5 rounded-full border border-[#C4E9DC]">
              Auto-Refreshing
            </span>
          </div>
          {(() => {
            const liveMatches = matches.filter(m => m.status === 'LIVE' || m.status === 'UNDER_REVIEW');
            if (liveMatches.length === 0) {
              return (
                <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-8 text-center text-[#667085] text-xs font-medium uppercase tracking-wider">
                  No active matches are currently in progress.
                </div>
              );
            }

            return (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {liveMatches.map((m) => {
                  const isFoot = isFootballMatch(m);
                  let scoreA = 0;
                  let scoreB = 0;
                  let periodOrGameText = '';

                  if (isFoot) {
                    scoreA = m.score_a ?? 0;
                    scoreB = m.score_b ?? 0;
                    periodOrGameText = m.match_phase ? m.match_phase.replace(/_/g, ' ') : 'FOOTBALL';
                  } else {
                    const gameScores = m.games || [];
                    const activeGame = gameScores.find((g: any) => g.status === 'LIVE') || gameScores[gameScores.length - 1];
                    const gameNum = activeGame ? activeGame.game_number : 1;
                    scoreA = activeGame ? activeGame.participant_a_score ?? 0 : 0;
                    scoreB = activeGame ? activeGame.participant_b_score ?? 0 : 0;
                    periodOrGameText = `Game ${gameNum}`;
                  }
                  const isScorerOnline = activeScorers[m.id];

                  return (
                    <div 
                      key={m.id} 
                      onClick={() => openMatchDetail(m)}
                      className="scoreboard-card p-4 flex flex-col justify-between gap-3 relative cursor-pointer hover:border-[#14966B] transition hover:shadow-md btn-press"
                    >
                      <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-2">
                        <span className="text-xs font-bold text-[#3267D6] uppercase tracking-wider font-mono">
                          {m.court?.name || (isFoot ? 'Pitch' : 'Court')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {m.outcome && (
                            <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] uppercase">
                              {m.outcome}
                            </span>
                          )}
                          <span className="badge-live text-[9px] font-bold uppercase px-2 py-0.5 rounded flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            LIVE
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs font-semibold text-[#172033]">
                          <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                            {!isFoot && m.service_state?.servingSide === 'A' && (
                              <span className="text-[10px] text-[#14966B] font-bold" title="Serving">🏸</span>
                            )}
                            <span className="truncate">
                              {getPlayerNames(m.participant_a)}
                            </span>
                          </div>
                          <span className="font-mono text-[#667085] text-[10px] font-bold">A</span>
                        </div>
                        <div className="flex justify-between items-center bg-[#F9FAFB] px-3.5 py-2.5 rounded-lg border border-[#EAECF0] text-center font-mono">
                          <span className="text-[10px] text-[#3267D6] font-bold uppercase tracking-wider">{periodOrGameText}</span>
                          <span className="text-base font-bold text-[#14966B] tabular-nums">{scoreA} - {scoreB}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-semibold text-[#172033]">
                          <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                            {!isFoot && m.service_state?.servingSide === 'B' && (
                              <span className="text-[10px] text-[#14966B] font-bold" title="Serving">🏸</span>
                            )}
                            <span className="truncate">
                              {getPlayerNames(m.participant_b)}
                            </span>
                          </div>
                          <span className="font-mono text-[#667085] text-[10px] font-bold">B</span>
                        </div>
                      </div>

                      {!isFoot && m.service_state && (
                        <div className="text-[10px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-md px-2.5 py-1 text-[#475467] flex justify-between items-center font-mono">
                          <span>Service ({m.service_state.serverCourt})</span>
                          <span className="font-bold text-[#14966B]">
                            {m.service_state.servingSide === 'A' ? 'Side A Serving' : 'Side B Serving'}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center text-[9px] border-t border-[#E4E7EC] pt-2">
                        {isScorerOnline ? (
                          <span className="text-[#14966B] font-semibold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#14966B] animate-pulse" />
                            Scorer Connected
                          </span>
                        ) : (
                          <span className="text-[#98A2B3]">Scorer Offline</span>
                        )}
                        <span className="text-[#3267D6] font-bold hover:underline">
                          View Timeline →
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* 3D Visualizer Scene Container or 2D Directory */}
        {viewMode === '3D' && hasWebGL ? (
          <div className="w-full relative">
            {(() => {
              const isTournamentFootball = tournament?.sports?.name?.toUpperCase() === 'FOOTBALL';
              let derivedVenues: any[] = [];

              if (allCourts.length > 0) {
                derivedVenues = allCourts.map((c) => ({
                  ...c,
                  venueType: isTournamentFootball || c.venue_type === 'PITCH' || c.sport === 'FOOTBALL' ? 'PITCH' : 'COURT',
                  sport: isTournamentFootball || c.sport === 'FOOTBALL' ? 'FOOTBALL' : 'BADMINTON'
                }));
              } else if (isTournamentFootball) {
                // In Football tournaments without traditional court table rows,
                // generate pitch venues from active, scheduled, or completed matches
                const liveOrReady = matches.filter(
                  (m) => m.status === 'LIVE' || m.status === 'UNDER_REVIEW' || m.status === 'PAUSED' || m.status === 'READY'
                );
                const targetMatches = liveOrReady.length > 0 ? liveOrReady : matches;
                
                derivedVenues = targetMatches.map((m, idx) => ({
                  id: m.court_id || `pitch-${m.id}`,
                  name: m.court?.name || (targetMatches.length === 1 ? 'Main Stadium Pitch' : `Pitch ${idx + 1}`),
                  venueType: 'PITCH',
                  sport: 'FOOTBALL',
                  match_id: m.id
                }));
              } else {
                // Badminton or multi-sport tournament
                const seen = new Set();
                matches.forEach((m, idx) => {
                  const isFoot = isFootballMatch(m);
                  if (m.court && !seen.has(m.court.id)) {
                    seen.add(m.court.id);
                    derivedVenues.push({
                      ...m.court,
                      venueType: isFoot ? 'PITCH' : 'COURT',
                      sport: isFoot ? 'FOOTBALL' : 'BADMINTON'
                    });
                  } else if (!m.court && (m.status === 'LIVE' || m.status === 'READY')) {
                    const vId = `venue-${m.id}`;
                    if (!seen.has(vId)) {
                      seen.add(vId);
                      derivedVenues.push({
                        id: vId,
                        name: isFoot ? `Pitch ${idx + 1}` : `Court ${idx + 1}`,
                        venueType: isFoot ? 'PITCH' : 'COURT',
                        sport: isFoot ? 'FOOTBALL' : 'BADMINTON',
                        match_id: m.id
                      });
                    }
                  }
                });
              }

              derivedVenues.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

              if (derivedVenues.length === 0) {
                return (
                  <div className="w-full h-[300px] flex flex-col items-center justify-center bg-white border border-[#E4E7EC] rounded-xl p-6 text-center shadow-sm">
                    <span className="text-sm font-bold text-[#172033] uppercase tracking-wider block mb-1">No Active Venues</span>
                    <span className="text-xs text-[#667085] max-w-sm">No courts or pitches are currently assigned to scheduled or live matches in this tournament.</span>
                  </div>
                );
              }

              const mappedMatches = matches.map((m) => {
                const cObj = allCourts.find((c) => c.id === m.court_id);
                return {
                  ...m,
                  court: cObj || m.court
                };
              });

              return (
                <>
                  <LiveVenueMap
                    matches={mappedMatches}
                    venues={derivedVenues}
                    activeScorers={activeScorers}
                    sport={tournament?.sports?.name}
                    onCourtSelect={(selectedMatch) => setSelectedCourtMatch(selectedMatch)}
                  />

                  {/* Selected Venue Details Overlay */}
                  {selectedCourtMatch && (
                    <div className="absolute top-16 right-4 w-72 sm:w-80 bg-white/95 backdrop-blur-md border border-[#E4E7EC] rounded-xl p-4 shadow-xl z-10 animate-in fade-in slide-in-from-right duration-200">
                      <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-2 mb-2">
                        <span className="text-[10px] font-bold text-[#3267D6] uppercase tracking-widest block">
                          {selectedCourtMatch.venue?.name || selectedCourtMatch.court?.name || selectedCourtMatch.court_name || 'Venue Details'}
                        </span>
                        <button 
                          onClick={() => setSelectedCourtMatch(null)}
                          className="text-[#667085] hover:text-[#172033] text-xs font-bold"
                          aria-label="Close details"
                        >
                          ✕
                        </button>
                      </div>
                      
                      {selectedCourtMatch.id && !selectedCourtMatch.id.startsWith('empty-') ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <span className="text-[9px] text-[#667085] uppercase tracking-wider font-semibold block">Active Match</span>
                            <div className="text-xs font-bold text-[#172033] leading-tight">
                              {getPlayerNames(selectedCourtMatch.participant_a)}
                            </div>
                            <div className="text-[9px] font-bold text-[#98A2B3] my-0.5">VS</div>
                            <div className="text-xs font-bold text-[#172033] leading-tight">
                              {getPlayerNames(selectedCourtMatch.participant_b)}
                            </div>
                          </div>

                          {/* Football Scores vs Badminton Scores List */}
                          {isFootballMatch(selectedCourtMatch) ? (
                            <div className="bg-[#F9FAFB] rounded-lg p-3 border border-[#EAECF0] space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-[9px] text-[#667085] uppercase tracking-wider font-bold">Official Score</span>
                                <span className="text-base font-bold text-[#14966B] font-mono">
                                  {selectedCourtMatch.score_a ?? 0} — {selectedCourtMatch.score_b ?? 0}
                                </span>
                              </div>
                              {selectedCourtMatch.shootout_score && (
                                <div className="flex justify-between items-center text-xs font-mono text-[#3267D6] bg-[#EEF4FF] px-2 py-1 rounded border border-[#C8DCFE]">
                                  <span className="text-[10px] font-semibold">Penalty Shootout</span>
                                  <span className="font-bold">
                                    {selectedCourtMatch.shootout_score.score_a ?? selectedCourtMatch.shootout_score_a} — {selectedCourtMatch.shootout_score.score_b ?? selectedCourtMatch.shootout_score_b}
                                  </span>
                                </div>
                              )}
                              <div className="text-[9px] text-[#667085] flex justify-between">
                                <span>Phase: <strong className="text-[#172033] uppercase">{selectedCourtMatch.match_phase ? selectedCourtMatch.match_phase.replace(/_/g, ' ') : selectedCourtMatch.status}</strong></span>
                                {selectedCourtMatch.halftime_score && (
                                  <span>HT: {selectedCourtMatch.halftime_score.score_a ?? selectedCourtMatch.halftime_score_a}-{selectedCourtMatch.halftime_score.score_b ?? selectedCourtMatch.halftime_score_b}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="bg-[#F9FAFB] rounded-lg p-2.5 border border-[#EAECF0] space-y-1.5">
                              <span className="text-[8px] text-[#667085] uppercase tracking-wider font-bold block">Game Scores</span>
                              {selectedCourtMatch.games && selectedCourtMatch.games.length > 0 ? (
                                <div className="space-y-1">
                                  {selectedCourtMatch.games.map((g: any) => (
                                    <div key={g.id} className="flex justify-between text-xs font-mono">
                                      <span className="text-[#344054] font-medium">Game {g.game_number}</span>
                                      <span className="text-[#14966B] font-bold">{g.participant_a_score} - {g.participant_b_score}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-[#98A2B3] italic">
                                  {formatOutcomeScore(selectedCourtMatch).text || 'No scores recorded yet.'}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex justify-between items-center text-[10px] text-[#667085] border-t border-[#E4E7EC] pt-2">
                            <span>Status: <span className="text-[#172033] font-bold uppercase tracking-wider text-[9px]">{selectedCourtMatch.status}</span></span>
                            {activeScorers[selectedCourtMatch.id] ? (
                              <span className="text-[#14966B] font-bold flex items-center gap-1">
                                <span className="live-dot-slow" /> Scorer Online
                              </span>
                            ) : (
                              <span className="text-[#98A2B3] font-medium">Scorer Offline</span>
                            )}
                          </div>

                          <button
                            onClick={() => openMatchDetail(selectedCourtMatch)}
                            className="w-full text-center py-2 text-xs font-bold text-white bg-[#14966B] hover:bg-[#10805B] rounded-md transition shadow-sm min-h-[44px] flex items-center justify-center"
                          >
                            View Match Timeline →
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#667085] italic text-center py-4">
                          No active match currently in progress on this {isTournamentFootball ? 'pitch' : 'court'}.
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          /* LIST VIEW Mode - 2D Court Match Directory fall back */
          <div className="pro-card p-6 space-y-4">
            <span className="text-sm font-bold text-[#172033] uppercase tracking-wider block border-b border-[#E4E7EC] pb-2">
              Venue Directory (2D Summary)
            </span>
            {(() => {
              if (matches.length === 0) {
                return (
                  <div className="text-center text-xs text-[#667085] py-6">No matches recorded for this tournament.</div>
                );
              }

              return (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {matches.map((m) => {
                    const outcomeInfo = formatOutcomeScore(m);
                    const isFoot = isFootballMatch(m);
                    
                    return (
                      <div 
                        key={m.id} 
                        onClick={() => openMatchDetail(m)}
                        className="pro-card pro-card-hover p-4 flex flex-col justify-between gap-3 cursor-pointer hover:border-[#14966B] transition"
                      >
                        <div className="flex justify-between items-center text-[10px] text-[#667085] font-bold uppercase tracking-wider border-b border-[#E4E7EC] pb-2">
                          <span>{m.court?.name || (isFoot ? 'Pitch' : 'Court')}</span>
                          <div className="flex items-center gap-1.5">
                            {outcomeInfo.outcomeLabel && (
                              <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] uppercase">
                                {outcomeInfo.outcomeLabel}
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest ${
                              m.status === 'LIVE' ? 'badge-live' :
                              m.status === 'READY' ? 'badge-ready' :
                              m.status === 'COMPLETED' || m.status === 'FINAL' ? 'badge-completed' :
                              'badge-idle'
                            }`}>
                              {m.status}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className={`text-xs font-bold truncate ${m.winner_id === m.participant_a_id && (m.status === 'COMPLETED' || m.status === 'FINAL') ? 'text-[#14966B]' : 'text-[#172033]'}`}>
                            {getPlayerNames(m.participant_a)}
                          </div>
                          <div className="text-[9px] text-[#98A2B3] font-mono">VS</div>
                          <div className={`text-xs font-bold truncate ${m.winner_id === m.participant_b_id && (m.status === 'COMPLETED' || m.status === 'FINAL') ? 'text-[#14966B]' : 'text-[#172033]'}`}>
                            {getPlayerNames(m.participant_b)}
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-[#E4E7EC] font-mono text-[10px]">
                          <span className="text-[#667085] font-medium max-w-[120px] truncate">{m.category?.name}</span>
                          <span className="text-[#14966B] font-bold">{outcomeInfo.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* UPCOMING MATCHES Section */}
        <div className="pro-card p-6 space-y-4">
          <h2 className="text-base font-bold text-[#172033] border-b border-[#E4E7EC] pb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#3267D6]" />
            UPCOMING MATCHES
          </h2>
          {(() => {
            const upcomingMatches = matches
              .filter(m => m.status === 'READY' || m.status === 'SCHEDULED')
              .sort((a, b) => 
                (a.scheduled_at || '9999').localeCompare(b.scheduled_at || '9999') ||
                (a.court?.name || '').localeCompare(b.court?.name || '') ||
                a.id.localeCompare(b.id)
              );

            if (upcomingMatches.length === 0) {
              return (
                <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-6 text-center text-[#667085] text-xs font-medium uppercase tracking-wider">
                  No upcoming matches scheduled.
                </div>
              );
            }

            return (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingMatches.map((m) => {
                  const schTime = m.scheduled_at
                    ? new Date(m.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : 'TBD';

                  return (
                    <div 
                      key={m.id} 
                      onClick={() => openMatchDetail(m)}
                      className="pro-card pro-card-hover p-4 space-y-3 cursor-pointer hover:border-[#3267D6] transition"
                    >
                      <div className="flex justify-between items-center text-[10px] text-[#667085] font-bold border-b border-[#E4E7EC] pb-2 uppercase tracking-wider">
                        <span>{m.court?.name || 'Court TBD'}</span>
                        <span className="text-[#3267D6] font-semibold">{schTime}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-[#172033] truncate">{getPlayerNames(m.participant_a)}</div>
                        <div className="text-[9px] font-bold text-[#98A2B3]">VS</div>
                        <div className="text-xs font-bold text-[#172033] truncate">{getPlayerNames(m.participant_b)}</div>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-[#E4E7EC] text-[9px] text-[#667085] font-semibold uppercase tracking-wider">
                        <span className="text-[#3267D6] truncate max-w-[120px]">{m.category?.name}</span>
                        <span className="badge-ready text-[8px] px-1.5 py-0.5 rounded">{m.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* COMPLETED MATCHES Section */}
        <div className="pro-card p-6 space-y-4">
          <h2 className="text-base font-bold text-[#172033] border-b border-[#E4E7EC] pb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#667085]" />
            COMPLETED MATCHES
          </h2>
          {(() => {
            const completedMatches = matches
              .filter(m => m.status === 'COMPLETED' || m.status === 'FINAL')
              .sort((a, b) => (b.scheduled_at || '').localeCompare(a.scheduled_at || '') || b.id.localeCompare(a.id));

            if (completedMatches.length === 0) {
              return (
                <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-6 text-center text-[#667085] text-xs font-medium uppercase tracking-wider">
                  No completed matches.
                </div>
              );
            }

            return (
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                {completedMatches.map((m) => {
                  const winnerName = m.winner_id
                    ? (m.winner_id === m.participant_a_id ? getPlayerNames(m.participant_a) : getPlayerNames(m.participant_b))
                    : 'TBD';

                  const outcomeInfo = formatOutcomeScore(m);

                  return (
                    <div 
                      key={m.id} 
                      onClick={() => openMatchDetail(m)}
                      className="pro-card p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer hover:border-[#14966B] transition"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs ${m.winner_id === m.participant_a_id ? 'text-[#14966B] font-bold' : 'text-[#344054]'}`}>
                            {getPlayerNames(m.participant_a)}
                          </span>
                          <span className="text-[10px] text-[#98A2B3] font-bold">VS</span>
                          <span className={`text-xs ${m.winner_id === m.participant_b_id ? 'text-[#14966B] font-bold' : 'text-[#344054]'}`}>
                            {getPlayerNames(m.participant_b)}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#667085]">
                          Winner: <span className="text-[#14966B] font-semibold">{winnerName}</span> | Court: {m.court?.name || 'Unassigned'}
                        </div>
                      </div>
                      <div className="flex flex-col sm:items-end gap-1 font-mono">
                        <span className="text-xs text-[#14966B] font-bold">{outcomeInfo.text}</span>
                        <div className="flex items-center gap-1">
                          {outcomeInfo.outcomeLabel && (
                            <span className="font-mono text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] uppercase">
                              {outcomeInfo.outcomeLabel}
                            </span>
                          )}
                          <span className="badge-completed text-[8px] px-1.5 py-0.5 rounded uppercase">
                            {m.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          
          {/* Main Tournament Details & Analytics */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Feature 12 & Phase E: Tournament Analytics, Records & Leaderboards */}
            {(() => {
              const isFootball = tournament.sports?.name?.toUpperCase() === 'FOOTBALL' ||
                categories.some((c: any) => c.sports?.name?.toUpperCase() === 'FOOTBALL') ||
                matches.some(isFootballMatch);

              if (isFootball) {
                const fbAnalytics = calculateFootballAnalytics(matches);
                const allFootballPlayerStats: FootballPlayerStats[] = [];
                participants.forEach((p: any) => {
                  p.members?.forEach((m: any) => {
                    if (m.player) {
                      allFootballPlayerStats.push(
                        calculateFootballPlayerStats(
                          matches,
                          m.player.id || m.player_id,
                          m.player.full_name || 'Player'
                        )
                      );
                    }
                  });
                });
                const fbLeaderboards = calculateFootballLeaderboards(allFootballPlayerStats, { topN: 5 });
                const totalCompleted = matches.filter(m => m.status === 'COMPLETED' || m.status === 'FINAL').length;
                const completionPct = matches.length > 0 ? (totalCompleted / matches.length) * 100 : 0;
                const avgGoals = totalCompleted > 0 ? (fbAnalytics.totalGoals / totalCompleted).toFixed(1) : '0.0';

                let highestScoringMatch: { goals: number; scoreA: number; scoreB: number } | null = null;
                let largestMargin: { margin: number; winnerScore: number; loserScore: number } | null = null;
                matches.forEach((m: any) => {
                  if (m.status === 'COMPLETED' || m.status === 'FINAL') {
                    const a = m.score_a ?? 0;
                    const b = m.score_b ?? 0;
                    const tot = a + b;
                    if (!highestScoringMatch || tot > highestScoringMatch.goals) {
                      highestScoringMatch = { goals: tot, scoreA: a, scoreB: b };
                    }
                    const diff = Math.abs(a - b);
                    if (!largestMargin || diff > largestMargin.margin) {
                      largestMargin = { margin: diff, winnerScore: Math.max(a, b), loserScore: Math.min(a, b) };
                    }
                  }
                });

                return (
                  <div className="pro-card p-6 space-y-6 bg-white">
                    <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
                      <div>
                        <h2 className="text-base font-bold text-[#172033]">Football Tournament Analytics & Highlights</h2>
                        <p className="text-xs text-[#667085] mt-0.5">
                          Authoritative match, scoring, discipline, and performance analytics powered by @arena-flow/statistics-engine
                        </p>
                      </div>
                      <span className="badge-live text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full">
                        ● LIVE STATS
                      </span>
                    </div>

                    {/* Core Football Metrics Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                        <span className="text-[10px] text-[#667085] uppercase font-semibold block">Completion</span>
                        <span className="text-lg font-bold text-[#172033] block mt-0.5">
                          {completionPct.toFixed(0)}%
                        </span>
                        <span className="text-[9px] text-[#667085] block">
                          {totalCompleted} of {matches.length} Matches
                        </span>
                      </div>

                      <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                        <span className="text-[10px] text-[#667085] uppercase font-semibold block">Total Goals</span>
                        <span className="text-lg font-bold text-[#14966B] block mt-0.5">
                          {fbAnalytics.totalGoals}
                        </span>
                        <span className="text-[9px] text-[#667085] block">
                          Avg {avgGoals} / match
                        </span>
                      </div>

                      <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                        <span className="text-[10px] text-[#667085] uppercase font-semibold block">Clean Sheets</span>
                        <span className="text-lg font-bold text-[#3267D6] block mt-0.5">
                          {fbAnalytics.cleanSheetMatches}
                        </span>
                        <span className="text-[9px] text-[#667085] block">
                          Shutouts Recorded
                        </span>
                      </div>

                      <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                        <span className="text-[10px] text-[#667085] uppercase font-semibold block">Discipline</span>
                        <span className="text-lg font-bold text-[#172033] block mt-0.5">
                          {fbAnalytics.totalYellowCards}🟨 / {fbAnalytics.totalRedCards}🟥
                        </span>
                        <span className="text-[9px] text-[#667085] block">
                          Total Cards
                        </span>
                      </div>
                    </div>

                    {/* Football Specific Insights & Records */}
                    {totalCompleted > 0 && (
                      <div className="grid sm:grid-cols-2 gap-4">
                        {/* Football Dynamic Insights */}
                        <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-2.5">
                          <span className="text-xs font-bold text-[#172033] uppercase font-mono block border-b border-[#E4E7EC] pb-1.5">
                            Football Dynamic Insights
                          </span>
                          <div className="space-y-1.5 text-xs text-[#667085]">
                            <div className="flex justify-between items-center">
                              <span>Matches Decided in Regulation:</span>
                              <span className="font-mono font-bold text-[#14966B]">{fbAnalytics.regulationDecidedMatches}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Extra Time Decisions:</span>
                              <span className="font-mono font-bold text-[#3267D6]">{fbAnalytics.extraTimeDecidedMatches}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Penalty Shootouts:</span>
                              <span className="font-mono font-bold text-[#5925DC]">{fbAnalytics.penaltyShootoutDecidedMatches}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Drawn Matches:</span>
                              <span className="font-mono font-bold text-[#C98218]">{fbAnalytics.drawMatches}</span>
                            </div>
                          </div>
                        </div>

                        {/* Tournament Records */}
                        <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-2.5">
                          <span className="text-xs font-bold text-[#172033] uppercase font-mono block border-b border-[#E4E7EC] pb-1.5">
                            Tournament Highlights
                          </span>
                          <div className="space-y-1.5 text-xs text-[#667085]">
                            <div className="flex justify-between items-center">
                              <span>Highest Scoring Match:</span>
                              <span className="font-mono font-bold text-[#14966B]">
                                {highestScoringMatch ? `${(highestScoringMatch as any).goals} goals (${(highestScoringMatch as any).scoreA}-${(highestScoringMatch as any).scoreB})` : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Largest Win Margin:</span>
                              <span className="font-mono font-bold text-[#3267D6]">
                                {largestMargin ? `+${(largestMargin as any).margin} goals (${(largestMargin as any).winnerScore}-${(largestMargin as any).loserScore})` : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Total Yellow Cards:</span>
                              <span className="font-mono font-bold text-[#B54708]">{fbAnalytics.totalYellowCards} 🟨</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>Total Red Cards:</span>
                              <span className="font-mono font-bold text-[#B42318]">{fbAnalytics.totalRedCards} 🟥</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Football Top Performer Leaderboards */}
                    {(fbLeaderboards.topScorers.length > 0 || fbLeaderboards.topAssists.length > 0 || fbLeaderboards.cleanSheets.length > 0) && (
                      <div className="space-y-3 pt-2 border-t border-[#E4E7EC]">
                        <span className="text-xs font-bold text-[#172033] uppercase font-mono block">
                          Football Performance Leaderboard
                        </span>
                        <div className="grid sm:grid-cols-3 gap-3 text-xs">
                          {/* Top Scorers */}
                          <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                            <span className="text-[10px] font-bold text-[#14966B] uppercase block mb-1.5">Top Scorers (Goals)</span>
                            {fbLeaderboards.topScorers.slice(0, 3).map((p: any, idx: number) => (
                              <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                                <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                                <span className="font-mono font-bold text-[#14966B]">{p.value} ⚽</span>
                              </div>
                            ))}
                          </div>

                          {/* Top Assists */}
                          <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                            <span className="text-[10px] font-bold text-[#3267D6] uppercase block mb-1.5">Top Assists</span>
                            {fbLeaderboards.topAssists.slice(0, 3).map((p: any, idx: number) => (
                              <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                                <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                                <span className="font-mono font-bold text-[#3267D6]">{p.value} 👟</span>
                              </div>
                            ))}
                          </div>

                          {/* Clean Sheets */}
                          <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                            <span className="text-[10px] font-bold text-[#5925DC] uppercase block mb-1.5">Clean Sheets</span>
                            {fbLeaderboards.cleanSheets.slice(0, 3).map((p: any, idx: number) => (
                              <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                                <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                                <span className="font-mono font-bold text-[#5925DC]">{p.value} 🧤</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              const tournStats = calculateTournamentStats({ matches, categories });
              const badmintonStats = calculateBadmintonAnalytics(matches);
              const tournRecords = calculateTournamentRecords(matches);
              const allPlayerStats = participants.map((p: any) => {
                const pId = p.id;
                const pName = p.members?.map((m: any) => m.player?.full_name).join(' & ') || 'Player';
                return calculatePlayerStats(matches, pId, pName);
              });
              const leaderboards = calculateLeaderboards(allPlayerStats, { minMatches: 1, topN: 5 });
              const totalDecided = badmintonStats.straightGameWins + badmintonStats.threeGameWins;
              const straightPct = totalDecided > 0 ? ((badmintonStats.straightGameWins / totalDecided) * 100).toFixed(0) : '0';
              const threePct = totalDecided > 0 ? ((badmintonStats.threeGameWins / totalDecided) * 100).toFixed(0) : '0';

              return (
                <div className="pro-card p-6 space-y-6 bg-white">
                  <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
                    <div>
                      <h2 className="text-base font-bold text-[#172033]">Tournament Analytics & Highlights</h2>
                      <p className="text-xs text-[#667085] mt-0.5">
                        Authoritative match, scoring, and performance analytics powered by @arena-flow/statistics-engine
                      </p>
                    </div>
                    <span className="badge-live text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full">
                      ● LIVE STATS
                    </span>
                  </div>

                  {/* Core Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                      <span className="text-[10px] text-[#667085] uppercase font-semibold block">Completion</span>
                      <span className="text-lg font-bold text-[#172033] block mt-0.5">
                        {tournStats.completionPercentage.toFixed(0)}%
                      </span>
                      <span className="text-[9px] text-[#667085] block">
                        {tournStats.completedMatches} of {tournStats.totalMatches} Matches
                      </span>
                    </div>

                    <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                      <span className="text-[10px] text-[#667085] uppercase font-semibold block">Total Games</span>
                      <span className="text-lg font-bold text-[#14966B] block mt-0.5">
                        {tournStats.totalGames}
                      </span>
                      <span className="text-[9px] text-[#667085] block">
                        Decided Games
                      </span>
                    </div>

                    <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                      <span className="text-[10px] text-[#667085] uppercase font-semibold block">Total Points</span>
                      <span className="text-lg font-bold text-[#3267D6] block mt-0.5">
                        {tournStats.totalPoints}
                      </span>
                      <span className="text-[9px] text-[#667085] block">
                        Avg {tournStats.averagePointsPerMatch.toFixed(1)} / match
                      </span>
                    </div>

                    <div className="bg-[#F8FAF9] p-3 rounded-xl border border-[#E4E7EC]">
                      <span className="text-[10px] text-[#667085] uppercase font-semibold block">Court Efficiency</span>
                      <span className="text-lg font-bold text-[#172033] block mt-0.5">
                        {allCourts.length > 0 ? (tournStats.completedMatches / allCourts.length).toFixed(1) : '0.0'}
                      </span>
                      <span className="text-[9px] text-[#667085] block">
                        Matches / Court
                      </span>
                    </div>
                  </div>

                  {/* Badminton Specific Analytics & Records */}
                  {tournStats.totalGames > 0 && (
                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Badminton Dynamic Insights */}
                      <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-2.5">
                        <span className="text-xs font-bold text-[#172033] uppercase font-mono block border-b border-[#E4E7EC] pb-1.5">
                          Badminton Dynamic Insights
                        </span>
                        <div className="space-y-1.5 text-xs text-[#667085]">
                          <div className="flex justify-between items-center">
                            <span>Total Rallies Played:</span>
                            <span className="font-mono font-bold text-[#172033]">{badmintonStats.totalRallies}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Straight-Game Wins (2-0):</span>
                            <span className="font-mono font-bold text-[#14966B]">{badmintonStats.straightGameWins} ({straightPct}%)</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>3-Game Deciders (2-1):</span>
                            <span className="font-mono font-bold text-[#3267D6]">{badmintonStats.threeGameWins} ({threePct}%)</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Deuce Games (≥20-20):</span>
                            <span className="font-mono font-bold text-[#C98218]">{badmintonStats.deuceGames}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Comeback Wins:</span>
                            <span className="font-mono font-bold text-[#5925DC]">{badmintonStats.comebackWins}</span>
                          </div>
                        </div>
                      </div>

                      {/* Tournament Records */}
                      <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-2.5">
                        <span className="text-xs font-bold text-[#172033] uppercase font-mono block border-b border-[#E4E7EC] pb-1.5">
                          Tournament Records & Highlights
                        </span>
                        <div className="space-y-1.5 text-xs text-[#667085]">
                          <div className="flex justify-between items-center">
                            <span>Longest Match:</span>
                            <span className="font-mono font-bold text-[#172033]">
                              {tournRecords.longestMatchDuration ? `${tournRecords.longestMatchDuration.durationMinutes}m` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Highest Scoring Game:</span>
                            <span className="font-mono font-bold text-[#14966B]">
                              {tournRecords.mostPointsInAGame ? `${tournRecords.mostPointsInAGame.totalPoints} pts (${tournRecords.mostPointsInAGame.scoreA}-${tournRecords.mostPointsInAGame.scoreB})` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Largest Game Margin:</span>
                            <span className="font-mono font-bold text-[#3267D6]">
                              {tournRecords.largestGameMargin ? `+${tournRecords.largestGameMargin.margin} (${tournRecords.largestGameMargin.winnerScore}-${tournRecords.largestGameMargin.loserScore})` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Walkovers / Defaults:</span>
                            <span className="font-mono font-bold text-[#667085]">
                              {tournStats.walkovers} W.O. / {tournStats.defaults} Def.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Top Performer Leaderboards */}
                  {leaderboards.highestWinPercentage.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-[#E4E7EC]">
                      <span className="text-xs font-bold text-[#172033] uppercase font-mono block">
                        Player Performance Leaderboard
                      </span>
                      <div className="grid sm:grid-cols-3 gap-3 text-xs">
                        {/* Win % Leaders */}
                        <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                          <span className="text-[10px] font-bold text-[#14966B] uppercase block mb-1.5">Top Win Rate</span>
                          {leaderboards.highestWinPercentage.slice(0, 3).map((p: any, idx: number) => (
                            <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                              <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                              <span className="font-mono font-bold text-[#14966B]">{p.value.toFixed(0)}%</span>
                            </div>
                          ))}
                        </div>

                        {/* Most Wins Leaders */}
                        <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                          <span className="text-[10px] font-bold text-[#3267D6] uppercase block mb-1.5">Most Match Wins</span>
                          {leaderboards.mostWins.slice(0, 3).map((p: any, idx: number) => (
                            <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                              <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                              <span className="font-mono font-bold text-[#3267D6]">{p.value}W</span>
                            </div>
                          ))}
                        </div>

                        {/* Point Diff Leaders */}
                        <div className="bg-[#F8FAF9] p-3 rounded-lg border border-[#E4E7EC]">
                          <span className="text-[10px] font-bold text-[#5925DC] uppercase block mb-1.5">Point Differential</span>
                          {leaderboards.bestPointDifferential.slice(0, 3).map((p: any, idx: number) => (
                            <div key={p.playerId} className="flex justify-between items-center py-1 border-b border-[#EAECF0]/60 last:border-0">
                              <span className="truncate max-w-[120px] font-semibold text-[#172033]">{idx + 1}. {p.playerName}</span>
                              <span className="font-mono font-bold text-[#5925DC]">{p.value > 0 ? `+${p.value}` : p.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            
            {/* Description */}
            <div className="pro-card p-6 space-y-3">
              <h2 className="text-base font-bold text-[#172033]">About Tournament</h2>
              <p className="text-xs text-[#667085] leading-relaxed whitespace-pre-wrap">
                {tournament.description || 'No description provided by the organizer.'}
              </p>
            </div>

            {/* Categories */}
            <div className="pro-card p-6 space-y-4">
              <h2 className="text-base font-bold text-[#172033]">Available Brackets</h2>
              {categories.length === 0 ? (
                <p className="text-xs text-[#98A2B3] italic">No categories created yet.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {categories.map((c) => (
                    <div key={c.id} className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-4 space-y-2">
                      <span className="font-bold text-sm text-[#172033] block">{c.name}</span>
                      <div className="space-y-1 text-xs text-[#667085]">
                        <div><span className="font-semibold text-[#344054]">Format:</span> {c.format}</div>
                        <div><span className="font-semibold text-[#344054]">Discipline:</span> {c.category_type}</div>
                        <div><span className="font-semibold text-[#344054]">Division:</span> {c.match_type}</div>
                        {c.age_group && <div><span className="font-semibold text-[#344054]">Age:</span> {c.age_group}</div>}
                        {c.skill_level && <div><span className="font-semibold text-[#344054]">Skill:</span> {c.skill_level}</div>}
                        <div><span className="font-semibold text-[#344054]">Registration Fee:</span> ${c.registration_fee}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rules */}
            <div className="pro-card p-6 space-y-3">
              <h2 className="text-base font-bold text-[#172033]">Rules & Guidelines</h2>
              <p className="text-xs text-[#667085] leading-relaxed whitespace-pre-wrap">
                {tournament.rules || 'Standard tournament rules apply.'}
              </p>
            </div>

            {/* Registered Participants */}
            <div className="pro-card p-6 space-y-4">
              <h2 className="text-base font-bold text-[#172033]">Registered Participants ({participants.filter(p => p.status === 'ACTIVE').length})</h2>
              {participants.filter(p => p.status === 'ACTIVE').length === 0 ? (
                <p className="text-xs text-[#98A2B3] italic">No confirmed participants yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {participants
                    .filter(p => p.status === 'ACTIVE')
                    .map((part) => {
                      const names = part.members.map(m => m.player?.full_name || 'Unknown Player').join(' & ');
                      return (
                        <div key={part.id} className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-3 text-xs">
                          <span className="font-semibold text-[#172033] block">{names}</span>
                          <span className="text-[10px] font-mono text-[#14966B] mt-1 block uppercase tracking-wider font-semibold">
                            {part.category.name}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Draws & Standings public spectator view */}
            {draws.length > 0 && (
              <div className="pro-card p-6 space-y-6">
                <h2 className="text-base font-bold text-[#172033]">Brackets, Standings & Results</h2>
                
                <div className="space-y-8">
                  {categories.filter(cat => draws.some(d => d.category_id === cat.id)).map((cat) => {
                    const catDraws = draws.filter(d => d.category_id === cat.id);
                    
                    return (
                      <div key={cat.id} className="border-t border-[#E4E7EC] pt-4 space-y-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="text-sm font-bold text-[#172033] block">{cat.name}</span>
                            <span className="text-xs text-[#667085] font-medium">Format: {cat.format}</span>
                          </div>
                        </div>

                        {/* If Group Stage, show standings for each subgroup */}
                        {cat.format === 'GROUP_KNOCKOUT' && (
                          <div className="space-y-6">
                            <span className="text-xs font-bold text-[#3267D6] font-mono block">Subgroup Stages</span>
                            <div className="grid gap-6 md:grid-cols-2">
                              {catDraws.filter(d => d.format === 'ROUND_ROBIN').map((subDraw) => {
                                const std = standings.find(s => s.draw_id === subDraw.id);
                                if (!std) return null;
                                const stdEntries = standingsEntries.filter(se => se.standings_id === std.id);
                                const isFootballCat = tournament.sports?.name?.toUpperCase() === 'FOOTBALL' ||
                                  (cat as any).sports?.name?.toUpperCase() === 'FOOTBALL' ||
                                  matches.some(isFootballMatch);
                                const sorted = sortStandings(stdEntries, matches, { sport: isFootballCat ? 'FOOTBALL' : 'BADMINTON' }).sortedEntries;
                                return (
                                  <div key={subDraw.id} className="bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-4 space-y-2">
                                    <span className="text-xs font-bold text-[#172033] block font-mono border-b border-[#EAECF0] pb-1.5">
                                      {subDraw.group_name} Standings
                                    </span>
                                    <div className="overflow-x-auto">
                                      {isFootballCat ? (
                                        <table className="w-full text-[11px] text-left text-[#667085]">
                                          <thead>
                                            <tr className="text-[#98A2B3] uppercase text-[9px] font-mono border-b border-[#EAECF0]">
                                              <th className="py-2 px-1">Rank</th>
                                              <th className="py-2 px-1">Team</th>
                                              <th className="py-2 px-1 text-center">P</th>
                                              <th className="py-2 px-1 text-center">W</th>
                                              <th className="py-2 px-1 text-center">D</th>
                                              <th className="py-2 px-1 text-center">L</th>
                                              <th className="py-2 px-1 text-center">GF</th>
                                              <th className="py-2 px-1 text-center">GA</th>
                                              <th className="py-2 px-1 text-center">GD</th>
                                              <th className="py-2 px-1 text-center">PTS</th>
                                              <th className="py-2 px-1">Tie-Break</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {sorted.map((e) => {
                                              const team = participants.find(p => p.id === e.participant_id);
                                              const nameStr = team?.members.map(m => m.player?.full_name).join(' & ') || 'Unknown';
                                              const gd = e.goal_difference ?? ((e.goals_for ?? 0) - (e.goals_against ?? 0));
                                              const pts = e.points ?? (e.won * 3 + (e.drawn ?? 0));
                                              const rankBadge = e.rank === 1
                                                ? 'bg-[#E8F5F0] text-[#14966B] font-bold border border-[#C4E9DC]'
                                                : e.rank === 2
                                                ? 'bg-[#F2F4F7] text-[#344054] font-bold border border-[#D0D5DD]'
                                                : e.rank === 3
                                                ? 'bg-[#FEF6EE] text-[#B54708] font-bold border border-[#F9DBAF]'
                                                : 'text-[#667085]';
                                              return (
                                                <tr key={e.id} className="border-b border-[#EAECF0] py-1 hover:bg-white transition-colors">
                                                  <td className="py-1 px-1">
                                                    <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${rankBadge}`}>
                                                      {e.rank}
                                                    </span>
                                                  </td>
                                                  <td className="py-1 px-1 text-[#172033] font-semibold truncate max-w-[110px]">{nameStr}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums">{e.played}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums text-[#14966B] font-bold">{e.won}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums text-[#667085]">{e.drawn ?? 0}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums text-[#C94A4A]">{e.lost}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums">{e.goals_for ?? 0}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums">{e.goals_against ?? 0}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums font-bold text-[#14966B]">{gd > 0 ? `+${gd}` : gd}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums font-bold text-[#172033]">{pts}</td>
                                                  <td className="py-1 px-1 text-[10px] text-[#667085] truncate max-w-[90px]" title={e.tieBreakReason || ''}>
                                                    {e.tieBreakReason || '—'}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      ) : (
                                        <table className="w-full text-[11px] text-left text-[#667085]">
                                          <thead>
                                            <tr className="text-[#98A2B3] uppercase text-[9px] font-mono border-b border-[#EAECF0]">
                                              <th className="py-2 px-1">Rank</th>
                                              <th className="py-2 px-1">Team</th>
                                              <th className="py-2 px-1 text-center">W/L</th>
                                              <th className="py-2 px-1 text-center">Games</th>
                                              <th className="py-2 px-1 text-center">Pts Diff</th>
                                              <th className="py-2 px-1">Tie-Break</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {sorted.map((e) => {
                                              const team = participants.find(p => p.id === e.participant_id);
                                              const nameStr = team?.members.map(m => m.player?.full_name).join(' & ') || 'Unknown';
                                              const rankBadge = e.rank === 1
                                                ? 'bg-[#E8F5F0] text-[#14966B] font-bold border border-[#C4E9DC]'
                                                : e.rank === 2
                                                ? 'bg-[#F2F4F7] text-[#344054] font-bold border border-[#D0D5DD]'
                                                : e.rank === 3
                                                ? 'bg-[#FEF6EE] text-[#B54708] font-bold border border-[#F9DBAF]'
                                                : 'text-[#667085]';
                                              return (
                                                <tr key={e.id} className="border-b border-[#EAECF0] py-1 hover:bg-white transition-colors">
                                                  <td className="py-1 px-1">
                                                    <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${rankBadge}`}>
                                                      {e.rank}
                                                    </span>
                                                  </td>
                                                  <td className="py-1 px-1 text-[#172033] font-semibold truncate max-w-[130px]">{nameStr}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums">{e.won}/{e.lost}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums">{e.games_won ?? 0}-{e.games_lost ?? 0}</td>
                                                  <td className="py-1 px-1 text-center font-mono tabular-nums text-[#14966B] font-semibold">{e.points_diff > 0 ? `+${e.points_diff}` : e.points_diff}</td>
                                                  <td className="py-1 px-1 text-[10px] text-[#667085] truncate max-w-[110px]" title={e.tieBreakReason || ''}>
                                                    {e.tieBreakReason || '—'}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Standard Round Robin Standings */}
                        {cat.format === 'ROUND_ROBIN' && (
                          <div className="space-y-4">
                            {catDraws.map((subDraw) => {
                              const std = standings.find(s => s.draw_id === subDraw.id);
                              if (!std) return null;
                              const stdEntries = standingsEntries.filter(se => se.standings_id === std.id);
                              const isFootballCat = tournament.sports?.name?.toUpperCase() === 'FOOTBALL' ||
                                (cat as any).sports?.name?.toUpperCase() === 'FOOTBALL' ||
                                matches.some(isFootballMatch);
                              const sorted = sortStandings(stdEntries, matches, { sport: isFootballCat ? 'FOOTBALL' : 'BADMINTON' }).sortedEntries;
                              return (
                                <div key={subDraw.id} className="bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-4 space-y-2">
                                  <span className="text-xs font-bold text-[#172033] block font-mono border-b border-[#EAECF0] pb-1.5">
                                    Standings Leaderboard
                                  </span>
                                  <div className="overflow-x-auto">
                                    {isFootballCat ? (
                                      <table className="w-full text-xs text-left text-[#667085]">
                                        <thead>
                                          <tr className="text-[#98A2B3] uppercase text-[10px] font-mono border-b border-[#EAECF0]">
                                            <th className="py-2 px-1">Rank</th>
                                            <th className="py-2 px-1">Team</th>
                                            <th className="py-2 px-1 text-center">P</th>
                                            <th className="py-2 px-1 text-center">W</th>
                                            <th className="py-2 px-1 text-center">D</th>
                                            <th className="py-2 px-1 text-center">L</th>
                                            <th className="py-2 px-1 text-center">GF</th>
                                            <th className="py-2 px-1 text-center">GA</th>
                                            <th className="py-2 px-1 text-center">GD</th>
                                            <th className="py-2 px-1 text-center">PTS</th>
                                            <th className="py-2 px-1">Tie-Break Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sorted.map((e) => {
                                            const team = participants.find(p => p.id === e.participant_id);
                                            const nameStr = team?.members.map(m => m.player?.full_name).join(' & ') || 'Unknown';
                                            const gd = e.goal_difference ?? ((e.goals_for ?? 0) - (e.goals_against ?? 0));
                                            const pts = e.points ?? (e.won * 3 + (e.drawn ?? 0));
                                            const rankBadge = e.rank === 1
                                              ? 'bg-[#E8F5F0] text-[#14966B] font-bold border border-[#C4E9DC]'
                                              : e.rank === 2
                                              ? 'bg-[#F2F4F7] text-[#344054] font-bold border border-[#D0D5DD]'
                                              : e.rank === 3
                                              ? 'bg-[#FEF6EE] text-[#B54708] font-bold border border-[#F9DBAF]'
                                              : 'text-[#667085]';
                                            return (
                                              <tr key={e.id} className="border-b border-[#EAECF0] py-1.5 hover:bg-white transition-colors">
                                                <td className="py-1.5 px-1">
                                                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${rankBadge}`}>
                                                    {e.rank}
                                                  </span>
                                                </td>
                                                <td className="py-1.5 px-1 text-[#172033] font-semibold">{nameStr}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums">{e.played}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums text-[#14966B] font-bold">{e.won}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums text-[#667085]">{e.drawn ?? 0}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums text-[#C94A4A]">{e.lost}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums">{e.goals_for ?? 0}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums">{e.goals_against ?? 0}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums font-bold text-[#14966B]">{gd > 0 ? `+${gd}` : gd}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums font-bold text-[#172033]">{pts}</td>
                                                <td className="py-1.5 px-1 text-[11px] text-[#667085]">
                                                  {e.tieBreakReason || '—'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <table className="w-full text-xs text-left text-[#667085]">
                                        <thead>
                                          <tr className="text-[#98A2B3] uppercase text-[10px] font-mono border-b border-[#EAECF0]">
                                            <th className="py-2 px-1">Rank</th>
                                            <th className="py-2 px-1">Player/Team</th>
                                            <th className="py-2 px-1 text-center">Played</th>
                                            <th className="py-2 px-1 text-center">Won</th>
                                            <th className="py-2 px-1 text-center">Lost</th>
                                            <th className="py-2 px-1 text-center">Games</th>
                                            <th className="py-2 px-1 text-center">Pts Diff</th>
                                            <th className="py-2 px-1">Tie-Break Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sorted.map((e) => {
                                            const team = participants.find(p => p.id === e.participant_id);
                                            const nameStr = team?.members.map(m => m.player?.full_name).join(' & ') || 'Unknown';
                                            const rankBadge = e.rank === 1
                                              ? 'bg-[#E8F5F0] text-[#14966B] font-bold border border-[#C4E9DC]'
                                              : e.rank === 2
                                              ? 'bg-[#F2F4F7] text-[#344054] font-bold border border-[#D0D5DD]'
                                              : e.rank === 3
                                              ? 'bg-[#FEF6EE] text-[#B54708] font-bold border border-[#F9DBAF]'
                                              : 'text-[#667085]';
                                            return (
                                              <tr key={e.id} className="border-b border-[#EAECF0] py-1.5 hover:bg-white transition-colors">
                                                <td className="py-1.5 px-1">
                                                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${rankBadge}`}>
                                                    {e.rank}
                                                  </span>
                                                </td>
                                                <td className="py-1.5 px-1 text-[#172033] font-semibold">{nameStr}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums">{e.played}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums text-[#14966B] font-bold">{e.won}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums text-[#C94A4A]">{e.lost}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums">{e.games_won ?? 0}-{e.games_lost ?? 0}</td>
                                                <td className="py-1.5 px-1 text-center font-mono tabular-nums font-bold text-[#14966B]">
                                                  {e.points_diff > 0 ? `+${e.points_diff}` : e.points_diff}
                                                </td>
                                                <td className="py-1.5 px-1 text-[11px] text-[#667085]">
                                                  {e.tieBreakReason || '—'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Bracket rendering for KNOCKOUT format */}
                        {catDraws.some(d => d.format === 'KNOCKOUT') && (
                          <div className="space-y-4">
                            <span className="text-xs font-bold text-[#14966B] font-mono block">
                              {cat.format === 'GROUP_KNOCKOUT' ? 'Knockout Bracket Stage' : 'Tournament Bracket'}
                            </span>
                            <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
                              {(() => {
                                const koDraw = catDraws.find(d => d.format === 'KNOCKOUT');
                                if (!koDraw) return null;
                                const koRounds = rounds.filter(r => r.draw_id === koDraw.id);
                                return koRounds.map((round) => {
                                  const roundMatches = matches.filter(m => m.round_id === round.id);
                                  const sortedMatches = [...roundMatches].sort((a, b) => {
                                    const nodeA = drawNodes.find(n => n.match_id === a.id);
                                    const nodeB = drawNodes.find(n => n.match_id === b.id);
                                    return (nodeA?.position || 0) - (nodeB?.position || 0);
                                  });

                                  return (
                                    <div key={round.id} className="flex-1 min-w-[220px] space-y-4">
                                      <span className="text-[10px] font-bold font-mono text-[#667085] uppercase tracking-wider block border-b border-[#E4E7EC] pb-1 text-center">
                                        {round.name}
                                      </span>
                                      <div className="space-y-4 flex flex-col justify-around h-full min-h-[250px]">
                                        {sortedMatches.map((m) => {
                                          const nameA = m.participant_a?.members.map((mb: any) => mb.player?.full_name).join(' & ') || 'Pending';
                                          const nameB = m.participant_b?.members.map((mb: any) => mb.player?.full_name).join(' & ') || 'Pending';
                                          
                                          const outcomeInfo = formatOutcomeScore(m);
                                          const isCompleted = m.status === 'COMPLETED' || m.status === 'FINAL';

                                          return (
                                            <div 
                                              key={m.id} 
                                              onClick={() => openMatchDetail(m)}
                                              className="scoreboard-card p-3 text-xs space-y-2 cursor-pointer hover:border-[#14966B] transition hover:shadow-md btn-press"
                                            >
                                              <div className="flex justify-between items-center text-[9px] text-[#98A2B3] font-mono">
                                                <span>Match ID: {m.id.substring(0, 4)}</span>
                                                <div className="flex items-center gap-1">
                                                  {outcomeInfo.outcomeLabel && (
                                                    <span className="font-mono text-[8px] font-bold px-1.5 py-0.2 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] uppercase">
                                                      {outcomeInfo.outcomeLabel}
                                                    </span>
                                                  )}
                                                  {m.court?.name && <span className="text-[#3267D6] font-semibold">{m.court.name}</span>}
                                                </div>
                                              </div>
                                              <div className="space-y-1">
                                                <div className={`flex justify-between items-center ${m.winner_id === m.participant_a_id && isCompleted ? 'text-[#14966B] font-bold' : 'text-[#344054]'}`}>
                                                  <span className="truncate max-w-[130px]">{nameA}</span>
                                                  {m.winner_id === m.participant_a_id && isCompleted && (
                                                    <span className="text-[10px] text-[#14966B]">✓</span>
                                                  )}
                                                </div>
                                                <div className={`flex justify-between items-center ${m.winner_id === m.participant_b_id && isCompleted ? 'text-[#14966B] font-bold' : 'text-[#344054]'}`}>
                                                  <span className="truncate max-w-[130px]">{nameB}</span>
                                                  {m.winner_id === m.participant_b_id && isCompleted && (
                                                    <span className="text-[10px] text-[#14966B]">✓</span>
                                                  )}
                                                </div>
                                              </div>
                                              {outcomeInfo.text && (
                                                <div className="text-[10px] text-[#14966B] font-mono text-right border-t border-[#E4E7EC] pt-1.5 font-bold tabular-nums">
                                                  Score: {outcomeInfo.text}
                                                </div>
                                              )}
                                              {m.status === 'READY' && m.scheduled_at && (
                                                <div className="text-[9px] text-[#3267D6] font-mono text-right border-t border-[#E4E7EC] pt-1.5">
                                                  Sch: {new Date(m.scheduled_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Registration Panel */}
          <div className="space-y-6">
            <div className="pro-card p-6 space-y-4">
              <h3 className="text-base font-bold text-[#172033] border-b border-[#E4E7EC] pb-2">Tournament Registration</h3>
              
              {successMsg && (
                <div className="bg-[#E8F5F0] border border-[#C4E9DC] text-[#14966B] rounded-md p-3 text-xs font-semibold">
                  {successMsg}
                </div>
              )}

              {errorMsg && (
                <div className="bg-[#FDF0F0] border border-[#FDA29B] text-[#B42318] rounded-md p-3 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-2 text-xs text-[#667085]">
                <div className="flex justify-between">
                  <span>Registration Status:</span>
                  <span className={`font-bold ${isRegistrationOpen ? 'text-[#14966B]' : 'text-[#B42318]'}`}>
                    {isRegistrationOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Registration Opens:</span>
                  <span className="text-[#344054] font-medium">{new Date(tournament.registration_open).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Registration Closes:</span>
                  <span className="text-[#344054] font-medium">{new Date(tournament.registration_close).toLocaleDateString()}</span>
                </div>
              </div>

              {user && myRegistrations.length > 0 && (
                <div className="pt-4 border-t border-[#E4E7EC] space-y-3">
                  <span className="font-bold text-xs block text-[#172033]">My Registrations:</span>
                  <div className="space-y-2">
                    {myRegistrations.map((reg) => {
                      const cat = categories.find(c => c.id === reg.category_id);
                      if (!cat) return null;
                      return (
                        <div key={reg.id} className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-3 text-xs space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-[#172033]">{cat.name}</span>
                            <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                              reg.status === 'APPROVED' ? 'badge-live' :
                              reg.status === 'PENDING' ? 'badge-ready' :
                              reg.status === 'REJECTED' ? 'bg-[#FDF0F0] text-[#B42318] border border-[#FDA29B]' :
                              'badge-idle'
                            }`}>
                              {reg.status}
                            </span>
                          </div>
                          
                          {reg.status === 'PENDING' && (
                            <div className="flex flex-col space-y-2">
                              <p className="text-[11px] text-[#667085]">Your registration is awaiting organizer approval.</p>
                              <button
                                type="button"
                                onClick={() => handleCancelRegistration(reg.id)}
                                disabled={registering}
                                className="text-xs font-semibold text-[#B42318] hover:text-[#912018] bg-[#FDF0F0] hover:bg-[#FEE4E2] border border-[#FDA29B] py-1.5 rounded-md transition text-center"
                              >
                                {registering ? 'Cancelling...' : 'Cancel Registration'}
                              </button>
                            </div>
                          )}

                          {reg.status === 'APPROVED' && (
                            <p className="text-[11px] text-[#14966B] font-semibold">Your registration is approved.</p>
                          )}

                          {reg.status === 'REJECTED' && (
                            <p className="text-[11px] text-[#B42318] font-medium">Your registration was rejected by the organizer.</p>
                          )}

                          {reg.status === 'CANCELLED' && (
                            <p className="text-[11px] text-[#667085]">You cancelled this registration.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isRegistrationOpen && (
                <div className="pt-4 border-t border-[#E4E7EC]">
                  {!user ? (
                    <div className="text-center py-2 space-y-3">
                      <p className="text-xs text-[#667085]">You must be logged in to register for categories.</p>
                      <button
                        type="button"
                        onClick={() => router.push('/auth/login')}
                        className="btn-primary w-full py-2 text-xs"
                      >
                        Log In to Register
                      </button>
                    </div>
                  ) : profile?.role !== 'PLAYER' ? (
                    <div className="text-center py-2 text-xs text-[#C98218] font-medium bg-[#FEF6EE] border border-[#F9DBAF] rounded-md p-2.5">
                      ⚠️ Registrations are restricted to users with the PLAYER role.
                    </div>
                  ) : eligibleCategories.length === 0 ? (
                    <div className="text-center py-4 text-xs text-[#667085] italic">
                      You have registered for all available brackets in this tournament.
                    </div>
                  ) : (
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-[#344054] mb-1.5">Select Category</label>
                        <select
                          value={regCategoryId}
                          onChange={(e) => setRegCategoryId(e.target.value)}
                          className="arena-select text-xs py-2"
                        >
                          {eligibleCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Player Gender & DOB Fields */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-[#344054] mb-1.5">Your Gender *</label>
                          <select
                            value={playerGender}
                            onChange={(e) => setPlayerGender(e.target.value)}
                            required
                            className="arena-select text-xs py-2"
                          >
                            <option value="">Select</option>
                            <option value="MALE">Male</option>
                            <option value="FEMALE">Female</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#344054] mb-1.5">Your DOB *</label>
                          <input
                            type="date"
                            value={playerDob}
                            onChange={(e) => setPlayerDob(e.target.value)}
                            required
                            className="arena-input text-xs py-2"
                          />
                        </div>
                      </div>

                      {categories.find(c => c.id === regCategoryId)?.category_type === 'DOUBLES' && (
                        <div className="space-y-3 pt-3 border-t border-[#E4E7EC]">
                          <div>
                            <label className="block text-xs font-semibold text-[#344054] mb-1.5">Partner Full Name / Display Name *</label>
                            <input
                              type="text"
                              required
                              placeholder="Enter partner name to search..."
                              value={partnerEmail}
                              onChange={(e) => setPartnerEmail(e.target.value)}
                              className="arena-input text-xs py-2"
                            />
                            <span className="text-[10px] text-[#667085] mt-1 block">
                              Partner must be registered as a PLAYER on ArenaFlow.
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-[#344054] mb-1.5">Partner Gender *</label>
                              <select
                                value={partnerGender}
                                onChange={(e) => setPartnerGender(e.target.value)}
                                required
                                className="arena-select text-xs py-2"
                              >
                                <option value="">Select</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#344054] mb-1.5">Partner DOB *</label>
                              <input
                                type="date"
                                value={partnerDob}
                                onChange={(e) => setPartnerDob(e.target.value)}
                                required
                                className="arena-input text-xs py-2"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={registering}
                        className="btn-primary w-full py-2.5 text-xs flex items-center justify-center gap-2"
                      >
                        {registering ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          'Submit Registration'
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      {/* Feature 11: Spectator Match Detail & Event Timeline Modal */}
      {selectedMatchDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div 
            className="bg-white border border-[#E4E7EC] rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-[#F8FAFC] border-b border-[#E4E7EC] p-5 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-[#3267D6] bg-[#EEF4FF] border border-[#C8DCFE] px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                    {selectedMatchDetail.category?.name || 'Match Details'}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider font-mono ${
                    selectedMatchDetail.status === 'LIVE' ? 'badge-live' :
                    selectedMatchDetail.status === 'READY' ? 'badge-ready' :
                    selectedMatchDetail.status === 'COMPLETED' || selectedMatchDetail.status === 'FINAL' ? 'badge-completed' :
                    'badge-idle'
                  }`}>
                    {selectedMatchDetail.status}
                  </span>
                  {selectedMatchDetail.outcome && (
                    <span className="text-[10px] font-bold bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA] px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                      {selectedMatchDetail.outcome}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-[#172033]">
                  {selectedMatchDetail.court?.name || 'Court TBD'}
                  {selectedMatchDetail.scheduled_at && (
                    <span className="text-xs font-normal text-[#667085] ml-2 font-mono">
                      • {new Date(selectedMatchDetail.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </h3>
              </div>
              <button
                onClick={closeMatchDetail}
                className="text-[#98A2B3] hover:text-[#172033] text-sm font-bold p-1 rounded-md hover:bg-[#EAECF0] transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-6 overflow-y-auto flex-1">
              {isFootballMatch(selectedMatchDetail) ? (
                <div className="space-y-4">
                  {/* Football Score Banner */}
                  <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-4">
                      <div className="flex-1 text-right">
                        <span className="font-bold text-sm text-[#172033] block truncate">{getPlayerNames(selectedMatchDetail.participant_a)}</span>
                        {selectedMatchDetail.winner_id === selectedMatchDetail.participant_a_id && (
                          <span className="text-[10px] font-bold text-[#14966B]">🏆 Winner</span>
                        )}
                      </div>
                      <div className="font-mono font-extrabold text-2xl text-[#172033] px-3 py-1 bg-white border border-[#E4E7EC] rounded-lg shadow-sm">
                        {selectedMatchDetail.score_a ?? 0} - {selectedMatchDetail.score_b ?? 0}
                      </div>
                      <div className="flex-1 text-left">
                        <span className="font-bold text-sm text-[#172033] block truncate">{getPlayerNames(selectedMatchDetail.participant_b)}</span>
                        {selectedMatchDetail.winner_id === selectedMatchDetail.participant_b_id && (
                          <span className="text-[10px] font-bold text-[#14966B]">🏆 Winner</span>
                        )}
                      </div>
                    </div>
                    {/* Football Period / Halftime / ET / Shootout Score Details */}
                    <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-[#667085] pt-1">
                      {selectedMatchDetail.match_phase && (
                        <span className="px-2 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] font-bold border border-[#C8DCFE] uppercase">
                          {selectedMatchDetail.match_phase.replace(/_/g, ' ')}
                        </span>
                      )}
                      {(selectedMatchDetail.halftime_score?.score_a ?? selectedMatchDetail.halftime_score?.scoreA ?? selectedMatchDetail.halftime_score_a) != null && (
                        <span>HT: {selectedMatchDetail.halftime_score?.score_a ?? selectedMatchDetail.halftime_score?.scoreA ?? selectedMatchDetail.halftime_score_a}-{selectedMatchDetail.halftime_score?.score_b ?? selectedMatchDetail.halftime_score?.scoreB ?? selectedMatchDetail.halftime_score_b}</span>
                      )}
                      {(selectedMatchDetail.extra_time_score?.score_a ?? selectedMatchDetail.extra_time_score?.scoreA ?? selectedMatchDetail.extra_time_score_a) != null && (
                        <span>• AET: {selectedMatchDetail.extra_time_score?.score_a ?? selectedMatchDetail.extra_time_score?.scoreA ?? selectedMatchDetail.extra_time_score_a}-{selectedMatchDetail.extra_time_score?.score_b ?? selectedMatchDetail.extra_time_score?.scoreB ?? selectedMatchDetail.extra_time_score_b}</span>
                      )}
                      {(selectedMatchDetail.shootout_score?.score_a ?? selectedMatchDetail.shootout_score?.scoreA ?? selectedMatchDetail.shootout_score_a) != null && (
                        <span>• PEN: {selectedMatchDetail.shootout_score?.score_a ?? selectedMatchDetail.shootout_score?.scoreA ?? selectedMatchDetail.shootout_score_a}-{selectedMatchDetail.shootout_score?.score_b ?? selectedMatchDetail.shootout_score?.scoreB ?? selectedMatchDetail.shootout_score_b}</span>
                      )}
                    </div>
                  </div>

                  {/* Football Lineups Section */}
                  {selectedMatchDetail.lineup_data && (
                    <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-3.5 space-y-3">
                      <span className="text-[10px] font-bold text-[#172033] uppercase font-mono tracking-wider block border-b border-[#EAECF0] pb-1">
                        Team Lineups
                      </span>
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {/* Side A Lineup */}
                        <div className="space-y-2">
                          <span className="font-bold text-[#172033] block text-[11px] truncate">
                            {getPlayerNames(selectedMatchDetail.participant_a)}
                          </span>
                          <div className="space-y-1">
                            <span className="text-[9px] font-mono font-bold text-[#667085] uppercase block">Starting XI</span>
                            {selectedMatchDetail.lineup_data.teamA?.startingXI?.map((p: any) => (
                              <div key={p.playerId} className="flex items-center gap-1 text-[11px]">
                                <span className="font-mono text-[9px] text-[#98A2B3]">#{p.shirtNumber || '-'}</span>
                                <span className="truncate">{p.playerName}</span>
                                {p.isCaptain && <span className="text-[9px] font-bold text-[#C98218]">(C)</span>}
                                {p.isGoalkeeper && <span className="text-[9px] font-bold text-[#3267D6]">(GK)</span>}
                              </div>
                            )) || <span className="text-[10px] text-[#98A2B3] italic">No Starting XI listed</span>}
                          </div>
                          {selectedMatchDetail.lineup_data.teamA?.substitutes?.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-[#EAECF0]">
                              <span className="text-[9px] font-mono font-bold text-[#667085] uppercase block">Substitutes</span>
                              {selectedMatchDetail.lineup_data.teamA.substitutes.map((p: any) => (
                                <div key={p.playerId} className="flex items-center gap-1 text-[11px] text-[#667085]">
                                  <span className="font-mono text-[9px] text-[#98A2B3]">#{p.shirtNumber || '-'}</span>
                                  <span className="truncate">{p.playerName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Side B Lineup */}
                        <div className="space-y-2">
                          <span className="font-bold text-[#172033] block text-[11px] truncate">
                            {getPlayerNames(selectedMatchDetail.participant_b)}
                          </span>
                          <div className="space-y-1">
                            <span className="text-[9px] font-mono font-bold text-[#667085] uppercase block">Starting XI</span>
                            {selectedMatchDetail.lineup_data.teamB?.startingXI?.map((p: any) => (
                              <div key={p.playerId} className="flex items-center gap-1 text-[11px]">
                                <span className="font-mono text-[9px] text-[#98A2B3]">#{p.shirtNumber || '-'}</span>
                                <span className="truncate">{p.playerName}</span>
                                {p.isCaptain && <span className="text-[9px] font-bold text-[#C98218]">(C)</span>}
                                {p.isGoalkeeper && <span className="text-[9px] font-bold text-[#3267D6]">(GK)</span>}
                              </div>
                            )) || <span className="text-[10px] text-[#98A2B3] italic">No Starting XI listed</span>}
                          </div>
                          {selectedMatchDetail.lineup_data.teamB?.substitutes?.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-[#EAECF0]">
                              <span className="text-[9px] font-mono font-bold text-[#667085] uppercase block">Substitutes</span>
                              {selectedMatchDetail.lineup_data.teamB.substitutes.map((p: any) => (
                                <div key={p.playerId} className="flex items-center gap-1 text-[11px] text-[#667085]">
                                  <span className="font-mono text-[9px] text-[#98A2B3]">#{p.shirtNumber || '-'}</span>
                                  <span className="truncate">{p.playerName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Head-to-Head Section */}
                  <div className="grid grid-cols-2 gap-4 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-4">
                    <div className={`space-y-1 ${
                      selectedMatchDetail.winner_id === selectedMatchDetail.participant_a_id ? 'text-[#14966B]' : 'text-[#172033]'
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-[#98A2B3] font-mono uppercase">Side A</span>
                        {selectedMatchDetail.winner_id === selectedMatchDetail.participant_a_id && (
                          <span className="text-xs">🏆 Winner</span>
                        )}
                      </div>
                      <div className="text-sm font-bold truncate">
                        {getPlayerNames(selectedMatchDetail.participant_a)}
                      </div>
                    </div>

                    <div className={`space-y-1 text-right ${
                      selectedMatchDetail.winner_id === selectedMatchDetail.participant_b_id ? 'text-[#14966B]' : 'text-[#172033]'
                    }`}>
                      <div className="flex items-center justify-end gap-1.5">
                        {selectedMatchDetail.winner_id === selectedMatchDetail.participant_b_id && (
                          <span className="text-xs">🏆 Winner</span>
                        )}
                        <span className="text-[10px] font-bold text-[#98A2B3] font-mono uppercase">Side B</span>
                      </div>
                      <div className="text-sm font-bold truncate">
                        {getPlayerNames(selectedMatchDetail.participant_b)}
                      </div>
                    </div>
                  </div>

                  {/* Live Service Indicator (if Badminton service active) */}
                  {selectedMatchDetail.service_state && (
                    <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-3 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div className="flex items-center gap-1.5 text-[#15803D] font-semibold">
                        <span className="text-sm">🏸</span>
                        <span>
                          Server: <strong className="font-bold">{selectedMatchDetail.service_state.servingSide === 'A' ? getPlayerNames(selectedMatchDetail.participant_a) : getPlayerNames(selectedMatchDetail.participant_b)}</strong> ({selectedMatchDetail.service_state.serverCourt} Court)
                        </span>
                      </div>
                      <div className="text-[#667085] text-[11px]">
                        Receiver Court: <strong className="font-semibold text-[#172033]">{selectedMatchDetail.service_state.receiverCourt}</strong>
                      </div>
                    </div>
                  )}

                  {/* Match Analytics Box */}
                  {(() => {
                    const matchAnalytics = calculateMatchAnalytics(selectedMatchDetail);
                    if (matchAnalytics.totalPoints === 0 && selectedMatchDetail.outcome !== 'WALKOVER' && selectedMatchDetail.outcome !== 'DEFAULT') return null;

                    return (
                      <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-3.5 space-y-2">
                        <div className="flex justify-between items-center border-b border-[#EAECF0] pb-1.5">
                          <span className="text-[10px] font-bold text-[#172033] uppercase font-mono tracking-wider">
                            Match Analytics Summary
                          </span>
                          <div className="flex items-center gap-1.5">
                            {matchAnalytics.isStraightGames && (
                              <span className="text-[9px] font-bold text-[#14966B] bg-[#E8F6F0] px-2 py-0.5 rounded border border-[#C4E9DC]">
                                2-0 Straight Games
                              </span>
                            )}
                            {matchAnalytics.isThreeGames && (
                              <span className="text-[9px] font-bold text-[#3267D6] bg-[#EEF4FF] px-2 py-0.5 rounded border border-[#C8DCFE]">
                                2-1 Decider (3 Games)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="bg-white p-2 rounded-lg border border-[#EAECF0]">
                            <span className="text-[9px] text-[#667085] uppercase font-semibold block">Total Points</span>
                            <span className="font-mono font-bold text-[#172033] mt-0.5 block">{matchAnalytics.totalPoints}</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-[#EAECF0]">
                            <span className="text-[9px] text-[#667085] uppercase font-semibold block">Match Duration</span>
                            <span className="font-mono font-bold text-[#172033] mt-0.5 block">
                              {matchAnalytics.durationMinutes ? `${matchAnalytics.durationMinutes}m` : '—'}
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-[#EAECF0]">
                            <span className="text-[9px] text-[#667085] uppercase font-semibold block">Largest Margin</span>
                            <span className="font-mono font-bold text-[#3267D6] mt-0.5 block">
                              {matchAnalytics.largestGameMargin > 0 ? `+${matchAnalytics.largestGameMargin} pts` : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Game Scores Breakdown */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-[#172033] uppercase tracking-wider block font-mono">
                      Game Score Details
                    </span>
                    {selectedMatchDetail.games && selectedMatchDetail.games.length > 0 ? (
                      <div className="border border-[#EAECF0] rounded-lg overflow-hidden">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#F8FAFC] border-b border-[#EAECF0] text-[10px] text-[#667085] uppercase font-mono">
                            <tr>
                              <th className="px-3 py-2">Game</th>
                              <th className="px-3 py-2 text-center">{getPlayerNames(selectedMatchDetail.participant_a)}</th>
                              <th className="px-3 py-2 text-center">{getPlayerNames(selectedMatchDetail.participant_b)}</th>
                              <th className="px-3 py-2 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EAECF0]">
                            {selectedMatchDetail.games.map((g: any) => (
                              <tr key={g.id || g.game_number} className="hover:bg-[#F9FAFB]">
                                <td className="px-3 py-2 font-mono font-semibold text-[#344054]">Game {g.game_number}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-[#172033] text-sm">
                                  {g.participant_a_score ?? 0}
                                </td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-[#172033] text-sm">
                                  {g.participant_b_score ?? 0}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[10px]">
                                  <span className={`px-1.5 py-0.5 rounded uppercase font-bold ${
                                    g.status === 'COMPLETED' ? 'badge-completed' : 'badge-live'
                                  }`}>
                                    {g.status || 'FINAL'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-[#98A2B3] italic bg-[#F9FAFB] p-3 rounded-lg border border-[#EAECF0]">
                        {formatOutcomeScore(selectedMatchDetail).text || 'No score recorded yet.'}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Match Event Timeline Section */}
              <div className="space-y-3 border-t border-[#E4E7EC] pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-[#172033] uppercase tracking-wider font-mono">
                    Match Event Timeline ({matchTimelineEvents.length} Events)
                  </span>
                  <span className="text-[10px] text-[#667085] font-mono">Ordered by Server Sequence #</span>
                </div>

                {loadingTimeline ? (
                  <div className="flex items-center justify-center py-8 text-[#667085] text-xs">
                    <span className="w-4 h-4 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin mr-2" />
                    Loading event timeline...
                  </div>
                ) : matchTimelineEvents.length === 0 ? (
                  <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-lg p-6 text-center text-xs text-[#667085]">
                    No events recorded for this match.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {matchTimelineEvents.map((ev, idx) => {
                      if (isFootballMatch(selectedMatchDetail)) {
                        const isGoal = ev.event_type === 'GOAL';
                        const isOwnGoal = ev.event_type === 'OWN_GOAL';
                        const isYellow = ev.event_type === 'YELLOW_CARD' && !ev.detail?.isSecondYellow && !ev.is_second_yellow;
                        const is2ndYellow = ev.event_type === 'SECOND_YELLOW_CARD' || (ev.event_type === 'YELLOW_CARD' && (ev.detail?.isSecondYellow || ev.is_second_yellow));
                        const isRed = ev.event_type === 'RED_CARD';
                        const isSub = ev.event_type === 'SUBSTITUTION';
                        const isPeriod = ev.event_type.startsWith('START_') || ev.event_type.startsWith('END_') || ev.event_type === 'PERIOD_START' || ev.event_type === 'PERIOD_END';
                        const isPenalty = ev.event_type === 'PENALTY_KICK';

                        let badgeStyle = 'bg-[#F2F4F7] text-[#344054] border-[#EAECF0]';
                        if (isGoal) badgeStyle = 'bg-[#E8F5F0] text-[#14966B] border-[#C4E9DC]';
                        if (isOwnGoal || isRed || is2ndYellow) badgeStyle = 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
                        if (isYellow) badgeStyle = 'bg-[#FEF0C7] text-[#B54708] border-[#FEDF89]';
                        if (isSub) badgeStyle = 'bg-[#EEF4FF] text-[#3267D6] border-[#C8DCFE]';
                        if (isPenalty) badgeStyle = 'bg-[#F4EBFF] text-[#6941C6] border-[#E9D7FE]';

                        const minStr = ev.minute !== undefined && ev.minute !== null 
                          ? `${ev.minute}${ev.stoppage_minute ? `+${ev.stoppage_minute}` : ''}'`
                          : '';

                        const scorerName = getEventPlayerName(ev, 'scorerPlayerId', selectedMatchDetail);
                        const assistName = getEventPlayerName(ev, 'assistPlayerId', selectedMatchDetail);
                        const yellowName = getEventPlayerName(ev, 'yellowCardPlayerId', selectedMatchDetail) || getEventPlayerName(ev, 'playerId', selectedMatchDetail);
                        const redName = getEventPlayerName(ev, 'redCardPlayerId', selectedMatchDetail) || getEventPlayerName(ev, 'playerId', selectedMatchDetail);
                        const subInName = getEventPlayerName(ev, 'subInPlayerId', selectedMatchDetail) || getEventPlayerName(ev, 'playerOnId', selectedMatchDetail);
                        const subOutName = getEventPlayerName(ev, 'subOutPlayerId', selectedMatchDetail) || getEventPlayerName(ev, 'playerOffId', selectedMatchDetail);

                        return (
                          <div 
                            key={ev.id || idx}
                            className="flex items-center justify-between bg-white border border-[#E4E7EC] rounded-lg p-2.5 text-xs hover:border-[#D0D5DD] transition"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-[#98A2B3] font-bold w-7">
                                {minStr || `#${ev.sequence_number || idx + 1}`}
                              </span>
                              <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${badgeStyle}`}>
                                {ev.event_type.replace(/_/g, ' ')}
                              </span>
                              <span className="font-semibold text-[#172033] text-xs">
                                {isGoal && (
                                  <>⚽ GOAL! {scorerName}{assistName !== 'Player' && assistName ? ` (Assist: ${assistName})` : ''}</>
                                )}
                                {isOwnGoal && (
                                  <>⚽ OWN GOAL by {scorerName}</>
                                )}
                                {isYellow && (
                                  <>🟨 Yellow Card: {yellowName}</>
                                )}
                                {is2ndYellow && (
                                  <>🟨🟥 Second Yellow / Dismissal: {yellowName}</>
                                )}
                                {isRed && (
                                  <>🟥 Red Card: {redName}</>
                                )}
                                {isSub && (
                                  <>🔄 Sub: {subInName} ⬆️ IN / {subOutName} ⬇️ OUT</>
                                )}
                                {isPeriod && (
                                  <>⏱️ {ev.event_type.replace(/_/g, ' ')} {ev.period || ev.detail?.period ? `(${ev.period || ev.detail?.period})` : ''}</>
                                )}
                                {isPenalty && (
                                  <>🥅 Penalty Kick: {ev.detail?.scored ? 'SCORED' : (ev.detail?.outcome || 'Attempt')}</>
                                )}
                                {!isGoal && !isOwnGoal && !isYellow && !is2ndYellow && !isRed && !isSub && !isPeriod && !isPenalty && (
                                  <>{ev.event_type.replace(/_/g, ' ')}</>
                                )}
                              </span>
                            </div>

                            <div className="text-[10px] text-[#667085] font-mono">
                              {ev.created_at ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                            </div>
                          </div>
                        );
                      }

                      const isPoint = ev.event_type === 'POINT';
                      const isUndo = ev.event_type === 'UNDO';
                      const isService = ev.event_type === 'SET_SERVICE';
                      const isSideOut = ev.event_type === 'SIDE_OUT';

                      let badgeStyle = 'bg-[#F2F4F7] text-[#344054] border-[#EAECF0]';
                      if (isPoint) badgeStyle = 'bg-[#E8F5F0] text-[#14966B] border-[#C4E9DC]';
                      if (isUndo) badgeStyle = 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
                      if (isService) badgeStyle = 'bg-[#EEF4FF] text-[#3267D6] border-[#C8DCFE]';

                      return (
                        <div 
                          key={ev.id || idx}
                          className="flex items-center justify-between bg-white border border-[#E4E7EC] rounded-lg p-2.5 text-xs hover:border-[#D0D5DD] transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-[#98A2B3] font-bold w-6">
                              #{ev.sequence_number || idx + 1}
                            </span>
                            <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${badgeStyle}`}>
                              {ev.event_type}
                            </span>
                            <span className="font-semibold text-[#172033] text-xs">
                              {isPoint && (
                                <>Point awarded to {ev.point_to === 'A' ? getPlayerNames(selectedMatchDetail.participant_a) : getPlayerNames(selectedMatchDetail.participant_b)}</>
                              )}
                              {isUndo && (
                                <>Point undone (rally negated)</>
                              )}
                              {isService && (
                                <>Service setup configured</>
                              )}
                              {isSideOut && (
                                <>Side out / service handover</>
                              )}
                              {!isPoint && !isUndo && !isService && !isSideOut && (
                                <>{ev.event_type.replace(/_/g, ' ')}</>
                              )}
                            </span>
                          </div>

                          <div className="text-[10px] text-[#667085] font-mono">
                            {ev.created_at ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-[#F8FAFC] border-t border-[#E4E7EC] p-4 flex justify-between items-center">
              <span className="text-[10px] text-[#667085] font-semibold uppercase tracking-wider">
                Spectator Live Center • Read-Only
              </span>
              <button
                onClick={closeMatchDetail}
                className="bg-white hover:bg-[#F9FAFB] border border-[#D0D5DD] text-[#344054] text-xs font-semibold px-4 py-2 rounded-lg transition shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
