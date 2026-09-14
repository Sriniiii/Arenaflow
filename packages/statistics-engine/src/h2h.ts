import {
  HeadToHeadStats,
  HeadToHeadGameScore,
  HeadToHeadMatchSummary,
  MatchDataInput,
} from './types';
import { isMatchCompleted } from './standings';
import { isPlayerInParticipant } from './player';

/**
 * Calculates head-to-head statistics and match breakdown between two players.
 * Correctly distinguishes opposing opponents vs doubles teammates.
 */
export function calculateHeadToHead(
  matches: MatchDataInput[] = [],
  playerAId: string,
  playerBId: string
): HeadToHeadStats {
  const result: HeadToHeadStats = {
    playerAId,
    playerBId,
    matchesPlayed: 0,
    playerAWins: 0,
    playerBWins: 0,
    playerAWinPercentage: 0,
    playerBWinPercentage: 0,
    playerAGamesWon: 0,
    playerBGamesWon: 0,
    playerAPoints: 0,
    playerBPoints: 0,
    pointDifferential: 0,
    mostRecentWinner: null,
    recentMeetings: [],
    matchHistory: [],
  };

  if (!playerAId || !playerBId || playerAId === playerBId || !matches || matches.length === 0) {
    return result;
  }

  const processedMatchIds = new Set<string>();
  const meetings: HeadToHeadMatchSummary[] = [];

  for (const match of matches) {
    if (!match.id || processedMatchIds.has(match.id)) continue;

    const aInSideA = isPlayerInParticipant(match.participant_a, match.participant_a_id, playerAId);
    const aInSideB = isPlayerInParticipant(match.participant_b, match.participant_b_id, playerAId);
    const bInSideA = isPlayerInParticipant(match.participant_a, match.participant_a_id, playerBId);
    const bInSideB = isPlayerInParticipant(match.participant_b, match.participant_b_id, playerBId);

    // If both players are on the SAME side (doubles teammates), they are NOT opposing opponents
    if ((aInSideA && bInSideA) || (aInSideB && bInSideB)) continue;

    // Check if they are facing each other
    const isAonSideA_BonSideB = aInSideA && bInSideB;
    const isAonSideB_BonSideA = aInSideB && bInSideA;

    if (!isAonSideA_BonSideB && !isAonSideB_BonSideA) continue;

    processedMatchIds.add(match.id);

    if (isMatchCompleted(match.status)) {
      const outcome = (match.outcome || '').toUpperCase();
      const isBye = outcome === 'BYE';
      if (isBye) continue;

      result.matchesPlayed += 1;

      const pAId = match.participant_a_id || match.participant_a?.id;
      const pBId = match.participant_b_id || match.participant_b?.id;

      const playerAParticipantId = isAonSideA_BonSideB ? pAId : pBId;
      const playerBParticipantId = isAonSideA_BonSideB ? pBId : pAId;

      let winnerPlayerId: string | null = null;
      if (match.winner_id === playerAParticipantId) {
        result.playerAWins += 1;
        winnerPlayerId = playerAId;
      } else if (match.winner_id === playerBParticipantId) {
        result.playerBWins += 1;
        winnerPlayerId = playerBId;
      }

      const matchGameScores: HeadToHeadGameScore[] = [];

      // Only count games & points for actual played matches (not W.O. / DEFAULT)
      if (outcome !== 'WALKOVER' && outcome !== 'DEFAULT') {
        if (match.games && Array.isArray(match.games)) {
          for (let i = 0; i < match.games.length; i++) {
            const g = match.games[i];
            const scoreSideA = g.participant_a_score ?? g.scoreA ?? 0;
            const scoreSideB = g.participant_b_score ?? g.scoreB ?? 0;

            const pAScore = isAonSideA_BonSideB ? scoreSideA : scoreSideB;
            const pBScore = isAonSideA_BonSideB ? scoreSideB : scoreSideA;

            result.playerAPoints += pAScore;
            result.playerBPoints += pBScore;

            if (pAScore > pBScore) {
              result.playerAGamesWon += 1;
            } else if (pBScore > pAScore) {
              result.playerBGamesWon += 1;
            }

            matchGameScores.push({
              gameNumber: g.game_number ?? g.gameNumber ?? (i + 1),
              playerAScore: pAScore,
              playerBScore: pBScore,
            });
          }
        }
      }

      meetings.push({
        matchId: match.id,
        date: match.completed_at || match.ended_at || match.started_at || match.scheduled_at || null,
        winnerId: winnerPlayerId,
        outcome: match.outcome || null,
        categoryName: match.category?.name || null,
        scores: matchGameScores,
      });
    }
  }

  // Sort meetings deterministically: if timestamps are present and distinct, sort descending (most recent first)
  if (meetings.some(m => m.date)) {
    meetings.sort((a, b) => {
      const timeA = a.date ? new Date(a.date).getTime() : 0;
      const timeB = b.date ? new Date(b.date).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;
      return 0;
    });
  }

  result.matchHistory = meetings;
  result.recentMeetings = meetings;
  result.mostRecentWinner = meetings.length > 0 ? (meetings[0].winnerId || null) : null;
  result.playerAWinPercentage = result.matchesPlayed > 0 ? (result.playerAWins / result.matchesPlayed) * 100 : 0;
  result.playerBWinPercentage = result.matchesPlayed > 0 ? (result.playerBWins / result.matchesPlayed) * 100 : 0;
  result.pointDifferential = result.playerAPoints - result.playerBPoints;

  return result;
}
