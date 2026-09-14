import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  calculateStandings,
  sortStandings,
  calculatePlayerStats,
  calculateTournamentStats,
  calculateHeadToHead,
  StandingEntry,
  MatchDataInput
} from '../src/index';

describe('Statistics Engine Unit Tests', () => {

  // -------------------------------------------------------------------------
  // 1. ROUND ROBIN & STANDINGS TESTS
  // -------------------------------------------------------------------------
  describe('1. Standings Calculation & Tiebreaks', () => {
    
    test('1.1. Simple Round Robin with clear ranking', () => {
      // 3 players: P1 (2 wins), P2 (1 win), P3 (0 wins)
      const participants = ['P1', 'P2', 'P3'];
      const matches: MatchDataInput[] = [
        {
          id: 'm1',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 15, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          ],
        },
        {
          id: 'm2',
          participant_a_id: 'P1',
          participant_b_id: 'P3',
          winner_id: 'P1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 10, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 12, isCompleted: true },
          ],
        },
        {
          id: 'm3',
          participant_a_id: 'P2',
          participant_b_id: 'P3',
          winner_id: 'P2',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 16, isCompleted: true },
          ],
        },
      ];

      const { sortedEntries, hasTies } = calculateStandings(participants, matches);

      assert.strictEqual(hasTies, false);
      assert.strictEqual(sortedEntries.length, 3);

      // Rank 1: P1
      assert.strictEqual(sortedEntries[0].participant_id, 'P1');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.strictEqual(sortedEntries[0].played, 2);
      assert.strictEqual(sortedEntries[0].won, 2);
      assert.strictEqual(sortedEntries[0].lost, 0);
      assert.strictEqual(sortedEntries[0].games_won, 4);
      assert.strictEqual(sortedEntries[0].games_lost, 0);
      assert.strictEqual(sortedEntries[0].games_diff, 4);
      assert.strictEqual(sortedEntries[0].points_for, 84); // 21+21+21+21
      assert.strictEqual(sortedEntries[0].points_against, 55); // 15+18+10+12
      assert.strictEqual(sortedEntries[0].points_diff, 29);
      assert.strictEqual(sortedEntries[0].win_percentage, 100);

      // Rank 2: P2
      assert.strictEqual(sortedEntries[1].participant_id, 'P2');
      assert.strictEqual(sortedEntries[1].rank, 2);
      assert.strictEqual(sortedEntries[1].played, 2);
      assert.strictEqual(sortedEntries[1].won, 1);
      assert.strictEqual(sortedEntries[1].lost, 1);
      assert.strictEqual(sortedEntries[1].games_won, 2);
      assert.strictEqual(sortedEntries[1].games_lost, 2);
      assert.strictEqual(sortedEntries[1].games_diff, 0);
      assert.strictEqual(sortedEntries[1].points_for, 75); // 15+18+21+21
      assert.strictEqual(sortedEntries[1].points_against, 77); // 21+21+19+16
      assert.strictEqual(sortedEntries[1].points_diff, -2);
      assert.strictEqual(sortedEntries[1].win_percentage, 50);

      // Rank 3: P3
      assert.strictEqual(sortedEntries[2].participant_id, 'P3');
      assert.strictEqual(sortedEntries[2].rank, 3);
      assert.strictEqual(sortedEntries[2].played, 2);
      assert.strictEqual(sortedEntries[2].won, 0);
      assert.strictEqual(sortedEntries[2].lost, 2);
      assert.strictEqual(sortedEntries[2].games_won, 0);
      assert.strictEqual(sortedEntries[2].games_lost, 4);
      assert.strictEqual(sortedEntries[2].games_diff, -4);
      assert.strictEqual(sortedEntries[2].points_for, 57); // 10+12+19+16
      assert.strictEqual(sortedEntries[2].points_against, 84);
      assert.strictEqual(sortedEntries[2].points_diff, -27);
      assert.strictEqual(sortedEntries[2].win_percentage, 0);
    });

    test('1.2. Equal wins tiebreak resolved by Head-to-Head (2 tied players)', () => {
      // P1 and P2 both have 1 win and 1 loss against P3/each other, but P1 beat P2 in their match
      const participants = ['P1', 'P2', 'P3'];
      const matches: MatchDataInput[] = [
        // P1 beats P2 (H2H advantage to P1)
        {
          id: 'm1',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P1',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 19, isCompleted: true }],
        },
        // P3 beats P1
        {
          id: 'm2',
          participant_a_id: 'P3',
          participant_b_id: 'P1',
          winner_id: 'P3',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 10, isCompleted: true }],
        },
        // P2 beats P3
        {
          id: 'm3',
          participant_a_id: 'P2',
          participant_b_id: 'P3',
          winner_id: 'P2',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 15, isCompleted: true }],
        },
      ];

      // All 3 have 1 win and 1 loss (circle tie: P1 beats P2, P2 beats P3, P3 beats P1).
      // Tied on wins: 3 players, so H2H is non-deterministic among 3, falls back to game/point diff.
      // P1: Pts for = 21+10 = 31, against = 19+21 = 40 (diff = -9)
      // P2: Pts for = 19+21 = 40, against = 21+15 = 36 (diff = +4)
      // P3: Pts for = 21+15 = 36, against = 10+21 = 31 (diff = +5)
      const res3 = calculateStandings(participants, matches);
      assert.strictEqual(res3.sortedEntries[0].participant_id, 'P3'); // +5 diff
      assert.strictEqual(res3.sortedEntries[1].participant_id, 'P2'); // +4 diff
      assert.strictEqual(res3.sortedEntries[2].participant_id, 'P1'); // -9 diff

      // Now test exact 2-player tie on top: P1 and P2 both 2-1, P1 beat P2
      const entries2Tied: StandingEntry[] = [
        {
          participant_id: 'P2',
          played: 3,
          won: 2,
          lost: 1,
          points_for: 60, // Even with higher points
          points_against: 40,
          points_diff: 20,
          games_won: 4,
          games_lost: 2,
          games_diff: 2,
          win_percentage: 66.6,
          rank: 1,
          is_manually_resolved: false,
        },
        {
          participant_id: 'P1',
          played: 3,
          won: 2,
          lost: 1,
          points_for: 50,
          points_against: 45,
          points_diff: 5,
          games_won: 4,
          games_lost: 2,
          games_diff: 2,
          win_percentage: 66.6,
          rank: 1,
          is_manually_resolved: false,
        },
      ];

      const h2hMatches: MatchDataInput[] = [
        {
          id: 'm_h2h',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P1',
          status: 'COMPLETED',
        },
      ];

      const sortedH2H = sortStandings(entries2Tied, h2hMatches);
      assert.strictEqual(sortedH2H.sortedEntries[0].participant_id, 'P1', 'P1 must be ranked #1 due to direct H2H win over P2');
      assert.strictEqual(sortedH2H.sortedEntries[1].participant_id, 'P2');
      assert.strictEqual(sortedH2H.hasTies, false);
    });

    test('1.3. Equal wins resolved by game differential', () => {
      const entries: StandingEntry[] = [
        {
          participant_id: 'PA',
          played: 3,
          won: 2,
          lost: 1,
          games_won: 5,
          games_lost: 2, // diff = +3
          points_for: 100,
          points_against: 90,
          points_diff: 10,
          win_percentage: 66.7,
          rank: 1,
          is_manually_resolved: false,
        },
        {
          participant_id: 'PB',
          played: 3,
          won: 2,
          lost: 1,
          games_won: 4,
          games_lost: 3, // diff = +1
          points_for: 110, // Higher points but lower game diff
          points_against: 80,
          points_diff: 30,
          win_percentage: 66.7,
          rank: 1,
          is_manually_resolved: false,
        },
      ];

      const { sortedEntries } = sortStandings(entries, []);
      assert.strictEqual(sortedEntries[0].participant_id, 'PA', 'PA must rank higher due to game differential (+3 vs +1)');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.strictEqual(sortedEntries[1].participant_id, 'PB');
      assert.strictEqual(sortedEntries[1].rank, 2);
    });

    test('1.4. Equal wins & game diff resolved by point differential', () => {
      const entries: StandingEntry[] = [
        {
          participant_id: 'PX',
          played: 2,
          won: 1,
          lost: 1,
          games_won: 2,
          games_lost: 2,
          games_diff: 0,
          points_for: 80,
          points_against: 65, // diff = +15
          points_diff: 15,
          win_percentage: 50,
          rank: 1,
          is_manually_resolved: false,
        },
        {
          participant_id: 'PY',
          played: 2,
          won: 1,
          lost: 1,
          games_won: 2,
          games_lost: 2,
          games_diff: 0,
          points_for: 75,
          points_against: 70, // diff = +5
          points_diff: 5,
          win_percentage: 50,
          rank: 1,
          is_manually_resolved: false,
        },
      ];

      const { sortedEntries } = sortStandings(entries, []);
      assert.strictEqual(sortedEntries[0].participant_id, 'PX');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.strictEqual(sortedEntries[1].participant_id, 'PY');
      assert.strictEqual(sortedEntries[1].rank, 2);
    });

    test('1.5. Manual rank override forces rank regardless of stats', () => {
      const entries: StandingEntry[] = [
        {
          participant_id: 'P_LEADER',
          played: 3,
          won: 3,
          lost: 0,
          points_for: 100,
          points_against: 50,
          points_diff: 50,
          games_won: 6,
          games_lost: 0,
          games_diff: 6,
          win_percentage: 100,
          rank: 1,
          is_manually_resolved: true,
          manual_rank_override: 2, // Admin manually overrode to 2
        },
        {
          participant_id: 'P_UNDERDOG',
          played: 3,
          won: 1,
          lost: 2,
          points_for: 60,
          points_against: 90,
          points_diff: -30,
          games_won: 2,
          games_lost: 5,
          games_diff: -3,
          win_percentage: 33.3,
          rank: 2,
          is_manually_resolved: true,
          manual_rank_override: 1, // Admin manually overrode to 1
        },
      ];

      const { sortedEntries } = sortStandings(entries, []);
      assert.strictEqual(sortedEntries[0].participant_id, 'P_UNDERDOG');
      assert.strictEqual(sortedEntries[0].rank, 1);
      assert.strictEqual(sortedEntries[1].participant_id, 'P_LEADER');
      assert.strictEqual(sortedEntries[1].rank, 2);
    });

    test('1.6. Incomplete & Live matches do not alter completed standings wins', () => {
      const participants = ['P1', 'P2'];
      const matches: MatchDataInput[] = [
        {
          id: 'm_live',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: null,
          status: 'LIVE',
          games: [
            { participant_a_score: 18, participant_b_score: 15, isCompleted: false },
          ],
        },
        {
          id: 'm_ready',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          status: 'READY',
        }
      ];

      const { sortedEntries } = calculateStandings(participants, matches);
      assert.strictEqual(sortedEntries[0].played, 0);
      assert.strictEqual(sortedEntries[0].won, 0);
      assert.strictEqual(sortedEntries[0].lost, 0);
      assert.strictEqual(sortedEntries[1].played, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. PLAYER STATS TESTS (SINGLES & DOUBLES)
  // -------------------------------------------------------------------------
  describe('2. Player Statistics (Singles & Doubles)', () => {

    test('2.1. Singles Player Stats calculation across multiple matches', () => {
      const playerId = 'player_alpha';
      const matches: MatchDataInput[] = [
        // Match 1: Alpha wins 2-0
        {
          id: 'm1',
          participant_a_id: playerId,
          participant_b_id: 'player_beta',
          winner_id: playerId,
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
          ],
        },
        // Match 2: Alpha loses 1-2
        {
          id: 'm2',
          participant_a_id: 'player_gamma',
          participant_b_id: playerId,
          winner_id: 'player_gamma',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 15, isCompleted: true },
            { participant_a_score: 19, participant_b_score: 21, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 17, isCompleted: true },
          ],
        },
        // Match 3: Unrelated match (Alpha not playing)
        {
          id: 'm3',
          participant_a_id: 'player_beta',
          participant_b_id: 'player_gamma',
          winner_id: 'player_beta',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 10, isCompleted: true }],
        },
        // Match 4: Alpha live match (not completed)
        {
          id: 'm4',
          participant_a_id: playerId,
          participant_b_id: 'player_delta',
          status: 'LIVE',
          games: [{ participant_a_score: 10, participant_b_score: 8 }],
        }
      ];

      const stats = calculatePlayerStats(matches, playerId);

      assert.strictEqual(stats.playerId, playerId);
      assert.strictEqual(stats.matchesPlayed, 2, 'Only completed matches should be counted');
      assert.strictEqual(stats.matchesWon, 1);
      assert.strictEqual(stats.matchesLost, 1);
      assert.strictEqual(stats.winPercentage, 50);

      // Games: Won G1 & G2 in m1, won G2 in m2 = 3 games won. Lost G1 & G3 in m2 = 2 games lost.
      assert.strictEqual(stats.gamesWon, 3);
      assert.strictEqual(stats.gamesLost, 2);
      assert.strictEqual(stats.gameDifference, 1);
      assert.strictEqual(stats.gameWinPercentage, 60);

      // Points: m1 (21+21 = 42 for, 18+19 = 37 against), m2 (15+21+17 = 53 for, 21+19+21 = 61 against)
      assert.strictEqual(stats.pointsScored, 95);
      assert.strictEqual(stats.pointsConceded, 98);
      assert.strictEqual(stats.pointDifference, -3);
      assert.strictEqual(stats.averagePointsPerMatch, 47.5);
      assert.strictEqual(stats.averagePointsPerGame, 19);
    });

    test('2.2. Doubles Player Stats attributes team matches to member without double counting', () => {
      const player1Id = 'p_d1';
      const player2Id = 'p_d2';

      const teamAlpha: MatchDataInput['participant_a'] = {
        id: 'team_alpha_id',
        participant_type: 'TEAM',
        members: [
          { player_id: player1Id, player: { id: player1Id, full_name: 'Doubles Player 1' } },
          { player_id: player2Id, player: { id: player2Id, full_name: 'Doubles Player 2' } },
        ],
      };

      const teamBeta: MatchDataInput['participant_b'] = {
        id: 'team_beta_id',
        participant_type: 'TEAM',
        members: [
          { player_id: 'p_d3', player: { id: 'p_d3', full_name: 'Doubles Player 3' } },
          { player_id: 'p_d4', player: { id: 'p_d4', full_name: 'Doubles Player 4' } },
        ],
      };

      const matches: MatchDataInput[] = [
        {
          id: 'doubles_m1',
          participant_a_id: 'team_alpha_id',
          participant_b_id: 'team_beta_id',
          participant_a: teamAlpha,
          participant_b: teamBeta,
          winner_id: 'team_alpha_id',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 16, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 14, isCompleted: true },
          ],
        },
      ];

      // Player 1 stats
      const p1Stats = calculatePlayerStats(matches, player1Id);
      assert.strictEqual(p1Stats.matchesPlayed, 1);
      assert.strictEqual(p1Stats.matchesWon, 1);
      assert.strictEqual(p1Stats.gamesWon, 2);
      assert.strictEqual(p1Stats.pointsScored, 42);

      // Player 2 stats (same team)
      const p2Stats = calculatePlayerStats(matches, player2Id);
      assert.strictEqual(p2Stats.matchesPlayed, 1);
      assert.strictEqual(p2Stats.matchesWon, 1);
      assert.strictEqual(p2Stats.gamesWon, 2);
      assert.strictEqual(p2Stats.pointsScored, 42);

      // Opponent Player 3 stats
      const p3Stats = calculatePlayerStats(matches, 'p_d3');
      assert.strictEqual(p3Stats.matchesPlayed, 1);
      assert.strictEqual(p3Stats.matchesLost, 1);
      assert.strictEqual(p3Stats.gamesLost, 2);
      assert.strictEqual(p3Stats.pointsScored, 30);
    });

    test('2.3. Walkover and Retirement stats attribution', () => {
      const pA = 'player_walk_a';
      const pB = 'player_walk_b';

      const matches: MatchDataInput[] = [
        // Walkover given to A
        {
          id: 'wo_match',
          participant_a_id: pA,
          participant_b_id: pB,
          winner_id: pA,
          outcome: 'WALKOVER',
          status: 'COMPLETED',
          games: [],
        },
        // Retirement by A
        {
          id: 'ret_match',
          participant_a_id: pA,
          participant_b_id: pB,
          winner_id: pB,
          outcome: 'RETIREMENT',
          status: 'COMPLETED',
          games: [{ participant_a_score: 11, participant_b_score: 9 }],
        }
      ];

      const statsA = calculatePlayerStats(matches, pA);
      assert.strictEqual(statsA.matchesPlayed, 2);
      assert.strictEqual(statsA.matchesWon, 1);
      assert.strictEqual(statsA.matchesLost, 1);
      assert.strictEqual(statsA.walkoversReceived, 1);
      assert.strictEqual(statsA.retirementsGiven, 1);

      const statsB = calculatePlayerStats(matches, pB);
      assert.strictEqual(statsB.retirementsReceived, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. HEAD-TO-HEAD TESTS
  // -------------------------------------------------------------------------
  describe('3. Head-to-Head Statistics', () => {

    test('3.1. Singles Head-to-Head between Player A and Player B', () => {
      const pA = 'p_h2h_a';
      const pB = 'p_h2h_b';
      const pC = 'p_h2h_c';

      const matches: MatchDataInput[] = [
        // Match 1: A vs B (A wins 2-0)
        {
          id: 'h2h_1',
          participant_a_id: pA,
          participant_b_id: pB,
          winner_id: pA,
          status: 'COMPLETED',
          category: { name: "Men's Singles" },
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 15 },
            { game_number: 2, participant_a_score: 21, participant_b_score: 19 },
          ],
        },
        // Match 2: B vs A (B wins 2-1)
        {
          id: 'h2h_2',
          participant_a_id: pB,
          participant_b_id: pA,
          winner_id: pB,
          status: 'COMPLETED',
          category: { name: "Men's Singles" },
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 18 },
            { game_number: 2, participant_a_score: 17, participant_b_score: 21 },
            { game_number: 3, participant_a_score: 21, participant_b_score: 19 },
          ],
        },
        // Match 3: A vs C (Unrelated to B)
        {
          id: 'h2h_3',
          participant_a_id: pA,
          participant_b_id: pC,
          winner_id: pA,
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 5 }],
        },
      ];

      const h2h = calculateHeadToHead(matches, pA, pB);

      assert.strictEqual(h2h.playerAId, pA);
      assert.strictEqual(h2h.playerBId, pB);
      assert.strictEqual(h2h.matchesPlayed, 2);
      assert.strictEqual(h2h.playerAWins, 1);
      assert.strictEqual(h2h.playerBWins, 1);
      assert.strictEqual(h2h.playerAGamesWon, 3); // 2 in match 1, 1 in match 2
      assert.strictEqual(h2h.playerBGamesWon, 2); // 0 in match 1, 2 in match 2
      assert.strictEqual(h2h.playerAPoints, 100); // 21+21+18+21+19
      assert.strictEqual(h2h.playerBPoints, 93);  // 15+19+21+17+21
      assert.strictEqual(h2h.matchHistory.length, 2);
      assert.strictEqual(h2h.matchHistory[0].matchId, 'h2h_1');
      assert.strictEqual(h2h.matchHistory[1].matchId, 'h2h_2');
    });

    test('3.2. Head-to-Head ignores teammates in Doubles', () => {
      const playerA = 'doubles_partner_a';
      const playerB = 'doubles_partner_b';

      const teamPair: MatchDataInput['participant_a'] = {
        id: 'team_pair',
        members: [
          { player_id: playerA, player: { id: playerA } },
          { player_id: playerB, player: { id: playerB } },
        ],
      };

      const oppTeam: MatchDataInput['participant_b'] = {
        id: 'opp_team',
        members: [
          { player_id: 'opp_1', player: { id: 'opp_1' } },
          { player_id: 'opp_2', player: { id: 'opp_2' } },
        ],
      };

      const matches: MatchDataInput[] = [
        {
          id: 'team_match',
          participant_a_id: 'team_pair',
          participant_b_id: 'opp_team',
          participant_a: teamPair,
          participant_b: oppTeam,
          winner_id: 'team_pair',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 10 }],
        }
      ];

      const h2h = calculateHeadToHead(matches, playerA, playerB);
      assert.strictEqual(h2h.matchesPlayed, 0, 'Doubles partners must not be recorded as opponents in H2H');
    });
  });

  // -------------------------------------------------------------------------
  // 4. TOURNAMENT STATS & OPERATIONAL METRICS
  // -------------------------------------------------------------------------
  describe('4. Tournament Operational Statistics', () => {

    test('4.1. Computes total, live, completed matches, points, and duration accurately', () => {
      const matches: MatchDataInput[] = [
        {
          id: 'tm1',
          category_id: 'cat1',
          court_id: 'court1',
          status: 'COMPLETED',
          started_at: '2026-09-20T10:00:00Z',
          completed_at: '2026-09-20T10:40:00Z', // 40 mins
          games: [
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
          ],
        },
        {
          id: 'tm2',
          category_id: 'cat1',
          court_id: 'court1',
          status: 'LIVE',
          games: [
            { participant_a_score: 10, participant_b_score: 8, isCompleted: false },
          ],
        },
        {
          id: 'tm3',
          category_id: 'cat2',
          court_id: 'court2',
          status: 'READY',
        },
        {
          id: 'tm4',
          category_id: 'cat2',
          status: 'SCHEDULED',
        },
        {
          id: 'tm5',
          category_id: 'cat2',
          status: 'CANCELLED',
        }
      ];

      const categories = [
        { id: 'cat1', name: "Men's Singles", matches: [matches[0], matches[1]] },
        { id: 'cat2', name: "Women's Singles", matches: [matches[2], matches[3], matches[4]] }
      ];

      const courts = [
        { id: 'court1', name: 'Court 1' },
        { id: 'court2', name: 'Court 2' },
        { id: 'court3', name: 'Court 3' }, // Unused
      ];

      const tourneyStats = calculateTournamentStats({ matches, categories, courts });

      assert.strictEqual(tourneyStats.totalMatches, 5);
      assert.strictEqual(tourneyStats.completedMatches, 1);
      assert.strictEqual(tourneyStats.liveMatches, 1);
      assert.strictEqual(tourneyStats.scheduledMatches, 2); // READY + SCHEDULED
      assert.strictEqual(tourneyStats.cancelledMatches, 1);
      assert.strictEqual(tourneyStats.totalGames, 3); // 2 in tm1, 1 in tm2
      assert.strictEqual(tourneyStats.totalPoints, 97); // 21+18+21+19 + 10+8
      assert.strictEqual(tourneyStats.averageMatchDurationMinutes, 40);

      // Category breakdowns
      assert.strictEqual(tourneyStats.categoryStats.length, 2);
      assert.strictEqual(tourneyStats.categoryStats[0].categoryId, 'cat1');
      assert.strictEqual(tourneyStats.categoryStats[0].totalMatches, 2);
      assert.strictEqual(tourneyStats.categoryStats[0].completedMatches, 1);
      assert.strictEqual(tourneyStats.categoryStats[0].liveMatches, 1);

      assert.strictEqual(tourneyStats.categoryStats[1].categoryId, 'cat2');
      assert.strictEqual(tourneyStats.categoryStats[1].totalMatches, 3);
      assert.strictEqual(tourneyStats.categoryStats[1].scheduledMatches, 2);

      // Court utilization
      assert.strictEqual(tourneyStats.courtUtilization?.length, 3);
      assert.strictEqual(tourneyStats.courtUtilization?.[0].courtId, 'court1');
      assert.strictEqual(tourneyStats.courtUtilization?.[0].matchesAssigned, 2);
      assert.strictEqual(tourneyStats.courtUtilization?.[0].matchesCompleted, 1);
      assert.strictEqual(tourneyStats.courtUtilization?.[0].isCurrentlyInUse, true); // tm2 is LIVE

      assert.strictEqual(tourneyStats.courtUtilization?.[1].courtId, 'court2');
      assert.strictEqual(tourneyStats.courtUtilization?.[1].matchesAssigned, 1);
      assert.strictEqual(tourneyStats.courtUtilization?.[1].isCurrentlyInUse, false);

      assert.strictEqual(tourneyStats.courtUtilization?.[2].courtId, 'court3');
      assert.strictEqual(tourneyStats.courtUtilization?.[2].matchesAssigned, 0);
      assert.strictEqual(tourneyStats.courtUtilization?.[2].isCurrentlyInUse, false);
    });

    test('4.2. Handles empty tournament gracefully without exceptions or NaN', () => {
      const stats = calculateTournamentStats({});
      assert.strictEqual(stats.totalMatches, 0);
      assert.strictEqual(stats.completedMatches, 0);
      assert.strictEqual(stats.liveMatches, 0);
      assert.strictEqual(stats.totalPoints, 0);
      assert.strictEqual(stats.averageMatchDurationMinutes, null);
      assert.strictEqual(stats.averagePointsPerMatch, 0);
      assert.strictEqual(stats.categoryStats.length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. EDGE CASES & MALFORMED DATA RESILIENCE
  // -------------------------------------------------------------------------
  describe('5. Edge Cases & Malformed Data Handling', () => {

    test('5.1. Handles null, undefined, and empty objects gracefully', () => {
      const standings = calculateStandings([]);
      assert.strictEqual(standings.sortedEntries.length, 0);
      assert.strictEqual(standings.hasTies, false);

      const pStats = calculatePlayerStats([], '');
      assert.strictEqual(pStats.matchesPlayed, 0);

      const h2h = calculateHeadToHead([], '', '');
      assert.strictEqual(h2h.matchesPlayed, 0);

      // Malformed match with missing games array and null participants
      const malformedMatches: MatchDataInput[] = [
        {
          id: 'malformed_1',
          status: 'COMPLETED',
          participant_a_id: null,
          participant_b_id: null,
          winner_id: null,
          games: null,
        }
      ];

      const safePStats = calculatePlayerStats(malformedMatches, 'any_id');
      assert.strictEqual(safePStats.matchesPlayed, 0);
    });
  });
});
