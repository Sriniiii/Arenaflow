import {
  BadmintonAnalytics,
  ClosestGameRecord,
  MatchDataInput,
} from './types';
import { isMatchCompleted } from './standings';

/**
 * Calculates badminton-specific match and tournament analytics.
 */
export function calculateBadmintonAnalytics(
  matches: MatchDataInput[] = []
): BadmintonAnalytics {
  let totalRallies = 0;
  let totalGamesCount = 0;
  let gamesWon21Plus = 0;
  let gamesWon11To20 = 0;
  let deuceGames = 0;
  let capped30PointGames = 0;
  let straightGameWins = 0;
  let threeGameWins = 0;
  let comebackWins = 0;

  const allPlayedGames: ClosestGameRecord[] = [];

  for (const match of matches) {
    if (!isMatchCompleted(match.status)) continue;

    const outcome = (match.outcome || '').toUpperCase();
    if (outcome === 'WALKOVER' || outcome === 'DEFAULT' || outcome === 'BYE') continue;

    const games = match.games || [];
    if (!Array.isArray(games) || games.length === 0) continue;

    let gamesWonA = 0;
    let gamesWonB = 0;
    let game1Winner: 'A' | 'B' | null = null;

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
      const scoreB = g.participant_b_score ?? g.scoreB ?? 0;

      if (scoreA === 0 && scoreB === 0 && !g.isCompleted) continue;

      totalRallies += scoreA + scoreB;
      totalGamesCount += 1;

      const winnerScore = Math.max(scoreA, scoreB);
      const loserScore = Math.min(scoreA, scoreB);
      const margin = winnerScore - loserScore;

      if (winnerScore >= 21) {
        gamesWon21Plus += 1;
      } else if (winnerScore >= 11 && winnerScore <= 20) {
        gamesWon11To20 += 1;
      }

      // Deuce game: both sides scored at least 20 points
      if (scoreA >= 20 && scoreB >= 20) {
        deuceGames += 1;
      }

      // 30-point cap: game reached 30 points ceiling
      if (scoreA === 30 || scoreB === 30) {
        capped30PointGames += 1;
      }

      allPlayedGames.push({
        matchId: match.id,
        gameNumber: g.game_number ?? g.gameNumber ?? (i + 1),
        scoreA,
        scoreB,
        margin,
      });

      if (scoreA > scoreB) {
        gamesWonA += 1;
        if (i === 0) game1Winner = 'A';
      } else if (scoreB > scoreA) {
        gamesWonB += 1;
        if (i === 0) game1Winner = 'B';
      }
    }

    const matchWinnerIsA = match.winner_id === match.participant_a_id || match.winner_id === match.participant_a?.id;
    const matchWinnerIsB = match.winner_id === match.participant_b_id || match.winner_id === match.participant_b?.id;

    // Straight games: winner won 2-0 (or all completed games without dropping one)
    if ((gamesWonA === 2 && gamesWonB === 0) || (gamesWonB === 2 && gamesWonA === 0)) {
      straightGameWins += 1;
    } else if ((gamesWonA === 2 && gamesWonB === 1) || (gamesWonB === 2 && gamesWonA === 1) || (games.length === 3 && (gamesWonA + gamesWonB >= 3))) {
      threeGameWins += 1;
    }

    // Comeback win: winner lost Game 1, but won the match
    if (matchWinnerIsA && game1Winner === 'B' && (gamesWonA > gamesWonB)) {
      comebackWins += 1;
    } else if (matchWinnerIsB && game1Winner === 'A' && (gamesWonB > gamesWonA)) {
      comebackWins += 1;
    }
  }

  // Sort closest games by margin ascending
  allPlayedGames.sort((a, b) => {
    if (a.margin !== b.margin) return a.margin - b.margin;
    const maxA = Math.max(a.scoreA, a.scoreB);
    const maxB = Math.max(b.scoreA, b.scoreB);
    return maxB - maxA; // higher scoring game preferred on tie
  });

  const closestGames = allPlayedGames.slice(0, 5);

  let largestWinningMargin: ClosestGameRecord | null = null;
  if (allPlayedGames.length > 0) {
    largestWinningMargin = allPlayedGames.reduce((max, cur) => (cur.margin > max.margin ? cur : max), allPlayedGames[0]);
  }

  return {
    totalRallies,
    averageRallyPointsPerGame: totalGamesCount > 0 ? totalRallies / totalGamesCount : 0,
    gamesWon21Plus,
    gamesWon11To20,
    deuceGames,
    capped30PointGames,
    straightGameWins,
    threeGameWins,
    comebackWins,
    closestGames,
    largestWinningMargin,
  };
}
