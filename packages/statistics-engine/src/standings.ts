import {
  StandingEntry,
  StandingsResult,
  StandingsOptions,
  ParticipantDataInput,
  MatchDataInput,
  DEFAULT_FAIR_PLAY_CONFIG,
  FairPlayConfig,
} from './types';

export function isMatchCompleted(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === 'COMPLETED' || s === 'FINAL';
}

export function extractParticipantId(item: any): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    return item.participant_id || item.participantId || item.id || '';
  }
  return '';
}

export function extractParticipantName(item: any): string | undefined {
  if (item && typeof item === 'object') {
    return item.participant_name || item.participantName || item.name || undefined;
  }
  return undefined;
}

/**
 * Explains why an entry was ranked above adjacent entries according to sport tie-break rules.
 */
export function generateTieBreakExplanations(
  ranked: StandingEntry[],
  matches: MatchDataInput[] = [],
  options: StandingsOptions = {}
): { explanations: Record<string, string>; details: Record<string, any> } {
  const explanations: Record<string, string> = {};
  const details: Record<string, any> = {};

  if (ranked.length === 0) return { explanations, details };

  const isFootball = options.sport?.toUpperCase() === 'FOOTBALL' ||
    matches.some(m => m.score_a !== undefined || m.category?.sport?.toUpperCase() === 'FOOTBALL' || m.match_phase !== undefined);

  for (let i = 0; i < ranked.length; i++) {
    const current = ranked[i];
    const pId = current.participant_id;

    // 1. Manual Rank Override
    if (current.is_manually_resolved && current.manual_rank_override) {
      const exp = `Manual rank override applied (Rank ${current.manual_rank_override}).`;
      explanations[pId] = exp;
      details[pId] = { ruleApplied: 'MANUAL_OVERRIDE', valuesCompared: `Override=${current.manual_rank_override}` };
      current.tieBreakReason = exp;
      current.tieBreakDetails = details[pId];
      continue;
    }

    if (isFootball) {
      const curPts = current.points ?? (current.won * (options.pointsPerWin ?? 3) + (current.draws ?? 0) * (options.pointsPerDraw ?? 1));
      
      // Rank 1 clear leader on points
      if (i === 0) {
        if (ranked.length === 1) {
          const exp = `Points`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'POINTS' };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        const next = ranked[1];
        const nextPts = next.points ?? (next.won * (options.pointsPerWin ?? 3) + (next.draws ?? 0) * (options.pointsPerDraw ?? 1));

        if (curPts > nextPts) {
          const exp = `Points`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'POINTS', valuesCompared: `${curPts} > ${nextPts}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }
      }

      const prev = i > 0 ? ranked[i - 1] : null;
      const next = i < ranked.length - 1 ? ranked[i + 1] : null;

      const prevPts = prev ? (prev.points ?? (prev.won * (options.pointsPerWin ?? 3) + (prev.draws ?? 0) * (options.pointsPerDraw ?? 1))) : null;
      const nextPts = next ? (next.points ?? (next.won * (options.pointsPerWin ?? 3) + (next.draws ?? 0) * (options.pointsPerDraw ?? 1))) : null;

      const prevTiedOnPts = prev !== null && prevPts === curPts;
      const nextTiedOnPts = next !== null && nextPts === curPts;

      if (!prevTiedOnPts && !nextTiedOnPts) {
        const exp = `Points`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'POINTS', valuesCompared: `${curPts} pts` };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
        continue;
      }

      const compared = prevTiedOnPts ? prev : next;
      if (!compared) continue;
      const compName = compared.participant_name || compared.participantName || compared.participant_id;

      // Check Goal Difference
      const curGD = current.goal_diff ?? current.points_diff;
      const compGD = compared.goal_diff ?? compared.points_diff;

      if (curGD !== compGD) {
        const exp = `Goal Difference`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'GOAL_DIFFERENCE', comparedWith: compName, valuesCompared: `${curGD} vs ${compGD}` };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
        continue;
      }

      // Check Goals For
      const curGF = current.goals_for ?? current.points_for;
      const compGF = compared.goals_for ?? compared.points_for;

      if (curGF !== compGF) {
        const exp = `Goals For`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'GOALS_FOR', comparedWith: compName, valuesCompared: `${curGF} vs ${compGF}` };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
        continue;
      }

      // Check Head-to-Head among tied teams
      if (matches.length > 0) {
        const pA = current.participant_id;
        const pB = compared.participant_id;

        const h2hMatch = matches.find(m =>
          isMatchCompleted(m.status) &&
          m.winner_id &&
          ((m.participant_a_id === pA && m.participant_b_id === pB) ||
           (m.participant_a_id === pB && m.participant_b_id === pA))
        );

        if (h2hMatch) {
          if (h2hMatch.winner_id === pA && i < ranked.indexOf(compared)) {
            const exp = `Head-to-Head`;
            explanations[pId] = exp;
            details[pId] = { ruleApplied: 'HEAD_TO_HEAD', comparedWith: compName, valuesCompared: `H2H Winner: ${pA}` };
            current.tieBreakReason = exp;
            current.tieBreakDetails = details[pId];
            continue;
          } else if (h2hMatch.winner_id === compared.participant_id && i > ranked.indexOf(compared)) {
            const exp = `Head-to-Head`;
            explanations[pId] = exp;
            details[pId] = { ruleApplied: 'HEAD_TO_HEAD', comparedWith: compName, valuesCompared: `H2H Winner: ${compared.participant_id}` };
            current.tieBreakReason = exp;
            current.tieBreakDetails = details[pId];
            continue;
          }
        }
      }

      // Check Fair Play
      const curFP = current.fair_play_points ?? current.fairPlayPoints ?? 0;
      const compFP = compared.fair_play_points ?? compared.fairPlayPoints ?? 0;
      if (curFP !== compFP) {
        const exp = `Fair Play`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'FAIR_PLAY', comparedWith: compName, valuesCompared: `${curFP} vs ${compFP}` };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
        continue;
      }

      // All criteria equal -> deterministic fallback
      const exp = `Deterministic Fallback`;
      explanations[pId] = exp;
      details[pId] = { ruleApplied: 'DETERMINISTIC_FALLBACK', comparedWith: compName };
      current.tieBreakReason = exp;
      current.tieBreakDetails = details[pId];

    } else {
      // BADMINTON TIE-BREAK EXPLANATIONS
      if (i === 0) {
        if (ranked.length === 1) {
          const exp = `Sole group participant.`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'SOLE_PARTICIPANT' };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        const next = ranked[1];
        const curWon = current.won;
        const nextWon = next.won;

        if (curWon > nextWon) {
          const exp = `Ranked #1 by match wins (${curWon} vs ${nextWon}).`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'MATCH_WINS', valuesCompared: `${curWon} > ${nextWon}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }
      }

      const prev = i > 0 ? ranked[i - 1] : null;
      const next = i < ranked.length - 1 ? ranked[i + 1] : null;

      const prevTiedOnWins = prev && prev.won === current.won;
      const nextTiedOnWins = next && next.won === current.won;

      if (!prevTiedOnWins && !nextTiedOnWins) {
        const exp = `Ranked by match wins (${current.won} wins).`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'MATCH_WINS', valuesCompared: `${current.won} wins` };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
        continue;
      }

      const compared = prevTiedOnWins ? prev : next;
      if (!compared) continue;
      const compName = compared.participant_name || compared.participantName || compared.participant_id;

      const tiedOnWinsCount = ranked.filter(e => e.won === current.won).length;
      let h2hDecided = false;

      if (tiedOnWinsCount === 2 && matches.length > 0 && compared) {
        const pA = current.participant_id;
        const pB = compared.participant_id;

        const h2hMatch = matches.find(m =>
          isMatchCompleted(m.status) &&
          m.winner_id &&
          ((m.participant_a_id === pA && m.participant_b_id === pB) ||
           (m.participant_a_id === pB && m.participant_b_id === pA))
        );

        if (h2hMatch) {
          if (h2hMatch.winner_id === pA && i < ranked.indexOf(compared)) {
            const exp = `Tied on wins (${current.won}); advanced by Head-to-Head victory over ${compName}.`;
            explanations[pId] = exp;
            details[pId] = { ruleApplied: 'HEAD_TO_HEAD', comparedWith: compName, valuesCompared: `H2H Winner: ${pA}` };
            current.tieBreakReason = exp;
            current.tieBreakDetails = details[pId];
            h2hDecided = true;
            continue;
          } else if (h2hMatch.winner_id === compared.participant_id && i > ranked.indexOf(compared)) {
            const exp = `Tied on wins (${current.won}); conceded Head-to-Head against ${compName}.`;
            explanations[pId] = exp;
            details[pId] = { ruleApplied: 'HEAD_TO_HEAD', comparedWith: compName, valuesCompared: `H2H Winner: ${compared.participant_id}` };
            current.tieBreakReason = exp;
            current.tieBreakDetails = details[pId];
            h2hDecided = true;
            continue;
          }
        }
      }

      if (!h2hDecided && compared) {
        if (current.games_diff !== compared.games_diff) {
          const sign = current.games_diff > 0 ? '+' : '';
          const compSign = compared.games_diff > 0 ? '+' : '';
          const exp = `Tied on wins (${current.won}); decided by game differential (${sign}${current.games_diff} vs ${compSign}${compared.games_diff}).`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'GAME_DIFFERENCE', comparedWith: compName, valuesCompared: `${current.games_diff} vs ${compared.games_diff}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        if (current.games_won !== compared.games_won) {
          const exp = `Tied on wins and game differential; decided by total games won (${current.games_won} vs ${compared.games_won}).`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'GAMES_WON', comparedWith: compName, valuesCompared: `${current.games_won} vs ${compared.games_won}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        if (current.points_diff !== compared.points_diff) {
          const sign = current.points_diff > 0 ? '+' : '';
          const compSign = compared.points_diff > 0 ? '+' : '';
          const exp = `Tied through games; decided by point differential (${sign}${current.points_diff} vs ${compSign}${compared.points_diff}).`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'POINT_DIFFERENCE', comparedWith: compName, valuesCompared: `${current.points_diff} vs ${compared.points_diff}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        if (current.points_for !== compared.points_for) {
          const exp = `Tied through point differential; decided by total points scored (${current.points_for} vs ${compared.points_for}).`;
          explanations[pId] = exp;
          details[pId] = { ruleApplied: 'POINTS_SCORED', comparedWith: compName, valuesCompared: `${current.points_for} vs ${compared.points_for}` };
          current.tieBreakReason = exp;
          current.tieBreakDetails = details[pId];
          continue;
        }

        const exp = `Tied with ${compName} on all criteria; ordered by deterministic fallback.`;
        explanations[pId] = exp;
        details[pId] = { ruleApplied: 'UNRESOLVED_TIE', comparedWith: compName };
        current.tieBreakReason = exp;
        current.tieBreakDetails = details[pId];
      }
    }
  }

  return { explanations, details };
}

/**
 * Sorts and ranks an array of standings entries according to sport-specific or configurable tie-break rules.
 */
export function sortStandings(
  entries: Array<StandingEntry | any>,
  matches: Array<MatchDataInput | any> = [],
  options: StandingsOptions = {}
): StandingsResult {
  const isFootball = options.sport?.toUpperCase() === 'FOOTBALL' ||
    matches.some(m => m.score_a !== undefined || m.category?.sport?.toUpperCase() === 'FOOTBALL' || m.match_phase !== undefined);

  const ptsPerWin = options.pointsPerWin ?? (isFootball ? 3 : 1);
  const ptsPerDraw = options.pointsPerDraw ?? (isFootball ? 1 : 0);
  const ptsPerLoss = options.pointsPerLoss ?? 0;

  const sorted: StandingEntry[] = entries.map(e => {
    const ptsFor = e.points_for ?? e.pointsFor ?? e.goals_for ?? e.goalsFor ?? 0;
    const ptsAgainst = e.points_against ?? e.pointsAgainst ?? e.goals_against ?? e.goalsAgainst ?? 0;
    const gWon = e.games_won ?? e.gamesWon ?? 0;
    const gLost = e.games_lost ?? e.gamesLost ?? 0;
    const played = e.played ?? 0;
    const won = e.won ?? e.wins ?? 0;
    const lost = e.lost ?? e.losses ?? 0;
    const draws = e.draws ?? 0;
    const pDiff = ptsFor - ptsAgainst;
    const gDiff = gWon - gLost;
    const totalPts = e.points ?? e.league_points ?? (won * ptsPerWin + draws * ptsPerDraw + lost * ptsPerLoss);
    const winPct = played > 0 ? (won / played) * 100 : 0;

    return {
      ...e,
      id: e.id,
      standings_id: e.standings_id,
      participant_id: e.participant_id || e.participantId || e.id || '',
      participantId: e.participant_id || e.participantId || e.id || '',
      participant_name: e.participant_name || e.participantName || e.name,
      participantName: e.participant_name || e.participantName || e.name,
      played,
      won,
      lost,
      draws,
      points: totalPts,
      league_points: totalPts,
      points_for: ptsFor,
      pointsFor: ptsFor,
      points_against: ptsAgainst,
      pointsAgainst: ptsAgainst,
      points_diff: pDiff,
      pointDifference: pDiff,
      goals_for: ptsFor,
      goalsFor: ptsFor,
      goals_against: ptsAgainst,
      goalsAgainst: ptsAgainst,
      goal_diff: pDiff,
      goalDifference: pDiff,
      games_won: gWon,
      gamesWon: gWon,
      games_lost: gLost,
      gamesLost: gLost,
      games_diff: gDiff,
      gameDifference: gDiff,
      win_percentage: winPct,
      winPercentage: winPct,
      rank: e.rank ?? 1,
      is_manually_resolved: e.is_manually_resolved ?? false,
      manual_rank_override: e.manual_rank_override ?? null,
      qualificationStatus: e.qualificationStatus ?? null,
    };
  });

  const footballTieBreakOrder = options.tieBreakOrder || [
    'POINTS',
    'GOAL_DIFFERENCE',
    'GOALS_FOR',
    'HEAD_TO_HEAD',
    'FAIR_PLAY',
    'DETERMINISTIC_FALLBACK'
  ];

  sorted.sort((a, b) => {
    // 1. Manual Override
    if (a.is_manually_resolved && a.manual_rank_override && b.is_manually_resolved && b.manual_rank_override) {
      return a.manual_rank_override - b.manual_rank_override;
    }
    if (a.is_manually_resolved && a.manual_rank_override) return -1;
    if (b.is_manually_resolved && b.manual_rank_override) return 1;

    if (isFootball) {
      for (const rule of footballTieBreakOrder) {
        if (rule === 'POINTS') {
          const aPts = a.points ?? 0;
          const bPts = b.points ?? 0;
          if (aPts !== bPts) return bPts - aPts;
        } else if (rule === 'GOAL_DIFFERENCE') {
          const aGD = a.goal_diff ?? a.points_diff;
          const bGD = b.goal_diff ?? b.points_diff;
          if (aGD !== bGD) return bGD - aGD;
        } else if (rule === 'GOALS_FOR') {
          const aGF = a.goals_for ?? a.points_for;
          const bGF = b.goals_for ?? b.points_for;
          if (aGF !== bGF) return bGF - aGF;
        } else if (rule === 'HEAD_TO_HEAD') {
          if (matches.length > 0) {
            const pA = a.participant_id;
            const pB = b.participant_id;
            const h2hMatch = matches.find(m =>
              isMatchCompleted(m.status) &&
              m.outcome !== 'ABANDONED' &&
              ((m.participant_a_id === pA && m.participant_b_id === pB) ||
               (m.participant_a_id === pB && m.participant_b_id === pA))
            );
            if (h2hMatch) {
              if (h2hMatch.winner_id === pA) return -1;
              if (h2hMatch.winner_id === pB) return 1;
              // If tied match, check H2H goal difference
              const isAMatchA = h2hMatch.participant_a_id === pA;
              const aScore = isAMatchA ? (h2hMatch.score_a ?? 0) : (h2hMatch.score_b ?? 0);
              const bScore = isAMatchA ? (h2hMatch.score_b ?? 0) : (h2hMatch.score_a ?? 0);
              if (aScore !== bScore) return bScore - aScore;
            }
          }
        } else if (rule === 'FAIR_PLAY') {
          const aFP = a.fair_play_points ?? a.fairPlayPoints ?? 0;
          const bFP = b.fair_play_points ?? b.fairPlayPoints ?? 0;
          if (aFP !== bFP) return bFP - aFP; // Higher is better (less negative penalties)
        } else if (rule === 'DETERMINISTIC_FALLBACK') {
          return (a.participant_id || '').localeCompare(b.participant_id || '');
        }
      }
      return (a.participant_id || '').localeCompare(b.participant_id || '');

    } else {
      // BADMINTON HIERARCHY
      // 2. Wins
      const aWon = a.won;
      const bWon = b.won;
      if (aWon !== bWon) {
        return bWon - aWon;
      }

      // 3. Head-to-Head when exactly 2 tied on wins
      const tiedOnWins = entries.filter(e => (e.won ?? e.wins ?? 0) === aWon);
      if (tiedOnWins.length === 2 && matches.length > 0) {
        const pA = a.participant_id;
        const pB = b.participant_id;
        const h2hMatch = matches.find(m =>
          isMatchCompleted(m.status) &&
          m.winner_id &&
          ((m.participant_a_id === pA && m.participant_b_id === pB) ||
           (m.participant_a_id === pB && m.participant_b_id === pA))
        );
        if (h2hMatch) {
          if (h2hMatch.winner_id === pA) return -1;
          if (h2hMatch.winner_id === pB) return 1;
        }
      }

      // 4. Game difference (games_diff desc)
      if (a.games_diff !== b.games_diff) {
        return b.games_diff - a.games_diff;
      }

      // 5. Games won (games_won desc)
      if (a.games_won !== b.games_won) {
        return b.games_won - a.games_won;
      }

      // 6. Point difference (points_diff desc)
      if (a.points_diff !== b.points_diff) {
        return b.points_diff - a.points_diff;
      }

      // 7. Points scored (points_for desc)
      if (a.points_for !== b.points_for) {
        return b.points_for - a.points_for;
      }

      // Deterministic fallback by participant_id
      return (a.participant_id || '').localeCompare(b.participant_id || '');
    }
  });

  // Check for unresolved ties
  let hasTies = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];

    if (isFootball) {
      const samePts = a.points === b.points;
      const sameGD = a.goal_diff === b.goal_diff;
      const sameGF = a.goals_for === b.goals_for;
      const bothNotResolved = !a.is_manually_resolved && !b.is_manually_resolved;

      if (samePts && sameGD && sameGF && bothNotResolved) {
        const pA = a.participant_id;
        const pB = b.participant_id;
        const h2hMatch = matches.find(m =>
          isMatchCompleted(m.status) &&
          m.winner_id &&
          ((m.participant_a_id === pA && m.participant_b_id === pB) ||
           (m.participant_a_id === pB && m.participant_b_id === pA))
        );
        if (!h2hMatch) {
          hasTies = true;
        }
      }
    } else {
      const sameWins = a.won === b.won;
      const sameGameDiff = a.games_diff === b.games_diff;
      const sameGamesWon = a.games_won === b.games_won;
      const samePointsDiff = a.points_diff === b.points_diff;
      const samePointsFor = a.points_for === b.points_for;
      const bothNotResolved = !a.is_manually_resolved && !b.is_manually_resolved;

      if (sameWins && sameGameDiff && sameGamesWon && samePointsDiff && samePointsFor && bothNotResolved) {
        const tiedOnWins = entries.filter(e => (e.won ?? e.wins ?? 0) === a.won);
        if (tiedOnWins.length === 2 && matches.length > 0) {
          const pA = a.participant_id;
          const pB = b.participant_id;
          const h2hMatch = matches.find(m =>
            isMatchCompleted(m.status) &&
            m.winner_id &&
            ((m.participant_a_id === pA && m.participant_b_id === pB) ||
             (m.participant_a_id === pB && m.participant_b_id === pA))
          );
          if (!h2hMatch) {
            hasTies = true;
          }
        } else {
          hasTies = true;
        }
      }
    }
  }

  // Assign ranks
  const ranked: StandingEntry[] = sorted.map((entry, idx) => ({
    ...entry,
    rank: entry.is_manually_resolved && entry.manual_rank_override ? entry.manual_rank_override : idx + 1,
  }));

  // Generate explainable tie-break reasons
  const { explanations } = generateTieBreakExplanations(ranked, matches, options);

  return {
    sortedEntries: ranked,
    hasTies,
    tieBreakExplanations: explanations,
  };
}

/**
 * Calculate Round Robin / Group Stage standings from participants and matches.
 */
export function calculateStandings(
  participantsOrEntries: Array<string | ParticipantDataInput | Partial<StandingEntry>>,
  matches: MatchDataInput[] = [],
  options: StandingsOptions = {}
): StandingsResult {
  if (!participantsOrEntries || participantsOrEntries.length === 0) {
    return { sortedEntries: [], hasTies: false, tieBreakExplanations: {} };
  }

  const isFootball = options.sport?.toUpperCase() === 'FOOTBALL' ||
    matches.some(m => m.score_a !== undefined || m.category?.sport?.toUpperCase() === 'FOOTBALL' || m.match_phase !== undefined);

  const ptsPerWin = options.pointsPerWin ?? (isFootball ? 3 : 1);
  const ptsPerDraw = options.pointsPerDraw ?? (isFootball ? 1 : 0);
  const ptsPerLoss = options.pointsPerLoss ?? 0;

  // 1. Build initial entry map
  const entryMap = new Map<string, StandingEntry>();

  for (const item of participantsOrEntries) {
    const pId = extractParticipantId(item);
    if (!pId) continue;

    const partial = typeof item === 'object' ? (item as any) : {};
    const pName = extractParticipantName(item);

    const entry: StandingEntry = {
      participant_id: pId,
      participantId: pId,
      participant_name: pName,
      participantName: pName,
      played: partial.played ?? 0,
      won: partial.won ?? partial.wins ?? 0,
      lost: partial.lost ?? partial.losses ?? 0,
      draws: partial.draws ?? 0,
      points: partial.points ?? partial.league_points ?? 0,
      league_points: partial.points ?? partial.league_points ?? 0,
      points_for: partial.points_for ?? partial.pointsFor ?? partial.goals_for ?? partial.goalsFor ?? 0,
      points_against: partial.points_against ?? partial.pointsAgainst ?? partial.goals_against ?? partial.goalsAgainst ?? 0,
      points_diff: 0,
      pointDifference: 0,
      goals_for: partial.goals_for ?? partial.goalsFor ?? partial.points_for ?? 0,
      goalsFor: partial.goals_for ?? partial.goalsFor ?? partial.points_for ?? 0,
      goals_against: partial.goals_against ?? partial.goalsAgainst ?? partial.points_against ?? 0,
      goalsAgainst: partial.goals_against ?? partial.goalsAgainst ?? partial.points_against ?? 0,
      goal_diff: 0,
      goalDifference: 0,
      fair_play_points: partial.fair_play_points ?? partial.fairPlayPoints ?? 0,
      fairPlayPoints: partial.fair_play_points ?? partial.fairPlayPoints ?? 0,
      yellow_cards: partial.yellow_cards ?? 0,
      red_cards: partial.red_cards ?? 0,
      games_won: partial.games_won ?? partial.gamesWon ?? 0,
      games_lost: partial.games_lost ?? partial.gamesLost ?? 0,
      games_diff: 0,
      gameDifference: 0,
      win_percentage: 0,
      winPercentage: 0,
      rank: partial.rank ?? 1,
      is_manually_resolved: partial.is_manually_resolved ?? false,
      manual_rank_override: partial.manual_rank_override ?? null,
      qualificationStatus: partial.qualificationStatus ?? null,
    };

    entryMap.set(pId, entry);
  }

  // 2. Compute stats from matches if entries are raw/uncomputed
  const allZero = Array.from(entryMap.values()).every(
    e => e.played === 0 && e.won === 0 && e.lost === 0 && e.points_for === 0 && e.points_against === 0 && e.games_won === 0 && e.games_lost === 0
  );

  if (allZero && matches.length > 0) {
    for (const match of matches) {
      const pAId = match.participant_a_id || match.participant_a?.id;
      const pBId = match.participant_b_id || match.participant_b?.id;
      if (!pAId || !pBId) continue;

      const entryA = entryMap.get(pAId);
      const entryB = entryMap.get(pBId);

      // Only completed matches count towards official standings
      if (isMatchCompleted(match.status)) {
        const outcome = (match.outcome || '').toUpperCase();

        // Abandoned matches do NOT count towards standings
        if (outcome === 'ABANDONED') continue;

        // BYE matches do NOT count as played matches
        const isBye = outcome === 'BYE' || (!match.participant_b_id && match.winner_id === match.participant_a_id);
        if (isBye) continue;

        if (entryA) entryA.played += 1;
        if (entryB) entryB.played += 1;

        if (outcome === 'WALKOVER' || outcome === 'DEFAULT') {
          if (match.winner_id === pAId) {
            if (entryA) {
              entryA.won += 1;
              entryA.points_for += 3;
            }
            if (entryB) {
              entryB.lost += 1;
              entryB.points_against += 3;
            }
          } else if (match.winner_id === pBId) {
            if (entryB) {
              entryB.won += 1;
              entryB.points_for += 3;
            }
            if (entryA) {
              entryA.lost += 1;
              entryA.points_against += 3;
            }
          }
          continue;
        }

        // Football Match Scores (score_a / score_b)
        if (match.score_a !== undefined && match.score_a !== null && match.score_b !== undefined && match.score_b !== null) {
          const scoreA = match.score_a ?? match.scoreA ?? 0;
          const scoreB = match.score_b ?? match.scoreB ?? 0;
          if (entryA) {
            entryA.points_for += scoreA;
            entryA.points_against += scoreB;
          }
          if (entryB) {
            entryB.points_for += scoreB;
            entryB.points_against += scoreA;
          }

          if (scoreA > scoreB) {
            if (entryA) entryA.won += 1;
            if (entryB) entryB.lost += 1;
          } else if (scoreB > scoreA) {
            if (entryB) entryB.won += 1;
            if (entryA) entryA.lost += 1;
          } else {
            // Drawn match in regulation
            if (entryA) entryA.draws = (entryA.draws || 0) + 1;
            if (entryB) entryB.draws = (entryB.draws || 0) + 1;
          }

          // Count cards for Fair Play points using configurable FairPlayConfig policy
          const events: any[] = match.match_events || match.events || [];
          const fpConfig = {
            ...DEFAULT_FAIR_PLAY_CONFIG,
            ...options.fairPlayConfig
          };

          const processTeamCards = (isSideA: boolean, entry: any) => {
            if (!entry) return;
            const targetSide = isSideA ? 'A' : 'B';
            const targetPId = isSideA ? pAId : pBId;

            // Group cards by player to accurately compute single yellow, second yellow, direct red, yellow + direct red
            const playerCards: Record<string, { yellows: number; directReds: number }> = {};

            for (const ev of events) {
              const evType = (ev.event_type || ev.type || '').toUpperCase();
              const evTeam = (ev.team || ev.side || ev.metadata?.team || ev.metadata?.side || '').toUpperCase();
              const isMatchTeam = evTeam === targetSide || ev.participant_id === targetPId || ev.metadata?.participant_id === targetPId || ev.metadata?.teamId === targetPId;
              if (!isMatchTeam) continue;

              const playerId = ev.playerId || ev.detail?.playerId || ev.metadata?.playerId || ev.metadata?.player_id || `anon_${Math.random()}`;
              if (!playerCards[playerId]) {
                playerCards[playerId] = { yellows: 0, directReds: 0 };
              }

              if (evType === 'YELLOW_CARD') {
                playerCards[playerId].yellows += 1;
              } else if (evType === 'RED_CARD') {
                playerCards[playerId].directReds += 1;
              }
            }

            for (const pId in playerCards) {
              const { yellows, directReds } = playerCards[pId];
              if (yellows >= 2) {
                // Second yellow dismissal (net weight e.g. -3 points)
                entry.yellow_cards = (entry.yellow_cards || 0) + 2;
                entry.second_yellows = (entry.second_yellows || 0) + 1;
                entry.red_cards = (entry.red_cards || 0) + 1;
                entry.fair_play_points = (entry.fair_play_points || 0) + fpConfig.secondYellowWeight;
              } else if (yellows === 1 && directReds === 0) {
                // Single yellow card (e.g. -1 point)
                entry.yellow_cards = (entry.yellow_cards || 0) + 1;
                entry.fair_play_points = (entry.fair_play_points || 0) + fpConfig.yellowCardWeight;
              } else if (yellows === 0 && directReds > 0) {
                // Direct red card (e.g. -4 points)
                entry.red_cards = (entry.red_cards || 0) + directReds;
                entry.fair_play_points = (entry.fair_play_points || 0) + (fpConfig.directRedCardWeight * directReds);
              } else if (yellows === 1 && directReds > 0) {
                // Yellow + Direct Red (e.g. -5 points)
                entry.yellow_cards = (entry.yellow_cards || 0) + 1;
                entry.red_cards = (entry.red_cards || 0) + directReds;
                entry.fair_play_points = (entry.fair_play_points || 0) + fpConfig.yellowPlusDirectRedWeight;
              }
            }
          };

          processTeamCards(true, entryA);
          processTeamCards(false, entryB);

        } else {
          // Standard / Badminton Match Result
          if (match.winner_id === pAId) {
            if (entryA) entryA.won += 1;
            if (entryB) entryB.lost += 1;
          } else if (match.winner_id === pBId) {
            if (entryB) entryB.won += 1;
            if (entryA) entryA.lost += 1;
          } else {
            if (entryA) entryA.draws = (entryA.draws || 0) + 1;
            if (entryB) entryB.draws = (entryB.draws || 0) + 1;
          }
        }

        // Badminton Games Processing
        if (match.outcome !== 'WALKOVER' && match.outcome !== 'DEFAULT' && match.games && Array.isArray(match.games) && match.games.length > 0) {
          for (const g of match.games) {
            const scoreA = g.participant_a_score ?? g.scoreA ?? 0;
            const scoreB = g.participant_b_score ?? g.scoreB ?? 0;

            if (entryA) {
              entryA.points_for += scoreA;
              entryA.points_against += scoreB;
            }
            if (entryB) {
              entryB.points_for += scoreB;
              entryB.points_against += scoreA;
            }

            if (g.winner_id === pAId || g.winnerId === 'PARTICIPANT_A' || (scoreA > scoreB && (g.isCompleted || isMatchCompleted(g.status || '')))) {
              if (entryA) entryA.games_won += 1;
              if (entryB) entryB.games_lost += 1;
            } else if (g.winner_id === pBId || g.winnerId === 'PARTICIPANT_B' || (scoreB > scoreA && (g.isCompleted || isMatchCompleted(g.status || '')))) {
              if (entryB) entryB.games_won += 1;
              if (entryA) entryA.games_lost += 1;
            }
          }
        }
      }
    }
  }

  // 3. Compute derived differentials and percentages
  for (const entry of entryMap.values()) {
    entry.points_diff = entry.points_for - entry.points_against;
    entry.pointDifference = entry.points_diff;
    entry.goals_for = entry.points_for;
    entry.goalsFor = entry.points_for;
    entry.goals_against = entry.points_against;
    entry.goalsAgainst = entry.points_against;
    entry.goal_diff = entry.points_diff;
    entry.goalDifference = entry.points_diff;
    entry.fairPlayPoints = entry.fair_play_points;
    entry.yellowCards = entry.yellow_cards;
    entry.secondYellows = entry.second_yellows;
    entry.redCards = entry.red_cards;
    entry.games_diff = entry.games_won - entry.games_lost;
    entry.gameDifference = entry.games_diff;
    entry.points = entry.won * ptsPerWin + (entry.draws || 0) * ptsPerDraw + entry.lost * ptsPerLoss;
    entry.league_points = entry.points;
    entry.win_percentage = entry.played > 0 ? (entry.won / entry.played) * 100 : 0;
    entry.winPercentage = entry.win_percentage;
    entry.pointsFor = entry.points_for;
    entry.pointsAgainst = entry.points_against;
    entry.gamesWon = entry.games_won;
    entry.gamesLost = entry.games_lost;
  }

  // 4. Sort and assign ranks using sport tie-break hierarchy
  const rawEntries = Array.from(entryMap.values());
  return sortStandings(rawEntries, matches, options);
}

