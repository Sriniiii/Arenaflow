import {
  TournamentStats,
  CategoryStats,
  CourtUtilizationStats,
  TournamentRecords,
  LeaderboardEntry,
  LeaderboardsResult,
  MatchDataInput,
  PlayerStats,
  ParticipantDataInput,
} from './types';
import { isMatchCompleted, calculateStandings } from './standings';
import { calculateBadmintonAnalytics } from './badminton';

/**
 * Calculates deterministic tournament records and highlights from matches and player stats.
 */
export function calculateTournamentRecords(
  matches: MatchDataInput[] = [],
  playerStatsList: PlayerStats[] = []
): TournamentRecords {
  let longestMatch: { matchId: string; durationMinutes: number; participantAName?: string; participantBName?: string } | null = null;
  let shortestMatch: { matchId: string; durationMinutes: number; participantAName?: string; participantBName?: string } | null = null;
  let largestGameMargin: { matchId: string; gameNumber: number; winnerScore: number; loserScore: number; margin: number } | null = null;
  let closestGame: { matchId: string; gameNumber: number; winnerScore: number; loserScore: number; margin: number } | null = null;
  let mostPointsInAGame: { matchId: string; gameNumber: number; totalPoints: number; scoreA: number; scoreB: number } | null = null;
  let mostPointsInAMatch: { matchId: string; totalPoints: number } | null = null;

  for (const match of matches) {
    if (!isMatchCompleted(match.status)) continue;

    const outcome = (match.outcome || '').toUpperCase();
    const isBye = outcome === 'BYE';
    const isWoOrDef = outcome === 'WALKOVER' || outcome === 'DEFAULT';

    // Duration records
    if (match.started_at && (match.completed_at || match.ended_at)) {
      const start = new Date(match.started_at).getTime();
      const end = new Date(match.completed_at || match.ended_at!).getTime();
      if (end > start) {
        const duration = Math.round(((end - start) / (1000 * 60)) * 10) / 10;
        const pAName = match.participant_a?.name || match.participant_a_id || 'Side A';
        const pBName = match.participant_b?.name || match.participant_b_id || 'Side B';

        if (!longestMatch || duration > longestMatch.durationMinutes) {
          longestMatch = { matchId: match.id, durationMinutes: duration, participantAName: pAName, participantBName: pBName };
        }
        if (!isWoOrDef && !isBye && (!shortestMatch || duration < shortestMatch.durationMinutes)) {
          shortestMatch = { matchId: match.id, durationMinutes: duration, participantAName: pAName, participantBName: pBName };
        }
      }
    } else if (typeof match.duration_minutes === 'number' && match.duration_minutes > 0) {
      const duration = match.duration_minutes;
      const pAName = match.participant_a?.name || match.participant_a_id || 'Side A';
      const pBName = match.participant_b?.name || match.participant_b_id || 'Side B';

      if (!longestMatch || duration > longestMatch.durationMinutes) {
        longestMatch = { matchId: match.id, durationMinutes: duration, participantAName: pAName, participantBName: pBName };
      }
      if (!isWoOrDef && !isBye && (!shortestMatch || duration < shortestMatch.durationMinutes)) {
        shortestMatch = { matchId: match.id, durationMinutes: duration, participantAName: pAName, participantBName: pBName };
      }
    }

    // Game level records (exclude W.O., DEFAULT, BYE)
    if (!isBye && !isWoOrDef && match.games && Array.isArray(match.games)) {
      let matchPoints = 0;

      for (let i = 0; i < match.games.length; i++) {
        const g = match.games[i];
        const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
        const scoreB = g.participant_b_score ?? g.scoreB ?? 0;

        if (scoreA === 0 && scoreB === 0 && !g.isCompleted) continue;

        const totalPts = scoreA + scoreB;
        matchPoints += totalPts;
        const winScore = Math.max(scoreA, scoreB);
        const loseScore = Math.min(scoreA, scoreB);
        const margin = winScore - loseScore;
        const gameNum = g.game_number ?? g.gameNumber ?? (i + 1);

        if (!largestGameMargin || margin > largestGameMargin.margin) {
          largestGameMargin = { matchId: match.id, gameNumber: gameNum, winnerScore: winScore, loserScore: loseScore, margin };
        }
        if (!closestGame || margin < closestGame.margin || (margin === closestGame.margin && totalPts > (closestGame.winnerScore + closestGame.loserScore))) {
          closestGame = { matchId: match.id, gameNumber: gameNum, winnerScore: winScore, loserScore: loseScore, margin };
        }
        if (!mostPointsInAGame || totalPts > mostPointsInAGame.totalPoints) {
          mostPointsInAGame = { matchId: match.id, gameNumber: gameNum, totalPoints: totalPts, scoreA, scoreB };
        }
      }

      if (!mostPointsInAMatch || matchPoints > mostPointsInAMatch.totalPoints) {
        mostPointsInAMatch = { matchId: match.id, totalPoints: matchPoints };
      }
    }
  }

  // Player level records
  let longestStreak: { playerId: string; playerName?: string; streak: number } | null = null;
  let mostWins: { playerId: string; playerName?: string; wins: number } | null = null;
  let mostGames: { playerId: string; playerName?: string; games: number } | null = null;

  for (const p of playerStatsList) {
    if (p.longestWinningStreak > 0 && (!longestStreak || p.longestWinningStreak > longestStreak.streak)) {
      longestStreak = { playerId: p.playerId, playerName: p.playerName, streak: p.longestWinningStreak };
    }
    if (p.matchesWon > 0 && (!mostWins || p.matchesWon > mostWins.wins)) {
      mostWins = { playerId: p.playerId, playerName: p.playerName, wins: p.matchesWon };
    }
    if (p.gamesPlayed > 0 && (!mostGames || p.gamesPlayed > mostGames.games)) {
      mostGames = { playerId: p.playerId, playerName: p.playerName, games: p.gamesPlayed };
    }
  }

  return {
    longestMatchDuration: longestMatch,
    shortestMatchDuration: shortestMatch,
    largestGameMargin,
    closestGame,
    mostPointsInAGame,
    mostPointsInAMatch,
    longestWinningStreak: longestStreak,
    mostWins,
    mostGamesPlayed: mostGames,
  };
}

/**
 * Calculates top performance leaderboards respecting configurable minimum sample size thresholds.
 */
export function calculateLeaderboards(
  players: PlayerStats[] = [],
  options: { minMatches?: number; topN?: number } = {}
): LeaderboardsResult {
  const minMatches = options.minMatches ?? 1;
  const topN = options.topN ?? 10;

  const buildEntries = (
    sorted: PlayerStats[],
    valFn: (p: PlayerStats) => number,
    secFn?: (p: PlayerStats) => number
  ): LeaderboardEntry[] => {
    return sorted.slice(0, topN).map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      playerName: p.playerName,
      value: valFn(p),
      secondaryValue: secFn ? secFn(p) : undefined,
      matchesPlayed: p.matchesPlayed,
    }));
  };

  // 1. Most Wins
  const byWins = [...players].sort((a, b) => {
    if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
    if (b.winPercentage !== a.winPercentage) return b.winPercentage - a.winPercentage;
    return a.playerId.localeCompare(b.playerId);
  });
  const mostWins = buildEntries(byWins, p => p.matchesWon, p => p.winPercentage);

  // 2. Highest Win Percentage (filtered by minMatches)
  const byWinPct = [...players]
    .filter(p => p.matchesPlayed >= minMatches)
    .sort((a, b) => {
      if (b.winPercentage !== a.winPercentage) return b.winPercentage - a.winPercentage;
      if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
      return a.playerId.localeCompare(b.playerId);
    });
  const highestWinPercentage = buildEntries(byWinPct, p => Math.round(p.winPercentage * 10) / 10, p => p.matchesWon);

  // 3. Most Games Won
  const byGamesWon = [...players].sort((a, b) => {
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
    if (b.gameWinPercentage !== a.gameWinPercentage) return b.gameWinPercentage - a.gameWinPercentage;
    return a.playerId.localeCompare(b.playerId);
  });
  const mostGamesWon = buildEntries(byGamesWon, p => p.gamesWon, p => p.gameWinPercentage);

  // 4. Highest Game Win Percentage (filtered by minMatches)
  const byGameWinPct = [...players]
    .filter(p => p.matchesPlayed >= minMatches)
    .sort((a, b) => {
      if (b.gameWinPercentage !== a.gameWinPercentage) return b.gameWinPercentage - a.gameWinPercentage;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      return a.playerId.localeCompare(b.playerId);
    });
  const highestGameWinPercentage = buildEntries(byGameWinPct, p => Math.round(p.gameWinPercentage * 10) / 10, p => p.gamesWon);

  // 5. Most Points Scored
  const byPoints = [...players].sort((a, b) => {
    if (b.pointsScored !== a.pointsScored) return b.pointsScored - a.pointsScored;
    if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
    return a.playerId.localeCompare(b.playerId);
  });
  const mostPointsScored = buildEntries(byPoints, p => p.pointsScored, p => p.pointDifference);

  // 6. Best Point Differential
  const byPointDiff = [...players].sort((a, b) => {
    if (b.pointDifference !== a.pointDifference) return b.pointDifference - a.pointDifference;
    if (b.pointsScored !== a.pointsScored) return b.pointsScored - a.pointsScored;
    return a.playerId.localeCompare(b.playerId);
  });
  const bestPointDifferential = buildEntries(byPointDiff, p => p.pointDifference, p => p.pointsScored);

  // 7. Longest Winning Streak
  const byStreak = [...players].sort((a, b) => {
    if (b.longestWinningStreak !== a.longestWinningStreak) return b.longestWinningStreak - a.longestWinningStreak;
    if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
    return a.playerId.localeCompare(b.playerId);
  });
  const longestWinningStreak = buildEntries(byStreak, p => p.longestWinningStreak, p => p.matchesWon);

  // 8. Most Matches Played
  const byMatches = [...players].sort((a, b) => {
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
    return a.playerId.localeCompare(b.playerId);
  });
  const mostMatchesPlayed = buildEntries(byMatches, p => p.matchesPlayed, p => p.matchesWon);

  return {
    minMatchesThreshold: minMatches,
    mostWins,
    highestWinPercentage,
    mostGamesWon,
    highestGameWinPercentage,
    mostPointsScored,
    bestPointDifferential,
    longestWinningStreak,
    mostMatchesPlayed,
  };
}

/**
 * Calculates category level statistics for a specific tournament category.
 */
export function calculateCategoryStats(
  matches: MatchDataInput[] = [],
  categoryId: string,
  categoryName?: string,
  format?: string,
  participants: Array<string | ParticipantDataInput> = []
): CategoryStats {
  const catMatches = matches.filter(m => m.category_id === categoryId);

  let completedMatches = 0;
  let liveMatches = 0;
  let scheduledMatches = 0;
  let pausedMatches = 0;
  let gamesPlayed = 0;
  let pointsPlayed = 0;
  let walkoverCount = 0;
  let defaultCount = 0;
  let retirementCount = 0;
  let byeCount = 0;
  let normalCompletedCount = 0;

  let totalDurationMinutes = 0;
  let durationCount = 0;

  for (const m of catMatches) {
    const s = (m.status || '').toUpperCase();
    const outcome = (m.outcome || '').toUpperCase();

    if (s === 'COMPLETED' || s === 'FINAL') {
      completedMatches += 1;
      if (outcome === 'WALKOVER') {
        walkoverCount += 1;
      } else if (outcome === 'DEFAULT') {
        defaultCount += 1;
      } else if (outcome === 'RETIREMENT') {
        retirementCount += 1;
        normalCompletedCount += 1;
      } else if (outcome === 'BYE' || (!m.participant_b_id && m.winner_id === m.participant_a_id)) {
        byeCount += 1;
      } else {
        normalCompletedCount += 1;
      }
    } else if (s === 'LIVE' || s === 'UNDER_REVIEW') {
      liveMatches += 1;
    } else if (s === 'PAUSED') {
      pausedMatches += 1;
    } else if (s === 'SCHEDULED' || s === 'READY') {
      scheduledMatches += 1;
    }

    // Games and points (exclude W.O. / DEFAULT / BYE)
    if (outcome !== 'WALKOVER' && outcome !== 'DEFAULT' && outcome !== 'BYE') {
      if (m.games && Array.isArray(m.games)) {
        for (const g of m.games) {
          const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
          const scoreB = g.participant_b_score ?? g.scoreB ?? 0;
          pointsPlayed += scoreA + scoreB;
          if (g.isCompleted || isMatchCompleted(m.status) || scoreA > 0 || scoreB > 0) {
            gamesPlayed += 1;
          }
        }
      }
    }

    // Duration
    if (isMatchCompleted(m.status)) {
      if (m.started_at && (m.completed_at || m.ended_at)) {
        const start = new Date(m.started_at).getTime();
        const end = new Date(m.completed_at || m.ended_at!).getTime();
        if (end > start) {
          totalDurationMinutes += (end - start) / (1000 * 60);
          durationCount += 1;
        }
      } else if (typeof m.duration_minutes === 'number' && m.duration_minutes > 0) {
        totalDurationMinutes += m.duration_minutes;
        durationCount += 1;
      }
    }
  }

  const pCount = participants.length > 0
    ? participants.length
    : new Set(catMatches.flatMap(m => [m.participant_a_id, m.participant_b_id].filter(Boolean))).size;

  let standings;
  if (format === 'ROUND_ROBIN' || format === 'GROUP_KNOCKOUT' || participants.length > 0) {
    standings = calculateStandings(participants, catMatches);
  }

  return {
    categoryId,
    categoryName,
    format,
    participantCount: pCount,
    totalMatches: catMatches.length,
    completedMatches,
    liveMatches,
    scheduledMatches,
    pausedMatches,
    gamesPlayed,
    pointsPlayed,
    averageMatchDuration: durationCount > 0 ? Math.round((totalDurationMinutes / durationCount) * 10) / 10 : null,
    averagePointsPerGame: gamesPlayed > 0 ? Math.round((pointsPlayed / gamesPlayed) * 10) / 10 : 0,
    averageGamesPerMatch: completedMatches > 0 ? Math.round((gamesPlayed / completedMatches) * 10) / 10 : 0,
    walkoverCount,
    defaultCount,
    retirementCount,
    byeCount,
    normalCompletedCount,
    totalGames: gamesPlayed,
    totalPoints: pointsPlayed,
    standings,
  };
}

/**
 * Calculates tournament-wide and category-level aggregate statistics from reliable match and court data.
 */
export function calculateTournamentStats(params: {
  matches?: MatchDataInput[];
  categories?: Array<{ id: string; name?: string; format?: string; matches?: MatchDataInput[]; participants?: Array<string | ParticipantDataInput> }>;
  courts?: Array<{ id: string; name?: string }>;
  participants?: Array<string | ParticipantDataInput>;
  playerStatsList?: PlayerStats[];
  minMatchesLeaderboard?: number;
}): TournamentStats {
  const {
    matches: directMatches = [],
    categories = [],
    courts = [],
    participants = [],
    playerStatsList = [],
    minMatchesLeaderboard = 1,
  } = params;

  // Flatten matches from categories or direct array, deduplicating by ID
  const allMatchesMap = new Map<string, MatchDataInput>();

  for (const m of directMatches) {
    if (m.id) allMatchesMap.set(m.id, m);
  }

  for (const cat of categories) {
    if (cat.matches && Array.isArray(cat.matches)) {
      for (const m of cat.matches) {
        if (m.id && !allMatchesMap.has(m.id)) {
          allMatchesMap.set(m.id, { ...m, category_id: m.category_id || cat.id });
        }
      }
    }
  }

  const allMatches = Array.from(allMatchesMap.values());

  let totalGames = 0;
  let totalPoints = 0;
  let completedCount = 0;
  let finalizedCount = 0;
  let liveCount = 0;
  let readyCount = 0;
  let scheduledCount = 0;
  let pausedCount = 0;
  let underReviewCount = 0;
  let cancelledCount = 0;

  let walkovers = 0;
  let defaults = 0;
  let retirements = 0;
  let byes = 0;
  let normalCompletedMatches = 0;

  let totalDurationMinutes = 0;
  let durationMatchesCount = 0;

  for (const m of allMatches) {
    const s = (m.status || '').toUpperCase();
    const outcome = (m.outcome || '').toUpperCase();

    if (s === 'COMPLETED' || s === 'FINAL') {
      completedCount += 1;
      if (s === 'FINAL') finalizedCount += 1;

      if (outcome === 'WALKOVER') {
        walkovers += 1;
      } else if (outcome === 'DEFAULT') {
        defaults += 1;
      } else if (outcome === 'RETIREMENT') {
        retirements += 1;
        normalCompletedMatches += 1;
      } else if (outcome === 'BYE' || (!m.participant_b_id && m.winner_id === m.participant_a_id)) {
        byes += 1;
      } else {
        normalCompletedMatches += 1;
      }
    } else if (s === 'LIVE') {
      liveCount += 1;
    } else if (s === 'UNDER_REVIEW') {
      underReviewCount += 1;
      liveCount += 1;
    } else if (s === 'PAUSED') {
      pausedCount += 1;
    } else if (s === 'READY') {
      readyCount += 1;
      scheduledCount += 1;
    } else if (s === 'SCHEDULED') {
      scheduledCount += 1;
    } else if (s === 'CANCELLED') {
      cancelledCount += 1;
    }

    // Process games and points (exclude W.O., DEFAULT, BYE)
    if (outcome !== 'WALKOVER' && outcome !== 'DEFAULT' && outcome !== 'BYE') {
      if (m.games && Array.isArray(m.games)) {
        for (const g of m.games) {
          const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
          const scoreB = g.participant_b_score ?? g.scoreB ?? 0;
          totalPoints += scoreA + scoreB;
          if (g.isCompleted || isMatchCompleted(m.status) || scoreA > 0 || scoreB > 0) {
            totalGames += 1;
          }
        }
      }
    }

    // Process duration
    if (isMatchCompleted(m.status)) {
      if (m.started_at && (m.completed_at || m.ended_at)) {
        const start = new Date(m.started_at).getTime();
        const end = new Date(m.completed_at || m.ended_at!).getTime();
        if (end > start) {
          totalDurationMinutes += (end - start) / (1000 * 60);
          durationMatchesCount += 1;
        }
      } else if (typeof m.duration_minutes === 'number' && m.duration_minutes > 0) {
        totalDurationMinutes += m.duration_minutes;
        durationMatchesCount += 1;
      }
    }
  }

  // Participants counts
  const totalPart = participants.length > 0
    ? participants.length
    : new Set(allMatches.flatMap(m => [m.participant_a_id, m.participant_b_id].filter(Boolean))).size;

  const approvedPart = participants.filter(p => typeof p === 'object' && ((p as any).status === 'ACTIVE' || (p as any).status === 'APPROVED')).length || totalPart;
  const registeredPart = participants.length > 0 ? participants.length : totalPart;

  // Category statistics breakdown
  const categoryStats: CategoryStats[] = categories.map(cat => {
    return calculateCategoryStats(allMatches, cat.id, cat.name, cat.format, cat.participants || []);
  });

  // Court utilization
  const courtUtilization: CourtUtilizationStats[] = courts.map(court => {
    const courtMatches = allMatches.filter(m => m.court_id === court.id);
    const assigned = courtMatches.length;
    const comp = courtMatches.filter(m => isMatchCompleted(m.status)).length;
    const inUse = courtMatches.some(m => {
      const s = (m.status || '').toUpperCase();
      return s === 'LIVE' || s === 'UNDER_REVIEW';
    });

    return {
      courtId: court.id,
      courtName: court.name,
      matchesAssigned: assigned,
      matchesCompleted: comp,
      isCurrentlyInUse: inUse,
    };
  });

  // Calculate Badminton analytics, records, and leaderboards
  const badmintonAnalytics = calculateBadmintonAnalytics(allMatches);
  const records = calculateTournamentRecords(allMatches, playerStatsList);
  const leaderboards = calculateLeaderboards(playerStatsList, { minMatches: minMatchesLeaderboard });

  const totalMatchCount = allMatches.length;
  const completionPercentage = totalMatchCount > 0 ? Math.round(((completedCount / totalMatchCount) * 100) * 10) / 10 : 0;
  const liveMatchPercentage = totalMatchCount > 0 ? Math.round(((liveCount / totalMatchCount) * 100) * 10) / 10 : 0;
  const completedMatchPercentage = completionPercentage;

  return {
    totalParticipants: totalPart,
    registeredParticipants: registeredPart,
    approvedParticipants: approvedPart,
    totalMatches: totalMatchCount,
    scheduledMatches: scheduledCount,
    readyMatches: readyCount,
    liveMatches: liveCount,
    pausedMatches: pausedCount,
    completedMatches: completedCount,
    finalizedMatches: finalizedCount,
    matchesUnderReview: underReviewCount,
    cancelledMatches: cancelledCount,
    totalGames,
    totalPoints,
    averagePointsPerGame: totalGames > 0 ? Math.round((totalPoints / totalGames) * 10) / 10 : 0,
    averageGamesPerMatch: completedCount > 0 ? Math.round((totalGames / completedCount) * 10) / 10 : 0,
    averageMatchDurationMinutes: durationMatchesCount > 0 ? Math.round((totalDurationMinutes / durationMatchesCount) * 10) / 10 : null,
    averagePointsPerMatch: completedCount > 0 ? Math.round((totalPoints / completedCount) * 10) / 10 : 0,
    walkovers,
    defaults,
    retirements,
    byes,
    normalCompletedMatches,
    completionPercentage,
    liveMatchPercentage,
    completedMatchPercentage,
    categoryStats,
    courtUtilization: courts.length > 0 ? courtUtilization : undefined,
    records,
    leaderboards,
    badmintonAnalytics,
  };
}
