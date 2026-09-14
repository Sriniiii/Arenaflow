import {
  MatchAnalytics,
  MatchDataInput,
} from './types';
import { isMatchCompleted } from './standings';

/**
 * Calculates rich match-level analytics for a single match.
 */
export function calculateMatchAnalytics(
  match: MatchDataInput
): MatchAnalytics {
  const pAId = match.participant_a_id || match.participant_a?.id || '';
  const pBId = match.participant_b_id || match.participant_b?.id || '';
  const pAName = match.participant_a?.name || pAId;
  const pBName = match.participant_b?.name || pBId;

  const outcome = (match.outcome || '').toUpperCase();
  const isBye = outcome === 'BYE' || (!match.participant_b_id && match.winner_id === pAId);
  const isWoOrDef = outcome === 'WALKOVER' || outcome === 'DEFAULT';

  let totalGames = 0;
  let totalPoints = 0;
  let pointsA = 0;
  let pointsB = 0;
  let gamesWonA = 0;
  let gamesWonB = 0;
  let largestMargin = 0;
  let closestMargin = Infinity;

  const games = match.games || [];

  if (!isBye && !isWoOrDef && Array.isArray(games)) {
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
      const scoreB = g.participant_b_score ?? g.scoreB ?? 0;

      if (scoreA === 0 && scoreB === 0 && !g.isCompleted) continue;

      totalGames += 1;
      pointsA += scoreA;
      pointsB += scoreB;
      totalPoints += scoreA + scoreB;

      const margin = Math.abs(scoreA - scoreB);
      if (margin > largestMargin) largestMargin = margin;
      if (margin < closestMargin) closestMargin = margin;

      if (scoreA > scoreB) {
        gamesWonA += 1;
      } else if (scoreB > scoreA) {
        gamesWonB += 1;
      }
    }
  }

  if (closestMargin === Infinity) closestMargin = 0;

  const isStraightGames = isMatchCompleted(match.status) && !isBye && !isWoOrDef && ((gamesWonA > 0 && gamesWonB === 0) || (gamesWonB > 0 && gamesWonA === 0));
  const isThreeGames = isMatchCompleted(match.status) && !isBye && !isWoOrDef && (totalGames === 3 || (gamesWonA >= 1 && gamesWonB >= 1 && totalGames >= 2));

  // Authoritative duration
  let durationMinutes: number | null = null;
  if (isMatchCompleted(match.status)) {
    if (match.started_at && (match.completed_at || match.ended_at)) {
      const start = new Date(match.started_at).getTime();
      const end = new Date(match.completed_at || match.ended_at!).getTime();
      if (end > start) {
        durationMinutes = Math.round(((end - start) / (1000 * 60)) * 10) / 10;
      }
    } else if (typeof match.duration_minutes === 'number' && match.duration_minutes > 0) {
      durationMinutes = match.duration_minutes;
    }
  }

  return {
    matchId: match.id,
    participantA: { id: pAId, name: pAName },
    participantB: pBId ? { id: pBId, name: pBName } : null,
    winnerId: match.winner_id || null,
    outcome: match.outcome || null,
    status: match.status,
    totalGames,
    totalPoints,
    pointDifferential: pointsA - pointsB,
    gameDifferential: gamesWonA - gamesWonB,
    isStraightGames,
    isThreeGames,
    largestGameMargin: largestMargin,
    closestGameMargin: closestMargin,
    durationMinutes,
    startTime: match.started_at || match.scheduled_at || null,
    completionTime: match.completed_at || match.ended_at || null,
    courtId: match.court_id || null,
    roundId: match.round_id || null,
    categoryId: match.category_id || null,
  };
}
