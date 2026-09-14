import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  calculateStandings,
  sortStandings,
  calculatePlayerStats,
  calculateRecentForm,
  calculateTournamentStats,
  calculateCategoryStats,
  calculateMatchAnalytics,
  calculateHeadToHead,
  calculateBadmintonAnalytics,
  calculateTournamentRecords,
  calculateLeaderboards,
  SportAnalyticsRegistry,
  BadmintonAnalyticsProvider,
  MatchDataInput,
  StandingEntry,
  PlayerStats,
} from '../src/index';

describe('Feature 12: Advanced Statistics Engine Comprehensive Suite', () => {

  // =========================================================================
  // 1. TOURNAMENT AGGREGATES & STATUS POLICY
  // =========================================================================
  describe('1. Tournament Aggregates & Match State Policy', () => {
    test('1.1. Computes total, registered, approved participants, match states, games, points and percentages', () => {
      const matches: MatchDataInput[] = [
        {
          id: 'm1',
          category_id: 'cat1',
          participant_a_id: 'p1',
          participant_b_id: 'p2',
          winner_id: 'p1',
          status: 'COMPLETED',
          started_at: '2026-09-08T10:00:00Z',
          completed_at: '2026-09-08T10:30:00Z',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 15, isCompleted: true },
            { game_number: 2, participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          ],
        },
        {
          id: 'm2',
          category_id: 'cat1',
          participant_a_id: 'p3',
          participant_b_id: 'p4',
          winner_id: 'p3',
          status: 'FINAL',
          started_at: '2026-09-08T11:00:00Z',
          completed_at: '2026-09-08T11:45:00Z',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { game_number: 2, participant_a_score: 18, participant_b_score: 21, isCompleted: true },
            { game_number: 3, participant_a_score: 21, participant_b_score: 16, isCompleted: true },
          ],
        },
        {
          id: 'm3',
          category_id: 'cat1',
          participant_a_id: 'p1',
          participant_b_id: 'p3',
          status: 'LIVE',
          games: [
            { game_number: 1, participant_a_score: 14, participant_b_score: 12, isCompleted: false },
          ],
        },
        {
          id: 'm4',
          category_id: 'cat1',
          participant_a_id: 'p2',
          participant_b_id: 'p4',
          status: 'PAUSED',
        },
        {
          id: 'm5',
          category_id: 'cat1',
          participant_a_id: 'p1',
          participant_b_id: 'p4',
          status: 'SCHEDULED',
        },
        {
          id: 'm6',
          category_id: 'cat1',
          participant_a_id: 'p2',
          participant_b_id: 'p3',
          winner_id: 'p2',
          status: 'COMPLETED',
          outcome: 'WALKOVER',
        },
        {
          id: 'm7',
          category_id: 'cat1',
          participant_a_id: 'p1',
          participant_b_id: null,
          winner_id: 'p1',
          status: 'COMPLETED',
          outcome: 'BYE',
        },
      ];

      const participants = [
        { id: 'p1', status: 'ACTIVE' },
        { id: 'p2', status: 'ACTIVE' },
        { id: 'p3', status: 'APPROVED' },
        { id: 'p4', status: 'REGISTERED' },
      ];

      const stats = calculateTournamentStats({
        matches,
        participants,
      });

      assert.strictEqual(stats.totalParticipants, 4);
      assert.strictEqual(stats.registeredParticipants, 4);
      assert.strictEqual(stats.totalMatches, 7);
      assert.strictEqual(stats.completedMatches, 4); // m1, m2, m6, m7
      assert.strictEqual(stats.finalizedMatches, 1); // m2
      assert.strictEqual(stats.liveMatches, 1); // m3
      assert.strictEqual(stats.pausedMatches, 1); // m4
      assert.strictEqual(stats.scheduledMatches, 1); // m5
      assert.strictEqual(stats.walkovers, 1); // m6
      assert.strictEqual(stats.byes, 1); // m7
      assert.strictEqual(stats.normalCompletedMatches, 2); // m1, m2

      // Games & Points: m1 (2 games, 75 pts), m2 (3 games, 116 pts), m3 live (1 game, 26 pts)
      assert.strictEqual(stats.totalGames, 6);
      assert.strictEqual(stats.totalPoints, 217);
      assert.strictEqual(stats.averagePointsPerGame, Math.round((217 / 6) * 10) / 10);
      assert.strictEqual(stats.averageGamesPerMatch, Math.round((6 / 4) * 10) / 10);

      // Duration: m1 (30 mins), m2 (45 mins) -> avg = 37.5 mins
      assert.strictEqual(stats.averageMatchDurationMinutes, 37.5);

      // Percentages
      assert.strictEqual(stats.completionPercentage, Math.round((4 / 7) * 100 * 10) / 10);
      assert.strictEqual(stats.liveMatchPercentage, Math.round((1 / 7) * 100 * 10) / 10);
    });

    test('1.2. Division by zero protection on empty data sets', () => {
      const emptyStats = calculateTournamentStats({});
      assert.strictEqual(emptyStats.totalMatches, 0);
      assert.strictEqual(emptyStats.completedMatches, 0);
      assert.strictEqual(emptyStats.averagePointsPerGame, 0);
      assert.strictEqual(emptyStats.averageGamesPerMatch, 0);
      assert.strictEqual(emptyStats.averageMatchDurationMinutes, null);
      assert.strictEqual(emptyStats.completionPercentage, 0);
    });
  });

  // =========================================================================
  // 2. CATEGORY AGGREGATES
  // =========================================================================
  describe('2. Category Aggregates', () => {
    test('2.1. Computes category-specific match counts, format standings, and durations', () => {
      const catMatches: MatchDataInput[] = [
        {
          id: 'cm1',
          category_id: 'cat_rr',
          participant_a_id: 'teamA',
          participant_b_id: 'teamB',
          winner_id: 'teamA',
          status: 'COMPLETED',
          started_at: '2026-09-08T12:00:00Z',
          completed_at: '2026-09-08T12:20:00Z',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 10, isCompleted: true },
            { game_number: 2, participant_a_score: 21, participant_b_score: 12, isCompleted: true },
          ],
        },
        {
          id: 'cm2',
          category_id: 'cat_rr',
          participant_a_id: 'teamB',
          participant_b_id: 'teamC',
          winner_id: 'teamB',
          status: 'COMPLETED',
          outcome: 'DEFAULT',
        },
      ];

      const participants = ['teamA', 'teamB', 'teamC'];

      const catStats = calculateCategoryStats(
        catMatches,
        'cat_rr',
        "Men's Doubles Round Robin",
        'ROUND_ROBIN',
        participants
      );

      assert.strictEqual(catStats.categoryId, 'cat_rr');
      assert.strictEqual(catStats.categoryName, "Men's Doubles Round Robin");
      assert.strictEqual(catStats.format, 'ROUND_ROBIN');
      assert.strictEqual(catStats.participantCount, 3);
      assert.strictEqual(catStats.totalMatches, 2);
      assert.strictEqual(catStats.completedMatches, 2);
      assert.strictEqual(catStats.defaultCount, 1);
      assert.strictEqual(catStats.gamesPlayed, 2);
      assert.strictEqual(catStats.pointsPlayed, 64);
      assert.strictEqual(catStats.averageMatchDuration, 20);
      assert.ok(catStats.standings);
      assert.strictEqual(catStats.standings.sortedEntries[0].participant_id, 'teamA');
    });
  });

  // =========================================================================
  // 3. PLAYER STATISTICS, STREAKS & RECENT FORM
  // =========================================================================
  describe('3. Player Statistics, Streaks & Recent Form', () => {
    test('3.1. Accurately calculates wins, losses, win percentage, game/point differentials', () => {
      const playerId = 'player_alpha';

      const matches: MatchDataInput[] = [
        {
          id: 'p_m1',
          participant_a_id: playerId,
          participant_b_id: 'player_beta',
          winner_id: playerId,
          status: 'COMPLETED',
          scheduled_at: '2026-09-01T10:00:00Z',
          completed_at: '2026-09-01T10:30:00Z',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 15 },
            { game_number: 2, participant_a_score: 21, participant_b_score: 18 },
          ],
        },
        {
          id: 'p_m2',
          participant_a_id: playerId,
          participant_b_id: 'player_gamma',
          winner_id: 'player_gamma',
          status: 'COMPLETED',
          scheduled_at: '2026-09-02T10:00:00Z',
          completed_at: '2026-09-02T10:40:00Z',
          games: [
            { game_number: 1, participant_a_score: 19, participant_b_score: 21 },
            { game_number: 2, participant_a_score: 21, participant_b_score: 17 },
            { game_number: 3, participant_a_score: 18, participant_b_score: 21 },
          ],
        },
        {
          id: 'p_m3',
          participant_a_id: playerId,
          participant_b_id: 'player_delta',
          winner_id: playerId,
          status: 'COMPLETED',
          outcome: 'WALKOVER',
          scheduled_at: '2026-09-03T10:00:00Z',
          completed_at: '2026-09-03T10:05:00Z',
        },
        {
          id: 'p_m4',
          participant_a_id: 'player_epsilon',
          participant_b_id: playerId,
          winner_id: playerId,
          status: 'COMPLETED',
          scheduled_at: '2026-09-04T10:00:00Z',
          completed_at: '2026-09-04T10:35:00Z',
          games: [
            { game_number: 1, participant_a_score: 16, participant_b_score: 21 },
            { game_number: 2, participant_a_score: 14, participant_b_score: 21 },
          ],
        },
      ];

      const pStats = calculatePlayerStats(matches, playerId);

      assert.strictEqual(pStats.playerId, playerId);
      assert.strictEqual(pStats.matchesPlayed, 4);
      assert.strictEqual(pStats.matchesWon, 3);
      assert.strictEqual(pStats.matchesLost, 1);
      assert.strictEqual(pStats.winPercentage, 75); // 3/4 = 75%
      assert.strictEqual(pStats.walkoversReceived, 1);

      // Games: m1 (2-0), m2 (1-2), m3 (0-0 W.O.), m4 (2-0) -> won: 5, lost: 2, played: 7
      assert.strictEqual(pStats.gamesWon, 5);
      assert.strictEqual(pStats.gamesLost, 2);
      assert.strictEqual(pStats.gamesPlayed, 7);
      assert.strictEqual(pStats.gameDifference, 3);
      assert.strictEqual(Math.round(pStats.gameWinPercentage * 10) / 10, 71.4);

      // Points:
      // m1: scored 42, conceded 33
      // m2: scored 58, conceded 59
      // m3: scored 0, conceded 0
      // m4: scored 42, conceded 30
      // Total scored: 142, total conceded: 122 -> diff = +20
      assert.strictEqual(pStats.pointsScored, 142);
      assert.strictEqual(pStats.pointsConceded, 122);
      assert.strictEqual(pStats.pointDifference, 20);
      assert.strictEqual(Math.round(pStats.averagePointsPerGame * 10) / 10, 20.3);
      assert.strictEqual(Math.round(pStats.averagePointsConcededPerGame * 10) / 10, 17.4);
    });

    test('3.2. Chronological streak calculation (longest winning streak, current winning streak, losing streaks)', () => {
      const playerId = 'streak_player';

      // Sequence of 6 matches: Win, Win, Loss, Win, Win, Win
      const matches: MatchDataInput[] = [
        { id: 's1', participant_a_id: playerId, participant_b_id: 'opp1', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-01T10:00:00Z' },
        { id: 's2', participant_a_id: playerId, participant_b_id: 'opp2', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-02T10:00:00Z' },
        { id: 's3', participant_a_id: playerId, participant_b_id: 'opp3', winner_id: 'opp3', status: 'COMPLETED', completed_at: '2026-09-03T10:00:00Z' },
        { id: 's4', participant_a_id: playerId, participant_b_id: 'opp4', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-04T10:00:00Z' },
        { id: 's5', participant_a_id: playerId, participant_b_id: 'opp5', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-05T10:00:00Z' },
        { id: 's6', participant_a_id: playerId, participant_b_id: 'opp6', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-06T10:00:00Z' },
      ];

      const pStats = calculatePlayerStats(matches, playerId);

      assert.strictEqual(pStats.longestWinningStreak, 3); // s4, s5, s6
      assert.strictEqual(pStats.currentWinningStreak, 3); // ending at s6
      assert.strictEqual(pStats.longestLosingStreak, 1);  // s3
      assert.strictEqual(pStats.currentLosingStreak, 0);
    });

    test('3.3. Recent form representation with distinct outcomes (W, L, W.O., DEFAULT, RET, BYE)', () => {
      const playerId = 'form_player';

      const matches: MatchDataInput[] = [
        { id: 'f1', participant_a_id: playerId, participant_b_id: 'opp1', winner_id: playerId, status: 'COMPLETED', completed_at: '2026-09-01T10:00:00Z' },
        { id: 'f2', participant_a_id: playerId, participant_b_id: 'opp2', winner_id: 'opp2', status: 'COMPLETED', completed_at: '2026-09-02T10:00:00Z' },
        { id: 'f3', participant_a_id: playerId, participant_b_id: 'opp3', winner_id: playerId, status: 'COMPLETED', outcome: 'WALKOVER', completed_at: '2026-09-03T10:00:00Z' },
        { id: 'f4', participant_a_id: playerId, participant_b_id: 'opp4', winner_id: 'opp4', status: 'COMPLETED', outcome: 'DEFAULT', completed_at: '2026-09-04T10:00:00Z' },
        { id: 'f5', participant_a_id: playerId, participant_b_id: 'opp5', winner_id: playerId, status: 'COMPLETED', outcome: 'RETIREMENT', completed_at: '2026-09-05T10:00:00Z' },
        { id: 'f6', participant_a_id: playerId, participant_b_id: null, winner_id: playerId, status: 'COMPLETED', outcome: 'BYE', completed_at: '2026-09-06T10:00:00Z' },
      ];

      const { recentForm, formDetails } = calculateRecentForm(matches, playerId, 5);

      // 5 most recent in descending chronological order: f6 (BYE), f5 (RET), f4 (DEFAULT), f3 (W.O.), f2 (L)
      assert.strictEqual(recentForm.length, 5);
      assert.deepStrictEqual(recentForm, ['BYE', 'RET', 'DEFAULT', 'W.O.', 'L']);

      assert.strictEqual(formDetails[0].matchId, 'f6');
      assert.strictEqual(formDetails[0].result, 'BYE');
      assert.strictEqual(formDetails[1].matchId, 'f5');
      assert.strictEqual(formDetails[1].result, 'RET');
      assert.strictEqual(formDetails[1].isWin, true);
      assert.strictEqual(formDetails[2].matchId, 'f4');
      assert.strictEqual(formDetails[2].result, 'DEFAULT');
      assert.strictEqual(formDetails[2].isWin, false);
    });

    test('3.4. Doubles team isolation via participant_members without confusing teams with players', () => {
      const pA = 'doubles_player_a';
      const pB = 'doubles_player_b';
      const pC = 'doubles_player_c';
      const pD = 'doubles_player_d';

      const team1: MatchDataInput['participant_a'] = {
        id: 'team_1',
        members: [{ player_id: pA, player: { id: pA } }, { player_id: pB, player: { id: pB } }],
      };
      const team2: MatchDataInput['participant_b'] = {
        id: 'team_2',
        members: [{ player_id: pC, player: { id: pC } }, { player_id: pD, player: { id: pD } }],
      };

      const matches: MatchDataInput[] = [
        {
          id: 'd_m1',
          participant_a: team1,
          participant_b: team2,
          participant_a_id: 'team_1',
          participant_b_id: 'team_2',
          winner_id: 'team_1',
          status: 'COMPLETED',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 18 },
            { game_number: 2, participant_a_score: 21, participant_b_score: 19 },
          ],
        },
      ];

      const statsA = calculatePlayerStats(matches, pA);
      const statsC = calculatePlayerStats(matches, pC);

      assert.strictEqual(statsA.matchesPlayed, 1);
      assert.strictEqual(statsA.matchesWon, 1);
      assert.strictEqual(statsA.pointsScored, 42);

      assert.strictEqual(statsC.matchesPlayed, 1);
      assert.strictEqual(statsC.matchesLost, 1);
      assert.strictEqual(statsC.pointsScored, 37);
    });
  });

  // =========================================================================
  // 4. BADMINTON-SPECIFIC ANALYTICS
  // =========================================================================
  describe('4. Badminton Specific Analytics', () => {
    test('4.1. Computes deuce games, 30-point caps, straight-game wins, 3-game wins, and comebacks', () => {
      const matches: MatchDataInput[] = [
        // Match 1: Straight games (2-0), normal 21-18, 21-15
        {
          id: 'bad_1',
          participant_a_id: 'sideA',
          participant_b_id: 'sideB',
          winner_id: 'sideA',
          status: 'COMPLETED',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 18 },
            { game_number: 2, participant_a_score: 21, participant_b_score: 15 },
          ],
        },
        // Match 2: Deuce game (24-22) and 30-point cap game (30-29) -> 3-game match (2-1)
        {
          id: 'bad_2',
          participant_a_id: 'sideC',
          participant_b_id: 'sideD',
          winner_id: 'sideC',
          status: 'COMPLETED',
          games: [
            { game_number: 1, participant_a_score: 22, participant_b_score: 24 }, // deuce game
            { game_number: 2, participant_a_score: 30, participant_b_score: 29 }, // 30-point cap & deuce
            { game_number: 3, participant_a_score: 21, participant_b_score: 17 },
          ],
        },
      ];

      const badAnalytics = calculateBadmintonAnalytics(matches);

      assert.strictEqual(badAnalytics.totalRallies, 75 + 46 + 59 + 38); // 218
      assert.strictEqual(badAnalytics.straightGameWins, 1); // bad_1
      assert.strictEqual(badAnalytics.threeGameWins, 1);    // bad_2
      assert.strictEqual(badAnalytics.comebackWins, 1);     // bad_2 lost game 1, won match
      assert.strictEqual(badAnalytics.deuceGames, 2);       // 22-24, 30-29
      assert.strictEqual(badAnalytics.capped30PointGames, 1); // 30-29
      assert.strictEqual(badAnalytics.closestGames[0].margin, 1); // 30-29 (margin 1)
      assert.strictEqual(badAnalytics.largestWinningMargin?.margin, 6); // 21-15 (margin 6)
    });
  });

  // =========================================================================
  // 5. MATCH ANALYTICS
  // =========================================================================
  describe('5. Match Analytics', () => {
    test('5.1. Computes game margins, straight/three-game classifications, and authentic durations', () => {
      const match: MatchDataInput = {
        id: 'ma1',
        participant_a_id: 'part1',
        participant_b_id: 'part2',
        winner_id: 'part1',
        status: 'COMPLETED',
        started_at: '2026-09-08T14:00:00Z',
        completed_at: '2026-09-08T14:38:00Z',
        games: [
          { game_number: 1, participant_a_score: 21, participant_b_score: 19 },
          { game_number: 2, participant_a_score: 21, participant_b_score: 11 },
        ],
      };

      const mAnalytics = calculateMatchAnalytics(match);

      assert.strictEqual(mAnalytics.matchId, 'ma1');
      assert.strictEqual(mAnalytics.totalGames, 2);
      assert.strictEqual(mAnalytics.totalPoints, 72);
      assert.strictEqual(mAnalytics.pointDifferential, 12); // 42 - 30
      assert.strictEqual(mAnalytics.isStraightGames, true);
      assert.strictEqual(mAnalytics.isThreeGames, false);
      assert.strictEqual(mAnalytics.largestGameMargin, 10); // 21-11
      assert.strictEqual(mAnalytics.closestGameMargin, 2);  // 21-19
      assert.strictEqual(mAnalytics.durationMinutes, 38);
    });

    test('5.2. WALKOVER and DEFAULT have zero fabricated game/point scores', () => {
      const woMatch: MatchDataInput = {
        id: 'ma_wo',
        participant_a_id: 'pA',
        participant_b_id: 'pB',
        winner_id: 'pA',
        status: 'COMPLETED',
        outcome: 'WALKOVER',
      };

      const ma = calculateMatchAnalytics(woMatch);
      assert.strictEqual(ma.totalGames, 0);
      assert.strictEqual(ma.totalPoints, 0);
      assert.strictEqual(ma.largestGameMargin, 0);
      assert.strictEqual(ma.closestGameMargin, 0);
      assert.strictEqual(ma.durationMinutes, null);
    });
  });

  // =========================================================================
  // 6. EXPLAINABLE TIE-BREAK REASONS & STANDINGS
  // =========================================================================
  describe('6. Explainable Tie-Break Reasons & Standings', () => {
    test('6.1. Provides clear human-readable explanations for match wins, H2H, game diff, and overrides', () => {
      const participants = [
        { id: 'T1', name: 'Alpha Eagles' },
        { id: 'T2', name: 'Beta Hawks' },
        { id: 'T3', name: 'Gamma Lions' },
      ];

      // T1 beats T2 (2-0), T2 beats T3 (2-0), T1 beats T3 (2-0)
      const matches: MatchDataInput[] = [
        {
          id: 'tb1',
          participant_a_id: 'T1',
          participant_b_id: 'T2',
          winner_id: 'T1',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 18 }, { participant_a_score: 21, participant_b_score: 19 }],
        },
        {
          id: 'tb2',
          participant_a_id: 'T1',
          participant_b_id: 'T3',
          winner_id: 'T1',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 12 }, { participant_a_score: 21, participant_b_score: 14 }],
        },
        {
          id: 'tb3',
          participant_a_id: 'T2',
          participant_b_id: 'T3',
          winner_id: 'T2',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 15 }, { participant_a_score: 21, participant_b_score: 16 }],
        },
      ];

      const { sortedEntries, tieBreakExplanations } = calculateStandings(participants, matches);

      assert.strictEqual(sortedEntries[0].participant_id, 'T1');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.ok(sortedEntries[0].tieBreakReason?.includes('wins'));

      assert.strictEqual(sortedEntries[1].participant_id, 'T2');
      assert.strictEqual(sortedEntries[1].rank, 2);

      assert.strictEqual(sortedEntries[2].participant_id, 'T3');
      assert.strictEqual(sortedEntries[2].rank, 3);
    });

    test('6.2. Two-way tie broken by Head-to-Head gives explicit H2H explanation', () => {
      // 2 teams tied with 1 win each, T1 defeated T2 in their match
      const entries: StandingEntry[] = [
        { participant_id: 'T1', participant_name: 'Team Alpha', played: 2, won: 1, lost: 1, points_for: 75, points_against: 75, points_diff: 0, games_won: 2, games_lost: 2, games_diff: 0, win_percentage: 50, rank: 1, is_manually_resolved: false },
        { participant_id: 'T2', participant_name: 'Team Beta', played: 2, won: 1, lost: 1, points_for: 75, points_against: 75, points_diff: 0, games_won: 2, games_lost: 2, games_diff: 0, win_percentage: 50, rank: 1, is_manually_resolved: false },
      ];

      const matches: MatchDataInput[] = [
        { id: 'h2h_tb', participant_a_id: 'T1', participant_b_id: 'T2', winner_id: 'T1', status: 'COMPLETED' },
      ];

      const { sortedEntries } = sortStandings(entries, matches);

      assert.strictEqual(sortedEntries[0].participant_id, 'T1');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.ok(sortedEntries[0].tieBreakReason?.includes('Head-to-Head victory over Team Beta'));

      assert.strictEqual(sortedEntries[1].participant_id, 'T2');
      assert.strictEqual(sortedEntries[1].rank, 2);
      assert.ok(sortedEntries[1].tieBreakReason?.includes('conceded Head-to-Head against Team Alpha'));
    });
  });

  // =========================================================================
  // 7. PERFORMANCE LEADERBOARDS & SAMPLE SIZE THRESHOLDS
  // =========================================================================
  describe('7. Performance Leaderboards', () => {
    test('7.1. Ranks leaderboards and respects minimum sample size threshold for percentage metrics', () => {
      const playerList: PlayerStats[] = [
        {
          playerId: 'p_few_matches',
          playerName: 'One Match Wonder',
          matchesPlayed: 1,
          matchesWon: 1,
          matchesLost: 0,
          winPercentage: 100,
          gamesPlayed: 2,
          gamesWon: 2,
          gamesLost: 0,
          gameDifference: 2,
          gameWinPercentage: 100,
          pointsScored: 42,
          pointsConceded: 20,
          pointDifference: 22,
          averagePointsPerMatch: 42,
          averagePointsPerGame: 21,
          averagePointsConcededPerGame: 10,
          longestWinningStreak: 1,
          currentWinningStreak: 1,
          longestLosingStreak: 0,
          currentLosingStreak: 0,
          recentForm: ['W'],
          walkoversReceived: 0,
          walkoversSuffered: 0,
          defaultsReceived: 0,
          defaultsSuffered: 0,
          retirementsReceived: 0,
          retirementsGiven: 0,
          byes: 0,
          tournamentAppearances: 1,
        },
        {
          playerId: 'p_veteran',
          playerName: 'Tournament Veteran',
          matchesPlayed: 10,
          matchesWon: 9,
          matchesLost: 1,
          winPercentage: 90,
          gamesPlayed: 22,
          gamesWon: 19,
          gamesLost: 3,
          gameDifference: 16,
          gameWinPercentage: 86.4,
          pointsScored: 450,
          pointsConceded: 320,
          pointDifference: 130,
          averagePointsPerMatch: 45,
          averagePointsPerGame: 20.5,
          averagePointsConcededPerGame: 14.5,
          longestWinningStreak: 7,
          currentWinningStreak: 4,
          longestLosingStreak: 1,
          currentLosingStreak: 0,
          recentForm: ['W', 'W', 'W', 'W', 'L'],
          walkoversReceived: 0,
          walkoversSuffered: 0,
          defaultsReceived: 0,
          defaultsSuffered: 0,
          retirementsReceived: 0,
          retirementsGiven: 0,
          byes: 0,
          tournamentAppearances: 3,
        },
      ];

      // With minMatches: 3, Veteran must be #1 for highestWinPercentage
      const leaderboards = calculateLeaderboards(playerList, { minMatches: 3 });

      assert.strictEqual(leaderboards.minMatchesThreshold, 3);
      assert.strictEqual(leaderboards.mostWins[0].playerId, 'p_veteran');
      assert.strictEqual(leaderboards.highestWinPercentage[0].playerId, 'p_veteran');
      assert.strictEqual(leaderboards.highestWinPercentage.length, 1); // p_few_matches excluded by minMatches
      assert.strictEqual(leaderboards.longestWinningStreak[0].value, 7);
      assert.strictEqual(leaderboards.bestPointDifferential[0].value, 130);
    });
  });

  // =========================================================================
  // 8. TOURNAMENT RECORDS & HIGHLIGHTS
  // =========================================================================
  describe('8. Tournament Records & Highlights', () => {
    test('8.1. Derives longest/shortest matches, margins, most points in game/match', () => {
      const matches: MatchDataInput[] = [
        {
          id: 'rec_1',
          participant_a: { id: 'p1', name: 'Lin Dan' },
          participant_b: { id: 'p2', name: 'Lee Chong Wei' },
          winner_id: 'p1',
          status: 'COMPLETED',
          started_at: '2026-09-08T15:00:00Z',
          completed_at: '2026-09-08T16:15:00Z', // 75 mins
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 19 },
            { game_number: 2, participant_a_score: 19, participant_b_score: 21 },
            { game_number: 3, participant_a_score: 23, participant_b_score: 21 }, // 44 pts
          ],
        },
        {
          id: 'rec_2',
          participant_a: { id: 'p3', name: 'Player 3' },
          participant_b: { id: 'p4', name: 'Player 4' },
          winner_id: 'p3',
          status: 'COMPLETED',
          started_at: '2026-09-08T17:00:00Z',
          completed_at: '2026-09-08T17:18:00Z', // 18 mins
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 4 }, // margin 17
            { game_number: 2, participant_a_score: 21, participant_b_score: 6 },
          ],
        },
      ];

      const records = calculateTournamentRecords(matches, []);

      assert.strictEqual(records.longestMatchDuration?.matchId, 'rec_1');
      assert.strictEqual(records.longestMatchDuration?.durationMinutes, 75);
      assert.strictEqual(records.shortestMatchDuration?.matchId, 'rec_2');
      assert.strictEqual(records.shortestMatchDuration?.durationMinutes, 18);
      assert.strictEqual(records.largestGameMargin?.margin, 17); // 21-4
      assert.strictEqual(records.closestGame?.margin, 2); // 21-19
      assert.strictEqual(records.mostPointsInAGame?.totalPoints, 44); // 23-21
      assert.strictEqual(records.mostPointsInAMatch?.totalPoints, 124); // 40 + 40 + 44
    });
  });

  // =========================================================================
  // 9. SPORT ABSTRACTION & REGISTRY
  // =========================================================================
  describe('9. Sport Abstraction Layer & Registry', () => {
    test('9.1. Generic registry resolves Badminton analytics provider and allows extensible sport registration', () => {
      const supported = SportAnalyticsRegistry.getSupportedSports();
      assert.ok(supported.includes('badminton'));

      const provider = SportAnalyticsRegistry.get('badminton');
      assert.ok(provider instanceof BadmintonAnalyticsProvider);

      const matches: MatchDataInput[] = [
        {
          id: 'reg_m1',
          participant_a_id: 'a',
          participant_b_id: 'b',
          winner_id: 'a',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 18 }],
        },
      ];

      const analytics = SportAnalyticsRegistry.calculateSportAnalytics('badminton', matches);
      assert.strictEqual(analytics.totalRallies, 39);
    });
  });
});
