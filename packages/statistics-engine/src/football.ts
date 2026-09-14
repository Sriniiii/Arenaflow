import {
  FootballPlayerStats,
  FootballTeamStats,
  FootballAnalytics,
  FootballLeaderboardsResult,
  LeaderboardEntry,
  MatchDataInput,
  ParticipantDataInput,
  FormResultType,
  FormEntry,
} from './types';
import { isMatchCompleted } from './standings';
import { isPlayerInParticipant } from './player';
import { FootballRules, FootballMatchState, DEFAULT_FOOTBALL_CONFIG } from '@arena-flow/sport-engine';

const footballRules = new FootballRules();

/**
 * Derives authoritative Football player statistics from match events and FootballRules replay.
 */
export function calculateFootballPlayerStats(
  matches: MatchDataInput[] = [],
  playerId: string,
  playerName?: string
): FootballPlayerStats {
  const result: FootballPlayerStats = {
    playerId,
    playerName,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesDrawn: 0,
    matchesLost: 0,
    appearances: 0,
    starts: 0,
    substitutionsIn: 0,
    substitutionsOut: 0,
    minutesPlayed: null,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    secondYellows: 0,
    redCards: 0,
    directRedCards: 0,
    ownGoals: 0,
    cleanSheetAppearances: 0,
    winPercentage: 0,
    recentForm: [],
    formDetails: [],
  };

  if (!playerId || !matches || matches.length === 0) {
    return result;
  }

  const processedMatchIds = new Set<string>();
  const eligibleMatches: Array<{ match: MatchDataInput; formType: FormResultType; isWin: boolean }> = [];
  let totalCalculatedMinutes = 0;
  let hasDerivableMinutes = false;

  for (const match of matches) {
    if (!match.id || processedMatchIds.has(match.id)) continue;

    const inA = isPlayerInParticipant(match.participant_a, match.participant_a_id, playerId);
    const inB = isPlayerInParticipant(match.participant_b, match.participant_b_id, playerId);

    if (!inA && !inB) continue;

    processedMatchIds.add(match.id);

    if (!isMatchCompleted(match.status)) continue;

    const outcome = (match.outcome || '').toUpperCase();
    if (outcome === 'ABANDONED') {
      // Abandoned matches are not normal completed matches
      continue;
    }

    const myParticipantId = inA
      ? (match.participant_a_id || match.participant_a?.id)
      : (match.participant_b_id || match.participant_b?.id);
    const oppParticipantId = inA
      ? (match.participant_b_id || match.participant_b?.id)
      : (match.participant_a_id || match.participant_a?.id);
    const oppParticipant = inA ? match.participant_b : match.participant_a;
    const oppName = oppParticipant?.name || oppParticipant?.members?.[0]?.player?.full_name || oppParticipantId || undefined;

    // Handle Walkover / Default
    if (outcome === 'WALKOVER' || outcome === 'DEFAULT') {
      result.matchesPlayed += 1;
      const isWinner = match.winner_id === myParticipantId;
      const formType: FormResultType = outcome === 'WALKOVER' ? 'W.O.' : 'DEFAULT';
      if (isWinner) {
        result.matchesWon += 1;
      } else {
        result.matchesLost += 1;
      }
      eligibleMatches.push({ match, formType, isWin: isWinner });
      continue;
    }

    // Replay match events to derive authoritative state
    const rawEvents: any[] = match.match_events || match.events || [];
    const matchConfig = {
      ...DEFAULT_FOOTBALL_CONFIG,
      extraTimeEnabled: match.extra_time_score !== undefined || (match as any).extraTimeEnabled === true,
      penaltyShootoutEnabled: match.shootout_score !== undefined || (match as any).penaltyShootoutEnabled === true,
    };
    let state: FootballMatchState = footballRules.getInitialState(matchConfig);

    // Sort events deterministically by sequence_number or created_at
    const sortedEvents = [...rawEvents].sort((a, b) => {
      if (a.sequence_number !== undefined && b.sequence_number !== undefined) {
        return a.sequence_number - b.sequence_number;
      }
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });

    for (const ev of sortedEvents) {
      const detailObj = typeof ev.detail === 'object' && ev.detail !== null ? ev.detail : {};
      const metadataObj = typeof ev.metadata === 'object' && ev.metadata !== null ? ev.metadata : {};
      const canonicalEvent = {
        id: ev.id || `ev-${Math.random()}`,
        type: ev.event_type || ev.type,
        timestamp: new Date(ev.created_at || 0).getTime(),
        metadata: {
          ...ev,
          ...detailObj,
          ...metadataObj,
          lineup: detailObj.startingXI ? detailObj : (metadataObj.lineup || detailObj.lineup || ev.lineup)
        }
      };
      state = footballRules.applyEvent(state, canonicalEvent as any);
    }

    // Check Player's Team side in replay
    const myTeamState = inA ? state.teamAState : state.teamBState;
    const oppTeamState = inA ? state.teamBState : state.teamAState;

    // Determine Starting XI vs Substitution vs Appearance
    let appeared = false;
    let started = false;
    let entryMinute: number | null = null;
    let exitMinute: number | null = null;

    if (myTeamState.lineup?.startingXI?.includes(playerId)) {
      appeared = true;
      started = true;
      entryMinute = 0;
    }

    // Check if player entered via substitution
    const subInRecord = state.substitutions.find((s) => s.playerOnId === playerId);
    if (subInRecord) {
      appeared = true;
      result.substitutionsIn += 1;
      entryMinute = subInRecord.minute ?? 45;
    }

    // Check if player was substituted out
    const subOutRecord = state.substitutions.find((s) => s.playerOffId === playerId);
    if (subOutRecord) {
      result.substitutionsOut += 1;
      exitMinute = subOutRecord.minute ?? 45;
    }

    // Check if player was sent off (red card or 2nd yellow)
    const cardRecords = state.cards.filter((c) => c.playerId === playerId);
    for (const c of cardRecords) {
      if (c.type === 'YELLOW') {
        result.yellowCards += 1;
        if (c.isSecondYellow) {
          result.secondYellows += 1;
          result.redCards += 1;
          if (exitMinute === null) {
            exitMinute = c.minute ?? 90;
          }
        }
      } else if (c.type === 'RED') {
        result.directRedCards += 1;
        result.redCards += 1;
        if (exitMinute === null) {
          exitMinute = c.minute ?? 90;
        }
      }
    }

    // Fallback: If no lineup was set but player has goals/assists/cards, count appearance
    if (!appeared) {
      const hasGoal = state.goals.some((g) => g.scorerPlayerId === playerId || g.assistPlayerId === playerId);
      const hasCard = cardRecords.length > 0;
      if (hasGoal || hasCard) {
        appeared = true;
      }
    }

    if (appeared) {
      result.appearances += 1;
      if (started) {
        result.starts += 1;
      }

      // Determine match playable end minute
      let matchEndMinute = 90;
      if (state.extraTimeScore !== null || state.phase === 'EXTRA_TIME_SECOND_HALF' || state.phase === 'PENALTY_SHOOTOUT') {
        matchEndMinute = 120;
      }

      if (exitMinute === null && entryMinute !== null) {
        exitMinute = matchEndMinute;
      }

      if (entryMinute !== null && exitMinute !== null && exitMinute >= entryMinute) {
        hasDerivableMinutes = true;
        totalCalculatedMinutes += (exitMinute - entryMinute);
      }
    }

    // Derive Goals & Assists (Strictly excluding shootout penalty kicks)
    for (const g of state.goals) {
      if (g.scorerPlayerId === playerId && !g.isOwnGoal) {
        result.goals += 1;
      }
      if (g.assistPlayerId === playerId) {
        result.assists += 1;
      }
      if (g.concedingPlayerId === playerId && g.isOwnGoal) {
        result.ownGoals += 1;
      }
    }

    // Clean sheet appearance: Team conceded 0 goals during normal/ET play
    const myTeamScore = inA ? (state.scoreA ?? match.score_a ?? 0) : (state.scoreB ?? match.score_b ?? 0);
    const oppTeamScore = inA ? (state.scoreB ?? match.score_b ?? 0) : (state.scoreA ?? match.score_a ?? 0);

    if (appeared && oppTeamScore === 0) {
      result.cleanSheetAppearances += 1;
    }

    // Match W/D/L accounting
    result.matchesPlayed += 1;
    let formType: FormResultType = 'L';
    let isWin = false;

    if (myTeamScore > oppTeamScore) {
      result.matchesWon += 1;
      formType = 'W';
      isWin = true;
    } else if (myTeamScore === oppTeamScore) {
      // In league or regulation tie
      if (state.shootoutState?.isCompleted) {
        // Shootout winner
        const winnerSide = state.shootoutState.winnerId;
        const mySide = inA ? 'PARTICIPANT_A' : 'PARTICIPANT_B';
        if (winnerSide === mySide) {
          result.matchesWon += 1;
          formType = 'W';
          isWin = true;
        } else {
          result.matchesLost += 1;
          formType = 'L';
        }
      } else {
        result.matchesDrawn += 1;
        formType = 'D' as any; // Draw
      }
    } else {
      result.matchesLost += 1;
      formType = 'L';
    }

    const scoreDisplay = `${myTeamScore}-${oppTeamScore}${state.shootoutState ? ` (${inA ? state.shootoutState.scoreA : state.shootoutState.scoreB}-${inA ? state.shootoutState.scoreB : state.shootoutState.scoreA} pens)` : ''}`;

    eligibleMatches.push({ match, formType, isWin });
    result.formDetails?.push({
      matchId: match.id,
      result: formType,
      outcome: match.outcome || null,
      isWin,
      opponentId: oppParticipantId,
      opponentName: oppName,
      date: match.completed_at || match.ended_at || match.started_at || match.scheduled_at || null,
      scoreDisplay,
    });
  }

  if (hasDerivableMinutes) {
    result.minutesPlayed = totalCalculatedMinutes;
  }

  if (result.matchesPlayed > 0) {
    result.winPercentage = (result.matchesWon / result.matchesPlayed) * 100;
  }

  // Calculate recent form (last 5 matches)
  result.recentForm = eligibleMatches.slice(-5).map((e) => e.formType);

  return result;
}

/**
 * Calculates Football Team Statistics for a specific participant/team.
 */
export function calculateFootballTeamStats(
  matches: MatchDataInput[] = [],
  teamId: string,
  teamName?: string
): FootballTeamStats {
  const result: FootballTeamStats = {
    teamId,
    teamName,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesDrawn: 0,
    matchesLost: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    cleanSheets: 0,
    winPercentage: 0,
    recentForm: [],
    formDetails: [],
  };

  if (!teamId || !matches || matches.length === 0) {
    return result;
  }

  const processedMatchIds = new Set<string>();
  const eligibleMatches: Array<{ match: MatchDataInput; formType: FormResultType; isWin: boolean }> = [];

  for (const match of matches) {
    if (!match.id || processedMatchIds.has(match.id)) continue;

    const isTeamA = match.participant_a_id === teamId || match.participant_a?.id === teamId;
    const isTeamB = match.participant_b_id === teamId || match.participant_b?.id === teamId;

    if (!isTeamA && !isTeamB) continue;

    processedMatchIds.add(match.id);

    if (!isMatchCompleted(match.status)) continue;

    const outcome = (match.outcome || '').toUpperCase();
    if (outcome === 'ABANDONED') {
      continue;
    }

    const oppTeamId = isTeamA ? (match.participant_b_id || match.participant_b?.id) : (match.participant_a_id || match.participant_a?.id);
    const oppParticipant = isTeamA ? match.participant_b : match.participant_a;
    const oppName = oppParticipant?.name || oppTeamId || undefined;

    if (outcome === 'WALKOVER' || outcome === 'DEFAULT') {
      result.matchesPlayed += 1;
      const isWinner = match.winner_id === teamId;
      if (isWinner) {
        result.matchesWon += 1;
        result.points += 3;
        result.goalsFor += 3;
        result.goalsAgainst += 0;
        result.cleanSheets += 1;
      } else {
        result.matchesLost += 1;
        result.goalsFor += 0;
        result.goalsAgainst += 3;
      }
      const formType: FormResultType = outcome === 'WALKOVER' ? 'W.O.' : 'DEFAULT';
      eligibleMatches.push({ match, formType, isWin: isWinner });
      continue;
    }

    result.matchesPlayed += 1;
    const teamScore = isTeamA ? (match.score_a ?? match.scoreA ?? 0) : (match.score_b ?? match.scoreB ?? 0);
    const oppScore = isTeamA ? (match.score_b ?? match.scoreB ?? 0) : (match.score_a ?? match.scoreA ?? 0);

    // Official regulation/ET goals only
    result.goalsFor += teamScore;
    result.goalsAgainst += oppScore;

    if (oppScore === 0) {
      result.cleanSheets += 1;
    }

    let formType: FormResultType = 'L';
    let isWin = false;

    if (teamScore > oppScore) {
      result.matchesWon += 1;
      result.points += 3;
      formType = 'W';
      isWin = true;
    } else if (teamScore === oppScore) {
      if (match.shootout_score) {
        // Knockout shootout match
        const winnerId = match.winner_id;
        if (winnerId === teamId) {
          result.matchesWon += 1;
          result.points += 3;
          formType = 'W';
          isWin = true;
        } else {
          result.matchesLost += 1;
          formType = 'L';
        }
      } else {
        result.matchesDrawn += 1;
        result.points += 1;
        formType = 'D' as any;
      }
    } else {
      result.matchesLost += 1;
      formType = 'L';
    }

    const scoreDisplay = `${teamScore}-${oppScore}${match.shootout_score ? ` (${isTeamA ? match.shootout_score.score_a : match.shootout_score.score_b}-${isTeamA ? match.shootout_score.score_b : match.shootout_score.score_a} pens)` : ''}`;

    eligibleMatches.push({ match, formType, isWin });
    result.formDetails?.push({
      matchId: match.id,
      result: formType,
      outcome: match.outcome || null,
      isWin,
      opponentId: oppTeamId,
      opponentName: oppName,
      date: match.completed_at || match.ended_at || match.started_at || match.scheduled_at || null,
      scoreDisplay,
    });
  }

  result.goalDifference = result.goalsFor - result.goalsAgainst;
  if (result.matchesPlayed > 0) {
    result.winPercentage = (result.matchesWon / result.matchesPlayed) * 100;
  }

  result.recentForm = eligibleMatches.slice(-5).map((e) => e.formType);

  return result;
}

/**
 * Calculates aggregated Football Tournament Analytics.
 */
export function calculateFootballAnalytics(matches: MatchDataInput[] = []): FootballAnalytics {
  let totalGoals = 0;
  let totalYellowCards = 0;
  let totalRedCards = 0;
  let totalSubstitutions = 0;
  let cleanSheetMatches = 0;
  let penaltyShootoutDecidedMatches = 0;
  let extraTimeDecidedMatches = 0;
  let regulationDecidedMatches = 0;
  let drawMatches = 0;
  let completedCount = 0;

  for (const match of matches) {
    if (!isMatchCompleted(match.status)) continue;
    const outcome = (match.outcome || '').toUpperCase();
    if (outcome === 'ABANDONED') continue;

    completedCount += 1;
    const scoreA = match.score_a ?? match.scoreA ?? 0;
    const scoreB = match.score_b ?? match.scoreB ?? 0;

    totalGoals += (scoreA + scoreB);

    if (scoreA === 0 || scoreB === 0) {
      cleanSheetMatches += 1;
    }

    if (match.shootout_score) {
      penaltyShootoutDecidedMatches += 1;
    } else if (match.extra_time_score) {
      extraTimeDecidedMatches += 1;
    } else if (scoreA === scoreB) {
      drawMatches += 1;
    } else {
      regulationDecidedMatches += 1;
    }

    const events: any[] = match.match_events || match.events || [];
    for (const ev of events) {
      const type = (ev.event_type || ev.type || '').toUpperCase();
      if (type === 'YELLOW_CARD') totalYellowCards += 1;
      if (type === 'RED_CARD') totalRedCards += 1;
      if (type === 'SUBSTITUTION') totalSubstitutions += 1;
    }
  }

  const averageGoalsPerMatch = completedCount > 0 ? totalGoals / completedCount : 0;

  return {
    totalGoals,
    averageGoalsPerMatch,
    totalYellowCards,
    totalRedCards,
    totalSubstitutions,
    cleanSheetMatches,
    penaltyShootoutDecidedMatches,
    extraTimeDecidedMatches,
    regulationDecidedMatches,
    drawMatches,
  };
}

/**
 * Calculates Football Leaderboards with explicit football semantics.
 */
export function calculateFootballLeaderboards(
  playerStatsList: FootballPlayerStats[],
  options: { minAppearances?: number; topN?: number } = {}
): FootballLeaderboardsResult {
  const minAppearances = options.minAppearances ?? 1;
  const topN = options.topN ?? 10;

  const eligible = playerStatsList.filter((p) => p.appearances >= minAppearances);

  // 1. Top Scorers (Goals desc, then assists desc, then appearances asc)
  const topScorers: LeaderboardEntry[] = [...eligible]
    .filter((p) => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.appearances - b.appearances)
    .slice(0, topN)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: p.goals,
      secondaryValue: p.assists,
      matchesPlayed: p.appearances,
    }));

  // 2. Top Assists (Assists desc, then goals desc)
  const topAssists: LeaderboardEntry[] = [...eligible]
    .filter((p) => p.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
    .slice(0, topN)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: p.assists,
      secondaryValue: p.goals,
      matchesPlayed: p.appearances,
    }));

  // 3. Most Appearances (Appearances desc, then minutesPlayed desc)
  const mostAppearances: LeaderboardEntry[] = [...eligible]
    .sort((a, b) => b.appearances - a.appearances || (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0))
    .slice(0, topN)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: p.appearances,
      secondaryValue: p.minutesPlayed ?? undefined,
      matchesPlayed: p.appearances,
    }));

  // 4. Disciplinary (Red cards desc, then Yellow cards desc)
  const disciplinary: LeaderboardEntry[] = [...eligible]
    .filter((p) => p.redCards > 0 || p.yellowCards > 0)
    .sort((a, b) => b.redCards - a.redCards || b.yellowCards - a.yellowCards)
    .slice(0, topN)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: p.redCards,
      secondaryValue: p.yellowCards,
      matchesPlayed: p.appearances,
    }));

  // 5. Clean Sheets (Clean sheets desc)
  const cleanSheets: LeaderboardEntry[] = [...eligible]
    .filter((p) => p.cleanSheetAppearances > 0)
    .sort((a, b) => b.cleanSheetAppearances - a.cleanSheetAppearances)
    .slice(0, topN)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: p.cleanSheetAppearances,
      matchesPlayed: p.appearances,
    }));

  return {
    topScorers,
    topAssists,
    mostAppearances,
    disciplinary,
    cleanSheets,
  };
}
