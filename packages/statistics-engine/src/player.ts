import {
  PlayerStats,
  MatchDataInput,
  ParticipantDataInput,
  FormResultType,
  FormEntry,
} from './types';
import { isMatchCompleted } from './standings';

export function isPlayerInParticipant(
  participant: ParticipantDataInput | null | undefined,
  participantId: string | null | undefined,
  playerId: string
): boolean {
  if (!playerId) return false;

  // Direct ID match (singles participant ID often matches player ID or passed directly)
  if (participantId === playerId) return true;
  if (participant?.id === playerId) return true;

  // Check participant members for doubles / team participants
  if (participant?.members && Array.isArray(participant.members)) {
    for (const m of participant.members) {
      if (m.player_id === playerId || m.playerId === playerId) return true;
      if (m.player?.id === playerId) return true;
    }
  }

  return false;
}

/**
 * Calculates recent form entries for an individual player across their last N eligible matches.
 */
export function calculateRecentForm(
  matches: MatchDataInput[] = [],
  playerId: string,
  n: number = 5
): { recentForm: FormResultType[]; formDetails: FormEntry[] } {
  if (!playerId || !matches || matches.length === 0) {
    return { recentForm: [], formDetails: [] };
  }

  // Filter eligible completed matches where player was a participant
  const eligibleMatches: MatchDataInput[] = [];

  for (const m of matches) {
    if (!isMatchCompleted(m.status)) continue;

    const inA = isPlayerInParticipant(m.participant_a, m.participant_a_id, playerId);
    const inB = isPlayerInParticipant(m.participant_b, m.participant_b_id, playerId);

    if (inA || inB) {
      eligibleMatches.push(m);
    }
  }

  // Sort deterministically by date descending (most recent first)
  eligibleMatches.sort((a, b) => {
    const timeA = new Date(a.completed_at || a.ended_at || a.started_at || a.scheduled_at || 0).getTime();
    const timeB = new Date(b.completed_at || b.ended_at || b.started_at || b.scheduled_at || 0).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return (b.id || '').localeCompare(a.id || '');
  });

  const selectedMatches = eligibleMatches.slice(0, n);
  const recentForm: FormResultType[] = [];
  const formDetails: FormEntry[] = [];

  for (const m of selectedMatches) {
    const inA = isPlayerInParticipant(m.participant_a, m.participant_a_id, playerId);
    const myPId = inA ? (m.participant_a_id || m.participant_a?.id) : (m.participant_b_id || m.participant_b?.id);
    const oppPId = inA ? (m.participant_b_id || m.participant_b?.id) : (m.participant_a_id || m.participant_a?.id);
    const oppParticipant = inA ? m.participant_b : m.participant_a;
    const oppName = oppParticipant?.name || oppParticipant?.members?.[0]?.player?.full_name || oppPId || undefined;

    const isWinner = m.winner_id === myPId;
    const outcome = (m.outcome || '').toUpperCase();
    const pAId = m.participant_a_id || m.participant_a?.id;
    const pBId = m.participant_b_id || m.participant_b?.id;
    const isBye = outcome === 'BYE' || (!pBId && m.winner_id === pAId && inA);

    let formType: FormResultType;

    if (isBye) {
      formType = 'BYE';
    } else if (outcome === 'WALKOVER') {
      formType = 'W.O.';
    } else if (outcome === 'DEFAULT') {
      formType = 'DEFAULT';
    } else if (outcome === 'RETIREMENT') {
      formType = 'RET';
    } else {
      formType = isWinner ? 'W' : 'L';
    }

    recentForm.push(formType);

    let scoreDisplay = '';
    if (m.games && Array.isArray(m.games) && m.games.length > 0 && outcome !== 'WALKOVER' && outcome !== 'DEFAULT' && !isBye) {
      scoreDisplay = m.games
        .map(g => {
          const sA = g.participant_a_score ?? g.scoreA ?? 0;
          const sB = g.participant_b_score ?? g.scoreB ?? 0;
          return inA ? `${sA}-${sB}` : `${sB}-${sA}`;
        })
        .join(', ');
    } else if (formType !== 'W' && formType !== 'L') {
      scoreDisplay = formType;
    }

    formDetails.push({
      matchId: m.id,
      result: formType,
      outcome: m.outcome || null,
      isWin: isWinner,
      opponentId: oppPId,
      opponentName: oppName,
      date: m.completed_at || m.ended_at || m.started_at || m.scheduled_at || null,
      scoreDisplay,
    });
  }

  return { recentForm, formDetails };
}

/**
 * Calculates career / tournament level statistics for an individual player across
 * singles and doubles matches without double-counting matches or confusing teams with players.
 */
export function calculatePlayerStats(
  matches: MatchDataInput[] = [],
  playerId: string,
  playerName?: string
): PlayerStats {
  const result: PlayerStats = {
    playerId,
    playerName,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesLost: 0,
    winPercentage: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    gameDifference: 0,
    gameWinPercentage: 0,
    pointsScored: 0,
    pointsConceded: 0,
    pointDifference: 0,
    averagePointsPerMatch: 0,
    averagePointsPerGame: 0,
    averagePointsConcededPerGame: 0,
    longestWinningStreak: 0,
    currentWinningStreak: 0,
    longestLosingStreak: 0,
    currentLosingStreak: 0,
    recentForm: [],
    formDetails: [],
    walkoversReceived: 0,
    walkoversSuffered: 0,
    defaultsReceived: 0,
    defaultsSuffered: 0,
    retirementsReceived: 0,
    retirementsGiven: 0,
    byes: 0,
    tournamentAppearances: 0,
  };

  if (!playerId || !matches || matches.length === 0) {
    return result;
  }

  // Track processed match IDs to strictly prevent double-counting
  const processedMatchIds = new Set<string>();
  const tournamentIds = new Set<string>();
  const eligibleMatches: Array<{ match: MatchDataInput; isWin: boolean; isBye: boolean }> = [];

  for (const match of matches) {
    if (!match.id || processedMatchIds.has(match.id)) continue;

    const inA = isPlayerInParticipant(match.participant_a, match.participant_a_id, playerId);
    const inB = isPlayerInParticipant(match.participant_b, match.participant_b_id, playerId);

    // If player is not in this match, skip
    if (!inA && !inB) continue;

    processedMatchIds.add(match.id);

    if (match.category_id) {
      tournamentIds.add(match.category_id);
    }

    const isSideA = inA;
    const myParticipantId = isSideA ? (match.participant_a_id || match.participant_a?.id) : (match.participant_b_id || match.participant_b?.id);
    const oppParticipantId = isSideA ? (match.participant_b_id || match.participant_b?.id) : (match.participant_a_id || match.participant_a?.id);

    // Only completed matches count towards official stats
    if (isMatchCompleted(match.status)) {
      const outcome = (match.outcome || '').toUpperCase();
      const pAId = match.participant_a_id || match.participant_a?.id;
      const pBId = match.participant_b_id || match.participant_b?.id;
      const isBye = outcome === 'BYE' || (!pBId && match.winner_id === pAId && inA);

      if (isBye) {
        result.byes += 1;
        eligibleMatches.push({ match, isWin: true, isBye: true });
        continue;
      }

      result.matchesPlayed += 1;

      const isWinner = match.winner_id === myParticipantId;
      const isOppWinner = match.winner_id === oppParticipantId;

      eligibleMatches.push({ match, isWin: isWinner, isBye: false });

      if (isWinner) {
        result.matchesWon += 1;
        if (outcome === 'WALKOVER') {
          result.walkoversReceived += 1;
        } else if (outcome === 'DEFAULT') {
          result.defaultsReceived += 1;
        } else if (outcome === 'RETIREMENT') {
          result.retirementsReceived += 1;
        }
      } else if (isOppWinner) {
        result.matchesLost += 1;
        if (outcome === 'WALKOVER') {
          result.walkoversSuffered += 1;
        } else if (outcome === 'DEFAULT') {
          result.defaultsSuffered += 1;
        } else if (outcome === 'RETIREMENT') {
          result.retirementsGiven += 1;
        }
      }

      // Games and Points: Exclude W.O. and DEFAULT (they have 0 games / 0 points)
      if (outcome !== 'WALKOVER' && outcome !== 'DEFAULT') {
        if (match.games && Array.isArray(match.games)) {
          for (const g of match.games) {
            const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
            const scoreB = g.participant_b_score ?? g.scoreB ?? 0;

            const myScore = isSideA ? scoreA : scoreB;
            const oppScore = isSideA ? scoreB : scoreA;

            result.pointsScored += myScore;
            result.pointsConceded += oppScore;

            if (g.isCompleted || isMatchCompleted(g.status || '') || scoreA > 0 || scoreB > 0) {
              result.gamesPlayed += 1;
            }

            const myGameWon = isSideA
              ? (g.winner_id === myParticipantId || g.winnerId === 'PARTICIPANT_A' || scoreA > scoreB)
              : (g.winner_id === myParticipantId || g.winnerId === 'PARTICIPANT_B' || scoreB > scoreA);

            const oppGameWon = isSideA
              ? (g.winner_id === oppParticipantId || g.winnerId === 'PARTICIPANT_B' || scoreB > scoreA)
              : (g.winner_id === oppParticipantId || g.winnerId === 'PARTICIPANT_A' || scoreA > scoreB);

            if (myGameWon) {
              result.gamesWon += 1;
            } else if (oppGameWon) {
              result.gamesLost += 1;
            }
          }
        }
      }
    }
  }

  // Calculate Streaks (chronological order ascending)
  // Sort eligible played matches (exclude BYEs from breaking/extending streaks)
  const streakEligible = eligibleMatches.filter(item => !item.isBye);

  streakEligible.sort((a, b) => {
    const timeA = new Date(a.match.completed_at || a.match.ended_at || a.match.started_at || a.match.scheduled_at || 0).getTime();
    const timeB = new Date(b.match.completed_at || b.match.ended_at || b.match.started_at || b.match.scheduled_at || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return (a.match.id || '').localeCompare(b.match.id || '');
  });

  let maxWinStreak = 0;
  let curWinStreak = 0;
  let maxLossStreak = 0;
  let curLossStreak = 0;

  for (const item of streakEligible) {
    if (item.isWin) {
      curWinStreak += 1;
      curLossStreak = 0;
      if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak;
    } else {
      curLossStreak += 1;
      curWinStreak = 0;
      if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
    }
  }

  result.longestWinningStreak = maxWinStreak;
  result.currentWinningStreak = curWinStreak;
  result.longestLosingStreak = maxLossStreak;
  result.currentLosingStreak = curLossStreak;

  // Recent Form
  const { recentForm, formDetails } = calculateRecentForm(matches, playerId, 5);
  result.recentForm = recentForm;
  result.formDetails = formDetails;

  // Derive final percentages & averages
  result.winPercentage = result.matchesPlayed > 0 ? (result.matchesWon / result.matchesPlayed) * 100 : 0;
  result.gameDifference = result.gamesWon - result.gamesLost;
  const totalGamesDecided = result.gamesWon + result.gamesLost;
  result.gameWinPercentage = totalGamesDecided > 0 ? (result.gamesWon / totalGamesDecided) * 100 : 0;
  result.pointDifference = result.pointsScored - result.pointsConceded;
  result.averagePointsPerMatch = result.matchesPlayed > 0 ? result.pointsScored / result.matchesPlayed : 0;
  result.averagePointsPerGame = result.gamesPlayed > 0 ? result.pointsScored / result.gamesPlayed : 0;
  result.averagePointsConcededPerGame = result.gamesPlayed > 0 ? result.pointsConceded / result.gamesPlayed : 0;
  result.tournamentAppearances = tournamentIds.size > 0 ? tournamentIds.size : (result.matchesPlayed > 0 ? 1 : 0);

  return result;
}
