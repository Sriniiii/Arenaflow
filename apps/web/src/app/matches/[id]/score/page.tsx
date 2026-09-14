'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  BadmintonRules,
  BadmintonMatchState,
  BadmintonMatchConfig,
  BadmintonServiceState,
  FootballRules,
  FootballMatchState,
  FootballMatchConfig,
  FootballLineup,
  FootballMatchPhase
} from '@arena-flow/sport-engine';
import {
  getPendingEventsForMatch,
  enqueueOfflineEvent,
  reconstructOfflineMatchState,
  reconstructOfflineFootballMatchState,
  syncPendingMatchEvents,
  OfflineMatchEvent,
  SyncStatus
} from '@/services/offlineScoring';
import {
  buildMatchScoreSheetReportData,
  exportTournamentReport,
  triggerBrowserDownload,
  ExportFormat
} from '@/services/reports';

interface ScorerPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function ScorerPage({ params }: ScorerPageProps) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.id;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [match, setMatch] = useState<any>(null);
  const [matchEvents, setMatchEvents] = useState<any[]>([]);
  const [scoreState, setScoreState] = useState<BadmintonMatchState | null>(null);
  const [footballScoreState, setFootballScoreState] = useState<FootballMatchState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connStatus, setConnStatus] = useState<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'CONFLICT'>('ONLINE');
  const [conflictReason, setConflictReason] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'>('IDLE');
  
  // Generic Outcome Modal State
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<'WALKOVER' | 'RETIREMENT' | 'DEFAULT' | 'ABANDONED'>('WALKOVER');
  const [selectedWinnerId, setSelectedWinnerId] = useState<string>('');
  const [outcomeNotes, setOutcomeNotes] = useState<string>('');
  const [submittingOutcome, setSubmittingOutcome] = useState(false);

  // Badminton Service Configuration Modal State
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [serviceSide, setServiceSide] = useState<'A' | 'B'>('A');
  const [serviceServerId, setServiceServerId] = useState<string>('');
  const [serviceReceiverId, setServiceReceiverId] = useState<string>('');
  const [sideARightId, setSideARightId] = useState<string>('');
  const [sideALeftId, setSideALeftId] = useState<string>('');
  const [sideBRightId, setSideBRightId] = useState<string>('');
  const [sideBLeftId, setSideBLeftId] = useState<string>('');
  const [submittingService, setSubmittingService] = useState(false);

  // Football Modals State
  const [showLineupModal, setShowLineupModal] = useState(false);
  const [lineupTeam, setLineupTeam] = useState<'A' | 'B'>('A');
  const [selectedStartersA, setSelectedStartersA] = useState<string[]>([]);
  const [selectedSubsA, setSelectedSubsA] = useState<string[]>([]);
  const [selectedCaptainA, setSelectedCaptainA] = useState<string>('');
  const [selectedStartersB, setSelectedStartersB] = useState<string[]>([]);
  const [selectedSubsB, setSelectedSubsB] = useState<string[]>([]);
  const [selectedCaptainB, setSelectedCaptainB] = useState<string>('');
  const [submittingLineup, setSubmittingLineup] = useState(false);

  // Football In-Game Modals
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalTeam, setGoalTeam] = useState<'A' | 'B'>('A');
  const [goalScorerId, setGoalScorerId] = useState<string>('');
  const [goalAssistId, setGoalAssistId] = useState<string>('');
  const [goalMinute, setGoalMinute] = useState<number>(1);

  const [showOwnGoalModal, setShowOwnGoalModal] = useState(false);
  const [ownGoalConcedingTeam, setOwnGoalConcedingTeam] = useState<'A' | 'B'>('A');
  const [ownGoalPlayerId, setOwnGoalPlayerId] = useState<string>('');
  const [ownGoalMinute, setOwnGoalMinute] = useState<number>(1);

  const [showCardModal, setShowCardModal] = useState(false);
  const [cardTeam, setCardTeam] = useState<'A' | 'B'>('A');
  const [cardPlayerId, setCardPlayerId] = useState<string>('');
  const [cardType, setCardType] = useState<'YELLOW' | 'RED'>('YELLOW');
  const [cardMinute, setCardMinute] = useState<number>(1);
  const [cardReason, setCardReason] = useState<string>('');

  const [showSubModal, setShowSubModal] = useState(false);
  const [subTeam, setSubTeam] = useState<'A' | 'B'>('A');
  const [subPlayerOffId, setSubPlayerOffId] = useState<string>('');
  const [subPlayerOnId, setSubPlayerOnId] = useState<string>('');
  const [subMinute, setSubMinute] = useState<number>(1);

  const [showShootoutModal, setShowShootoutModal] = useState(false);
  const [shootoutTeam, setShootoutTeam] = useState<'A' | 'B'>('A');
  const [shootoutKickerId, setShootoutKickerId] = useState<string>('');
  const [shootoutScored, setShootoutScored] = useState<boolean>(true);

  const badmintonRules = new BadmintonRules();
  const footballRules = new FootballRules();

  const isFootballMatch = (m: any) => {
    return (
      m?.category?.tournament?.sport?.slug === 'football' ||
      m?.category?.sport?.slug === 'football' ||
      m?.category?.category_type === 'TEAM'
    );
  };

  const isFootball = isFootballMatch(match);

  const loadMatchData = async () => {
    try {
      // 1. Fetch Match Details
      const { data: matchData, error: mErr } = await supabase
        .from('matches')
        .select(`
          *,
          category: categories (
            id,
            name,
            category_type,
            match_type,
            rules_config,
            tournament: tournaments (
              id,
              name,
              organizer_id,
              sport: sports ( id, name, slug )
            )
          ),
          participant_a: participants!matches_participant_a_id_fkey (
            id,
            members: participant_members (
              id,
              member_order,
              jersey_number,
              position,
              status,
              player: players ( id, full_name, display_name )
            )
          ),
          participant_b: participants!matches_participant_b_id_fkey (
            id,
            members: participant_members (
              id,
              member_order,
              jersey_number,
              position,
              status,
              player: players ( id, full_name, display_name )
            )
          )
        `)
        .eq('id', matchId)
        .single();

      if (mErr || !matchData) throw new Error('Match not found or accessible.');
      setMatch(matchData);

      const isFoot = isFootballMatch(matchData);

      // 2. Fetch Match Events from Server
      let eventsData: any[] = [];
      try {
        const { data: sEvents, error: eErr } = await supabase
          .from('match_events')
          .select('*')
          .eq('match_id', matchId)
          .order('sequence_number', { ascending: true });

        if (!eErr && sEvents) {
          eventsData = sEvents;
        }
      } catch (e) {
        console.warn('Could not fetch server match_events (likely offline):', e);
      }
      setMatchEvents(eventsData || []);

      // 3. Fetch Local Pending Events from IndexedDB
      const pendingEvents = await getPendingEventsForMatch(matchId);
      setPendingCount(pendingEvents.length);

      const hasConflict = pendingEvents.some((p) => p.sync_status === 'CONFLICT');
      if (hasConflict) {
        setSyncState('CONFLICT');
        const conflictItem = pendingEvents.find((p) => p.sync_status === 'CONFLICT');
        setConflictReason(conflictItem?.error_message || 'Conflicting score events detected.');
      } else if (!navigator.onLine) {
        setSyncState('OFFLINE');
      } else if (pendingEvents.length > 0) {
        setSyncState('PENDING' as any);
      } else {
        setSyncState('SYNCED');
      }

      // 4. Reconstruct Scoring State using Sport Engine
      if (isFoot) {
        const rulesConfig = matchData?.category?.rules_config || {};
        const fConfig: Partial<FootballMatchConfig> = {
          regulationHalfMinutes: rulesConfig.regulationHalfMinutes ?? 45,
          extraTimeEnabled: rulesConfig.extraTimeEnabled ?? false,
          extraTimeHalfMinutes: rulesConfig.extraTimeHalfMinutes ?? 15,
          penaltyShootoutEnabled: rulesConfig.penaltyShootoutEnabled ?? false,
          maxSubstitutions: rulesConfig.maxSubstitutions ?? 5,
          allowDraw: rulesConfig.allowDraw ?? true,
          playersPerTeam: rulesConfig.playersPerTeam ?? 11,
          minimumStartingXI: rulesConfig.playersPerTeam ?? 11,
          participantA: {
            id: matchData.participant_a_id,
            name: 'Team A',
            squad: matchData.participant_a?.members?.map((m: any) => ({
              id: m.player?.id,
              name: m.player?.full_name || m.player?.display_name || 'Player',
              jerseyNumber: m.jersey_number,
              position: m.position,
              isSuspended: m.status === 'SUSPENDED'
            })) || []
          },
          participantB: {
            id: matchData.participant_b_id,
            name: 'Team B',
            squad: matchData.participant_b?.members?.map((m: any) => ({
              id: m.player?.id,
              name: m.player?.full_name || m.player?.display_name || 'Player',
              jerseyNumber: m.jersey_number,
              position: m.position,
              isSuspended: m.status === 'SUSPENDED'
            })) || []
          }
        };

        const reconstructedState = reconstructOfflineFootballMatchState(eventsData, pendingEvents, fConfig);
        setFootballScoreState(reconstructedState);

        // Populate initial lineup state from matchData if available
        if (matchData.lineup_data?.teamA) {
          setSelectedStartersA(matchData.lineup_data.teamA.startingXI || []);
          setSelectedSubsA(matchData.lineup_data.teamA.substitutes || []);
          setSelectedCaptainA(matchData.lineup_data.teamA.captainId || '');
        }
        if (matchData.lineup_data?.teamB) {
          setSelectedStartersB(matchData.lineup_data.teamB.startingXI || []);
          setSelectedSubsB(matchData.lineup_data.teamB.substitutes || []);
          setSelectedCaptainB(matchData.lineup_data.teamB.captainId || '');
        }
      } else {
        const matchType = matchData?.category?.category_type === 'DOUBLES' ? 'DOUBLES' : 'SINGLES';
        const playerIdsA = matchData?.participant_a?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];
        const playerNamesA: Record<string, string> = {};
        matchData?.participant_a?.members?.forEach((m: any) => {
          if (m.player?.id) playerNamesA[m.player.id] = m.player.full_name || m.player.display_name || 'Player';
        });

        const playerIdsB = matchData?.participant_b?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];
        const playerNamesB: Record<string, string> = {};
        matchData?.participant_b?.members?.forEach((m: any) => {
          if (m.player?.id) playerNamesB[m.player.id] = m.player.full_name || m.player.display_name || 'Player';
        });

        const config: BadmintonMatchConfig = {
          matchType,
          participantA: {
            id: matchData.participant_a_id,
            playerIds: playerIdsA,
            playerNames: playerNamesA
          },
          participantB: {
            id: matchData.participant_b_id,
            playerIds: playerIdsB,
            playerNames: playerNamesB
          }
        };

        const reconstructedState = reconstructOfflineMatchState(eventsData, pendingEvents, config);
        setScoreState(reconstructedState);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to load match details.');
    } finally {
      setLoading(false);
    }
  };

  const triggerSync = async () => {
    if (!navigator.onLine) return;
    try {
      setSyncState('SYNCING');
      const res = await syncPendingMatchEvents(matchId, supabase, { isFootball });
      if (res.has_conflict) {
        setSyncState('CONFLICT');
        setConflictReason(res.conflict_reason || 'Conflicting state detected during synchronization.');
      } else if (res.success) {
        setSyncState('SYNCED');
        setConflictReason(null);
      } else {
        setSyncState('PENDING' as any);
      }
      await loadMatchData();
    } catch (err) {
      setSyncState('PENDING' as any);
    }
  };

  // Online / Offline Listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setConnStatus('CONNECTED');
      triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnStatus('DISCONNECTED');
      setSyncState('OFFLINE');
    };

    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      if (!navigator.onLine) {
        setSyncState('OFFLINE');
        setConnStatus('DISCONNECTED');
      }
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, [matchId]);

  const checkAuthorization = async () => {
    if (authLoading) return;
    if (!user) {
      router.push('/auth/login');
      return;
    }

    try {
      const { data: canScore, error } = await supabase.rpc('can_score_match', {
        m_id: matchId,
        u_id: user.id
      });
      if (error || !canScore) {
        setAuthorized(false);
        setErrorMsg('Unauthorized: You do not have permissions to score this match.');
      } else {
        setAuthorized(true);
        await loadMatchData();
      }
    } catch (err) {
      // In offline scenario, allow if previously authorized
      setAuthorized(true);
      await loadMatchData();
    }
  };

  useEffect(() => {
    checkAuthorization();
  }, [user, authLoading]);

  // Subscribe to realtime updates for matches and match_events + Presence
  useEffect(() => {
    if (!authorized || !user || !match) return;

    const tournamentId = match?.category?.tournament?.id;

    const eventsChannel = supabase
      .channel(`match_scoring:${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
        () => {
          loadMatchData();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        () => {
          loadMatchData();
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

    let presenceChannel: any = null;
    if (tournamentId) {
      presenceChannel = supabase
        .channel(`tournament_presence:${tournamentId}`)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            try {
              await presenceChannel.track({
                user_id: user.id,
                online_at: new Date().toISOString(),
                role: 'SCORER',
                email: user.email,
                match_id: matchId
              });
            } catch (err) {
              console.error('Failed to track presence:', err);
            }
          }
        });
    }

    return () => {
      supabase.removeChannel(eventsChannel);
      if (presenceChannel) {
        supabase.removeChannel(presenceChannel);
      }
    };
  }, [authorized, user, matchId, match]);

  // ==========================================
  // FOOTBALL ACTION HANDLERS
  // ==========================================
  const handleApplyFootballEvent = async (eventType: string, metadata: any = {}) => {
    const currentStatus = match?.status;
    const isLifecycleEvent =
      eventType === 'SET_LINEUP' ||
      eventType === 'START_FIRST_HALF' ||
      eventType === 'RESUME_MATCH' ||
      eventType === 'START_SECOND_HALF' ||
      eventType === 'START_EXTRA_TIME_FIRST_HALF' ||
      eventType === 'START_EXTRA_TIME_SECOND_HALF' ||
      eventType === 'START_PENALTY_SHOOTOUT' ||
      eventType === 'DECLARE_OUTCOME';

    if (
      !isLifecycleEvent &&
      currentStatus !== 'LIVE' &&
      currentStatus !== 'UNDER_REVIEW'
    ) {
      setErrorMsg(`Action locked because match status is ${currentStatus}.`);
      return;
    }

    try {
      setSavingState('SAVING');
      setErrorMsg(null);
      const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 1. Calculate next state locally using footballRules
      let nextState: any = null;
      if (footballScoreState) {
        nextState = footballRules.applyEvent(footballScoreState, {
          id: clientEventId,
          type: eventType,
          metadata,
          timestamp: new Date().toISOString()
        } as any);
        setFootballScoreState(nextState);
      }

      // 2. Persist to local IndexedDB queue
      const localEvent: OfflineMatchEvent = {
        client_event_id: clientEventId,
        match_id: matchId,
        event_type: eventType,
        local_order: matchEvents.length + pendingCount + 1,
        created_at: new Date().toISOString(),
        expected_server_sequence: matchEvents.length,
        metadata,
        sync_status: 'PENDING',
        retry_count: 0
      };

      await enqueueOfflineEvent(localEvent);
      let addedEvents = 1;

      // If match completed via this event (e.g. penalty shootout or sudden completion), trigger DECLARE_OUTCOME
      if (nextState?.isCompleted && eventType !== 'DECLARE_OUTCOME') {
        const winnerSide = nextState.winnerId === 'PARTICIPANT_A' ? 'A' : (nextState.winnerId === 'PARTICIPANT_B' ? 'B' : undefined);
        const winnerId = winnerSide === 'A' ? match?.participant_a_id : (winnerSide === 'B' ? match?.participant_b_id : null);
        const outcomeEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const outcomePayload = {
          outcome: nextState.decisionMethod || 'COMPLETED',
          winnerId,
          winnerSide,
          reason: `Match completed via ${nextState.decisionMethod || 'normal play'}`
        };
        const outcomeEvent: OfflineMatchEvent = {
          client_event_id: outcomeEventId,
          match_id: matchId,
          event_type: 'DECLARE_OUTCOME',
          local_order: matchEvents.length + pendingCount + 2,
          created_at: new Date().toISOString(),
          expected_server_sequence: matchEvents.length + 1,
          metadata: outcomePayload,
          sync_status: 'PENDING',
          retry_count: 0
        };
        await enqueueOfflineEvent(outcomeEvent);
        addedEvents += 1;
      }

      setPendingCount((prev) => prev + addedEvents);

      // 3. If online, trigger synchronization
      if (navigator.onLine) {
        triggerSync();
      }

      setSavingState('SAVED');
      setTimeout(() => setSavingState('IDLE'), 1500);
    } catch (err: any) {
      setSavingState('ERROR');
      setErrorMsg(err.message || 'Failed to apply football event.');
    }
  };

  const handleSaveFootballLineup = async () => {
    try {
      setSubmittingLineup(true);
      setErrorMsg(null);

      const team = lineupTeam;
      const starters = team === 'A' ? selectedStartersA : selectedStartersB;
      const subs = team === 'A' ? selectedSubsA : selectedSubsB;
      const captainId = team === 'A' ? selectedCaptainA : selectedCaptainB;
      const expectedStarters = match?.category?.rules_config?.playersPerTeam ?? 11;

      if (starters.length !== expectedStarters) {
        throw new Error(`Starting XI must contain exactly ${expectedStarters} players. Currently selected: ${starters.length}`);
      }
      if (!captainId || !starters.includes(captainId)) {
        throw new Error('Captain must be selected and must be in the Starting XI.');
      }

      const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lineup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const lineupPayload: FootballLineup = {
        startingXI: starters,
        substitutes: subs,
        captainId,
        positions: {}
      };

      const localEvent: OfflineMatchEvent = {
        client_event_id: clientEventId,
        match_id: matchId,
        event_type: 'SET_LINEUP',
        local_order: matchEvents.length + pendingCount + 1,
        created_at: new Date().toISOString(),
        expected_server_sequence: matchEvents.length,
        metadata: { team, lineup: lineupPayload },
        sync_status: 'PENDING',
        retry_count: 0
      };

      await enqueueOfflineEvent(localEvent);

      if (footballScoreState) {
        const nextState = footballRules.applyEvent(footballScoreState, {
          id: clientEventId,
          type: 'SET_LINEUP',
          metadata: { team, lineup: lineupPayload },
          timestamp: new Date().toISOString()
        } as any);
        setFootballScoreState(nextState);
      }

      setPendingCount((prev) => prev + 1);
      setShowLineupModal(false);

      if (navigator.onLine) {
        triggerSync();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit lineup.');
    } finally {
      setSubmittingLineup(false);
    }
  };

  const handleGoalSubmit = async () => {
    try {
      if (!goalScorerId) {
        setErrorMsg('Please select a goal scorer.');
        return;
      }
      await handleApplyFootballEvent('GOAL', {
        team: goalTeam,
        scorerPlayerId: goalScorerId,
        assistPlayerId: goalAssistId || undefined,
        minute: Number(goalMinute) || 1
      });
      setShowGoalModal(false);
      setGoalScorerId('');
      setGoalAssistId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record goal.');
    }
  };

  const handleOwnGoalSubmit = async () => {
    try {
      if (!ownGoalPlayerId) {
        setErrorMsg('Please select the player who conceded the own goal.');
        return;
      }
      await handleApplyFootballEvent('OWN_GOAL', {
        team: ownGoalConcedingTeam,
        concedingTeam: ownGoalConcedingTeam,
        playerPlayerId: ownGoalPlayerId,
        minute: Number(ownGoalMinute) || 1
      });
      setShowOwnGoalModal(false);
      setOwnGoalPlayerId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record own goal.');
    }
  };

  const handleCardSubmit = async () => {
    try {
      if (!cardPlayerId) {
        setErrorMsg('Please select a player to card.');
        return;
      }
      const eventType = cardType === 'YELLOW' ? 'YELLOW_CARD' : 'RED_CARD';
      await handleApplyFootballEvent(eventType, {
        team: cardTeam,
        playerId: cardPlayerId,
        minute: Number(cardMinute) || 1,
        reason: cardReason || undefined
      });
      setShowCardModal(false);
      setCardPlayerId('');
      setCardReason('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record card.');
    }
  };

  const handleSubSubmit = async () => {
    try {
      if (!subPlayerOffId || !subPlayerOnId) {
        setErrorMsg('Please select both the player coming off and the player coming on.');
        return;
      }
      if (subPlayerOffId === subPlayerOnId) {
        setErrorMsg('Player off and Player on cannot be the same player.');
        return;
      }
      await handleApplyFootballEvent('SUBSTITUTION', {
        team: subTeam,
        playerOffId: subPlayerOffId,
        playerOnId: subPlayerOnId,
        minute: Number(subMinute) || 1
      });
      setShowSubModal(false);
      setSubPlayerOffId('');
      setSubPlayerOnId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record substitution.');
    }
  };

  const handleShootoutKickSubmit = async () => {
    try {
      if (!shootoutKickerId) {
        setErrorMsg('Please select the penalty kicker.');
        return;
      }
      await handleApplyFootballEvent('PENALTY_KICK', {
        team: shootoutTeam,
        kickerPlayerId: shootoutKickerId,
        scored: shootoutScored
      });
      setShowShootoutModal(false);
      setShootoutKickerId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record penalty kick.');
    }
  };

  // ==========================================
  // BADMINTON ACTION HANDLERS
  // ==========================================
  const handleScorePoint = async (isA: boolean) => {
    const currentStatus = match?.status;
    if (currentStatus !== 'LIVE' && currentStatus !== 'UNDER_REVIEW') {
      setErrorMsg(`Scoring is locked because match status is ${currentStatus}.`);
      return;
    }

    if (!scoreState || scoreState.isCompleted) return;

    try {
      setSavingState('SAVING');
      setErrorMsg(null);
      const eventType = isA ? 'POINT_A' : 'POINT_B';
      const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 1. Calculate next state locally using rules
      const nextState = badmintonRules.applyEvent(scoreState, {
        id: clientEventId,
        type: eventType,
        timestamp: new Date().toISOString()
      });

      const nextService = nextState.currentServiceState;

      // 2. Persist to local IndexedDB queue
      const localEvent: OfflineMatchEvent = {
        client_event_id: clientEventId,
        match_id: matchId,
        event_type: eventType,
        local_order: matchEvents.length + pendingCount + 1,
        created_at: new Date().toISOString(),
        expected_server_sequence: matchEvents.length,
        server_player_id: nextService?.serverPlayerId || null,
        receiver_player_id: nextService?.receiverPlayerId || null,
        metadata: nextService || {},
        sync_status: 'PENDING',
        retry_count: 0
      };

      await enqueueOfflineEvent(localEvent);
      setScoreState(nextState);
      setPendingCount((prev) => prev + 1);

      // 3. If online, trigger reliable synchronization
      if (navigator.onLine) {
        triggerSync();
      }

      setSavingState('SAVED');
      setTimeout(() => setSavingState('IDLE'), 1500);
    } catch (err: any) {
      setSavingState('ERROR');
      setErrorMsg(err.message || 'Failed to submit score.');
    }
  };

  const handleUndo = async () => {
    const currentStatus = match?.status;
    if (currentStatus !== 'LIVE' && currentStatus !== 'UNDER_REVIEW') {
      setErrorMsg(`Scoring is locked because match status is ${currentStatus}.`);
      return;
    }

    if (isFootball) {
      if (!footballScoreState || footballScoreState.eventHistory.length === 0) return;
      await handleApplyFootballEvent('UNDO');
      return;
    }

    if (!scoreState || scoreState.eventHistory.length === 0) return;

    try {
      setErrorMsg(null);
      const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 1. Reconstruct state locally with UNDO
      const nextState = badmintonRules.applyEvent(scoreState, {
        id: clientEventId,
        type: 'UNDO',
        timestamp: new Date().toISOString()
      });

      // 2. Enqueue offline UNDO event
      const localEvent: OfflineMatchEvent = {
        client_event_id: clientEventId,
        match_id: matchId,
        event_type: 'UNDO',
        local_order: matchEvents.length + pendingCount + 1,
        created_at: new Date().toISOString(),
        expected_server_sequence: matchEvents.length,
        metadata: nextState.currentServiceState || {},
        sync_status: 'PENDING',
        retry_count: 0
      };

      await enqueueOfflineEvent(localEvent);
      setScoreState(nextState);
      setPendingCount((prev) => prev + 1);

      // 3. If online, sync
      if (navigator.onLine) {
        triggerSync();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to undo point.');
    }
  };

  const openServiceModal = () => {
    setErrorMsg(null);
    const isDoubles = match?.category?.category_type === 'DOUBLES';
    const currentService = scoreState?.currentServiceState;

    const pAIds = match?.participant_a?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];
    const pBIds = match?.participant_b?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];

    const curServingSide = currentService?.servingSide || 'A';
    setServiceSide(curServingSide);

    if (isDoubles) {
      const posA = currentService?.sideAPositions || { rightPlayerId: pAIds[0] || '', leftPlayerId: pAIds[1] || '' };
      const posB = currentService?.sideBPositions || { rightPlayerId: pBIds[0] || '', leftPlayerId: pBIds[1] || '' };

      setSideARightId(posA.rightPlayerId);
      setSideALeftId(posA.leftPlayerId);
      setSideBRightId(posB.rightPlayerId);
      setSideBLeftId(posB.leftPlayerId);

      setServiceServerId(currentService?.serverPlayerId || (curServingSide === 'A' ? posA.rightPlayerId : posB.rightPlayerId));
      setServiceReceiverId(currentService?.receiverPlayerId || (curServingSide === 'A' ? posB.rightPlayerId : posA.rightPlayerId));
    } else {
      setServiceServerId(curServingSide === 'A' ? pAIds[0] || '' : pBIds[0] || '');
      setServiceReceiverId(curServingSide === 'A' ? pBIds[0] || '' : pAIds[0] || '');
    }

    setShowServiceModal(true);
  };

  const handleSetService = async () => {
    try {
      setSubmittingService(true);
      setErrorMsg(null);

      const isDoubles = match?.category?.category_type === 'DOUBLES';
      const pAIds = match?.participant_a?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];
      const pBIds = match?.participant_b?.members?.map((m: any) => m.player?.id).filter(Boolean) || [];

      const serverId = serviceServerId || (serviceSide === 'A' ? pAIds[0] : pBIds[0]);
      const receiverId = serviceReceiverId || (serviceSide === 'A' ? pBIds[0] : pAIds[0]);

      let sideAPos: any = null;
      let sideBPos: any = null;

      if (isDoubles) {
        sideAPos = {
          rightPlayerId: sideARightId || pAIds[0],
          leftPlayerId: sideALeftId || pAIds[1]
        };
        sideBPos = {
          rightPlayerId: sideBRightId || pBIds[0],
          leftPlayerId: sideBLeftId || pBIds[1]
        };
      }

      const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `svc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const newServiceState: BadmintonServiceState = {
        matchType: isDoubles ? 'DOUBLES' : 'SINGLES',
        servingSide: serviceSide,
        receivingSide: serviceSide === 'A' ? 'B' : 'A',
        serverPlayerId: serverId,
        receiverPlayerId: receiverId,
        serverCourt: 'RIGHT',
        receiverCourt: 'RIGHT',
        sideAPositions: sideAPos,
        sideBPositions: sideBPos
      };

      const localEvent: OfflineMatchEvent = {
        client_event_id: clientEventId,
        match_id: matchId,
        event_type: 'SET_SERVICE',
        local_order: matchEvents.length + pendingCount + 1,
        created_at: new Date().toISOString(),
        expected_server_sequence: matchEvents.length,
        server_player_id: serverId,
        receiver_player_id: receiverId,
        metadata: newServiceState,
        sync_status: 'PENDING',
        retry_count: 0
      };

      await enqueueOfflineEvent(localEvent);

      if (scoreState) {
        const nextState = badmintonRules.applyEvent(scoreState, {
          id: clientEventId,
          type: 'SET_SERVICE',
          server_player_id: serverId,
          receiver_player_id: receiverId,
          metadata: newServiceState,
          timestamp: new Date().toISOString()
        } as any);
        setScoreState(nextState);
      }

      setPendingCount((prev) => prev + 1);
      setShowServiceModal(false);

      if (navigator.onLine) {
        triggerSync();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update service setup.');
    } finally {
      setSubmittingService(false);
    }
  };

  // Generic Match Lifecycle RPCs
  const startMatch = async () => {
    try {
      setErrorMsg(null);
      if (isFootball) {
        await handleApplyFootballEvent('START_FIRST_HALF');
      } else {
        const { error } = await supabase.rpc('start_match', { p_match_id: matchId });
        if (error) throw error;
      }
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start match.');
    }
  };

  const pauseMatch = async () => {
    try {
      setErrorMsg(null);
      if (isFootball) {
        await handleApplyFootballEvent('PAUSE_MATCH');
      } else {
        const { error } = await supabase.rpc('pause_match', { p_match_id: matchId });
        if (error) throw error;
      }
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to pause match.');
    }
  };

  const resumeMatch = async () => {
    try {
      setErrorMsg(null);
      if (isFootball) {
        await handleApplyFootballEvent('RESUME_MATCH');
      } else {
        const { error } = await supabase.rpc('resume_match', { p_match_id: matchId });
        if (error) throw error;
      }
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resume match.');
    }
  };

  const finalizeMatch = async () => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('finalize_match', { p_match_id: matchId });
      if (error) throw error;
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to finalize match.');
    }
  };

  const reopenMatch = async () => {
    try {
      setErrorMsg(null);
      const { error } = await supabase.rpc('reopen_match_for_correction', { p_match_id: matchId });
      if (error) throw error;
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reopen match.');
    }
  };

  const openOutcomeModal = () => {
    setErrorMsg(null);
    const hasEvents = matchEvents.length > 0;
    const isLiveOrPaused = match?.status === 'LIVE' || match?.status === 'PAUSED';

    if (hasEvents && isLiveOrPaused) {
      setSelectedOutcome('RETIREMENT');
    } else {
      setSelectedOutcome('WALKOVER');
    }

    if (!selectedWinnerId && match?.participant_a_id) {
      setSelectedWinnerId(match.participant_a_id);
    }
    setOutcomeNotes('');
    setShowOutcomeModal(true);
  };

  const handleDeclareOutcome = async () => {
    if (selectedOutcome !== 'ABANDONED' && !selectedWinnerId) {
      setErrorMsg('Please select the winner to advance.');
      return;
    }

    try {
      setSubmittingOutcome(true);
      setErrorMsg(null);

      if (isFootball) {
        const winnerSide = selectedWinnerId === match.participant_a_id ? 'A' : (selectedWinnerId === match.participant_b_id ? 'B' : undefined);
        await handleApplyFootballEvent('DECLARE_OUTCOME', {
          outcome: selectedOutcome,
          winnerId: selectedOutcome === 'ABANDONED' ? null : selectedWinnerId,
          winnerSide,
          reason: outcomeNotes || 'Match declared outcome',
          notes: outcomeNotes || null
        });
      } else {
        const retiringParticipantId = selectedOutcome === 'RETIREMENT'
          ? (selectedWinnerId === match.participant_a_id ? match.participant_b_id : match.participant_a_id)
          : null;

        const { error } = await supabase.rpc('declare_match_outcome', {
          p_match_id: matchId,
          p_outcome: selectedOutcome,
          p_winner_id: selectedWinnerId,
          p_retiring_participant_id: retiringParticipantId,
          p_notes: outcomeNotes || null
        });

        if (error) throw error;
      }

      setShowOutcomeModal(false);
      await loadMatchData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to declare match outcome.');
    } finally {
      setSubmittingOutcome(false);
    }
  };

  const handleExportScoreSheet = (format: ExportFormat) => {
    if (!match) return;
    try {
      const tableData = buildMatchScoreSheetReportData(
        match.category?.tournament || { name: 'Tournament' },
        match.category,
        match,
        match.games || [],
        matchEvents || []
      );
      const filenameBase = `${match.category?.tournament?.slug || 'tournament'}_match_${match.match_order || match.id}_scoresheet`;
      const { filename, mimeType, content } = exportTournamentReport(tableData, format, filenameBase);
      triggerBrowserDownload(content, filename, mimeType);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to export score sheet');
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] flex items-center justify-center text-[#667085]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#14966B] border-t-transparent mx-auto"></div>
          <p className="text-xs font-semibold">Loading scoring console...</p>
        </div>
      </div>
    );
  }

  if (errorMsg && !authorized) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] flex items-center justify-center p-4">
        <div className="pro-card p-6 max-w-md w-full text-center space-y-4 shadow-sm">
          <h2 className="text-lg font-bold text-[#B42318]">Access Denied</h2>
          <p className="text-xs text-[#667085]">{errorMsg}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="btn-primary w-full py-2.5 text-xs font-semibold"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const nameA = isFootball
    ? (match?.participant_a?.name || 'Team A')
    : (match?.participant_a?.members?.map((m: any) => m.player?.full_name).join(' & ') || 'Participant A');

  const nameB = isFootball
    ? (match?.participant_b?.name || 'Team B')
    : (match?.participant_b?.members?.map((m: any) => m.player?.full_name).join(' & ') || 'Participant B');

  const membersA = match?.participant_a?.members || [];
  const membersB = match?.participant_b?.members || [];

  const getPlayerName = (playerId?: string) => {
    if (!playerId) return 'Player';
    const allMembers = [...membersA, ...membersB];
    const member = allMembers.find((m: any) => m.player?.id === playerId);
    return member?.player?.full_name || member?.player?.display_name || 'Player';
  };

  const currentStatus = match?.status || 'SCHEDULED';
  const currentPhase = footballScoreState?.phase || match?.match_phase || 'PRE_MATCH';
  const isScoringActive = currentStatus === 'LIVE' || currentStatus === 'UNDER_REVIEW';
  const isOrganizer = user && match?.category?.tournament?.organizer_id === user.id;

  // Banner configurations with Outcome awareness
  const getBannerConfig = () => {
    if (match?.outcome === 'WALKOVER') {
      return {
        bg: 'bg-[#EEF4FF] border-[#C8DCFE]',
        text: 'text-[#3267D6]',
        label: 'COMPLETED (WALKOVER)',
        desc: 'Match won by walkover. Winner has been advanced in the bracket.'
      };
    }
    if (match?.outcome === 'RETIREMENT') {
      return {
        bg: 'bg-[#FEF6EE] border-[#F9DBAF]',
        text: 'text-[#C98218]',
        label: 'COMPLETED (RETIREMENT)',
        desc: 'Match concluded by retirement. Goals and points prior to retirement are preserved.'
      };
    }
    if (match?.outcome === 'DEFAULT') {
      return {
        bg: 'bg-[#FDF0F0] border-[#FDA29B]',
        text: 'text-[#B42318]',
        label: 'COMPLETED (DEFAULT)',
        desc: 'Match concluded by default / disqualification. Winner has been advanced in the bracket.'
      };
    }
    if (match?.outcome === 'ABANDONED' || currentStatus === 'POSTPONED') {
      return {
        bg: 'bg-[#FEF6EE] border-[#F9DBAF]',
        text: 'text-[#C98218]',
        label: 'MATCH ABANDONED (POSTPONED)',
        desc: 'Match was abandoned and postponed. No winner was declared.'
      };
    }

    const statusBanners: Record<string, { bg: string; text: string; label: string; desc: string }> = {
      SCHEDULED: {
        bg: 'bg-[#EEF4FF] border-[#C8DCFE]',
        text: 'text-[#3267D6]',
        label: 'SCHEDULED',
        desc: isFootball ? 'Match is scheduled. Set Starting XI lineups before kickoff.' : 'Match is scheduled but has not started yet. Ready to start.'
      },
      READY: {
        bg: 'bg-[#EEF4FF] border-[#C8DCFE]',
        text: 'text-[#3267D6]',
        label: 'READY',
        desc: isFootball ? 'Both teams assigned. Configure lineups or start First Half.' : 'Both participants are assigned and the match is ready to start.'
      },
      LIVE: {
        bg: 'bg-[#E8F5F0] border-[#C4E9DC]',
        text: 'text-[#14966B]',
        label: isFootball ? `LIVE — ${currentPhase.replace(/_/g, ' ')}` : 'LIVE',
        desc: 'Match is actively in progress. Scoring panels are enabled.'
      },
      PAUSED: {
        bg: 'bg-[#FEF6EE] border-[#F9DBAF]',
        text: 'text-[#C98218]',
        label: 'PAUSED',
        desc: 'Match is paused by the referee. Scoring is temporarily locked.'
      },
      COMPLETED: {
        bg: 'bg-[#EEF4FF] border-[#C8DCFE]',
        text: 'text-[#3267D6]',
        label: 'COMPLETED',
        desc: 'Match is completed. Winner has been advanced. Ready to finalize.'
      },
      FINAL: {
        bg: 'bg-[#F4F3FF] border-[#D9D6FE]',
        text: 'text-[#5925DC]',
        label: 'FINALIZED',
        desc: 'Match is finalized. Scores are locked. Only organizers can reopen.'
      },
      UNDER_REVIEW: {
        bg: 'bg-[#FEF6EE] border-[#F9DBAF]',
        text: 'text-[#C98218]',
        label: 'UNDER REVIEW',
        desc: 'Organizer/Admin correction mode. Scoring is temporarily unlocked.'
      },
      POSTPONED: {
        bg: 'bg-[#FEF6EE] border-[#F9DBAF]',
        text: 'text-[#C98218]',
        label: 'POSTPONED',
        desc: 'Match is postponed or abandoned.'
      }
    };

    return statusBanners[currentStatus] || {
      bg: 'bg-[#F9FAFB] border-[#EAECF0]',
      text: 'text-[#667085]',
      label: currentStatus,
      desc: 'Match is currently inactive.'
    };
  };

  const banner = getBannerConfig();
  const hasScoringPoints = matchEvents.some(e => e.type === 'POINT_A' || e.type === 'POINT_B' || e.type === 'GOAL' || e.type === 'OWN_GOAL');
  const isLiveOrPaused = currentStatus === 'LIVE' || currentStatus === 'PAUSED';

  const currentGame = scoreState?.games[scoreState.currentGameIndex] || { scoreA: 0, scoreB: 0, isCompleted: false };

  return (
    <div className="min-h-screen bg-transparent text-[#0F172A] flex flex-col">
      {/* Top Bar Header */}
      <header className="pro-glass-primary px-6 py-4 flex justify-between items-center shrink-0 sticky top-0 z-20 shadow-xs border-b border-white/80">
        <div className="space-y-0.5">
          <span className="text-[10px] text-[#14966B] font-extrabold uppercase tracking-wider">
            {match?.category?.tournament?.name || 'Tournament'} • {isFootball ? 'Football' : 'Badminton'}
          </span>
          <h1 className="text-sm font-extrabold text-[#0F172A]">
            {match?.category?.name} — Scoring Console
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Offline Sync Status Badge */}
          {syncState === 'OFFLINE' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FEF6EE]/90 border border-[#F9DBAF] text-[10px] font-bold tracking-wider uppercase text-[#C98218] backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#C98218]" />
              <span>OFFLINE {pendingCount > 0 ? `(${pendingCount} QUEUED)` : ''}</span>
            </div>
          )}
          {syncState === 'SYNCING' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50/90 border border-blue-200 text-[10px] font-bold tracking-wider uppercase text-blue-700 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-spin" />
              <span>SYNCING...</span>
            </div>
          )}
          {syncState === 'CONFLICT' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FDF0F0]/90 border border-[#FDA29B] text-[10px] font-bold tracking-wider uppercase text-[#B42318] backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#B42318]" />
              <span>CONFLICT</span>
            </div>
          )}
          {syncState === 'SYNCED' && pendingCount === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50/90 border border-emerald-200 text-[10px] font-bold tracking-wider uppercase text-[#14966B] backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#14966B]" />
              <span>SYNCED</span>
            </div>
          )}
          {pendingCount > 0 && syncState !== 'OFFLINE' && syncState !== 'SYNCING' && syncState !== 'CONFLICT' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FEF6EE]/90 border border-[#F9DBAF] text-[10px] font-bold tracking-wider uppercase text-[#C98218] backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#C98218]" />
              <span>{pendingCount} QUEUED</span>
            </div>
          )}

          {/* Saving Status Indicator */}
          {savingState !== 'IDLE' && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold tracking-wider backdrop-blur-md ${
              savingState === 'SAVING' ? 'bg-[#FEF6EE]/90 border border-[#F9DBAF] text-[#C98218]' :
              savingState === 'SAVED' ? 'bg-emerald-50/90 border border-emerald-200 text-[#14966B]' :
              'bg-[#FDF0F0]/90 border border-[#FDA29B] text-[#B42318]'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                savingState === 'SAVING' ? 'bg-[#C98218]' :
                savingState === 'SAVED' ? 'bg-[#14966B]' : 'bg-[#B42318]'
              }`} />
              <span>
                {savingState === 'SAVING' ? 'Saving...' :
                 savingState === 'SAVED' ? 'Saved' : 'Save Error'}
              </span>
            </div>
          )}

          {/* Connection Status Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50/90 border border-emerald-200 text-[10px] font-bold tracking-wider uppercase text-[#14966B] backdrop-blur-md" role="status" aria-live="polite">
            <span className={`w-2 h-2 rounded-full ${
              connStatus === 'CONNECTED' ? 'bg-[#14966B]' :
              connStatus === 'RECONNECTING' ? 'bg-[#C98218]' : 'bg-[#C94A4A]'
            }`} />
            <span>
              {connStatus}
            </span>
          </div>

          {/* Export Score Sheet Buttons */}
          <div className="hidden sm:inline-flex items-center rounded-lg border border-slate-200 bg-white/80 backdrop-blur-md p-0.5 shadow-2xs">
            <button
              onClick={() => handleExportScoreSheet('pdf')}
              className="px-2.5 py-1 rounded text-[10px] font-bold text-[#14966B] hover:bg-emerald-50 transition"
              title="Download PDF Score Sheet"
            >
              Score Sheet PDF
            </button>
            <span className="w-px h-3 bg-slate-200" />
            <button
              onClick={() => handleExportScoreSheet('csv')}
              className="px-2 py-1 rounded text-[10px] font-bold text-[#64748B] hover:bg-slate-100 transition"
              title="Download CSV Score Sheet"
            >
              CSV
            </button>
          </div>

          <button
            onClick={() => router.push(`/tournaments/${match?.category?.tournament?.id}/configure`)}
            className="btn-secondary text-xs px-3.5 py-1.5"
            aria-label="Close Scoring Console"
          >
            Close Console
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full justify-center">
        {conflictReason && (
          <div className="bg-[#FDF0F0] border border-[#FDA29B] text-[#B42318] rounded-md p-3 text-xs font-semibold flex justify-between items-center" role="alert">
            <div>
              <p className="font-bold">Synchronization Conflict</p>
              <p>{conflictReason}</p>
            </div>
            <button
              onClick={() => { setConflictReason(null); loadMatchData(); }}
              className="px-2.5 py-1 rounded bg-[#B42318] text-white text-[10px] font-bold hover:bg-[#912018]"
            >
              Reconcile
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="bg-[#FDF0F0] border border-[#FDA29B] text-[#B42318] rounded-md p-3 text-xs font-semibold" role="alert">
            {errorMsg}
          </div>
        )}

        {/* Dynamic Match Status Banner */}
        <div className={`border rounded-xl p-4 flex flex-col md:flex-row justify-between items-center gap-4 ${banner.bg}`}>
          <div className="space-y-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <span className={`text-xs font-extrabold uppercase tracking-wider ${banner.text}`}>
                {banner.label}
              </span>
              {match?.outcome && (
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-white/80 border border-current">
                  {match.outcome}
                </span>
              )}
            </div>
            <p className="text-xs text-[#475467]">{banner.desc}</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center">
            {/* Start Match / Kickoff Button */}
            {(currentStatus === 'SCHEDULED' || currentStatus === 'READY') && (
              <button
                onClick={startMatch}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
                aria-label="Start Match"
              >
                {isFootball ? '⚽ Start First Half (Kickoff)' : 'Start Match'}
              </button>
            )}

            {/* Lineup Modal Trigger (Football) */}
            {isFootball && (currentStatus === 'SCHEDULED' || currentStatus === 'READY' || currentStatus === 'LIVE' || currentStatus === 'UNDER_REVIEW') && (
              <button
                onClick={() => setShowLineupModal(true)}
                className="bg-[#E8F5F0] hover:bg-[#D1EEDB] text-[#14966B] border border-[#C4E9DC] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                aria-label="Configure Starting XI"
              >
                <span>📋</span>
                <span>Starting Lineups</span>
              </button>
            )}

            {/* Football Period Progression Controls */}
            {isFootball && currentStatus === 'LIVE' && currentPhase === 'FIRST_HALF' && (
              <button
                onClick={() => handleApplyFootballEvent('END_FIRST_HALF')}
                className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
              >
                ⏱️ End 1st Half (Halftime)
              </button>
            )}

            {isFootball && currentPhase === 'HALFTIME' && (
              <button
                onClick={() => handleApplyFootballEvent('START_SECOND_HALF')}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
              >
                ⚽ Start Second Half
              </button>
            )}

            {isFootball && currentStatus === 'LIVE' && currentPhase === 'SECOND_HALF' && (
              <button
                onClick={() => handleApplyFootballEvent('END_SECOND_HALF')}
                className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
              >
                ⏱️ End 2nd Half (Full Time)
              </button>
            )}

            {/* Extra Time & Shootout Triggers */}
            {isFootball && currentPhase === 'FULL_TIME' && match?.category?.rules_config?.extraTimeEnabled && (
              <button
                onClick={() => handleApplyFootballEvent('START_EXTRA_TIME_FIRST_HALF')}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
              >
                ⏱️ Start Extra Time
              </button>
            )}

            {isFootball && currentPhase === 'EXTRA_TIME_FIRST_HALF' && currentStatus === 'LIVE' && (
              <button
                onClick={() => handleApplyFootballEvent('END_EXTRA_TIME_FIRST_HALF')}
                className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
              >
                End ET 1st Half
              </button>
            )}

            {isFootball && currentPhase === 'EXTRA_TIME_HALFTIME' && (
              <button
                onClick={() => handleApplyFootballEvent('START_EXTRA_TIME_SECOND_HALF')}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
              >
                Start ET 2nd Half
              </button>
            )}

            {isFootball && currentPhase === 'EXTRA_TIME_SECOND_HALF' && currentStatus === 'LIVE' && (
              <button
                onClick={() => handleApplyFootballEvent('END_EXTRA_TIME_SECOND_HALF')}
                className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
              >
                End Extra Time
              </button>
            )}

            {isFootball && (currentPhase === 'FULL_TIME' || currentPhase === 'EXTRA_TIME_END') && match?.category?.rules_config?.penaltyShootoutEnabled && (
              <button
                onClick={() => handleApplyFootballEvent('START_PENALTY_SHOOTOUT')}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
              >
                🥅 Start Penalty Shootout
              </button>
            )}

            {isFootball && currentPhase === 'PENALTY_SHOOTOUT' && !footballScoreState?.shootoutState?.isCompleted && (
              <button
                onClick={() => setShowShootoutModal(true)}
                className="bg-[#14966B] hover:bg-[#0E7050] text-white font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
              >
                + Log Penalty Kick
              </button>
            )}

            {/* Service Setup Button (Badminton) */}
            {!isFootball && (currentStatus === 'SCHEDULED' || currentStatus === 'READY' || currentStatus === 'LIVE' || currentStatus === 'UNDER_REVIEW') && (
              <button
                onClick={openServiceModal}
                className="bg-[#E8F5F0] hover:bg-[#D1EEDB] text-[#14966B] border border-[#C4E9DC] font-bold text-xs px-3.5 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                aria-label="Service Setup"
              >
                <span>🏸</span>
                <span>Service Setup</span>
              </button>
            )}

            {/* Pause Match Button */}
            {currentStatus === 'LIVE' && (
              <button
                onClick={pauseMatch}
                className="bg-[#FEF6EE] hover:bg-[#FEE4E2] text-[#C98218] border border-[#F9DBAF] font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
                aria-label="Pause Match"
              >
                Pause Match
              </button>
            )}

            {/* Resume Match Button */}
            {currentStatus === 'PAUSED' && (
              <button
                onClick={resumeMatch}
                className="btn-primary font-bold text-xs px-4 py-2.5 min-h-[44px] uppercase tracking-wider"
                aria-label="Resume Match"
              >
                Resume Match
              </button>
            )}

            {/* Declare Outcome Button */}
            {(currentStatus === 'SCHEDULED' || currentStatus === 'READY' || currentStatus === 'LIVE' || currentStatus === 'PAUSED') && (
              <button
                onClick={openOutcomeModal}
                className="bg-[#F4F3FF] hover:bg-[#EBE9FE] text-[#5925DC] border border-[#D9D6FE] font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
                aria-label="Declare Outcome"
              >
                Declare Outcome
              </button>
            )}

            {/* Finalize Match Button */}
            {(currentStatus === 'COMPLETED' || currentStatus === 'UNDER_REVIEW') && (
              <button
                onClick={finalizeMatch}
                className="bg-[#3267D6] hover:bg-[#2854B2] text-white font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
                aria-label="Finalize Match"
              >
                Finalize Match
              </button>
            )}

            {/* Reopen for Correction Button */}
            {currentStatus === 'FINAL' && isOrganizer && (
              <button
                onClick={reopenMatch}
                className="bg-[#FEF6EE] hover:bg-[#F9DBAF] text-[#C98218] border border-[#F9DBAF] font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-md transition uppercase tracking-wider shadow-sm"
                aria-label="Reopen Match for Correction"
              >
                Reopen for Correction
              </button>
            )}
          </div>
        </div>

        {/* Lock Explanation Banner */}
        {!isScoringActive && (
          <div className="bg-[#FEF6EE] border border-[#F9DBAF] text-[#C98218] rounded-lg p-3 text-center text-xs font-semibold">
            ⚠️ Scoring panels are disabled because the match is not in a live scoring state. Start or Resume the match to log points or events.
          </div>
        )}

        {/* FOOTBALL SCOREBOARD & PANELS */}
        {isFootball ? (
          <div className="space-y-6">
            {/* Phase & Snapshot Indicators */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-[#475467]">
              <span className="bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] px-3 py-1 rounded-full uppercase tracking-widest text-[10px]">
                Phase: {currentPhase.replace(/_/g, ' ')}
              </span>
              {footballScoreState?.halftimeScore && (
                <span className="bg-[#F2F4F7] text-[#344054] px-2.5 py-1 rounded-md border border-[#EAECF0] text-[11px]">
                  HT: {footballScoreState.halftimeScore.scoreA} - {footballScoreState.halftimeScore.scoreB}
                </span>
              )}
              {footballScoreState?.extraTimeScore && (
                <span className="bg-[#F2F4F7] text-[#344054] px-2.5 py-1 rounded-md border border-[#EAECF0] text-[11px]">
                  ET: {footballScoreState.extraTimeScore.scoreA} - {footballScoreState.extraTimeScore.scoreB}
                </span>
              )}
              {footballScoreState?.shootoutState && (
                <span className="bg-[#E8F5F0] text-[#14966B] px-2.5 py-1 rounded-md border border-[#C4E9DC] text-[11px]">
                  Shootout: {footballScoreState.shootoutState.scoreA} - {footballScoreState.shootoutState.scoreB}
                </span>
              )}
            </div>

            {/* Big Score Cards Grid */}
            <div className="grid md:grid-cols-2 gap-4 sm:gap-6 flex-1 items-stretch">
              {/* Team A Card */}
              <div className="scoreboard-card p-6 min-h-[240px] flex flex-col justify-between text-center border-2 border-[#E4E7EC] shadow-sm">
                <div className="flex flex-col items-center gap-1 w-full">
                  <span className="text-base text-[#172033] font-extrabold block truncate w-full">{nameA}</span>
                  <span className="text-[10px] text-[#667085] uppercase tracking-wider font-bold bg-[#F2F4F7] px-2 py-0.5 rounded border border-[#EAECF0]">Team A</span>
                </div>

                <div className="text-7xl sm:text-8xl font-black font-mono text-[#172033] my-3 tracking-tighter tabular-nums select-none">
                  {footballScoreState?.scoreA ?? match?.score_a ?? 0}
                </div>

                {/* Team A In-game Action Buttons */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setGoalTeam('A'); setShowGoalModal(true); }}
                    className="btn-primary text-xs py-2.5 min-h-[44px] disabled:opacity-40 font-bold shadow-2xs cursor-pointer"
                  >
                    ⚽ + Goal
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setOwnGoalConcedingTeam('A'); setShowOwnGoalModal(true); }}
                    className="bg-[#FEF6EE] hover:bg-[#F9DBAF] text-[#C98218] border border-[#F9DBAF] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🥅 + Own Goal
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setCardTeam('A'); setShowCardModal(true); }}
                    className="bg-[#FEF0C7] hover:bg-[#FEE4E2] text-[#B54708] border border-[#FEDF89] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🟨 / 🟥 Card
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setSubTeam('A'); setShowSubModal(true); }}
                    className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🔄 Sub ({footballScoreState?.teamAState?.substitutionsCount || 0}/5)
                  </button>
                </div>
              </div>

              {/* Team B Card */}
              <div className="scoreboard-card p-6 min-h-[240px] flex flex-col justify-between text-center border-2 border-[#E4E7EC] shadow-sm">
                <div className="flex flex-col items-center gap-1 w-full">
                  <span className="text-base text-[#172033] font-extrabold block truncate w-full">{nameB}</span>
                  <span className="text-[10px] text-[#667085] uppercase tracking-wider font-bold bg-[#F2F4F7] px-2 py-0.5 rounded border border-[#EAECF0]">Team B</span>
                </div>

                <div className="text-7xl sm:text-8xl font-black font-mono text-[#172033] my-3 tracking-tighter tabular-nums select-none">
                  {footballScoreState?.scoreB ?? match?.score_b ?? 0}
                </div>

                {/* Team B In-game Action Buttons */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setGoalTeam('B'); setShowGoalModal(true); }}
                    className="btn-primary text-xs py-2.5 min-h-[44px] disabled:opacity-40 font-bold shadow-2xs cursor-pointer"
                  >
                    ⚽ + Goal
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setOwnGoalConcedingTeam('B'); setShowOwnGoalModal(true); }}
                    className="bg-[#FEF6EE] hover:bg-[#F9DBAF] text-[#C98218] border border-[#F9DBAF] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🥅 + Own Goal
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setCardTeam('B'); setShowCardModal(true); }}
                    className="bg-[#FEF0C7] hover:bg-[#FEE4E2] text-[#B54708] border border-[#FEDF89] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🟨 / 🟥 Card
                  </button>
                  <button
                    disabled={!isScoringActive || footballScoreState?.isCompleted}
                    onClick={() => { setSubTeam('B'); setShowSubModal(true); }}
                    className="bg-[#EEF4FF] hover:bg-[#D9E6FE] text-[#3267D6] border border-[#C8DCFE] font-bold text-xs py-2.5 min-h-[44px] rounded-lg disabled:opacity-40 shadow-2xs cursor-pointer transition"
                  >
                    🔄 Sub ({footballScoreState?.teamBState?.substitutionsCount || 0}/5)
                  </button>
                </div>
              </div>
            </div>

            {/* Active Lineup Summary & Pitch State */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="pro-card p-4 space-y-2">
                <span className="text-[11px] font-bold text-[#344054] uppercase tracking-wider block">
                  {nameA} — Active on Pitch ({footballScoreState?.teamAState?.activePlayersOnPitch?.length || 0})
                </span>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {footballScoreState?.teamAState?.activePlayersOnPitch?.map((pid) => (
                    <span key={pid} className="bg-[#F2F4F7] border border-[#EAECF0] px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1">
                      {getPlayerName(pid)}
                      {footballScoreState.teamAState.captainId === pid && <span className="text-[#14966B] font-bold text-[9px]">Ⓒ</span>}
                      {footballScoreState.teamAState.yellowCards[pid] > 0 && <span className="text-[#B54708] text-[9px]">🟨</span>}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pro-card p-4 space-y-2">
                <span className="text-[11px] font-bold text-[#344054] uppercase tracking-wider block">
                  {nameB} — Active on Pitch ({footballScoreState?.teamBState?.activePlayersOnPitch?.length || 0})
                </span>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {footballScoreState?.teamBState?.activePlayersOnPitch?.map((pid) => (
                    <span key={pid} className="bg-[#F2F4F7] border border-[#EAECF0] px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1">
                      {getPlayerName(pid)}
                      {footballScoreState.teamBState.captainId === pid && <span className="text-[#14966B] font-bold text-[9px]">Ⓒ</span>}
                      {footballScoreState.teamBState.yellowCards[pid] > 0 && <span className="text-[#B54708] text-[9px]">🟨</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Match Event Timeline Summary */}
            <div className="pro-card p-4 space-y-3">
              <span className="text-[10px] text-[#667085] uppercase tracking-widest font-bold block">Match Timeline Events ({matchEvents.length})</span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2">
                {matchEvents.length === 0 ? (
                  <p className="text-xs text-[#98A2B3]">No match events recorded yet.</p>
                ) : (
                  matchEvents.map((ev, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-[#F9FAFB] border border-[#EAECF0]">
                      <span className="font-bold text-[#344054]">
                        {ev.event_type === 'GOAL' ? `⚽ Goal (${ev.metadata?.minute}') — ${getPlayerName(ev.metadata?.scorerPlayerId)}` :
                         ev.event_type === 'OWN_GOAL' ? `🥅 Own Goal (${ev.metadata?.minute}') — ${getPlayerName(ev.metadata?.playerPlayerId)}` :
                         ev.event_type === 'YELLOW_CARD' ? `🟨 Yellow Card (${ev.metadata?.minute}') — ${getPlayerName(ev.metadata?.playerId)}` :
                         ev.event_type === 'RED_CARD' ? `🟥 Red Card (${ev.metadata?.minute}') — ${getPlayerName(ev.metadata?.playerId)}` :
                         ev.event_type === 'SUBSTITUTION' ? `🔄 Sub (${ev.metadata?.minute}') — Off: ${getPlayerName(ev.metadata?.playerOffId)} ➔ On: ${getPlayerName(ev.metadata?.playerOnId)}` :
                         ev.event_type === 'PENALTY_KICK' ? `🥅 Penalty Kick — ${getPlayerName(ev.metadata?.kickerPlayerId)} (${ev.metadata?.scored ? 'Scored' : 'Missed'})` :
                         ev.event_type}
                      </span>
                      <span className="text-[10px] text-[#98A2B3]">Seq #{ev.sequence_number || idx + 1}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* BADMINTON SCOREBOARD & PANELS */
          <div className="space-y-6">
            {/* Active Service Status Bar */}
            {scoreState?.currentServiceState && (
              <div className="bg-white border border-[#E4E7EC] rounded-xl p-3.5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14966B] live-dot-slow" />
                  <span className="font-bold text-[#344054] uppercase tracking-wider text-[11px]">Active Service:</span>
                  <span className="font-bold text-[#14966B] bg-[#E8F5F0] px-2.5 py-1 rounded-md border border-[#C4E9DC]">
                    🏸 Server: {getPlayerName(scoreState.currentServiceState.serverPlayerId)} ({scoreState.currentServiceState.serverCourt} Court)
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
                  <span className="text-[#667085] font-bold">➔</span>
                  <span className="font-bold text-[#3267D6] bg-[#EEF4FF] px-2.5 py-1 rounded-md border border-[#C8DCFE]">
                    Receiver: {getPlayerName(scoreState.currentServiceState.receiverPlayerId)} ({scoreState.currentServiceState.receiverCourt} Court)
                  </span>
                </div>
              </div>
            )}

            {/* Large Display Game Info */}
            <div className="text-center space-y-1">
              <span className="bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                Game {scoreState ? scoreState.currentGameIndex + 1 : 1}
              </span>
            </div>

            {/* Scoring Panels Grid */}
            <div className="grid md:grid-cols-2 gap-4 sm:gap-6 flex-1 items-stretch" role="region" aria-label="Scoring Panels">
              {/* Side A */}
              <button
                disabled={!isScoringActive || scoreState?.isCompleted}
                onClick={() => handleScorePoint(true)}
                aria-label={`Score Point for ${nameA}. Current score: ${currentGame.scoreA}`}
                className={`scoreboard-card p-6 min-h-[180px] md:min-h-[240px] flex flex-col justify-between text-center transition group relative active:scale-[0.98] ${
                  isScoringActive && !scoreState?.isCompleted
                    ? 'border-2 border-[#E4E7EC] hover:border-[#14966B] focus:ring-2 focus:ring-[#14966B] focus:outline-none cursor-pointer shadow-sm hover:shadow-md'
                    : 'opacity-50 cursor-not-allowed border-2 border-[#EAECF0]'
                }`}
              >
                <div className="flex flex-col items-center gap-1 w-full">
                  <span className="text-base text-[#172033] font-extrabold block truncate w-full">{nameA}</span>
                  {scoreState?.currentServiceState?.servingSide === 'A' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-[#14966B] text-white tracking-wider shadow-sm">
                      ● SERVING ({scoreState.currentServiceState.serverCourt})
                    </span>
                  )}
                  {scoreState?.currentServiceState?.receivingSide === 'A' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] tracking-wider">
                      RECEIVING ({scoreState.currentServiceState.receiverCourt})
                    </span>
                  )}
                </div>

                <div className={`text-7xl sm:text-8xl font-black font-mono text-[#172033] my-3 tracking-tighter tabular-nums select-none ${isScoringActive && 'group-hover:text-[#14966B]'}`}>
                  {currentGame.scoreA}
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider block py-1 px-3 rounded-md self-center ${isScoringActive ? 'text-[#14966B] bg-[#E8F6F0]' : 'text-[#98A2B3] bg-[#F2F4F7]'}`}>
                  {isScoringActive ? '+1 Point A' : 'Locked'}
                </span>
              </button>

              {/* Side B */}
              <button
                disabled={!isScoringActive || scoreState?.isCompleted}
                onClick={() => handleScorePoint(false)}
                aria-label={`Score Point for ${nameB}. Current score: ${currentGame.scoreB}`}
                className={`scoreboard-card p-6 min-h-[180px] md:min-h-[240px] flex flex-col justify-between text-center transition group relative active:scale-[0.98] ${
                  isScoringActive && !scoreState?.isCompleted
                    ? 'border-2 border-[#E4E7EC] hover:border-[#14966B] focus:ring-2 focus:ring-[#14966B] focus:outline-none cursor-pointer shadow-sm hover:shadow-md'
                    : 'opacity-50 cursor-not-allowed border-2 border-[#EAECF0]'
                }`}
              >
                <div className="flex flex-col items-center gap-1 w-full">
                  <span className="text-base text-[#172033] font-extrabold block truncate w-full">{nameB}</span>
                  {scoreState?.currentServiceState?.servingSide === 'B' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-[#14966B] text-white tracking-wider shadow-sm">
                      ● SERVING ({scoreState.currentServiceState.serverCourt})
                    </span>
                  )}
                  {scoreState?.currentServiceState?.receivingSide === 'B' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE] tracking-wider">
                      RECEIVING ({scoreState.currentServiceState.receiverCourt})
                    </span>
                  )}
                </div>

                <div className={`text-7xl sm:text-8xl font-black font-mono text-[#172033] my-3 tracking-tighter tabular-nums select-none ${isScoringActive && 'group-hover:text-[#14966B]'}`}>
                  {currentGame.scoreB}
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider block py-1 px-3 rounded-md self-center ${isScoringActive ? 'text-[#14966B] bg-[#E8F6F0]' : 'text-[#98A2B3] bg-[#F2F4F7]'}`}>
                  {isScoringActive ? '+1 Point B' : 'Locked'}
                </span>
              </button>
            </div>

            {/* Historic Game Results Row */}
            <div className="pro-card p-4 flex flex-col space-y-2">
              <span className="text-[10px] text-[#667085] uppercase tracking-widest font-bold block">Games Summary</span>
              <div className="flex flex-wrap gap-3 text-xs font-semibold text-[#344054]">
                {scoreState?.games.map((g, idx) => (
                  <div key={idx} className="bg-[#F9FAFB] px-3 py-1.5 rounded-md border border-[#EAECF0]">
                    Game {idx + 1}: <span className={g.isCompleted ? 'text-[#14966B] font-bold' : 'text-[#3267D6] font-bold'}>{g.scoreA} - {g.scoreB}</span>
                    {g.isCompleted && <span className="text-[10px] text-[#667085] ml-1">({g.winnerId === 'PARTICIPANT_A' ? 'A' : 'B'} win)</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Undo Controls Bar */}
        <div className="flex gap-4 shrink-0">
          <button
            onClick={handleUndo}
            disabled={!isScoringActive || matchEvents.length === 0}
            className="flex-1 bg-white hover:bg-[#F9FAFB] disabled:opacity-40 text-[#C98218] font-bold text-xs py-3 rounded-lg border border-[#F9DBAF] transition uppercase tracking-wider shadow-sm min-h-[44px] cursor-pointer flex items-center justify-center gap-2"
          >
            <span>↩</span>
            <span>Undo Last Event ({matchEvents.filter(e => e.type !== 'UNDO').length})</span>
          </button>
        </div>
      </main>

      {/* ========================================== */}
      {/* FOOTBALL STARTING LINEUP CONFIG MODAL */}
      {/* ========================================== */}
      {showLineupModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">📋 Configure Football Lineup</h3>
                <p className="text-[11px] text-[#667085]">Standard 11 Starters + Bench Substitutes</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLineupModal(false)}
                className="text-[#667085] hover:text-[#172033] text-sm font-bold p-1"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Team Selector Tabs */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLineupTeam('A')}
                className={`py-2 px-3 text-xs font-bold rounded-lg border transition ${
                  lineupTeam === 'A' ? 'bg-[#E8F5F0] border-[#14966B] text-[#14966B]' : 'border-[#EAECF0] text-[#344054]'
                }`}
              >
                {nameA} (Team A)
              </button>
              <button
                type="button"
                onClick={() => setLineupTeam('B')}
                className={`py-2 px-3 text-xs font-bold rounded-lg border transition ${
                  lineupTeam === 'B' ? 'bg-[#E8F5F0] border-[#14966B] text-[#14966B]' : 'border-[#EAECF0] text-[#344054]'
                }`}
              >
                {nameB} (Team B)
              </button>
            </div>

            {/* Squad Members Selection */}
            {(() => {
              const currentMembers = lineupTeam === 'A' ? membersA : membersB;
              const currentStarters = lineupTeam === 'A' ? selectedStartersA : selectedStartersB;
              const currentSubs = lineupTeam === 'A' ? selectedSubsA : selectedSubsB;
              const currentCaptain = lineupTeam === 'A' ? selectedCaptainA : selectedCaptainB;
              const setStarters = lineupTeam === 'A' ? setSelectedStartersA : setSelectedStartersB;
              const setSubs = lineupTeam === 'A' ? setSelectedSubsA : setSelectedSubsB;
              const setCaptain = lineupTeam === 'A' ? setSelectedCaptainA : setSelectedCaptainB;
              const expectedCount = match?.category?.rules_config?.playersPerTeam ?? 11;

              return (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#344054]">
                      Starting XI ({currentStarters.length}/{expectedCount} Selected)
                    </span>
                    {currentStarters.length === expectedCount ? (
                      <span className="text-[10px] text-[#14966B] font-bold">✓ Exactly {expectedCount} Selected</span>
                    ) : (
                      <span className="text-[10px] text-[#B42318] font-bold">Need {expectedCount - currentStarters.length} more</span>
                    )}
                  </div>

                  {/* Player Checklist */}
                  <div className="border border-[#EAECF0] rounded-lg divide-y divide-[#EAECF0] max-h-60 overflow-y-auto">
                    {currentMembers.map((m: any) => {
                      const pid = m.player?.id;
                      const isStarter = currentStarters.includes(pid);
                      const isSub = currentSubs.includes(pid);
                      const isSuspended = m.status === 'SUSPENDED';

                      return (
                        <div key={pid} className={`p-2.5 flex items-center justify-between text-xs ${isSuspended ? 'opacity-40 bg-[#FDF0F0]' : ''}`}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] bg-[#F2F4F7] px-1.5 py-0.5 rounded text-[#344054] font-bold">
                              #{m.jersey_number || '—'}
                            </span>
                            <span className="font-semibold text-[#172033]">{m.player?.full_name}</span>
                            <span className="text-[10px] text-[#667085] uppercase">({m.position || 'PLAYER'})</span>
                            {isSuspended && <span className="text-[9px] font-bold text-[#B42318] bg-[#FDF0F0] px-1 rounded">SUSPENDED</span>}
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Starter Button */}
                            <button
                              type="button"
                              disabled={isSuspended}
                              onClick={() => {
                                if (isStarter) {
                                  setStarters(currentStarters.filter(id => id !== pid));
                                  if (currentCaptain === pid) setCaptain('');
                                } else {
                                  if (currentStarters.length >= expectedCount) {
                                    setErrorMsg(`Starting XI already has ${expectedCount} players.`);
                                    return;
                                  }
                                  setStarters([...currentStarters, pid]);
                                  setSubs(currentSubs.filter(id => id !== pid));
                                  if (!currentCaptain) setCaptain(pid);
                                }
                              }}
                              className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                                isStarter ? 'bg-[#14966B] text-white' : 'bg-[#F2F4F7] text-[#344054] hover:bg-[#EAECF0]'
                              }`}
                            >
                              {isStarter ? 'Starter XI ✓' : 'Add Starter'}
                            </button>

                            {/* Bench Sub Button */}
                            <button
                              type="button"
                              disabled={isSuspended}
                              onClick={() => {
                                if (isSub) {
                                  setSubs(currentSubs.filter(id => id !== pid));
                                } else {
                                  setSubs([...currentSubs, pid]);
                                  setStarters(currentStarters.filter(id => id !== pid));
                                  if (currentCaptain === pid) setCaptain('');
                                }
                              }}
                              className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                                isSub ? 'bg-[#3267D6] text-white' : 'bg-[#F2F4F7] text-[#667085] hover:bg-[#EAECF0]'
                              }`}
                            >
                              {isSub ? 'Bench ✓' : 'Bench'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Captain Selector */}
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-[#344054]">Select Team Captain * (Must be Starter)</label>
                    <select
                      value={currentCaptain}
                      onChange={(e) => setCaptain(e.target.value)}
                      className="arena-input text-xs py-2 w-full"
                    >
                      <option value="">-- Choose Captain --</option>
                      {currentStarters.map((pid) => (
                        <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })()}

            {/* Modal Actions */}
            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button
                type="button"
                onClick={() => setShowLineupModal(false)}
                disabled={submittingLineup}
                className="btn-secondary flex-1 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveFootballLineup}
                disabled={submittingLineup}
                className="btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-2"
              >
                {submittingLineup ? 'Saving Lineup...' : `Confirm ${nameA} Lineup`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* FOOTBALL GOAL MODAL */}
      {/* ========================================== */}
      {showGoalModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">⚽ Record Goal</h3>
                <p className="text-[11px] text-[#667085]">{goalTeam === 'A' ? nameA : nameB}</p>
              </div>
              <button type="button" onClick={() => setShowGoalModal(false)} className="text-[#667085] font-bold p-1">✕</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Goal Scorer *</label>
                <select
                  value={goalScorerId}
                  onChange={(e) => setGoalScorerId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Scorer --</option>
                  {(goalTeam === 'A' ? footballScoreState?.teamAState?.activePlayersOnPitch : footballScoreState?.teamBState?.activePlayersOnPitch)?.map((pid) => (
                    <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Assist Player (Optional)</label>
                <select
                  value={goalAssistId}
                  onChange={(e) => setGoalAssistId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- No Assist / Unassisted --</option>
                  {(goalTeam === 'A' ? footballScoreState?.teamAState?.activePlayersOnPitch : footballScoreState?.teamBState?.activePlayersOnPitch)
                    ?.filter(pid => pid !== goalScorerId)
                    ?.map((pid) => (
                      <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Match Minute *</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={goalMinute}
                  onChange={(e) => setGoalMinute(Number(e.target.value))}
                  className="arena-input text-xs py-2 w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button type="button" onClick={() => setShowGoalModal(false)} className="btn-secondary flex-1 py-2 text-xs">Cancel</button>
              <button type="button" onClick={handleGoalSubmit} className="btn-primary flex-1 py-2 text-xs">Record Goal ⚽</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* FOOTBALL OWN GOAL MODAL */}
      {/* ========================================== */}
      {showOwnGoalModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">🥅 Record Own Goal</h3>
                <p className="text-[11px] text-[#667085]">Conceding Team: {ownGoalConcedingTeam === 'A' ? nameA : nameB} (Credits opponent)</p>
              </div>
              <button type="button" onClick={() => setShowOwnGoalModal(false)} className="text-[#667085] font-bold p-1">✕</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Conceding Player *</label>
                <select
                  value={ownGoalPlayerId}
                  onChange={(e) => setOwnGoalPlayerId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Player --</option>
                  {(ownGoalConcedingTeam === 'A' ? footballScoreState?.teamAState?.activePlayersOnPitch : footballScoreState?.teamBState?.activePlayersOnPitch)?.map((pid) => (
                    <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Match Minute *</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={ownGoalMinute}
                  onChange={(e) => setOwnGoalMinute(Number(e.target.value))}
                  className="arena-input text-xs py-2 w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button type="button" onClick={() => setShowOwnGoalModal(false)} className="btn-secondary flex-1 py-2 text-xs">Cancel</button>
              <button type="button" onClick={handleOwnGoalSubmit} className="btn-primary flex-1 py-2 text-xs">Record Own Goal</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* FOOTBALL CARD MODAL */}
      {/* ========================================== */}
      {showCardModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">🟨 / 🟥 Discipline Card</h3>
                <p className="text-[11px] text-[#667085]">{cardTeam === 'A' ? nameA : nameB}</p>
              </div>
              <button type="button" onClick={() => setShowCardModal(false)} className="text-[#667085] font-bold p-1">✕</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Card Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCardType('YELLOW')}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      cardType === 'YELLOW' ? 'bg-[#FEF0C7] border-[#FEDF89] text-[#B54708]' : 'border-[#EAECF0]'
                    }`}
                  >
                    🟨 Yellow Card
                  </button>
                  <button
                    type="button"
                    onClick={() => setCardType('RED')}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      cardType === 'RED' ? 'bg-[#FDF0F0] border-[#FDA29B] text-[#B42318]' : 'border-[#EAECF0]'
                    }`}
                  >
                    🟥 Red Card
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Player *</label>
                <select
                  value={cardPlayerId}
                  onChange={(e) => setCardPlayerId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Player --</option>
                  {(cardTeam === 'A' ? [
                    ...(footballScoreState?.teamAState?.activePlayersOnPitch || []),
                    ...(footballScoreState?.teamAState?.benchPlayers || [])
                  ] : [
                    ...(footballScoreState?.teamBState?.activePlayersOnPitch || []),
                    ...(footballScoreState?.teamBState?.benchPlayers || [])
                  ])?.map((pid) => (
                    <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Minute & Reason</label>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={cardMinute}
                    onChange={(e) => setCardMinute(Number(e.target.value))}
                    className="arena-input text-xs py-2"
                  />
                  <input
                    type="text"
                    placeholder="Reason (e.g. Foul)"
                    value={cardReason}
                    onChange={(e) => setCardReason(e.target.value)}
                    className="arena-input text-xs py-2 col-span-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button type="button" onClick={() => setShowCardModal(false)} className="btn-secondary flex-1 py-2 text-xs">Cancel</button>
              <button type="button" onClick={handleCardSubmit} className="btn-primary flex-1 py-2 text-xs">Confirm Card</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* FOOTBALL SUBSTITUTION MODAL */}
      {/* ========================================== */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">🔄 Make Substitution</h3>
                <p className="text-[11px] text-[#667085]">{subTeam === 'A' ? nameA : nameB}</p>
              </div>
              <button type="button" onClick={() => setShowSubModal(false)} className="text-[#667085] font-bold p-1">✕</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Player Coming Off (On Pitch) *</label>
                <select
                  value={subPlayerOffId}
                  onChange={(e) => setSubPlayerOffId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Player Off --</option>
                  {(subTeam === 'A' ? footballScoreState?.teamAState?.activePlayersOnPitch : footballScoreState?.teamBState?.activePlayersOnPitch)?.map((pid) => (
                    <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Player Coming On (Bench) *</label>
                <select
                  value={subPlayerOnId}
                  onChange={(e) => setSubPlayerOnId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Player On --</option>
                  {(subTeam === 'A' ? footballScoreState?.teamAState?.benchPlayers : footballScoreState?.teamBState?.benchPlayers)?.map((pid) => (
                    <option key={pid} value={pid}>{getPlayerName(pid)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Minute *</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={subMinute}
                  onChange={(e) => setSubMinute(Number(e.target.value))}
                  className="arena-input text-xs py-2 w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button type="button" onClick={() => setShowSubModal(false)} className="btn-secondary flex-1 py-2 text-xs">Cancel</button>
              <button type="button" onClick={handleSubSubmit} className="btn-primary flex-1 py-2 text-xs">Confirm Substitution</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* FOOTBALL SHOOTOUT KICK MODAL */}
      {/* ========================================== */}
      {showShootoutModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">🥅 Penalty Shootout Kick</h3>
                <p className="text-[11px] text-[#667085]">Kick #{((footballScoreState?.shootoutState?.kicks?.length || 0) + 1)}</p>
              </div>
              <button type="button" onClick={() => setShowShootoutModal(false)} className="text-[#667085] font-bold p-1">✕</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Shooting Team *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShootoutTeam('A')}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      shootoutTeam === 'A' ? 'bg-[#E8F5F0] border-[#14966B] text-[#14966B]' : 'border-[#EAECF0]'
                    }`}
                  >
                    {nameA}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShootoutTeam('B')}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      shootoutTeam === 'B' ? 'bg-[#E8F5F0] border-[#14966B] text-[#14966B]' : 'border-[#EAECF0]'
                    }`}
                  >
                    {nameB}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Penalty Kicker *</label>
                <select
                  value={shootoutKickerId}
                  onChange={(e) => setShootoutKickerId(e.target.value)}
                  className="arena-input text-xs py-2 w-full"
                >
                  <option value="">-- Select Kicker --</option>
                  {(shootoutTeam === 'A' ? membersA : membersB).map((m: any) => (
                    <option key={m.player?.id} value={m.player?.id}>{m.player?.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[#344054]">Kick Result *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShootoutScored(true)}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      shootoutScored ? 'bg-[#E8F5F0] border-[#14966B] text-[#14966B]' : 'border-[#EAECF0]'
                    }`}
                  >
                    ⚽ Scored (Goal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShootoutScored(false)}
                    className={`py-2 rounded-lg border text-xs font-bold transition ${
                      !shootoutScored ? 'bg-[#FDF0F0] border-[#FDA29B] text-[#B42318]' : 'border-[#EAECF0]'
                    }`}
                  >
                    ❌ Missed / Saved
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button type="button" onClick={() => setShowShootoutModal(false)} className="btn-secondary flex-1 py-2 text-xs">Cancel</button>
              <button type="button" onClick={handleShootoutKickSubmit} className="btn-primary flex-1 py-2 text-xs">Record Kick</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* BADMINTON SERVICE SETUP MODAL */}
      {/* ========================================== */}
      {showServiceModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">🏸 Service & Court Setup</h3>
                <p className="text-[11px] text-[#667085]">Configure initial server, receiver, and court positions</p>
              </div>
              <button
                type="button"
                onClick={() => setShowServiceModal(false)}
                className="text-[#667085] hover:text-[#172033] text-sm font-bold p-1"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Serving Side Choice */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[#344054]">Serving Side *</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setServiceSide('A');
                    if (membersA.length > 0) setServiceServerId(membersA[0].player?.id || '');
                    if (membersB.length > 0) setServiceReceiverId(membersB[0].player?.id || '');
                  }}
                  className={`p-2.5 rounded-lg border text-left text-xs transition ${
                    serviceSide === 'A'
                      ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                      : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                  }`}
                >
                  <span className="block truncate">{nameA}</span>
                  <span className="text-[10px] text-[#667085] font-normal block">Serving Side</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setServiceSide('B');
                    if (membersB.length > 0) setServiceServerId(membersB[0].player?.id || '');
                    if (membersA.length > 0) setServiceReceiverId(membersA[0].player?.id || '');
                  }}
                  className={`p-2.5 rounded-lg border text-left text-xs transition ${
                    serviceSide === 'B'
                      ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                      : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                  }`}
                >
                  <span className="block truncate">{nameB}</span>
                  <span className="text-[10px] text-[#667085] font-normal block">Serving Side</span>
                </button>
              </div>
            </div>

            {/* Server Player Selection */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#344054]">Initial Server Player *</label>
              <select
                value={serviceServerId}
                onChange={(e) => setServiceServerId(e.target.value)}
                className="arena-input text-xs py-2 w-full"
              >
                {(serviceSide === 'A' ? membersA : membersB).map((m: any) => (
                  <option key={m.player?.id} value={m.player?.id}>
                    {m.player?.full_name || m.player?.display_name || 'Player'}
                  </option>
                ))}
              </select>
            </div>

            {/* Receiver Player Selection */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#344054]">Initial Receiver Player *</label>
              <select
                value={serviceReceiverId}
                onChange={(e) => setServiceReceiverId(e.target.value)}
                className="arena-input text-xs py-2 w-full"
              >
                {(serviceSide === 'A' ? membersB : membersA).map((m: any) => (
                  <option key={m.player?.id} value={m.player?.id}>
                    {m.player?.full_name || m.player?.display_name || 'Player'}
                  </option>
                ))}
              </select>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button
                type="button"
                onClick={() => setShowServiceModal(false)}
                disabled={submittingService}
                className="btn-secondary flex-1 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSetService}
                disabled={submittingService || !serviceServerId || !serviceReceiverId}
                className="btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-2"
              >
                {submittingService ? 'Saving...' : 'Confirm Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* DECLARE OUTCOME MODAL */}
      {/* ========================================== */}
      {showOutcomeModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg border border-[#E4E7EC] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#E4E7EC] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#172033]">Declare Match Outcome</h3>
                <p className="text-[11px] text-[#667085]">{nameA} vs {nameB}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowOutcomeModal(false)}
                className="text-[#667085] hover:text-[#172033] text-sm font-bold p-1"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Outcome Selection Radio Group */}
            <div className="space-y-2.5">
              <label className="block text-xs font-semibold text-[#344054]">Select Outcome Type *</label>

              {/* WALKOVER Option */}
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                selectedOutcome === 'WALKOVER' ? 'bg-[#EEF4FF] border-[#3267D6]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
              } ${hasScoringPoints ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="radio"
                  name="outcomeType"
                  value="WALKOVER"
                  checked={selectedOutcome === 'WALKOVER'}
                  disabled={hasScoringPoints}
                  onChange={() => setSelectedOutcome('WALKOVER')}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#172033]">Walkover (W.O.)</span>
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FF] text-[#3267D6] border border-[#C8DCFE]">W.O.</span>
                  </div>
                  <p className="text-[11px] text-[#667085]">
                    Opponent did not appear or withdrew before the match started.
                  </p>
                </div>
              </label>

              {/* RETIREMENT Option */}
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                selectedOutcome === 'RETIREMENT' ? 'bg-[#FEF6EE] border-[#C98218]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
              } ${!isLiveOrPaused ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="radio"
                  name="outcomeType"
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
                    Player/Team retired mid-match. Points/goals scored prior to retirement are preserved.
                  </p>
                </div>
              </label>

              {/* DEFAULT Option */}
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                selectedOutcome === 'DEFAULT' ? 'bg-[#FDF0F0] border-[#B42318]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
              } ${hasScoringPoints ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="radio"
                  name="outcomeType"
                  value="DEFAULT"
                  checked={selectedOutcome === 'DEFAULT'}
                  disabled={hasScoringPoints}
                  onChange={() => setSelectedOutcome('DEFAULT')}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#172033]">Default / Disqualification</span>
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FDF0F0] text-[#B42318] border border-[#FDA29B]">DEF.</span>
                  </div>
                  <p className="text-[11px] text-[#667085]">
                    Player/Team is disqualified by tournament referee.
                  </p>
                </div>
              </label>

              {/* ABANDONED Option (Football / General) */}
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
                selectedOutcome === 'ABANDONED' ? 'bg-[#FEF6EE] border-[#C98218]' : 'border-[#EAECF0] hover:bg-[#F9FAFB]'
              }`}>
                <input
                  type="radio"
                  name="outcomeType"
                  value="ABANDONED"
                  checked={selectedOutcome === 'ABANDONED'}
                  onChange={() => setSelectedOutcome('ABANDONED')}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#172033]">Abandon Match (Postponed)</span>
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FEF6EE] text-[#C98218] border border-[#F9DBAF]">ABN.</span>
                  </div>
                  <p className="text-[11px] text-[#667085]">
                    Match abandoned due to severe weather, pitch failure, or referee stoppage. Status becomes POSTPONED with no winner.
                  </p>
                </div>
              </label>
            </div>

            {/* Winner Selection (Not required for ABANDONED) */}
            {selectedOutcome !== 'ABANDONED' && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#344054]">
                  {selectedOutcome === 'RETIREMENT' ? 'Select Conceding Side (Retiring) *' : 'Select Winner to Advance *'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedWinnerId(selectedOutcome === 'RETIREMENT' ? (match?.participant_b_id || '') : (match?.participant_a_id || ''))}
                    className={`p-2.5 rounded-lg border text-left text-xs transition ${
                      (selectedOutcome === 'RETIREMENT' ? selectedWinnerId === match?.participant_b_id : selectedWinnerId === match?.participant_a_id)
                        ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                        : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                    }`}
                  >
                    <span className="block truncate">{nameA}</span>
                    <span className="text-[10px] text-[#667085] font-normal block">
                      {selectedOutcome === 'RETIREMENT'
                        ? (selectedWinnerId === match?.participant_b_id ? 'Retires (Concedes)' : 'Wins Match')
                        : (selectedWinnerId === match?.participant_a_id ? 'Winner (Advances)' : 'Concedes')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedWinnerId(selectedOutcome === 'RETIREMENT' ? (match?.participant_a_id || '') : (match?.participant_b_id || ''))}
                    className={`p-2.5 rounded-lg border text-left text-xs transition ${
                      (selectedOutcome === 'RETIREMENT' ? selectedWinnerId === match?.participant_a_id : selectedWinnerId === match?.participant_b_id)
                        ? 'bg-[#E8F5F0] border-[#14966B] font-bold text-[#14966B]'
                        : 'border-[#EAECF0] hover:bg-[#F9FAFB] text-[#344054]'
                    }`}
                  >
                    <span className="block truncate">{nameB}</span>
                    <span className="text-[10px] text-[#667085] font-normal block">
                      {selectedOutcome === 'RETIREMENT'
                        ? (selectedWinnerId === match?.participant_a_id ? 'Retires (Concedes)' : 'Wins Match')
                        : (selectedWinnerId === match?.participant_b_id ? 'Winner (Advances)' : 'Concedes')}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Optional Notes */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#344054]">Referee / Official Notes</label>
              <textarea
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="e.g. Severe thunderstorm / Player injury..."
                rows={2}
                className="arena-input text-xs py-1.5 w-full resize-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex gap-2 pt-2 border-t border-[#E4E7EC]">
              <button
                type="button"
                onClick={() => setShowOutcomeModal(false)}
                disabled={submittingOutcome}
                className="btn-secondary flex-1 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeclareOutcome}
                disabled={submittingOutcome || (selectedOutcome !== 'ABANDONED' && !selectedWinnerId)}
                className="btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-2"
              >
                {submittingOutcome ? 'Recording...' : 'Confirm & Declare'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
