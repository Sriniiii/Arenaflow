'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../context/AuthContext';
import { supabase } from '../../../../services/supabase';
import { categorySchema, courtSchema, tournamentSchema } from '@arena-flow/validation';
import Navigation from '../../../../components/Navigation';
import {
  generateKnockoutStructure,
  generateRoundRobinFixtures,
  checkScheduleConflict
} from '@arena-flow/tournament-engine';
import {
  calculateTournamentStats,
  calculateStandings,
  sortStandings
} from '@arena-flow/statistics-engine';
import {
  ReportType,
  ExportFormat,
  buildParticipantsReportData,
  buildScheduleReportData,
  buildResultsReportData,
  buildStandingsReportData,
  buildDrawReportData,
  buildTournamentSummaryReportData,
  buildMatchScoreSheetReportData,
  exportTournamentReport,
  triggerBrowserDownload
} from '../../../../services/reports';

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
  sports: Sport | null;
  venues: Venue | null;
  default_match_duration?: number;
  default_buffer_time?: number;
}

interface Category {
  id: string;
  name: string;
  category_type: 'SINGLES' | 'DOUBLES';
  match_type: 'MENS' | 'WOMENS' | 'MIXED';
  format: 'KNOCKOUT' | 'ROUND_ROBIN' | 'GROUP_KNOCKOUT';
  age_group?: string;
  skill_level?: string;
  max_participants: number | null;
  registration_fee: number;
}

interface Court {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface Player {
  id: string;
  user_id?: string;
  full_name: string;
  display_name?: string;
  gender?: string;
  date_of_birth?: string;
}

interface Registration {
  id: string;
  category_id: string;
  participant_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  created_at: string;
  category: {
    id: string;
    name: string;
    category_type: 'SINGLES' | 'DOUBLES';
  };
  participant: {
    id: string;
    members: {
      player: Player;
    }[];
  };
}

interface Participant {
  id: string;
  category_id: string;
  category: {
    id?: string;
    name: string;
  };
  participant_type: 'INDIVIDUAL' | 'TEAM';
  status: 'ACTIVE' | 'WITHDRAWN';
  members: {
    player: Player;
  }[];
}

type TabType = 'court_board' | 'matches' | 'registrations' | 'participants' | 'draws' | 'categories' | 'courts' | 'reports' | 'details' | 'danger';

const getPlayerNames = (participant: any): string => {
  if (!participant?.members || participant.members.length === 0) return 'TBD (Waiting)';
  return participant.members
    .map((m: any) => m.player?.display_name || m.player?.full_name || 'Player')
    .join(' & ');
};

const calculateAge = (dobStr: string, refDateStr?: string): number => {
  if (!dobStr) return 0;
  const dob = new Date(dobStr);
  const ref = refDateStr ? new Date(refDateStr) : new Date();
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) {
    age--;
  }
  return age;
};

export default function ConfigureTournamentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.slug as string;

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabType>('details');

  const [draws, setDraws] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [drawNodes, setDrawNodes] = useState<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [standingsEntries, setStandingsEntries] = useState<any[]>([]);
  const [tournamentScorers, setTournamentScorers] = useState<any[]>([]);

  // Selection/State for Draw Generation
  const [selectedDrawCategoryId, setSelectedDrawCategoryId] = useState('');
  const [selectedDrawFormat, setSelectedDrawFormat] = useState<'KNOCKOUT' | 'ROUND_ROBIN' | 'GROUP_KNOCKOUT'>('KNOCKOUT');
  const [numGroups, setNumGroups] = useState(2);
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(2);
  const [allocMethod, setAllocMethod] = useState<'SNAKE' | 'SEQUENTIAL'>('SNAKE');
  const [generatingKnockout, setGeneratingKnockout] = useState(false);
  const [seedsInput, setSeedsInput] = useState<Record<string, number>>({});

  // State for Scheduling
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [schedCourtId, setSchedCourtId] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [schedDuration, setSchedDuration] = useState(45);
  const [schedBuffer, setSchedBuffer] = useState(10);

  // Initial loading states
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter States for Match Control Center
  const [matchSearch, setMatchSearch] = useState('');
  const [matchCourtFilter, setMatchCourtFilter] = useState('ALL');
  const [matchCategoryFilter, setMatchCategoryFilter] = useState('ALL');
  const [matchRoundFilter, setMatchRoundFilter] = useState('ALL');
  const [matchStatusFilter, setMatchStatusFilter] = useState('ALL');

  // Filter States for Court Status Board
  const [courtBoardFilter, setCourtBoardFilter] = useState('ALL');

  // Filter States for Registrations
  const [regSearch, setRegSearch] = useState('');
  const [regCategoryFilter, setRegCategoryFilter] = useState('ALL');
  const [regStatusFilter, setRegStatusFilter] = useState('ALL');

  // Filter States for Participants
  const [partSearch, setPartSearch] = useState('');
  const [partCategoryFilter, setPartCategoryFilter] = useState('ALL');
  const [partStatusFilter, setPartStatusFilter] = useState('ALL');

  // Registration Rejection Modal
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingRegId, setRejectingRegId] = useState<string | null>(null);
  const [rejectingPartId, setRejectingPartId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Tournament Deletion states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInputName, setDeleteInputName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Exports & Reports State
  const [reportCategoryFilter, setReportCategoryFilter] = useState('ALL');
  const [exportingReport, setExportingReport] = useState(false);

  // Core Data
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  
  // Extra lists for selections
  const [sports, setSports] = useState<Sport[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);

  // 1. Details Edit state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sportId, setSportId] = useState('');
  const [venueId, setVenueId] = useState('none');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState('');
  const [registrationClose, setRegistrationClose] = useState('');
  const [rules, setRules] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // 2. Category Form states
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'SINGLES' | 'DOUBLES'>('SINGLES');
  const [catMatchType, setCatMatchType] = useState<'MENS' | 'WOMENS' | 'MIXED'>('MENS');
  const [catFormat, setCatFormat] = useState<'KNOCKOUT' | 'ROUND_ROBIN' | 'GROUP_KNOCKOUT'>('KNOCKOUT');
  const [catAgeGroup, setCatAgeGroup] = useState('');
  const [catSkillLevel, setCatSkillLevel] = useState('');
  const [catMaxParts, setCatMaxParts] = useState('32');
  const [catFee, setCatFee] = useState('0');
  const [creatingCategory, setCreatingCategory] = useState(false);

  // 3. Court Form state
  const [courtName, setCourtName] = useState('');
  const [addingCourt, setAddingCourt] = useState(false);

  // 4. Manual Participant form state
  const [manCategoryId, setManCategoryId] = useState('');
  const [manPlayer1Id, setManPlayer1Id] = useState('');
  const [manPlayer2Id, setManPlayer2Id] = useState('');
  const [addingParticipant, setAddingParticipant] = useState(false);

  // 5. Outcome Declaration Modal State
  const [outcomeModalMatch, setOutcomeModalMatch] = useState<any | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<'WALKOVER' | 'RETIREMENT' | 'DEFAULT'>('WALKOVER');
  const [selectedWinnerId, setSelectedWinnerId] = useState<string>('');
  const [outcomeNotes, setOutcomeNotes] = useState<string>('');
  const [submittingOutcome, setSubmittingOutcome] = useState(false);

  // Handle URL Query param tab switching
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      if (['court_board', 'matches', 'registrations', 'participants', 'draws', 'categories', 'courts', 'details', 'danger'].includes(tabParam)) {
        setActiveTab(tabParam as TabType);
      }
    }
  }, [searchParams]);

  // Compute registered player user_ids for deduplication in manual registration
  const registeredPlayerIds = useMemo(() => {
    if (!manCategoryId) return new Set<string>();
    const categoryRegistrations = registrations.filter(
      r => r.category_id === manCategoryId && r.status !== 'CANCELLED' && r.status !== 'REJECTED'
    );
    const ids = new Set<string>();
    categoryRegistrations.forEach(r => {
      r.participant?.members?.forEach(m => {
        if (m.player?.id) ids.add(m.player.id);
        if (m.player?.user_id) ids.add(m.player.user_id);
      });
    });
    return ids;
  }, [registrations, manCategoryId]);

  const eligiblePlayers = useMemo(() => {
    return allPlayers.filter(p => !registeredPlayerIds.has(p.id) && (!p.user_id || !registeredPlayerIds.has(p.user_id)));
  }, [allPlayers, registeredPlayerIds]);

  useEffect(() => {
    if (eligiblePlayers.length > 0) {
      if (!eligiblePlayers.some(p => p.id === manPlayer1Id)) {
        setManPlayer1Id(eligiblePlayers[0].id);
      }
      if (!eligiblePlayers.some(p => p.id === manPlayer2Id)) {
        setManPlayer2Id(eligiblePlayers[0].id);
      }
    } else {
      setManPlayer1Id('');
      setManPlayer2Id('');
    }
  }, [eligiblePlayers, manCategoryId, manPlayer1Id, manPlayer2Id]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  const loadAllData = useCallback(async () => {
    if (!user) return;
    setErrorMsg(null);
    try {
      // 1. Fetch Tournament
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      const query = supabase
        .from('tournaments')
        .select('*, sports(*), venues(*)');
      const { data: tourney, error: tErr } = await (
        isUuid ? query.eq('id', id) : query.eq('slug', id)
      ).single();
      if (tErr) throw tErr;

      // Verify Ownership
      if (tourney.organizer_id !== user.id) {
        throw new Error('Unauthorized: You do not own this tournament.');
      }

      setTournament(tourney);
      setName(tourney.name);
      setDescription(tourney.description || '');
      setSportId(tourney.sport_id);
      setVenueId(tourney.venue_id || 'none');
      setStartDate(tourney.start_date.substring(0, 10));
      setEndDate(tourney.end_date.substring(0, 10));
      setRegistrationOpen(tourney.registration_open.substring(0, 10));
      setRegistrationClose(tourney.registration_close.substring(0, 10));
      setRules(tourney.rules || '');

      // 2. Fetch Sports & Venues for options
      const { data: sData } = await supabase.from('sports').select('id, name');
      const filteredSports = (sData || []).filter(s => {
        return !/^(P[0-9]|Test)/i.test(s.name);
      });
      setSports(filteredSports);

      const { data: vData } = await supabase.from('venues').select('id, name').eq('owner_id', user.id);
      setVenues(vData || []);

      // 3. Fetch Categories
      const { data: cats, error: catsErr } = await supabase
        .from('categories')
        .select('*')
        .eq('tournament_id', tourney.id)
        .order('created_at', { ascending: true });
      if (catsErr) throw catsErr;
      setCategories(cats || []);
      if (cats && cats.length > 0 && !manCategoryId) {
        setManCategoryId(cats[0].id);
      }

      // 4. Fetch Courts (if venue exists)
      if (tourney.venue_id) {
        const { data: crts } = await supabase
          .from('courts')
          .select('*')
          .eq('venue_id', tourney.venue_id)
          .order('name', { ascending: true });
        setCourts(crts || []);
      } else {
        setCourts([]);
      }

      // 5. Fetch Registrations
      const { data: regs } = await supabase
        .from('registrations')
        .select(`
          id,
          category_id,
          participant_id,
          status,
          created_at,
          category: categories ( id, name, category_type ),
          participant: participants (
            id,
            members: participant_members (
              player: players ( id, full_name, display_name, gender, date_of_birth )
            )
          )
        `)
        .in('category_id', cats?.map((c: Category) => c.id) || []);
      
      setRegistrations((regs as any) || []);

      // 6. Fetch Participants
      const { data: parts } = await supabase
        .from('participants')
        .select(`
          id,
          category_id,
          participant_type,
          status,
          category: categories ( id, name ),
          members: participant_members (
            player: players ( id, full_name, display_name, gender, date_of_birth )
          )
        `)
        .in('category_id', cats?.map((c: Category) => c.id) || []);
      
      setParticipants((parts as any) || []);

      // 7. Fetch Tournament Scorers
      const { data: scorersData } = await supabase
        .from('tournament_scorers')
        .select('user_id')
        .eq('tournament_id', tourney.id);
      setTournamentScorers(scorersData || []);

      // 8. Fetch all players list (for manual registrations)
      const { data: plyrs } = await supabase
        .from('players')
        .select('id, full_name, display_name, user_id, gender, date_of_birth');
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, role');

      const profileRoles = new Map(profs?.map(p => [p.id, p.role]) || []);
      const filteredPlyrs = (plyrs || []).filter(p => {
        if (!p.user_id) return true;
        const role = profileRoles.get(p.user_id);
        return role === 'PLAYER' || role === 'SPECTATOR';
      });

      const seenUserIds = new Set();
      const dedupedPlyrs: any[] = [];
      filteredPlyrs.forEach(p => {
        if (p.user_id) {
          if (!seenUserIds.has(p.user_id)) {
            seenUserIds.add(p.user_id);
            const canonical = filteredPlyrs.find(c => c.user_id === p.user_id && c.id === p.user_id);
            dedupedPlyrs.push(canonical || p);
          }
        } else {
          dedupedPlyrs.push(p);
        }
      });

      setAllPlayers(dedupedPlyrs);
      if (dedupedPlyrs.length > 0 && !manPlayer1Id) {
        setManPlayer1Id(dedupedPlyrs[0].id);
        setManPlayer2Id(dedupedPlyrs[0].id);
      }

      const catIds = cats?.map((c: Category) => c.id) || [];
      if (catIds.length > 0) {
        // Fetch Draws
        const { data: drawsData } = await supabase
          .from('draws')
          .select('*')
          .in('category_id', catIds);
        const fetchedDraws = drawsData || [];
        setDraws(fetchedDraws);

        const drawIds = fetchedDraws.map(d => d.id);

        // Fetch Rounds
        if (drawIds.length > 0) {
          const { data: roundsData } = await supabase
            .from('rounds')
            .select('*')
            .in('draw_id', drawIds);
          setRounds(roundsData || []);
        } else {
          setRounds([]);
        }

        // Fetch Matches with Games
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
            duration_minutes,
            buffer_minutes,
            outcome,
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            winner: participants!matches_winner_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            court: courts ( id, name ),
            games ( id, game_number, participant_a_score, participant_b_score, status, winner_id )
          `)
          .in('category_id', catIds);
        setMatches(matchesData || []);

        // Fetch Draw Nodes
        if (drawIds.length > 0) {
          const { data: drawNodesData } = await supabase
            .from('draw_nodes')
            .select('*')
            .in('draw_id', drawIds);
          setDrawNodes(drawNodesData || []);
        } else {
          setDrawNodes([]);
        }

        // Fetch Standings
        const { data: standingsData } = await supabase
          .from('standings')
          .select('*')
          .in('category_id', catIds);
        const fetchedStandings = standingsData || [];
        setStandings(fetchedStandings);

        const standingsIds = fetchedStandings.map(s => s.id);

        // Fetch Standings Entries
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
      setErrorMsg(err.message || 'Failed to load tournament configurations.');
    } finally {
      setLoadingConfig(false);
    }
  }, [id, user, manCategoryId, manPlayer1Id]);

  useEffect(() => {
    if (user && id) {
      loadAllData();
    }
  }, [user, id, loadAllData]);

  // Real-time updates subscription for matches, games, registrations, participants
  useEffect(() => {
    if (!tournament?.id) return;

    const channel = supabase
      .channel(`tournament_config:${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        loadAllData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        loadAllData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => {
        loadAllData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        loadAllData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournament?.id, loadAllData]);

  const showToast = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 5000);
    }
  };

  // --- LIFECYCLE ACTION HANDLERS ---
  const handleStartMatch = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('start_match', { p_match_id: matchId });
      if (error) throw error;
      showToast('Match started! Status is now LIVE.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to start match', true);
    }
  };

  const handlePauseMatch = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('pause_match', { p_match_id: matchId });
      if (error) throw error;
      showToast('Match paused.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to pause match', true);
    }
  };

  const handleResumeMatch = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('resume_match', { p_match_id: matchId });
      if (error) throw error;
      showToast('Match resumed! Status is now LIVE.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to resume match', true);
    }
  };

  const handleFinalizeMatch = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('finalize_match', { p_match_id: matchId });
      if (error) throw error;
      showToast('Match finalized successfully! Status is now FINAL.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to finalize match', true);
    }
  };

  const handleReopenMatch = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('reopen_match_for_correction', { p_match_id: matchId });
      if (error) throw error;
      showToast('Match reopened for correction! Status is now UNDER_REVIEW.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reopen match', true);
    }
  };

  const openOutcomeModalForMatch = (m: any) => {
    setErrorMsg(null);
    const hasPoints = m.games && Array.isArray(m.games) && m.games.some((g: any) => (g.participant_a_score || 0) > 0 || (g.participant_b_score || 0) > 0);
    const isLiveOrPaused = m.status === 'LIVE' || m.status === 'PAUSED';

    if (hasPoints && isLiveOrPaused) {
      setSelectedOutcome('RETIREMENT');
    } else {
      setSelectedOutcome('WALKOVER');
    }

    if (m.participant_a_id) {
      setSelectedWinnerId(m.participant_a_id);
    }
    setOutcomeNotes('');
    setOutcomeModalMatch(m);
  };

  const handleConfirmOutcome = async () => {
    if (!outcomeModalMatch || !selectedWinnerId) return;

    try {
      setSubmittingOutcome(true);
      setErrorMsg(null);

      const retiringParticipantId = selectedOutcome === 'RETIREMENT'
        ? (selectedWinnerId === outcomeModalMatch.participant_a_id ? outcomeModalMatch.participant_b_id : outcomeModalMatch.participant_a_id)
        : null;

      const { error } = await supabase.rpc('declare_match_outcome', {
        p_match_id: outcomeModalMatch.id,
        p_outcome: selectedOutcome,
        p_winner_id: selectedWinnerId,
        p_retiring_participant_id: retiringParticipantId,
        p_notes: outcomeNotes || null
      });

      if (error) throw error;

      showToast(`Match outcome recorded: ${selectedOutcome}! Winner advanced.`);
      setOutcomeModalMatch(null);
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to declare match outcome', true);
    } finally {
      setSubmittingOutcome(false);
    }
  };

  // 1. Details Edit
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    setErrorMsg(null);

    const validation = tournamentSchema.safeParse({
      name,
      description,
      sport_id: sportId,
      venue_id: venueId === 'none' ? null : venueId,
      start_date: new Date(startDate).toISOString(),
      end_date: new Date(endDate).toISOString(),
      registration_open: new Date(registrationOpen).toISOString(),
      registration_close: new Date(registrationClose).toISOString(),
      rules
    });

    if (!validation.success) {
      setErrorMsg(validation.error.issues[0].message);
      setSavingDetails(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('tournaments')
        .update({
          name,
          description,
          sport_id: sportId,
          venue_id: venueId === 'none' ? null : venueId,
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
          registration_open: new Date(registrationOpen).toISOString(),
          registration_close: new Date(registrationClose).toISOString(),
          rules
        })
        .eq('id', tournament?.id);

      if (error) throw error;
      showToast('Tournament details saved successfully!');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save details', true);
    } finally {
      setSavingDetails(false);
    }
  };

  // 2. Publish Tournament
  const handlePublish = async () => {
    if (!tournament) return;
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'PUBLISHED' })
        .eq('id', tournament.id);
      if (error) throw error;
      showToast('Tournament published successfully!');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to publish', true);
    }
  };

  // Delete Tournament Handler
  const handleDeleteTournament = async () => {
    if (!tournament) return;
    if (deleteInputName !== tournament.name) {
      showToast("Tournament name doesn't match.", true);
      return;
    }
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase
        .from('tournaments')
        .delete()
        .eq('id', tournament.id);

      if (error) throw error;

      showToast('Tournament deleted successfully!');
      router.push('/dashboard');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete tournament.', true);
      setIsDeleting(false);
    }
  };

  // 3. Category Creation
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament) return;
    setCreatingCategory(true);
    setErrorMsg(null);

    const feeNum = Number(catFee);
    const maxPartsNum = catMaxParts ? Number(catMaxParts) : null;

    const validation = categorySchema.safeParse({
      name: catName,
      tournament_id: tournament.id,
      category_type: catType,
      match_type: catMatchType,
      format: catFormat,
      age_group: catAgeGroup || undefined,
      skill_level: catSkillLevel || undefined,
      max_participants: maxPartsNum,
      registration_fee: isNaN(feeNum) ? 0 : feeNum
    });

    if (!validation.success) {
      setErrorMsg(validation.error.issues[0].message);
      setCreatingCategory(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('categories')
        .insert({
          tournament_id: tournament.id,
          name: catName,
          category_type: catType,
          match_type: catMatchType,
          format: catFormat,
          age_group: catAgeGroup || null,
          skill_level: catSkillLevel || null,
          max_participants: maxPartsNum,
          registration_fee: isNaN(feeNum) ? 0 : feeNum
        });

      if (error) throw error;

      showToast('Category created successfully!');
      setCatName('');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to create category', true);
    } finally {
      setCreatingCategory(false);
    }
  };

  // 4. Court Creation
  const handleAddCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament?.venue_id) {
      showToast('Please assign a venue first in General Details.', true);
      return;
    }
    setAddingCourt(true);
    setErrorMsg(null);

    const validation = courtSchema.safeParse({
      name: courtName,
      venue_id: tournament.venue_id,
      status: 'ACTIVE'
    });

    if (!validation.success) {
      setErrorMsg(validation.error.issues[0].message);
      setAddingCourt(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('courts')
        .insert({
          venue_id: tournament.venue_id,
          name: courtName,
          status: 'ACTIVE'
        });

      if (error) throw error;

      showToast('Court added successfully!');
      setCourtName('');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add court', true);
    } finally {
      setAddingCourt(false);
    }
  };

  // 5. Registration Approval/Rejection
  const handleMutationRegistration = async (regId: string, partId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      const regStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const partStatus = action === 'APPROVE' ? 'ACTIVE' : 'WITHDRAWN';

      const { error: regErr } = await supabase
        .from('registrations')
        .update({ status: regStatus })
        .eq('id', regId);
      if (regErr) throw regErr;

      const { error: partErr } = await supabase
        .from('participants')
        .update({ status: partStatus })
        .eq('id', partId);
      if (partErr) throw partErr;

      showToast(`Registration ${action.toLowerCase()}d successfully.`);
      setRejectModalOpen(false);
      setRejectingRegId(null);
      setRejectingPartId(null);
      setRejectReason('');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Action failed', true);
    }
  };

  // 6. Draw Generation (Atomic RPC)
  const handleGenerateDraw = async (categoryId: string) => {
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      
      const cat = categories.find(c => c.id === categoryId);
      if (!cat) throw new Error('Category not found.');

      const format = selectedDrawCategoryId === categoryId ? selectedDrawFormat : cat.format;

      const { data, error } = await supabase.rpc('generate_tournament_draw', {
        p_category_id: categoryId,
        p_format: format,
        p_seeds: seedsInput,
        p_options: {
          force_regenerate: true,
          num_groups: numGroups,
          allocation_method: allocMethod,
          qualifiers_per_group: qualifiersPerGroup
        }
      });

      if (error) throw error;

      if (data?.idempotent) {
        showToast('Draw already exists for this category.');
      } else {
        const formatLabel = format === 'KNOCKOUT' ? 'Knockout' : format === 'GROUP_KNOCKOUT' ? 'Group Stage' : 'Round Robin';
        showToast(`${formatLabel} draw generated atomically! (${data?.matches_count || 0} matches created)`);
      }

      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to generate draw.', true);
    }
  };

  const handleGenerateKnockoutFromGroups = async (categoryId: string) => {
    try {
      setGeneratingKnockout(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const { data, error } = await supabase.rpc('generate_knockout_from_groups', {
        p_category_id: categoryId,
        p_options: {
          qualifiers_per_group: qualifiersPerGroup,
          force_regenerate: true
        }
      });

      if (error) throw error;

      showToast(`Knockout stage generated atomically! (${data?.qualifiers_count || 0} qualifiers, ${data?.matches_count || 0} matches created)`);
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to generate knockout stage.', true);
    } finally {
      setGeneratingKnockout(false);
    }
  };

  const handleDeleteDraw = async (categoryId: string) => {
    if (!confirm('Are you sure you want to delete this draw and all associated matches?')) return;
    try {
      const { data, error } = await supabase.rpc('delete_tournament_draw', {
        p_category_id: categoryId
      });
      if (error) throw error;
      showToast(data?.message || 'Draw deleted successfully.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete draw.', true);
    }
  };

  const handlePublishDraw = async (drawId: string) => {
    try {
      const { error } = await supabase
        .from('draws')
        .update({ status: 'PUBLISHED' })
        .eq('id', drawId);
      if (error) throw error;
      showToast('Draw published! Visible on public live page.');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to publish draw.', true);
    }
  };

  // 7. Match Scheduling Handler
  const handleSaveSchedule = async (matchId: string) => {
    try {
      setErrorMsg(null);
      const match = matches.find(m => m.id === matchId);
      if (!match) return;

      if (schedCourtId && schedTime) {
        const conflict = checkScheduleConflict(matches, {
          id: matchId,
          court_id: schedCourtId,
          scheduled_at: new Date(schedTime).toISOString(),
          duration_minutes: schedDuration,
          buffer_minutes: schedBuffer,
          participant_a_id: match.participant_a_id,
          participant_b_id: match.participant_b_id
        });

        if (conflict.conflict) {
          throw new Error(`Scheduling Conflict: ${conflict.reason}`);
        }
      }

      const { error } = await supabase
        .from('matches')
        .update({
          court_id: schedCourtId || null,
          scheduled_at: schedTime ? new Date(schedTime).toISOString() : null,
          duration_minutes: schedDuration,
          buffer_minutes: schedBuffer,
          status: (match.participant_a_id && match.participant_b_id) ? 'READY' : 'SCHEDULED'
        })
        .eq('id', matchId);

      if (error) throw error;

      showToast('Match scheduled successfully!');
      setEditingMatchId(null);
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to schedule match.', true);
    }
  };

  // 8. Manual Participant Addition
  const handleAddManualParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manCategoryId) {
      showToast('Please select a category first.', true);
      return;
    }
    setAddingParticipant(true);

    const category = categories.find(c => c.id === manCategoryId);
    if (!category) return;

    const isDoubles = category.category_type === 'DOUBLES';
    if (isDoubles && (!manPlayer1Id || !manPlayer2Id)) {
      showToast('Both players are required for doubles.', true);
      setAddingParticipant(false);
      return;
    }
    if (isDoubles && manPlayer1Id === manPlayer2Id) {
      showToast('Player 1 and Player 2 must be different users.', true);
      setAddingParticipant(false);
      return;
    }

    try {
      const { data: part, error: pErr } = await supabase
        .from('participants')
        .insert({
          category_id: manCategoryId,
          participant_type: isDoubles ? 'TEAM' : 'INDIVIDUAL',
          status: 'ACTIVE'
        })
        .select()
        .single();

      if (pErr) throw pErr;

      const membersToInsert = [{ participant_id: part.id, player_id: manPlayer1Id, member_order: 1 }];
      if (isDoubles) {
        membersToInsert.push({ participant_id: part.id, player_id: manPlayer2Id, member_order: 2 });
      }

      const { error: pmErr } = await supabase
        .from('participant_members')
        .insert(membersToInsert);
      if (pmErr) throw pmErr;

      await supabase
        .from('registrations')
        .insert({
          category_id: manCategoryId,
          participant_id: part.id,
          status: 'APPROVED'
        });

      showToast('Participant registered and approved successfully!');
      loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to register participant.', true);
    } finally {
      setAddingParticipant(false);
    }
  };

  // Operational Metrics Computation
  const opsMetrics = useMemo(() => {
    let approvedParts = 0;
    let pendingRegs = 0;
    const playerIds = new Set<string>();

    participants.forEach(p => {
      if (p.status === 'ACTIVE') approvedParts++;
      p.members?.forEach(m => {
        if (m.player?.id) playerIds.add(m.player.id);
      });
    });

    registrations.forEach(r => {
      if (r.status === 'PENDING') pendingRegs++;
    });

    const matchStats = calculateTournamentStats({ matches, courts });

    const isRegOpen = tournament
      ? new Date() >= new Date(tournament.registration_open) && new Date() <= new Date(tournament.registration_close)
      : false;

    return {
      totalRegistered: playerIds.size,
      approvedParticipants: approvedParts,
      pendingRegistrations: pendingRegs,
      totalMatches: matchStats.totalMatches,
      liveMatches: matchStats.liveMatches,
      completedMatches: matchStats.completedMatches,
      totalCourts: courts.length,
      assignedScorers: tournamentScorers.length,
      isRegOpen
    };
  }, [participants, registrations, matches, courts, tournamentScorers, tournament]);

  // Filtered Matches for Match Control Center
  const filteredMatches = useMemo(() => {
    return matches.filter(m => {
      if (matchCourtFilter !== 'ALL' && m.court_id !== matchCourtFilter) return false;
      if (matchCategoryFilter !== 'ALL' && m.category_id !== matchCategoryFilter) return false;
      if (matchRoundFilter !== 'ALL' && m.round_id !== matchRoundFilter) return false;
      if (matchStatusFilter !== 'ALL' && m.status !== matchStatusFilter) return false;
      if (matchSearch.trim()) {
        const query = matchSearch.toLowerCase();
        const nameA = getPlayerNames(m.participant_a).toLowerCase();
        const nameB = getPlayerNames(m.participant_b).toLowerCase();
        if (!nameA.includes(query) && !nameB.includes(query)) return false;
      }
      return true;
    });
  }, [matches, matchCourtFilter, matchCategoryFilter, matchRoundFilter, matchStatusFilter, matchSearch]);

  // Filtered Registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter(r => {
      if (regCategoryFilter !== 'ALL' && r.category_id !== regCategoryFilter) return false;
      if (regStatusFilter !== 'ALL' && r.status !== regStatusFilter) return false;
      if (regSearch.trim()) {
        const query = regSearch.toLowerCase();
        const nameStr = getPlayerNames(r.participant).toLowerCase();
        if (!nameStr.includes(query)) return false;
      }
      return true;
    });
  }, [registrations, regCategoryFilter, regStatusFilter, regSearch]);

  // Filtered Participants
  const filteredParticipants = useMemo(() => {
    return participants.filter(p => {
      if (partCategoryFilter !== 'ALL' && p.category_id !== partCategoryFilter) return false;
      if (partStatusFilter !== 'ALL' && p.status !== partStatusFilter) return false;
      if (partSearch.trim()) {
        const query = partSearch.toLowerCase();
        const nameStr = getPlayerNames(p).toLowerCase();
        if (!nameStr.includes(query)) return false;
      }
      return true;
    });
  }, [participants, partCategoryFilter, partStatusFilter, partSearch]);

  // Filtered Courts for Court Status Board
  const filteredCourts = useMemo(() => {
    if (courtBoardFilter === 'ALL') return courts;

    return courts.filter(court => {
      const activeM = matches.find(m => m.court_id === court.id && (m.status === 'LIVE' || m.status === 'UNDER_REVIEW' || m.status === 'PAUSED'));
      const readyM = matches.find(m => m.court_id === court.id && m.status === 'READY');
      const compM = matches.find(m => m.court_id === court.id && (m.status === 'COMPLETED' || m.status === 'FINAL'));

      if (courtBoardFilter === 'LIVE') return activeM && (activeM.status === 'LIVE' || activeM.status === 'UNDER_REVIEW');
      if (courtBoardFilter === 'PAUSED') return activeM && activeM.status === 'PAUSED';
      if (courtBoardFilter === 'READY') return readyM && !activeM;
      if (courtBoardFilter === 'COMPLETED') return compM && !activeM && !readyM;
      if (courtBoardFilter === 'IDLE') return !activeM && !readyM;
      return true;
    });
  }, [courts, matches, courtBoardFilter]);

  // --- EXPORT & REPORT HANDLERS ---
  const handleExportReport = async (reportType: ReportType, format: ExportFormat, catId = reportCategoryFilter) => {
    if (!tournament) return;
    try {
      setExportingReport(true);
      setErrorMsg(null);

      let tableData;
      let filenameBase = `${tournament.slug || tournament.name}_${reportType}`;

      switch (reportType) {
        case 'participants':
          tableData = buildParticipantsReportData(tournament, categories, participants, registrations, catId);
          break;
        case 'schedule':
          tableData = buildScheduleReportData(tournament, categories, matches, venues, courts, catId);
          break;
        case 'results':
          tableData = buildResultsReportData(tournament, categories, matches, venues, courts, catId);
          break;
        case 'standings':
          tableData = buildStandingsReportData(tournament, categories, participants, matches, catId);
          break;
        case 'draw': {
          const targetCat = catId !== 'ALL' ? categories.find(c => c.id === catId) : categories[0];
          if (!targetCat) {
            showToast('No category selected or available for draw export.', true);
            return;
          }
          const draw = draws.find(d => d.category_id === targetCat.id);
          const catRounds = rounds.filter(r => r.draw_id === draw?.id);
          const catDrawNodes = drawNodes.filter(n => n.draw_id === draw?.id);
          tableData = buildDrawReportData(tournament, targetCat, draw, catRounds, catDrawNodes, matches);
          filenameBase = `${tournament.slug || tournament.name}_draw_${targetCat.name}`;
          break;
        }
        case 'summary':
          tableData = buildTournamentSummaryReportData(tournament, categories, participants, registrations, matches, venues, courts);
          break;
      }

      if (tableData) {
        const { filename, mimeType, content } = exportTournamentReport(tableData, format, filenameBase);
        triggerBrowserDownload(content, filename, mimeType);
        showToast(`Downloaded ${filename} successfully!`);
      }
    } catch (err: any) {
      showToast(err.message || 'Export failed', true);
    } finally {
      setExportingReport(false);
    }
  };

  const handleExportScoreSheet = async (matchId: string, format: ExportFormat) => {
    if (!tournament) return;
    try {
      setExportingReport(true);
      setErrorMsg(null);

      const targetMatch = matches.find(m => m.id === matchId);
      if (!targetMatch) throw new Error('Match not found');

      const cat = categories.find(c => c.id === targetMatch.category_id);

      // Fetch match events for detailed scoresheet
      const { data: eventsData } = await supabase
        .from('match_events')
        .select('*')
        .eq('match_id', matchId)
        .order('sequence_number', { ascending: true });

      const tableData = buildMatchScoreSheetReportData(
        tournament,
        cat,
        targetMatch,
        targetMatch.games || [],
        eventsData || []
      );

      const filenameBase = `${tournament.slug || tournament.name}_match_${targetMatch.match_order || targetMatch.id}_scoresheet`;
      const { filename, mimeType, content } = exportTournamentReport(tableData, format, filenameBase);
      triggerBrowserDownload(content, filename, mimeType);
      showToast(`Downloaded ${filename} successfully!`);
    } catch (err: any) {
      showToast(err.message || 'Score sheet export failed', true);
    } finally {
      setExportingReport(false);
    }
  };

  if (loadingConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F7F6] text-[#667085] font-medium">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold">Loading tournament configuration...</span>
        </div>
      </div>
    );
  }

  if (errorMsg && !tournament) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] text-[#172033] flex flex-col">
        <Navigation />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-xl font-bold mb-2 text-[#C94A4A]">Error Loading Configuration</h2>
          <p className="text-[#667085] max-w-md mb-6 text-xs">
            Unable to load tournament configuration. Please refresh the page or check the tournament data.
          </p>
          <div className="text-xs text-[#C94A4A] font-mono bg-[#FDEEEE] border border-[#FECDCA] p-4 rounded-xl max-w-lg mb-6">
            {errorMsg}
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="btn-secondary"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!tournament) return null;

  return (
    <div className="min-h-screen bg-transparent text-[#0F172A] flex flex-col">
      <Navigation />

      {/* Header Info */}
      <div className="pro-glass-primary border-b border-white/80 px-4 sm:px-6 py-4 sticky top-[57px] z-40 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="text-[10px] bg-slate-100 text-[#475467] font-semibold border border-slate-200 px-2 py-0.5 rounded uppercase">
                {tournament.sports?.name || 'Badminton'}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                tournament.status === 'PUBLISHED' ? 'badge-live' : 'badge-paused'
              }`}>
                {tournament.status === 'PUBLISHED' ? '● LIVE' : tournament.status}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] mt-1">{tournament.name}</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-secondary"
            >
              Dashboard
            </button>
            {tournament.status === 'DRAFT' && (
              <button
                onClick={handlePublish}
                className="btn-primary"
              >
                Publish Tournament
              </button>
            )}
            {tournament.status === 'PUBLISHED' && (
              <button
                onClick={() => router.push(`/tournaments/${tournament.slug}`)}
                className="bg-[#EEF4FF] hover:bg-[#CFDEFB] text-[#2563EB] font-semibold text-xs px-3.5 py-1.5 rounded-lg border border-[#CFDEFB] transition shadow-xs"
              >
                View Public Live Page
              </button>
            )}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-danger"
            >
              Delete Tournament
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 flex-1 space-y-6">
        {/* Compact Operational Statistics Header */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pro-glass rounded-xl p-3 text-center shadow-xs">
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Registered</span>
            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{opsMetrics.totalRegistered}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Approved</span>
            <span className="text-sm font-bold text-[#14966B] tabular-nums">{opsMetrics.approvedParticipants}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Pending</span>
            <span className="text-sm font-bold text-[#C98218] tabular-nums">{opsMetrics.pendingRegistrations}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Matches</span>
            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{opsMetrics.totalMatches}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Live</span>
            <span className="text-sm font-bold text-[#14966B] tabular-nums">{opsMetrics.liveMatches}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Completed</span>
            <span className="text-sm font-bold text-[#7C3AED] tabular-nums">{opsMetrics.completedMatches}</span>
          </div>
          <div className="border-r border-slate-200/80 pr-1">
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Courts</span>
            <span className="text-sm font-bold text-[#2563EB] tabular-nums">{opsMetrics.totalCourts}</span>
          </div>
          <div>
            <span className="text-[10px] text-[#64748B] uppercase font-semibold block">Scorers</span>
            <span className="text-sm font-bold text-[#0F172A] tabular-nums">{opsMetrics.assignedScorers}</span>
          </div>
        </div>

        {successMsg && (
          <div className="bg-emerald-50/90 backdrop-blur-md border border-emerald-200 text-[#14966B] rounded-xl p-4 text-xs font-medium" role="status">
            {successMsg}
          </div>
        )}

        {errorMsg && (
          <div className="bg-[#FDEEEE]/90 backdrop-blur-md border border-[#FECDCA] text-[#C94A4A] rounded-xl p-4 text-xs font-medium" role="alert">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Side Tabs Selector */}
          <div className="w-full lg:w-60 pro-glass rounded-xl p-2 space-y-1 shadow-xs h-fit">
            {[
              { id: 'court_board', label: 'Court Status Board', highlight: true },
              { id: 'matches', label: 'Match Control Center' },
              { id: 'registrations', label: `Registrations (${registrations.filter(r => r.status === 'PENDING').length})` },
              { id: 'participants', label: 'Participants' },
              { id: 'draws', label: 'Draws & Standings' },
              { id: 'categories', label: 'Categories' },
              { id: 'courts', label: 'Venues & Courts' },
              { id: 'reports', label: 'Exports & Reports' },
              { id: 'details', label: 'General Details' },
              { id: 'danger', label: 'Danger Zone', danger: true },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold transition flex justify-between items-center cursor-pointer ${
                  activeTab === tab.id
                    ? tab.danger
                      ? 'bg-[#FDEEEE] text-[#C94A4A] border-l-4 border-[#C94A4A]'
                      : 'bg-emerald-50 text-[#14966B] border-l-4 border-[#14966B] shadow-2xs font-bold'
                    : tab.danger
                    ? 'text-[#C94A4A] hover:bg-[#FDEEEE]'
                    : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/60'
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === 'court_board' && opsMetrics.liveMatches > 0 && (
                  <span className="w-2 h-2 rounded-full bg-[#14966B] live-dot-slow" />
                )}
              </button>
            ))}
          </div>

          {/* Active Tab Panel */}
          <div className="flex-1 pro-card p-6 sm:p-8 min-h-[480px]">
            
            {/* 1. COURT STATUS BOARD TAB */}
            {activeTab === 'court_board' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200/80 pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] live-dot-slow" />
                      Court Status Board
                    </h2>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      Live realtime court tracking for every venue court.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#64748B] font-semibold">Filter:</span>
                    <select
                      value={courtBoardFilter}
                      onChange={(e) => setCourtBoardFilter(e.target.value)}
                      className="arena-select text-xs py-1.5"
                    >
                      <option value="ALL">All Courts ({courts.length})</option>
                      <option value="LIVE">LIVE Only</option>
                      <option value="READY">READY Only</option>
                      <option value="PAUSED">PAUSED Only</option>
                      <option value="IDLE">IDLE Only</option>
                      <option value="COMPLETED">COMPLETED Only</option>
                    </select>
                  </div>
                </div>

                {courts.length === 0 ? (
                  <div className="text-center py-12 bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-6">
                    <span className="text-sm text-[#172033] font-bold block mb-1">No Courts Configured</span>
                    <p className="text-xs text-[#667085] mb-4">Add courts in the Venues & Courts tab to monitor live activity.</p>
                    <button
                      onClick={() => setActiveTab('courts')}
                      className="btn-primary"
                    >
                      Add Courts
                    </button>
                  </div>
                ) : filteredCourts.length === 0 ? (
                  <div className="text-center py-8 text-[#667085] text-xs">
                    No courts matching status filter &apos;{courtBoardFilter}&apos;.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {filteredCourts.map((court) => {
                      const activeMatch = matches.find(
                        m => m.court_id === court.id && (m.status === 'LIVE' || m.status === 'UNDER_REVIEW' || m.status === 'PAUSED')
                      ) || matches.find(
                        m => m.court_id === court.id && m.status === 'READY'
                      ) || matches.find(
                        m => m.court_id === court.id && (m.status === 'COMPLETED' || m.status === 'FINAL')
                      );

                      const status = activeMatch ? activeMatch.status : 'IDLE';
                      const games = activeMatch?.games || [];
                      const activeGame = games.find((g: any) => g.status === 'LIVE') || games[games.length - 1];

                      return (
                        <div
                          key={court.id}
                          className="bg-white border border-[#E4E7EC] rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4 transition hover:border-[#D0D5DD]"
                        >
                          <div>
                            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-2.5">
                              <span className="text-sm font-bold text-[#172033] uppercase tracking-wider">
                                {court.name}
                              </span>
                              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                                status === 'LIVE' || status === 'UNDER_REVIEW'
                                  ? 'badge-live'
                                  : status === 'PAUSED'
                                  ? 'badge-paused'
                                  : status === 'READY'
                                  ? 'badge-ready'
                                  : status === 'COMPLETED' || status === 'FINAL'
                                  ? 'badge-completed'
                                  : 'badge-idle'
                              }`}>
                                {status === 'LIVE' ? '● LIVE' : status}
                              </span>
                            </div>

                            {activeMatch ? (
                              <div className="mt-3 space-y-3">
                                <div className="space-y-1">
                                  <div className="text-xs font-semibold text-[#172033]">
                                    {getPlayerNames(activeMatch.participant_a)}
                                  </div>
                                  <div className="text-[10px] text-[#98A2B3] font-bold font-mono">VS</div>
                                  <div className="text-xs font-semibold text-[#172033]">
                                    {getPlayerNames(activeMatch.participant_b)}
                                  </div>
                                </div>

                                {games.length > 0 ? (
                                  <div className="bg-[#F8FAF9] p-2.5 rounded-lg border border-[#EAECF0] space-y-1">
                                    <div className="flex justify-between items-center text-[10px] text-[#667085]">
                                      <span>Current Score:</span>
                                      <span className="font-bold text-[#14966B] font-mono">
                                        {activeGame ? `${activeGame.participant_a_score ?? 0} - ${activeGame.participant_b_score ?? 0}` : '0 - 0'}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-[#667085]">
                                      {games.map((g: any) => (
                                        <span key={g.id} className="bg-white px-1.5 py-0.5 rounded border border-[#E4E7EC]">
                                          G{g.game_number}: {g.participant_a_score}-{g.participant_b_score}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-[#667085] italic">
                                    {activeMatch.scheduled_at ? `Scheduled: ${new Date(activeMatch.scheduled_at).toLocaleTimeString()}` : 'Scheduled'}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-6 mb-4 text-center">
                                <span className="text-xs text-[#667085] font-medium">No active match. Court is available.</span>
                              </div>
                            )}
                          </div>

                          <div className="pt-3 border-t border-[#E4E7EC] flex flex-wrap gap-2">
                            {status === 'READY' && (
                              <>
                                <button
                                  onClick={() => handleStartMatch(activeMatch.id)}
                                  className="flex-1 btn-primary"
                                >
                                  Start Match
                                </button>
                                <button
                                  onClick={() => router.push(`/matches/${activeMatch.id}/score`)}
                                  className="flex-1 bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Live Score
                                </button>
                                <button
                                  onClick={() => openOutcomeModalForMatch(activeMatch)}
                                  className="bg-[#F4F3FF] hover:bg-[#EBE9FE] text-[#5925DC] border border-[#D9D6FE] font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Declare Outcome
                                </button>
                              </>
                            )}
                            {(status === 'LIVE' || status === 'UNDER_REVIEW') && (
                              <>
                                <button
                                  onClick={() => router.push(`/matches/${activeMatch.id}/score`)}
                                  className="flex-1 bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Live Score
                                </button>
                                <button
                                  onClick={() => handlePauseMatch(activeMatch.id)}
                                  className="bg-[#FFF5E6] hover:bg-[#F8E3C2] text-[#C98218] border border-[#F8E3C2] font-semibold text-xs py-1.5 px-3 rounded-lg transition"
                                >
                                  Pause
                                </button>
                                <button
                                  onClick={() => openOutcomeModalForMatch(activeMatch)}
                                  className="bg-[#F4F3FF] hover:bg-[#EBE9FE] text-[#5925DC] border border-[#D9D6FE] font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Declare Outcome
                                </button>
                              </>
                            )}
                            {status === 'PAUSED' && (
                              <>
                                <button
                                  onClick={() => handleResumeMatch(activeMatch.id)}
                                  className="flex-1 btn-primary"
                                >
                                  Resume Match
                                </button>
                                <button
                                  onClick={() => router.push(`/matches/${activeMatch.id}/score`)}
                                  className="flex-1 bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Live Score
                                </button>
                                <button
                                  onClick={() => openOutcomeModalForMatch(activeMatch)}
                                  className="bg-[#F4F3FF] hover:bg-[#EBE9FE] text-[#5925DC] border border-[#D9D6FE] font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                >
                                  Declare Outcome
                                </button>
                              </>
                            )}
                            {status === 'COMPLETED' && (
                              <button
                                onClick={() => handleFinalizeMatch(activeMatch.id)}
                                className="flex-1 bg-[#5925DC] hover:bg-[#4A1FB8] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                              >
                                Finalize Match
                              </button>
                            )}
                            {status === 'FINAL' && (
                              <button
                                onClick={() => handleReopenMatch(activeMatch.id)}
                                className="flex-1 bg-[#FFF5E6] hover:bg-[#F8E3C2] text-[#C98218] border border-[#F8E3C2] font-semibold text-xs py-1.5 px-3 rounded-lg transition"
                              >
                                Reopen Correction
                              </button>
                            )}
                            {status === 'IDLE' && (
                              <button
                                onClick={() => setActiveTab('matches')}
                                className="w-full btn-secondary"
                              >
                                Schedule a Match
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. MATCH CONTROL CENTER TAB */}
            {activeTab === 'matches' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Match Control Center</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Schedule, monitor, and control matches across all categories and courts.
                  </p>
                </div>

                {/* Multi-Parameter Filters Bar */}
                <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Search Player</label>
                      <input
                        type="text"
                        placeholder="Search player/team..."
                        value={matchSearch}
                        onChange={(e) => setMatchSearch(e.target.value)}
                        className="arena-input w-full py-1.5 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Court</label>
                      <select
                        value={matchCourtFilter}
                        onChange={(e) => setMatchCourtFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Courts ({courts.length})</option>
                        {courts.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Category</label>
                      <select
                        value={matchCategoryFilter}
                        onChange={(e) => setMatchCategoryFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Categories ({categories.length})</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Round</label>
                      <select
                        value={matchRoundFilter}
                        onChange={(e) => setMatchRoundFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Rounds ({rounds.length})</option>
                        {rounds.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Status</label>
                      <select
                        value={matchStatusFilter}
                        onChange={(e) => setMatchStatusFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="READY">READY</option>
                        <option value="LIVE">LIVE</option>
                        <option value="PAUSED">PAUSED</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="FINAL">FINAL</option>
                        <option value="UNDER_REVIEW">UNDER REVIEW</option>
                        <option value="SCHEDULED">SCHEDULED</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-[#E4E7EC] text-xs text-[#667085]">
                    <span>Showing <strong className="text-[#172033]">{filteredMatches.length}</strong> of {matches.length} matches</span>
                    {(matchSearch || matchCourtFilter !== 'ALL' || matchCategoryFilter !== 'ALL' || matchRoundFilter !== 'ALL' || matchStatusFilter !== 'ALL') && (
                      <button
                        onClick={() => {
                          setMatchSearch('');
                          setMatchCourtFilter('ALL');
                          setMatchCategoryFilter('ALL');
                          setMatchRoundFilter('ALL');
                          setMatchStatusFilter('ALL');
                        }}
                        className="text-xs text-[#14966B] hover:underline font-semibold"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </div>

                {matches.length === 0 ? (
                  <div className="text-center py-12 bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-6">
                    <span className="text-sm text-[#172033] font-bold block mb-1">No Matches Found</span>
                    <p className="text-xs text-[#667085] mb-4">Generate category draws first in the Draws & Standings tab.</p>
                    <button
                      onClick={() => setActiveTab('draws')}
                      className="btn-primary"
                    >
                      Generate Draws
                    </button>
                  </div>
                ) : filteredMatches.length === 0 ? (
                  <div className="text-center py-8 text-[#667085] text-xs">
                    No matches match your current filter criteria.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredMatches.map((match) => {
                      const nameA = getPlayerNames(match.participant_a);
                      const nameB = getPlayerNames(match.participant_b);
                      const catName = categories.find(c => c.id === match.category_id)?.name || '';
                      const roundName = rounds.find(r => r.id === match.round_id)?.name || 'Round';
                      const games = match.games || [];

                      return (
                        <div
                          key={match.id}
                          className="bg-white border border-[#E4E7EC] rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-[#D0D5DD] transition shadow-sm"
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] font-semibold bg-[#F2F4F7] px-2 py-0.5 rounded text-[#475467] border border-[#EAECF0]">
                                {catName}
                              </span>
                              <span className="text-[10px] font-semibold bg-[#EEF4FF] text-[#3267D6] px-2 py-0.5 rounded">
                                {roundName}
                              </span>
                              <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                                match.status === 'LIVE' || match.status === 'UNDER_REVIEW'
                                  ? 'badge-live'
                                  : match.status === 'PAUSED'
                                  ? 'badge-paused'
                                  : match.status === 'READY'
                                  ? 'badge-ready'
                                  : match.status === 'COMPLETED' || match.status === 'FINAL'
                                  ? 'badge-completed'
                                  : 'badge-idle'
                              }`}>
                                {match.status}
                              </span>
                              {match.outcome && (
                                <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] uppercase">
                                  {match.outcome}
                                </span>
                              )}
                            </div>
                            
                            <div className="text-sm font-bold text-[#172033] flex items-center space-x-3">
                              <span className={match.winner_id === match.participant_a_id ? 'text-[#14966B] font-extrabold' : ''}>
                                {nameA}
                              </span>
                              <span className="text-xs text-[#98A2B3] font-mono">vs</span>
                              <span className={match.winner_id === match.participant_b_id ? 'text-[#14966B] font-extrabold' : ''}>
                                {nameB}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-x-4 text-xs text-[#667085]">
                              <div>Court: <span className="text-[#172033] font-medium">{match.court?.name || 'Not assigned'}</span></div>
                              <div>Time: <span className="text-[#172033] font-medium">{match.scheduled_at ? new Date(match.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not scheduled'}</span></div>
                              {games.length > 0 && (
                                <div>Score: <span className="text-[#14966B] font-mono font-bold">
                                  {games.map((g: any) => `${g.participant_a_score}-${g.participant_b_score}`).join(', ')}
                                </span></div>
                              )}
                            </div>
                          </div>

                          {/* Context-Aware Action Buttons */}
                          <div className="flex flex-wrap gap-2 w-full md:w-auto">
                            {editingMatchId === match.id ? (
                              <div className="bg-[#F8FAF9] p-4 border border-[#E4E7EC] rounded-xl space-y-3 w-full md:w-80 shadow-sm">
                                <span className="text-xs font-bold text-[#172033] block">Schedule Match</span>
                                <div>
                                  <label className="block text-[10px] text-[#667085] mb-1 font-semibold">Select Court *</label>
                                  <select
                                    value={schedCourtId}
                                    onChange={(e) => setSchedCourtId(e.target.value)}
                                    className="arena-select w-full text-xs py-1.5"
                                  >
                                    <option value="">No Court</option>
                                    {courts.map(c => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] text-[#667085] mb-1 font-semibold">Scheduled Time *</label>
                                  <input
                                    type="datetime-local"
                                    value={schedTime}
                                    onChange={(e) => setSchedTime(e.target.value)}
                                    className="arena-input w-full text-xs py-1.5"
                                  />
                                </div>
                                <div className="flex space-x-2">
                                  <button
                                    onClick={() => handleSaveSchedule(match.id)}
                                    className="flex-1 btn-primary py-1 text-xs"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingMatchId(null)}
                                    className="btn-secondary py-1 text-xs"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingMatchId(match.id);
                                    setSchedCourtId(match.court_id || '');
                                    setSchedTime(match.scheduled_at ? match.scheduled_at.substring(0, 16) : '');
                                  }}
                                  className="btn-secondary py-1 text-xs"
                                >
                                  {match.scheduled_at ? 'Reschedule' : 'Schedule'}
                                </button>

                                {match.status === 'READY' && (
                                  <>
                                    <button
                                      onClick={() => handleStartMatch(match.id)}
                                      className="btn-primary py-1 text-xs"
                                    >
                                      Start Match
                                    </button>
                                    <button
                                      onClick={() => router.push(`/matches/${match.id}/score`)}
                                      className="bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                    >
                                      Live Score
                                    </button>
                                  </>
                                )}

                                {(match.status === 'LIVE' || match.status === 'UNDER_REVIEW') && (
                                  <>
                                    <button
                                      onClick={() => router.push(`/matches/${match.id}/score`)}
                                      className="bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                    >
                                      Live Score
                                    </button>
                                    <button
                                      onClick={() => handlePauseMatch(match.id)}
                                      className="bg-[#FFF5E6] hover:bg-[#F8E3C2] text-[#C98218] border border-[#F8E3C2] font-semibold text-xs py-1.5 px-3 rounded-lg transition"
                                    >
                                      Pause
                                    </button>
                                    {match.status === 'UNDER_REVIEW' && (
                                      <button
                                        onClick={() => handleFinalizeMatch(match.id)}
                                        className="bg-[#5925DC] hover:bg-[#4A1FB8] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                      >
                                        Finalize
                                      </button>
                                    )}
                                  </>
                                )}

                                {match.status === 'PAUSED' && (
                                  <>
                                    <button
                                      onClick={() => handleResumeMatch(match.id)}
                                      className="btn-primary py-1 text-xs"
                                    >
                                      Resume Match
                                    </button>
                                    <button
                                      onClick={() => router.push(`/matches/${match.id}/score`)}
                                      className="bg-[#3267D6] hover:bg-[#2853AE] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                    >
                                      Live Score
                                    </button>
                                  </>
                                )}

                                {(match.status === 'SCHEDULED' || match.status === 'READY' || match.status === 'LIVE' || match.status === 'PAUSED' || match.status === 'UNDER_REVIEW') && (
                                  <button
                                    onClick={() => openOutcomeModalForMatch(match)}
                                    className="bg-[#F4F3FF] hover:bg-[#EBE9FE] text-[#5925DC] border border-[#D9D6FE] font-semibold text-xs py-1 px-2.5 rounded-lg transition shadow-sm"
                                  >
                                    Declare Outcome
                                  </button>
                                )}

                                {match.status === 'COMPLETED' && (
                                  <button
                                    onClick={() => handleFinalizeMatch(match.id)}
                                    className="bg-[#5925DC] hover:bg-[#4A1FB8] text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition shadow-sm"
                                  >
                                    Finalize Match
                                  </button>
                                )}

                                {match.status === 'FINAL' && (
                                  <button
                                    onClick={() => handleReopenMatch(match.id)}
                                    className="bg-[#FFF5E6] hover:bg-[#F8E3C2] text-[#C98218] border border-[#F8E3C2] font-semibold text-xs py-1.5 px-3 rounded-lg transition"
                                  >
                                    Reopen for Correction
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 3. REGISTRATIONS TAB */}
            {activeTab === 'registrations' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Registration Review & Approval</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Review incoming registrations, verify category eligibility, and approve or reject players.
                  </p>
                </div>

                {/* Filters */}
                <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Search Player</label>
                      <input
                        type="text"
                        placeholder="Search player name..."
                        value={regSearch}
                        onChange={(e) => setRegSearch(e.target.value)}
                        className="arena-input w-full py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Category</label>
                      <select
                        value={regCategoryFilter}
                        onChange={(e) => setRegCategoryFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Categories</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Status</label>
                      <select
                        value={regStatusFilter}
                        onChange={(e) => setRegStatusFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="PENDING">PENDING</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="REJECTED">REJECTED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-[#E4E7EC] text-xs text-[#667085]">
                    <span>Showing <strong className="text-[#172033]">{filteredRegistrations.length}</strong> registrations</span>
                    {(regSearch || regCategoryFilter !== 'ALL' || regStatusFilter !== 'ALL') && (
                      <button
                        onClick={() => {
                          setRegSearch('');
                          setRegCategoryFilter('ALL');
                          setRegStatusFilter('ALL');
                        }}
                        className="text-xs text-[#14966B] hover:underline font-semibold"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </div>

                {filteredRegistrations.length === 0 ? (
                  <div className="text-center py-8 text-[#667085] text-xs">
                    No registrations matching your filter criteria.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#E4E7EC] rounded-xl">
                    <table className="w-full text-xs text-left text-[#344054]">
                      <thead className="bg-[#F8FAF9] text-[#667085] uppercase text-[10px] border-b border-[#E4E7EC] font-semibold">
                        <tr>
                          <th className="px-4 py-3">Player / Team</th>
                          <th className="px-4 py-3">Demographics</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Registered Date</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E7EC] bg-white">
                        {filteredRegistrations.map((reg) => {
                          const playerNames = getPlayerNames(reg.participant);
                          const members = reg.participant?.members || [];
                          const p1 = members[0]?.player;
                          const p2 = members[1]?.player;

                          return (
                            <tr key={reg.id} className="hover:bg-[#F8FAF9]">
                              <td className="px-4 py-3">
                                <span className="font-bold text-[#172033] block">{playerNames}</span>
                                <span className="text-[10px] text-[#667085]">{reg.category.category_type}</span>
                              </td>
                              <td className="px-4 py-3 text-[11px] text-[#667085]">
                                {p1 && (
                                  <div>
                                    {p1.gender || 'N/A'} {p1.date_of_birth ? `(Age ${calculateAge(p1.date_of_birth)})` : ''}
                                  </div>
                                )}
                                {p2 && (
                                  <div>
                                    {p2.gender || 'N/A'} {p2.date_of_birth ? `(Age ${calculateAge(p2.date_of_birth)})` : ''}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 font-semibold text-[#172033]">
                                {reg.category.name}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  reg.status === 'APPROVED' ? 'badge-live' :
                                  reg.status === 'PENDING' ? 'badge-paused' :
                                  reg.status === 'REJECTED' ? 'badge-idle text-[#C94A4A]' : 'badge-idle'
                                }`}>
                                  {reg.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-[#667085] text-[11px]">
                                {new Date(reg.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {reg.status === 'PENDING' && (
                                  <div className="flex justify-end space-x-2">
                                    <button
                                      onClick={() => handleMutationRegistration(reg.id, reg.participant.id, 'APPROVE')}
                                      className="btn-primary py-1 text-xs"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => {
                                        setRejectingRegId(reg.id);
                                        setRejectingPartId(reg.participant.id);
                                        setRejectModalOpen(true);
                                      }}
                                      className="btn-danger py-1 text-xs"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Rejection Modal */}
                {rejectModalOpen && (
                  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_10px_40px_rgba(23,32,51,0.12)]">
                      <h4 className="text-base font-bold text-[#172033]">Reject Registration</h4>
                      <p className="text-xs text-[#667085]">
                        Are you sure you want to reject this registration? The participant status will become WITHDRAWN.
                      </p>
                      <div>
                        <label className="block text-xs font-semibold text-[#344054] mb-1">Optional Rejection Reason</label>
                        <textarea
                          rows={2}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="e.g. Ineligible division or age limit exceeded"
                          className="arena-textarea w-full text-xs"
                        />
                      </div>
                      <div className="flex justify-end space-x-2 pt-2">
                        <button
                          onClick={() => {
                            setRejectModalOpen(false);
                            setRejectingRegId(null);
                            setRejectingPartId(null);
                            setRejectReason('');
                          }}
                          className="btn-secondary"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (rejectingRegId && rejectingPartId) {
                              handleMutationRegistration(rejectingRegId, rejectingPartId, 'REJECT');
                            }
                          }}
                          className="btn-danger"
                        >
                          Confirm Rejection
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. PARTICIPANTS TAB */}
            {activeTab === 'participants' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Participants & Roster Management</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    View active and withdrawn players or manually register participants.
                  </p>
                </div>

                {/* Manual Registration Form */}
                <form onSubmit={handleAddManualParticipant} className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-5 space-y-4">
                  <span className="font-bold text-sm block text-[#172033]">Manually Register Player / Team</span>
                  
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Category *</label>
                      <select
                        value={manCategoryId}
                        onChange={(e) => setManCategoryId(e.target.value)}
                        className="arena-select w-full"
                      >
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.category_type})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Select Player 1 *</label>
                      <select
                        value={manPlayer1Id}
                        onChange={(e) => setManPlayer1Id(e.target.value)}
                        className="arena-select w-full"
                      >
                        {eligiblePlayers.map(p => (
                          <option key={p.id} value={p.id}>{p.full_name}</option>
                        ))}
                      </select>
                    </div>

                    {categories.find(c => c.id === manCategoryId)?.category_type === 'DOUBLES' && (
                      <div>
                        <label className="block text-xs font-semibold text-[#344054] mb-1">Select Player 2 *</label>
                        <select
                          value={manPlayer2Id}
                          onChange={(e) => setManPlayer2Id(e.target.value)}
                          className="arena-select w-full"
                        >
                          {eligiblePlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.full_name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={addingParticipant || eligiblePlayers.length === 0}
                    className="btn-primary"
                  >
                    {addingParticipant ? 'Registering...' : 'Register & Approve Participant'}
                  </button>
                </form>

                {/* Filters */}
                <div className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Search Player</label>
                      <input
                        type="text"
                        placeholder="Search player name..."
                        value={partSearch}
                        onChange={(e) => setPartSearch(e.target.value)}
                        className="arena-input w-full py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Category</label>
                      <select
                        value={partCategoryFilter}
                        onChange={(e) => setPartCategoryFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Categories</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#667085] uppercase font-bold mb-1">Status</label>
                      <select
                        value={partStatusFilter}
                        onChange={(e) => setPartStatusFilter(e.target.value)}
                        className="arena-select w-full py-1.5 text-xs"
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="WITHDRAWN">WITHDRAWN</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-[#E4E7EC] text-xs text-[#667085]">
                    <span>Showing <strong className="text-[#172033]">{filteredParticipants.length}</strong> participants</span>
                    {(partSearch || partCategoryFilter !== 'ALL' || partStatusFilter !== 'ALL') && (
                      <button
                        onClick={() => {
                          setPartSearch('');
                          setPartCategoryFilter('ALL');
                          setPartStatusFilter('ALL');
                        }}
                        className="text-xs text-[#14966B] hover:underline font-semibold"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </div>

                {/* List participants */}
                {filteredParticipants.length === 0 ? (
                  <p className="text-sm text-[#667085] italic text-center py-6">No participants matching your filter criteria.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filteredParticipants.map((part) => {
                      const playerNames = getPlayerNames(part);
                      return (
                        <div key={part.id} className="bg-white border border-[#E4E7EC] rounded-xl p-4 flex justify-between items-center shadow-sm">
                          <div>
                            <span className="text-xs font-semibold text-[#667085] uppercase font-mono block">
                              {part.category?.name || 'Category'}
                            </span>
                            <span className="text-base font-bold text-[#172033] block mt-1">
                              {playerNames}
                            </span>
                          </div>
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                            part.status === 'ACTIVE' ? 'badge-live' : 'badge-idle text-[#C94A4A]'
                          }`}>
                            {part.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 5. DRAWS & STANDINGS TAB */}
            {activeTab === 'draws' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Draws & Standings Management</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Generate brackets, round robin fixtures, and publish tournament draws.
                  </p>
                </div>

                {categories.length === 0 ? (
                  <p className="text-sm text-[#667085] italic">No categories created yet.</p>
                ) : (
                  <div className="space-y-6">
                    {categories.map((cat) => {
                      const categoryDraw = draws.find(d => d.category_id === cat.id && !d.parent_draw_id);
                      const catParticipants = participants.filter(p => p.status === 'ACTIVE' && p.category_id === cat.id);
                      
                      return (
                        <div key={cat.id} className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-5 space-y-4">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#E4E7EC] pb-3">
                            <div>
                              <h3 className="text-base font-bold text-[#172033]">{cat.name}</h3>
                              <span className="text-xs text-[#667085]">
                                Format: <span className="font-mono text-[#14966B] font-bold">{cat.format}</span> | Active Players: {catParticipants.length}
                              </span>
                            </div>
                            <div>
                              {categoryDraw ? (
                                <div className="flex space-x-2">
                                  {categoryDraw.status === 'DRAFT' && (
                                    <button
                                      onClick={() => handlePublishDraw(categoryDraw.id)}
                                      className="btn-primary py-1 text-xs"
                                    >
                                      Publish Draw
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteDraw(cat.id)}
                                    className="btn-danger py-1 text-xs"
                                  >
                                    Delete Draw
                                  </button>
                                </div>
                              ) : (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <select
                                      value={selectedDrawCategoryId === cat.id ? selectedDrawFormat : (cat.format || 'KNOCKOUT')}
                                      onChange={(e) => {
                                        setSelectedDrawCategoryId(cat.id);
                                        setSelectedDrawFormat(e.target.value as any);
                                      }}
                                      className="arena-select text-xs py-1"
                                    >
                                      <option value="KNOCKOUT">KNOCKOUT</option>
                                      <option value="ROUND_ROBIN">ROUND ROBIN</option>
                                      <option value="GROUP_KNOCKOUT">GROUP + KNOCKOUT</option>
                                    </select>

                                    {(selectedDrawCategoryId === cat.id ? selectedDrawFormat : cat.format) === 'GROUP_KNOCKOUT' && (
                                      <div className="flex items-center gap-1.5">
                                        <label className="text-[11px] text-[#667085]">Groups:</label>
                                        <select
                                          value={numGroups}
                                          onChange={(e) => setNumGroups(parseInt(e.target.value))}
                                          className="arena-select text-xs py-1 w-14"
                                        >
                                          <option value="2">2</option>
                                          <option value="4">4</option>
                                          <option value="8">8</option>
                                        </select>

                                        <label className="text-[11px] text-[#667085] ml-1">Qualifiers/Grp:</label>
                                        <select
                                          value={qualifiersPerGroup}
                                          onChange={(e) => setQualifiersPerGroup(parseInt(e.target.value))}
                                          className="arena-select text-xs py-1 w-14"
                                        >
                                          <option value="1">1</option>
                                          <option value="2">2</option>
                                        </select>

                                        <label className="text-[11px] text-[#667085] ml-1">Allocation:</label>
                                        <select
                                          value={allocMethod}
                                          onChange={(e) => setAllocMethod(e.target.value as any)}
                                          className="arena-select text-xs py-1"
                                        >
                                          <option value="SNAKE">Snake</option>
                                          <option value="SEQUENTIAL">Sequential</option>
                                        </select>
                                      </div>
                                    )}

                                    <button
                                      onClick={() => {
                                        setSelectedDrawCategoryId(cat.id);
                                        handleGenerateDraw(cat.id);
                                      }}
                                      disabled={catParticipants.length < ((selectedDrawCategoryId === cat.id ? selectedDrawFormat : cat.format) === 'GROUP_KNOCKOUT' ? numGroups * 2 : 2)}
                                      className="btn-primary py-1 text-xs"
                                    >
                                      Generate Draw
                                    </button>
                                  </div>
                                )}
                            </div>
                          </div>

                          {categoryDraw ? (
                            <div className="space-y-4 pt-2">
                              <div className="flex justify-between items-center text-xs text-[#667085]">
                                <span>Draw Status: <span className={`font-bold ${categoryDraw.status === 'PUBLISHED' ? 'text-[#14966B]' : 'text-[#C98218]'}`}>{categoryDraw.status}</span></span>
                                <span>Format: <span className="font-bold text-[#172033] font-mono">{categoryDraw.format}</span></span>
                                <span>Total Matches: {matches.filter(m => m.category_id === cat.id).length}</span>
                              </div>

                              {categoryDraw.format === 'GROUP_KNOCKOUT' && (() => {
                                const groupDraws = draws.filter(d => d.parent_draw_id === categoryDraw.id && d.format === 'ROUND_ROBIN');
                                const koDraw = draws.find(d => d.parent_draw_id === categoryDraw.id && d.format === 'KNOCKOUT');
                                const groupMatches = matches.filter(m => groupDraws.some(gd => rounds.some(r => r.draw_id === gd.id && r.id === m.round_id)));
                                const completedGroupMatches = groupMatches.filter(m => m.status === 'COMPLETED' || m.status === 'FINAL');
                                const allGroupMatchesDone = groupMatches.length > 0 && completedGroupMatches.length === groupMatches.length;

                                return (
                                  <div className="space-y-4 border-t border-[#EAECF0] pt-3">
                                    <div className="grid gap-4 md:grid-cols-2">
                                      {groupDraws.map((gd) => {
                                        const std = standings.find(s => s.draw_id === gd.id);
                                        const stdEntries = std ? standingsEntries.filter(se => se.standings_id === std.id) : [];
                                        const sorted = sortStandings(stdEntries, matches).sortedEntries;
                                        return (
                                          <div key={gd.id} className="bg-white border border-[#EAECF0] rounded-lg p-3 space-y-2">
                                            <span className="text-xs font-bold text-[#172033] block font-mono border-b border-[#EAECF0] pb-1">
                                              {gd.group_name} Standings
                                            </span>
                                            <table className="w-full text-[11px] text-left text-[#667085]">
                                              <thead>
                                                <tr className="text-[#98A2B3] uppercase text-[9px] font-mono border-b border-[#EAECF0]">
                                                  <th className="py-1">Rank</th>
                                                  <th className="py-1">Player/Team</th>
                                                  <th className="py-1">W/L</th>
                                                  <th className="py-1">Pts Diff</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {sorted.map((e) => {
                                                  const team = participants.find(p => p.id === e.participant_id);
                                                  const nameStr = team?.members.map(m => m.player?.full_name).join(' & ') || 'Unknown';
                                                  return (
                                                    <tr key={e.id} className="border-b border-[#EAECF0]">
                                                      <td className="py-1 text-[#172033] font-bold">{e.rank}</td>
                                                      <td className="py-1 text-[#172033] font-medium truncate max-w-[120px]">{nameStr}</td>
                                                      <td className="py-1">{e.won}/{e.lost}</td>
                                                      <td className="py-1 font-semibold text-[#14966B]">{e.points_for - e.points_against}</td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    <div className="bg-white border border-[#EAECF0] rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                      <div>
                                        <span className="text-xs font-bold text-[#172033] block font-mono">Knockout Bracket Stage</span>
                                        {koDraw ? (
                                          <span className="text-[11px] text-[#14966B] font-medium">
                                            Knockout Stage generated ({matches.filter(m => rounds.some(r => r.draw_id === koDraw.id && r.id === m.round_id)).length} bracket matches)
                                          </span>
                                        ) : (
                                          <span className="text-[11px] text-[#667085]">
                                            {allGroupMatchesDone
                                              ? 'All group stage matches completed. Ready to qualify top players.'
                                              : `Group stage in progress (${completedGroupMatches.length}/${groupMatches.length} matches completed)`}
                                          </span>
                                        )}
                                      </div>
                                      {!koDraw && (
                                        <button
                                          onClick={() => handleGenerateKnockoutFromGroups(cat.id)}
                                          disabled={!allGroupMatchesDone || generatingKnockout}
                                          className="btn-primary py-1 text-xs whitespace-nowrap"
                                        >
                                          {generatingKnockout ? 'Generating...' : 'Generate Knockout Stage'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <p className="text-xs text-[#667085] italic">No draw generated yet. Click Generate Draw above.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 6. CATEGORIES TAB */}
            {activeTab === 'categories' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Category Management</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Define tournament divisions, match formats, and registration fees.
                  </p>
                </div>

                <form onSubmit={handleCreateCategory} className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-5 space-y-4">
                  <span className="font-bold text-sm block text-[#172033]">Add New Category</span>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Category Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Men's Singles"
                        value={catName}
                        onChange={(e) => setCatName(e.target.value)}
                        className="arena-input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Format *</label>
                      <select
                        value={catFormat}
                        onChange={(e) => setCatFormat(e.target.value as any)}
                        className="arena-select w-full"
                      >
                        <option value="KNOCKOUT">Knockout Bracket</option>
                        <option value="ROUND_ROBIN">Round Robin</option>
                        <option value="GROUP_KNOCKOUT">Group Stage + Knockout</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Category Type *</label>
                      <select
                        value={catType}
                        onChange={(e) => setCatType(e.target.value as any)}
                        className="arena-select w-full"
                      >
                        <option value="SINGLES">Singles (Individual)</option>
                        <option value="DOUBLES">Doubles (Team)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Match Gender *</label>
                      <select
                        value={catMatchType}
                        onChange={(e) => setCatMatchType(e.target.value as any)}
                        className="arena-select w-full"
                      >
                        <option value="MENS">Men&apos;s Event</option>
                        <option value="WOMENS">Women&apos;s Event</option>
                        <option value="MIXED">Mixed Event</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#344054] mb-1">Max Participants</label>
                      <input
                        type="number"
                        min="2"
                        value={catMaxParts}
                        onChange={(e) => setCatMaxParts(e.target.value)}
                        className="arena-input w-full"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={creatingCategory}
                    className="btn-primary"
                  >
                    {creatingCategory ? 'Creating...' : 'Create Category'}
                  </button>
                </form>

                <div className="space-y-3">
                  <span className="font-bold text-sm block text-[#172033]">Existing Categories</span>
                  {categories.length === 0 ? (
                    <p className="text-sm text-[#667085] italic">No categories created yet.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {categories.map((cat) => (
                        <div key={cat.id} className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm">
                          <h4 className="font-bold text-[#172033]">{cat.name}</h4>
                          <div className="text-xs text-[#667085] mt-1 space-y-0.5">
                            <div>Type: <span className="text-[#172033] font-medium">{cat.category_type}</span> | Gender: <span className="text-[#172033] font-medium">{cat.match_type}</span></div>
                            <div>Format: <span className="text-[#14966B] font-mono font-bold">{cat.format}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 7. VENUES & COURTS TAB */}
            {activeTab === 'courts' && (
              <div className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Venues & Courts Management</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Assign tournament venue and configure available competition courts.
                  </p>
                </div>

                {tournament.venue_id ? (
                  <form onSubmit={handleAddCourt} className="bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl p-5 space-y-4">
                    <span className="font-bold text-sm block text-[#172033]">Add New Court</span>
                    <div className="flex gap-4">
                      <input
                        type="text"
                        required
                        placeholder="e.g. Court 1, Main Court"
                        value={courtName}
                        onChange={(e) => setCourtName(e.target.value)}
                        className="arena-input flex-1"
                      />
                      <button
                        type="submit"
                        disabled={addingCourt}
                        className="btn-primary"
                      >
                        {addingCourt ? 'Adding...' : 'Add Court'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="bg-[#FFF5E6] border border-[#F8E3C2] text-[#C98218] rounded-xl p-4 text-xs">
                    Please assign a venue in General Details tab first before adding courts.
                  </div>
                )}

                <div className="space-y-3">
                  <span className="font-bold text-sm block text-[#172033]">Available Courts ({courts.length})</span>
                  {courts.length === 0 ? (
                    <p className="text-sm text-[#667085] italic">No courts added yet.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {courts.map((court) => (
                        <div key={court.id} className="bg-white border border-[#E4E7EC] rounded-xl p-4 flex justify-between items-center shadow-sm">
                          <span className="font-bold text-[#172033]">{court.name}</span>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full badge-live">
                            {court.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 8. EXPORTS & REPORTS TAB */}
            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#E4E7EC] pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#14966B]" />
                      Exports & Official Reports
                    </h2>
                    <p className="text-xs text-[#667085] mt-0.5">
                      Generate and export official tournament documents in CSV (RFC 4180), Excel XLSX, and PDF formats.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#667085] font-semibold">Category Filter:</span>
                    <select
                      value={reportCategoryFilter}
                      onChange={(e) => setReportCategoryFilter(e.target.value)}
                      className="arena-select text-xs py-1.5"
                    >
                      <option value="ALL">All Categories ({categories.length})</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.category_type})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 6 Main Tournament Reports Grid */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {/* 1. Participants / Registrations */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">1. Participants & Registrations</span>
                        <span className="text-[10px] bg-[#E8F6F0] text-[#14966B] font-mono font-bold px-1.5 py-0.5 rounded">
                          {participants.length} Entries
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Official player roster, category assignments, seeds, demographic details, and registration statuses.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('participants', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('participants', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('participants', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>

                  {/* 2. Match Schedule */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">2. Match Schedule</span>
                        <span className="text-[10px] bg-[#EEF4FF] text-[#3267D6] font-mono font-bold px-1.5 py-0.5 rounded">
                          {matches.length} Matches
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Complete tournament timetable with round names, court assignments, side matchups, and scheduled times.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('schedule', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('schedule', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('schedule', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>

                  {/* 3. Match Results */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">3. Match Results</span>
                        <span className="text-[10px] bg-[#F2F4F7] text-[#475467] font-mono font-bold px-1.5 py-0.5 rounded">
                          {matches.filter(m => m.status === 'COMPLETED' || m.status === 'FINAL').length} Completed
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Official match outcomes, game scores, winners, walkovers, defaults, and retirements.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('results', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('results', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('results', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>

                  {/* 4. Standings & Rankings */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">4. Standings & Rankings</span>
                        <span className="text-[10px] bg-[#E8F6F0] text-[#14966B] font-mono font-bold px-1.5 py-0.5 rounded">
                          Engine Synced
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Authoritative rankings computed via Statistics Engine with Played, Won, Lost, Game Diff, and Point Diff.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('standings', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('standings', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('standings', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>

                  {/* 5. Draw / Bracket */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">5. Draw & Bracket</span>
                        <span className="text-[10px] bg-[#FEF6EE] text-[#C98218] font-mono font-bold px-1.5 py-0.5 rounded">
                          {draws.length} Draws
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Complete tournament tree node hierarchy, seed placements, BYEs, and advancement targets.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('draw', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('draw', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('draw', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>

                  {/* 6. Tournament Summary */}
                  <div className="bg-white border border-[#E4E7EC] rounded-xl p-4 shadow-sm flex flex-col justify-between hover:border-[#D0D5DD] transition">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#172033]">6. Tournament Summary</span>
                        <span className="text-[10px] bg-[#5925DC]/10 text-[#5925DC] font-mono font-bold px-1.5 py-0.5 rounded">
                          Executive Audit
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] mb-3">
                        Comprehensive executive summary with operational KPIs, court utilization, and points aggregates.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[#F2F4F7]">
                      <button
                        onClick={() => handleExportReport('summary', 'csv')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleExportReport('summary', 'xlsx')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#F8FAF9] hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[11px] font-semibold transition"
                      >
                        XLSX
                      </button>
                      <button
                        onClick={() => handleExportReport('summary', 'pdf')}
                        disabled={exportingReport}
                        className="flex-1 py-1.5 px-2 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[11px] font-semibold transition"
                      >
                        PDF
                      </button>
                    </div>
                  </div>
                </div>

                {/* 7. Match Score Sheets Section */}
                <div className="space-y-3 pt-4 border-t border-[#E4E7EC]">
                  <div>
                    <h3 className="text-sm font-bold text-[#172033]">7. Individual Match Score Sheets</h3>
                    <p className="text-xs text-[#667085]">
                      Export printable official match score sheets and game records for specific matches.
                    </p>
                  </div>

                  {matches.length === 0 ? (
                    <div className="text-center py-6 bg-[#F8FAF9] border border-[#E4E7EC] rounded-xl text-xs text-[#667085]">
                      No matches available yet. Generate draws or schedule fixtures to export individual score sheets.
                    </div>
                  ) : (
                    <div className="border border-[#E4E7EC] rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#F8FAF9] border-b border-[#E4E7EC] text-[#667085] font-semibold">
                          <tr>
                            <th className="p-3">Match</th>
                            <th className="p-3">Category</th>
                            <th className="p-3">Side A vs Side B</th>
                            <th className="p-3">Status</th>
                            <th className="p-3 text-right">Export Score Sheet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E4E7EC]">
                          {matches
                            .filter(m => reportCategoryFilter === 'ALL' || m.category_id === reportCategoryFilter)
                            .map((m, idx) => {
                              const cat = categories.find(c => c.id === m.category_id);
                              const sideA = getPlayerNames(m.participant_a);
                              const sideB = getPlayerNames(m.participant_b);
                              return (
                                <tr key={m.id} className="hover:bg-[#F8FAF9] transition">
                                  <td className="p-3 font-bold text-[#172033]">#{m.match_order || idx + 1}</td>
                                  <td className="p-3 text-[#667085]">{cat?.name || 'Unknown'}</td>
                                  <td className="p-3 font-medium text-[#172033]">
                                    {sideA} <span className="text-[#98A2B3]">vs</span> {sideB}
                                  </td>
                                  <td className="p-3">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      m.status === 'COMPLETED' || m.status === 'FINAL'
                                        ? 'badge-completed'
                                        : m.status === 'LIVE'
                                        ? 'badge-live'
                                        : 'badge-ready'
                                    }`}>
                                      {m.status}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right">
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        onClick={() => handleExportScoreSheet(m.id, 'csv')}
                                        disabled={exportingReport}
                                        className="py-1 px-2 bg-white hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[10px] font-semibold transition"
                                      >
                                        CSV
                                      </button>
                                      <button
                                        onClick={() => handleExportScoreSheet(m.id, 'xlsx')}
                                        disabled={exportingReport}
                                        className="py-1 px-2 bg-white hover:bg-[#E8F6F0] text-[#172033] hover:text-[#14966B] border border-[#E4E7EC] rounded text-[10px] font-semibold transition"
                                      >
                                        XLSX
                                      </button>
                                      <button
                                        onClick={() => handleExportScoreSheet(m.id, 'pdf')}
                                        disabled={exportingReport}
                                        className="py-1 px-2.5 bg-[#14966B] hover:bg-[#107c58] text-white rounded text-[10px] font-semibold transition"
                                      >
                                        PDF
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 9. GENERAL DETAILS TAB */}
            {activeTab === 'details' && (
              <form onSubmit={handleSaveDetails} className="space-y-6">
                <div className="border-b border-[#E4E7EC] pb-3">
                  <h2 className="text-lg font-bold text-[#172033]">Edit Tournament Details</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Update core tournament configuration and schedule dates.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">Tournament Name *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="arena-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">Sport *</label>
                    <select
                      value={sportId}
                      onChange={(e) => setSportId(e.target.value)}
                      className="arena-select w-full"
                    >
                      {sports.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#344054] mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="arena-textarea w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#344054] mb-1">Venue Assignment</label>
                  <select
                    value={venueId}
                    onChange={(e) => setVenueId(e.target.value)}
                    className="arena-select w-full"
                  >
                    <option value="none">No Venue Assigned</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">Start Date</label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="arena-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">End Date</label>
                    <input
                      type="date"
                      required
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="arena-input w-full"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">Registration Open Date</label>
                    <input
                      type="date"
                      required
                      value={registrationOpen}
                      onChange={(e) => setRegistrationOpen(e.target.value)}
                      className="arena-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#344054] mb-1">Registration Close Date</label>
                    <input
                      type="date"
                      required
                      value={registrationClose}
                      onChange={(e) => setRegistrationClose(e.target.value)}
                      className="arena-input w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#344054] mb-1">Rules & Notes</label>
                  <textarea
                    rows={3}
                    value={rules}
                    onChange={(e) => setRules(e.target.value)}
                    className="arena-textarea w-full"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingDetails}
                  className="btn-primary"
                >
                  {savingDetails ? 'Saving...' : 'Save Settings'}
                </button>
              </form>
            )}

            {/* 9. DANGER ZONE TAB */}
            {activeTab === 'danger' && (
              <div className="space-y-6">
                <div className="border-b border-[#FECDCA] pb-3">
                  <h2 className="text-lg font-bold text-[#C94A4A]">Danger Zone</h2>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Permanently delete this tournament and all associated fixtures, draws, and registrations.
                  </p>
                </div>

                <div className="bg-[#FEF3F2] border border-[#FECDCA] rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#C94A4A]">Delete Tournament</h3>
                    <p className="text-xs text-[#667085] mt-1">
                      Once deleted, this tournament cannot be recovered. Player accounts will remain intact.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="btn-danger"
                  >
                    Delete This Tournament
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#FECDCA] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_10px_40px_rgba(23,32,51,0.12)]">
              <h4 className="text-base font-bold text-[#C94A4A]">Confirm Tournament Deletion</h4>
              <p className="text-xs text-[#667085]">
                To confirm deletion, please type the exact tournament name: <strong className="text-[#172033] font-mono">{tournament.name}</strong>
              </p>
              <input
                type="text"
                placeholder="Enter tournament name..."
                value={deleteInputName}
                onChange={(e) => setDeleteInputName(e.target.value)}
                className="arena-input w-full text-xs"
              />
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteInputName('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteTournament}
                  disabled={isDeleting || deleteInputName !== tournament.name}
                  className="btn-danger"
                >
                  {isDeleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Outcome Declaration Modal */}
        {outcomeModalMatch && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_10px_40px_rgba(23,32,51,0.12)] border border-[#E4E7EC]">
              <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
                <div>
                  <h4 className="text-sm font-bold text-[#172033]">Declare Match Outcome</h4>
                  <p className="text-[11px] text-[#667085]">
                    {getPlayerNames(outcomeModalMatch.participant_a)} vs {getPlayerNames(outcomeModalMatch.participant_b)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOutcomeModalMatch(null)}
                  className="text-[#667085] hover:text-[#172033] text-sm font-bold p-1"
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>

              {/* Outcome Selection */}
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-[#344054]">Select Outcome Type *</label>

                {(() => {
                  const hasPoints = outcomeModalMatch.games && Array.isArray(outcomeModalMatch.games) && outcomeModalMatch.games.some((g: any) => (g.participant_a_score || 0) > 0 || (g.participant_b_score || 0) > 0);
                  const isLiveOrPaused = outcomeModalMatch.status === 'LIVE' || outcomeModalMatch.status === 'PAUSED';

                  return (
                    <>
                      {/* WALKOVER Option */}
                      <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                        selectedOutcome === 'WALKOVER' ? 'bg-[#EEF4FF] border-[#3267D6]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
                      } ${hasPoints ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name="confOutcomeType"
                          value="WALKOVER"
                          checked={selectedOutcome === 'WALKOVER'}
                          disabled={hasPoints}
                          onChange={() => setSelectedOutcome('WALKOVER')}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#172033]">Walkover (W.O.)</span>
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE]">W.O.</span>
                          </div>
                          <p className="text-[11px] text-[#667085]">
                            Opponent did not appear or withdrew before the match started. No rally points are created.
                          </p>
                          {hasPoints && (
                            <p className="text-[10px] text-[#B42318] font-medium">
                              ⚠️ Scoring points already recorded. Use Retirement instead.
                            </p>
                          )}
                        </div>
                      </label>

                      {/* RETIREMENT Option */}
                      <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                        selectedOutcome === 'RETIREMENT' ? 'bg-[#FEF6EE] border-[#C98218]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
                      } ${!isLiveOrPaused ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name="confOutcomeType"
                          value="RETIREMENT"
                          checked={selectedOutcome === 'RETIREMENT'}
                          disabled={!isLiveOrPaused}
                          onChange={() => setSelectedOutcome('RETIREMENT')}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#172033]">Retirement (Ret.)</span>
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FEF6EE] text-[#C98218] border border-[#F9DBAF]">RET.</span>
                          </div>
                          <p className="text-[11px] text-[#667085]">
                            Player retired mid-match due to injury or illness. All games and rally points scored prior to retirement are preserved.
                          </p>
                          {!isLiveOrPaused && (
                            <p className="text-[10px] text-[#B42318] font-medium">
                              ⚠️ Retirement is only available once match is LIVE or PAUSED.
                            </p>
                          )}
                        </div>
                      </label>

                      {/* DEFAULT Option */}
                      <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                        selectedOutcome === 'DEFAULT' ? 'bg-[#FDF0F0] border-[#B42318]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
                      } ${hasPoints ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name="confOutcomeType"
                          value="DEFAULT"
                          checked={selectedOutcome === 'DEFAULT'}
                          disabled={hasPoints}
                          onChange={() => setSelectedOutcome('DEFAULT')}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#172033]">Default / Disqualification</span>
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FDF0F0] text-[#B42318] border border-[#FDA29B]">DEF.</span>
                          </div>
                          <p className="text-[11px] text-[#667085]">
                            Player is disqualified by tournament referee or failed to attend.
                          </p>
                          {hasPoints && (
                            <p className="text-[10px] text-[#B42318] font-medium">
                              ⚠️ Scoring points already recorded. Use Retirement instead.
                            </p>
                          )}
                        </div>
                      </label>
                    </>
                  );
                })()}
              </div>

              {/* Winner Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#344054]">
                  {selectedOutcome === 'RETIREMENT' ? 'Select Conceding Player (Retiring Side) *' : 'Select Winner to Advance *'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedWinnerId(selectedOutcome === 'RETIREMENT' ? (outcomeModalMatch.participant_b_id || '') : (outcomeModalMatch.participant_a_id || ''))}
                    className={`p-2.5 rounded-lg border text-left text-xs transition ${
                      (selectedOutcome === 'RETIREMENT' ? selectedWinnerId === outcomeModalMatch.participant_b_id : selectedWinnerId === outcomeModalMatch.participant_a_id)
                        ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                        : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                    }`}
                  >
                    <span className="block truncate">{getPlayerNames(outcomeModalMatch.participant_a)}</span>
                    <span className="text-[10px] text-[#667085] font-normal block">
                      {selectedOutcome === 'RETIREMENT'
                        ? (selectedWinnerId === outcomeModalMatch.participant_b_id ? 'Retires (Concedes)' : 'Wins Match')
                        : (selectedWinnerId === outcomeModalMatch.participant_a_id ? 'Winner (Advances)' : 'Concedes')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedWinnerId(selectedOutcome === 'RETIREMENT' ? (outcomeModalMatch.participant_a_id || '') : (outcomeModalMatch.participant_b_id || ''))}
                    className={`p-2.5 rounded-lg border text-left text-xs transition ${
                      (selectedOutcome === 'RETIREMENT' ? selectedWinnerId === outcomeModalMatch.participant_a_id : selectedWinnerId === outcomeModalMatch.participant_b_id)
                        ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                        : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                    }`}
                  >
                    <span className="block truncate">{getPlayerNames(outcomeModalMatch.participant_b)}</span>
                    <span className="text-[10px] text-[#667085] font-normal block">
                      {selectedOutcome === 'RETIREMENT'
                        ? (selectedWinnerId === outcomeModalMatch.participant_a_id ? 'Retires (Concedes)' : 'Wins Match')
                        : (selectedWinnerId === outcomeModalMatch.participant_b_id ? 'Winner (Advances)' : 'Concedes')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Optional Notes */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Referee / Official Notes (Optional)</label>
                <textarea
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  placeholder="e.g., Ankle injury in second game / No-show after 15 min call..."
                  rows={2}
                  className="arena-input text-xs py-1.5 w-full resize-none"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end space-x-2 pt-2 border-t border-[#E4E7EC]">
                <button
                  type="button"
                  onClick={() => setOutcomeModalMatch(null)}
                  disabled={submittingOutcome}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmOutcome}
                  disabled={submittingOutcome || !selectedWinnerId}
                  className="btn-primary text-xs flex items-center justify-center gap-2"
                >
                  {submittingOutcome ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Recording...
                    </>
                  ) : (
                    'Confirm & Declare'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
