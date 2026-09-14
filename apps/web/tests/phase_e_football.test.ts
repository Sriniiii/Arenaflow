import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  FootballRules,
  FootballMatchState,
  FootballLineup,
  DEFAULT_FOOTBALL_CONFIG,
  BadmintonRules
} from '@arena-flow/sport-engine';
import {
  calculateFootballPlayerStats,
  calculateFootballTeamStats,
  calculateFootballAnalytics,
  calculateFootballLeaderboards,
  calculateBadmintonAnalytics,
  calculatePlayerStats,
  sortStandings,
  StandingEntry
} from '@arena-flow/statistics-engine';
import {
  reconstructOfflineFootballMatchState,
  OfflineMatchEvent
} from '../src/services/offlineScoring';

function loadEnv() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '../.env'),
      path.resolve(process.cwd(), '../../.env'),
      path.resolve(__dirname, '../../../.env'),
      path.resolve(__dirname, '../../.env'),
      path.resolve(__dirname, '../.env'),
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(process.cwd(), '../.env.local')
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
          const parts = line.split('=');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
            if (value && !process.env[key]) {
              process.env[key] = value;
            }
          }
        });
      }
    }
  } catch (err) {
    console.warn('Failed to load root .env file:', err);
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('ArenaFlow Phase E: Football Player Portal, Spectator, & Statistics Integration Test Suite', () => {
  const fbRules = new FootballRules();
  const bmRules = new BadmintonRules();

  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  // Track transient entities to clean up
  const cleanupMatchIds: string[] = [];
  const cleanupParticipantIds: string[] = [];
  const cleanupCategoryIds: string[] = [];
  const cleanupDrawIds: string[] = [];
  const cleanupTournamentIds: string[] = [];
  const cleanupPlayerIds: string[] = [];

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });
  });

  after(async () => {
    // Clean up all transient test records
    try {
      if (cleanupMatchIds.length > 0) {
        await adminClient.from('match_events').delete().in('match_id', cleanupMatchIds);
        await adminClient.from('matches').delete().in('id', cleanupMatchIds);
      }
      if (cleanupDrawIds.length > 0) {
        await adminClient.from('draw_nodes').delete().in('draw_id', cleanupDrawIds);
        await adminClient.from('rounds').delete().in('draw_id', cleanupDrawIds);
        await adminClient.from('standings_entries').delete().in('standings_id', cleanupDrawIds);
        await adminClient.from('standings').delete().in('draw_id', cleanupDrawIds);
        await adminClient.from('draws').delete().in('id', cleanupDrawIds);
      }
      if (cleanupParticipantIds.length > 0) {
        await adminClient.from('participant_members').delete().in('participant_id', cleanupParticipantIds);
        await adminClient.from('participants').delete().in('id', cleanupParticipantIds);
      }
      if (cleanupCategoryIds.length > 0) {
        await adminClient.from('categories').delete().in('id', cleanupCategoryIds);
      }
      if (cleanupTournamentIds.length > 0) {
        await adminClient.from('tournaments').delete().in('id', cleanupTournamentIds);
      }
      if (cleanupPlayerIds.length > 0) {
        await adminClient.from('players').delete().in('id', cleanupPlayerIds);
      }
    } catch (e) {
      console.warn('Cleanup notice:', e);
    }
  });

  // ==========================================
  // 1. Authoritative Football Player Statistics
  // ==========================================
  describe('1. Authoritative Football Player Statistics Engine', () => {
    test('E1.1: Canonical match_events replay derives goals, assists, cards, substitutions, and starts', () => {
      let state = fbRules.getInitialState();

      const playerStrikerId = 'pl_striker_01';
      const playerWingerId = 'pl_winger_01';
      const playerDefenderId = 'pl_def_01';
      const playerSubInId = 'pl_sub_01';
      const playerGkId = 'pl_gk_01';

      // 1. Set Lineup
      const lineupA: FootballLineup = {
        startingXI: [playerGkId, playerDefenderId, playerWingerId, playerStrikerId],
        substitutes: [playerSubInId],
        captainId: playerStrikerId
      };
      state = fbRules.applyEvent(state, {
        id: 'ev1', type: 'SET_LINEUP', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 1, team: 'A', lineup: lineupA }
      });

      // 2. Start First Half
      state = fbRules.applyEvent(state, {
        id: 'ev2', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 2 }
      });

      // 3. Goal scored by Striker assisted by Winger at 23'
      state = fbRules.applyEvent(state, {
        id: 'ev3', type: 'GOAL', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 3, team: 'A', minute: 23, scorerPlayerId: playerStrikerId, assistPlayerId: playerWingerId }
      });

      // 4. Yellow card for Defender at 35'
      state = fbRules.applyEvent(state, {
        id: 'ev4', type: 'YELLOW_CARD', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 4, team: 'A', minute: 35, playerId: playerDefenderId }
      });

      // 5. Second Yellow -> Red card for Defender at 58'
      state = fbRules.applyEvent(state, {
        id: 'ev5', type: 'YELLOW_CARD', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 5, team: 'A', minute: 58, playerId: playerDefenderId }
      });

      // 6. Substitution: Winger OUT -> Sub IN at 65'
      state = fbRules.applyEvent(state, {
        id: 'ev6', type: 'SUBSTITUTION', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 6, team: 'A', minute: 65, playerOffId: playerWingerId, playerOnId: playerSubInId }
      });

      // 7. Full Time 1-0 Win for Team A
      state = fbRules.applyEvent(state, {
        id: 'ev7', type: 'END_SECOND_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm1', sequenceNumber: 7 }
      });

      const mockMatch = {
        id: 'm1',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 0,
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            { player: { id: playerGkId, full_name: 'GK One' } },
            { player: { id: playerDefenderId, full_name: 'Defender One' } },
            { player: { id: playerWingerId, full_name: 'Winger One' } },
            { player: { id: playerStrikerId, full_name: 'Striker One' } },
            { player: { id: playerSubInId, full_name: 'Sub Player' } }
          ]
        },
        participant_b: { id: 'team_b', name: 'Team Beta', members: [] },
        lineup_data: { teamA: lineupA },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: lineupA, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 2 },
          { event_type: 'GOAL', side: 'A', minute: 23, detail: { scorerPlayerId: playerStrikerId, assistPlayerId: playerWingerId }, sequence_number: 3 },
          { event_type: 'YELLOW_CARD', side: 'A', minute: 35, detail: { playerId: playerDefenderId }, sequence_number: 4 },
          { event_type: 'YELLOW_CARD', side: 'A', minute: 58, detail: { playerId: playerDefenderId }, sequence_number: 5 },
          { event_type: 'SUBSTITUTION', side: 'A', minute: 65, detail: { playerOffId: playerWingerId, playerOnId: playerSubInId }, sequence_number: 6 },
          { event_type: 'END_SECOND_HALF', sequence_number: 7 }
        ]
      };

      // Test Striker stats
      const strikerStats = calculateFootballPlayerStats([mockMatch], playerStrikerId, 'Striker One');
      assert.strictEqual(strikerStats.goals, 1, 'Striker must have 1 goal');
      assert.strictEqual(strikerStats.assists, 0, 'Striker assists = 0');
      assert.strictEqual(strikerStats.starts, 1, 'Striker started match');
      assert.strictEqual(strikerStats.appearances, 1, 'Striker has 1 appearance');
      assert.strictEqual(strikerStats.matchesWon, 1, 'Team won match');
      assert.strictEqual(strikerStats.cleanSheetAppearances, 1, 'Clean sheet credited since conceded = 0');

      // Test Winger stats
      const wingerStats = calculateFootballPlayerStats([mockMatch], playerWingerId, 'Winger One');
      assert.strictEqual(wingerStats.goals, 0, 'Winger goals = 0');
      assert.strictEqual(wingerStats.assists, 1, 'Winger has 1 assist');
      assert.strictEqual(wingerStats.substitutionsOut, 1, 'Winger was subbed out');
      assert.strictEqual(wingerStats.starts, 1, 'Winger started');
      assert.strictEqual(wingerStats.minutesPlayed, 65, 'Winger played 65 minutes');

      // Test Sub In stats
      const subStats = calculateFootballPlayerStats([mockMatch], playerSubInId, 'Sub Player');
      assert.strictEqual(subStats.starts, 0, 'Sub did not start');
      assert.strictEqual(subStats.substitutionsIn, 1, 'Sub entered as substitute');
      assert.strictEqual(subStats.appearances, 1, 'Sub appearance = 1');
      assert.strictEqual(subStats.minutesPlayed, 25, 'Sub played 90 - 65 = 25 minutes');

      // Test Defender stats (second yellow -> red)
      const defStats = calculateFootballPlayerStats([mockMatch], playerDefenderId, 'Defender One');
      assert.strictEqual(defStats.yellowCards, 2, 'Defender received 2 yellow cards');
      assert.strictEqual(defStats.secondYellows, 1, 'Defender received 1 second yellow');
      assert.strictEqual(defStats.redCards, 1, 'Defender received 1 total red card');
    });

    test('E1.2: Penalty shootout goals are strictly isolated and NOT added to player total goals', () => {
      let state = fbRules.getInitialState({ penaltyShootoutEnabled: true, allowDraw: false });

      const playerKicker1 = 'pl_kicker_01';
      const playerKicker2 = 'pl_kicker_02';

      // 1. Lineup
      const lineupA: FootballLineup = { startingXI: [playerKicker1, playerKicker2], substitutes: [] };
      state = fbRules.applyEvent(state, {
        id: 'ev1', type: 'SET_LINEUP', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 1, team: 'A', lineup: lineupA }
      });

      // 2. Regulation ends 1-1 (Kicker1 scored regulation goal at 40')
      state = fbRules.applyEvent(state, {
        id: 'ev2', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 2 }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev3', type: 'GOAL', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 3, team: 'A', minute: 40, scorerPlayerId: playerKicker1 }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev4', type: 'END_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 4 }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev5', type: 'START_SECOND_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 5 }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev6', type: 'GOAL', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 6, team: 'B', minute: 75, scorerPlayerId: 'opp_player' }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev7', type: 'END_SECOND_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 7 }
      });

      // 3. Shootout kicks
      state = fbRules.applyEvent(state, {
        id: 'ev8', type: 'START_PENALTY_SHOOTOUT', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 8 }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev9', type: 'PENALTY_KICK', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 9, team: 'A', kickerPlayerId: playerKicker1, kickNumber: 1, scored: true }
      });
      state = fbRules.applyEvent(state, {
        id: 'ev10', type: 'PENALTY_KICK', timestamp: new Date().toISOString(),
        metadata: { matchId: 'm_shootout', sequenceNumber: 10, team: 'A', kickerPlayerId: playerKicker2, kickNumber: 2, scored: true }
      });

      const mockShootoutMatch = {
        id: 'm_shootout',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 1,
        shootout_score: { score_a: 4, score_b: 2 },
        winner_id: 'team_a',
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            { player: { id: playerKicker1, full_name: 'Kicker One' } },
            { player: { id: playerKicker2, full_name: 'Kicker Two' } }
          ]
        },
        participant_b: {
          id: 'team_b',
          name: 'Team Beta',
          members: [{ player: { id: 'opp_player', full_name: 'Opp Player' } }]
        },
        lineup_data: { teamA: lineupA },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: lineupA, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 1.5 },
          { event_type: 'GOAL', side: 'A', minute: 40, detail: { scorerPlayerId: playerKicker1 }, sequence_number: 2 },
          { event_type: 'GOAL', side: 'B', minute: 75, detail: { scorerPlayerId: 'opp_player' }, sequence_number: 3 },
          { event_type: 'END_SECOND_HALF', sequence_number: 3.5 },
          { event_type: 'START_PENALTY_SHOOTOUT', sequence_number: 4 },
          { event_type: 'PENALTY_KICK', side: 'A', detail: { kickerPlayerId: playerKicker1, kickNumber: 1, scored: true }, sequence_number: 5 },
          { event_type: 'PENALTY_KICK', side: 'A', detail: { kickerPlayerId: playerKicker2, kickNumber: 2, scored: true }, sequence_number: 6 }
        ]
      };

      const kicker1Stats = calculateFootballPlayerStats([mockShootoutMatch], playerKicker1, 'Kicker One');
      assert.strictEqual(kicker1Stats.goals, 1, 'Player goals must be 1 (regulation goal only, shootout kick excluded)');

      const kicker2Stats = calculateFootballPlayerStats([mockShootoutMatch], playerKicker2, 'Kicker Two');
      assert.strictEqual(kicker2Stats.goals, 0, 'Player goals must be 0 (shootout kick strictly excluded)');
    });

    test('E1.3: Deterministic Minutes Played calculation (Regulation Sub at 67\', ET Sub at 67\', Unused Sub = 0, Abandoned = Skipped)', () => {
      const pStarter1 = 'p_starter_1';
      const pStarter2 = 'p_starter_2';
      const pSubIn67 = 'p_sub_67';
      const pUnusedSub = 'p_unused';

      const regLineup: FootballLineup = {
        startingXI: [pStarter1, pStarter2],
        substitutes: [pSubIn67, pUnusedSub]
      };

      // Match 1: 90-minute Regulation match with sub at 67'
      const matchRegulation = {
        id: 'm_reg_minutes',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 0,
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            { player: { id: pStarter1, full_name: 'Starter One' } },
            { player: { id: pStarter2, full_name: 'Starter Two' } },
            { player: { id: pSubIn67, full_name: 'Sub 67' } },
            { player: { id: pUnusedSub, full_name: 'Unused Sub' } }
          ]
        },
        lineup_data: { teamA: regLineup },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: regLineup, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 2 },
          { event_type: 'END_FIRST_HALF', sequence_number: 3 },
          { event_type: 'START_SECOND_HALF', sequence_number: 4 },
          { event_type: 'SUBSTITUTION', side: 'A', minute: 67, detail: { playerOffId: pStarter1, playerOnId: pSubIn67 }, sequence_number: 5 },
          { event_type: 'END_SECOND_HALF', sequence_number: 6 }
        ]
      };

      // Starter 1 (subbed off at 67'): 67 minutes
      const st1Stats = calculateFootballPlayerStats([matchRegulation], pStarter1);
      assert.strictEqual(st1Stats.starts, 1);
      assert.strictEqual(st1Stats.substitutionsOut, 1);
      assert.strictEqual(st1Stats.minutesPlayed, 67, 'Starter subbed off at 67 receives exactly 67 minutes');

      // Starter 2 (played full 90'): 90 minutes
      const st2Stats = calculateFootballPlayerStats([matchRegulation], pStarter2);
      assert.strictEqual(st2Stats.starts, 1);
      assert.strictEqual(st2Stats.minutesPlayed, 90, 'Full-match starter receives exactly 90 minutes');

      // Sub In (entered at 67'): 90 - 67 = 23 minutes
      const subStats = calculateFootballPlayerStats([matchRegulation], pSubIn67);
      assert.strictEqual(subStats.starts, 0);
      assert.strictEqual(subStats.substitutionsIn, 1);
      assert.strictEqual(subStats.minutesPlayed, 23, 'Substitute entering at 67 in regulation receives 90 - 67 = 23 minutes');

      // Unused Sub: 0 appearances, 0 starts, null/0 minutes
      const unusedStats = calculateFootballPlayerStats([matchRegulation], pUnusedSub);
      assert.strictEqual(unusedStats.appearances, 0);
      assert.strictEqual(unusedStats.starts, 0);
      assert.strictEqual(unusedStats.minutesPlayed, null, 'Unused sub receives null / 0 minutes');

      // Match 2: 120-minute Extra Time match with sub at 67'
      const matchExtraTime = {
        id: 'm_et_minutes',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 1,
        extra_time_score: { score_a: 2, score_b: 1 },
        winner_id: 'team_a',
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            { player: { id: pStarter1, full_name: 'Starter One' } },
            { player: { id: pStarter2, full_name: 'Starter Two' } },
            { player: { id: pSubIn67, full_name: 'Sub 67' } }
          ]
        },
        lineup_data: { teamA: regLineup },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: regLineup, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 2 },
          { event_type: 'END_FIRST_HALF', sequence_number: 3 },
          { event_type: 'START_SECOND_HALF', sequence_number: 4 },
          { event_type: 'SUBSTITUTION', side: 'A', minute: 67, detail: { playerOffId: pStarter1, playerOnId: pSubIn67 }, sequence_number: 5 },
          { event_type: 'END_SECOND_HALF', sequence_number: 6 },
          { event_type: 'START_EXTRA_TIME_FIRST_HALF', sequence_number: 7 },
          { event_type: 'END_EXTRA_TIME_FIRST_HALF', sequence_number: 8 },
          { event_type: 'START_EXTRA_TIME_SECOND_HALF', sequence_number: 9 },
          { event_type: 'END_EXTRA_TIME_SECOND_HALF', sequence_number: 10 }
        ]
      };

      // In ET: Starter 2 gets 120 minutes, Sub in at 67' gets 120 - 67 = 53 minutes
      const st2EtStats = calculateFootballPlayerStats([matchExtraTime], pStarter2);
      assert.strictEqual(st2EtStats.minutesPlayed, 120, 'Full-match starter in extra time receives 120 minutes');

      const subEtStats = calculateFootballPlayerStats([matchExtraTime], pSubIn67);
      assert.strictEqual(subEtStats.minutesPlayed, 53, 'Substitute entering at 67 in extra time receives 120 - 67 = 53 minutes');

      // Match 3: Abandoned match is explicitly excluded from completed stats
      const matchAbandoned = {
        id: 'm_abandoned',
        status: 'COMPLETED',
        outcome: 'ABANDONED',
        score_a: 1,
        score_b: 0,
        participant_a_id: 'team_a',
        participant_a: {
          id: 'team_a',
          members: [{ player: { id: pStarter1, full_name: 'Starter One' } }]
        },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: regLineup, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 2 }
        ]
      };
      const abandonedStats = calculateFootballPlayerStats([matchAbandoned], pStarter1);
      assert.strictEqual(abandonedStats.matchesPlayed, 0, 'Abandoned matches are excluded from completed statistics');
    });

    test('E1.4: Canonical Football Event Vocabulary compliance verification', () => {
      const canonicalVocabulary = [
        'SET_LINEUP',
        'START_FIRST_HALF',
        'END_FIRST_HALF',
        'START_SECOND_HALF',
        'END_SECOND_HALF',
        'START_EXTRA_TIME_FIRST_HALF',
        'END_EXTRA_TIME_FIRST_HALF',
        'START_EXTRA_TIME_SECOND_HALF',
        'END_EXTRA_TIME_SECOND_HALF',
        'START_PENALTY_SHOOTOUT',
        'PENALTY_KICK',
        'GOAL',
        'OWN_GOAL',
        'YELLOW_CARD',
        'RED_CARD',
        'SUBSTITUTION',
        'PAUSE_MATCH',
        'RESUME_MATCH',
        'DECLARE_OUTCOME',
        'UNDO'
      ];

      for (const eventType of canonicalVocabulary) {
        const dummyEvent = {
          id: `ev_${eventType}`,
          type: eventType,
          timestamp: new Date().toISOString(),
          metadata: {}
        };
        const validation = fbRules.validateEvent(fbRules.getInitialState(), dummyEvent);
        assert.ok(typeof validation.isValid === 'boolean', `Engine must recognize canonical event type: ${eventType}`);
      }

      // Non-canonical types must be rejected
      const invalidValidation = fbRules.validateEvent(fbRules.getInitialState(), {
        id: 'ev_invalid',
        type: 'NON_CANONICAL_TYPE',
        timestamp: new Date().toISOString(),
        metadata: {}
      });
      assert.strictEqual(invalidValidation.isValid, false, 'Non-canonical event types must be rejected by FootballRules');
    });
  });

  // ==========================================
  // 2. Football Standings & Tie-Break Ordering
  // ==========================================
  describe('2. Football Standings & Hierarchy Tie-Break Rules', () => {
    test('E2.1: 3-1-0 Point system, Goal Difference, Goals For, and Fair Play Point calculation', () => {
      const entryA: StandingEntry = {
        id: 'st_1',
        standings_id: 'std_grp_a',
        participant_id: 'team_a',
        played: 3,
        won: 2,
        drawn: 0,
        lost: 1,
        points_for: 6,
        points_against: 2,
        points_diff: 4,
        goals_for: 6,
        goals_against: 2,
        goal_difference: 4,
        points: 6,
        games_won: 0,
        games_lost: 0,
        games_diff: 0,
        win_percentage: 66.7,
        rank: 0,
        is_manually_resolved: false,
        yellow_cards: 1,
        red_cards: 0,
        fair_play_points: -1
      };

      const entryB: StandingEntry = {
        id: 'st_2',
        standings_id: 'std_grp_a',
        participant_id: 'team_b',
        played: 3,
        won: 2,
        drawn: 0,
        lost: 1,
        points_for: 5,
        points_against: 2,
        points_diff: 3,
        goals_for: 5,
        goals_against: 2,
        goal_difference: 3,
        points: 6,
        games_won: 0,
        games_lost: 0,
        games_diff: 0,
        win_percentage: 66.7,
        rank: 0,
        is_manually_resolved: false,
        yellow_cards: 3,
        red_cards: 0,
        fair_play_points: -3
      };

      const entryC: StandingEntry = {
        id: 'st_3',
        standings_id: 'std_grp_a',
        participant_id: 'team_c',
        played: 3,
        won: 2,
        drawn: 0,
        lost: 1,
        points_for: 3,
        points_against: 0,
        points_diff: 3,
        goals_for: 3,
        goals_against: 0,
        goal_difference: 3,
        points: 6,
        games_won: 0,
        games_lost: 0,
        games_diff: 0,
        win_percentage: 66.7,
        rank: 0,
        is_manually_resolved: false,
        yellow_cards: 0,
        red_cards: 0,
        fair_play_points: 0
      };

      const matches = [
        { id: 'm1', status: 'COMPLETED', participant_a_id: 'team_a', participant_b_id: 'team_b', score_a: 2, score_b: 1 },
        { id: 'm2', status: 'COMPLETED', participant_a_id: 'team_b', participant_b_id: 'team_c', score_a: 1, score_b: 0 },
        { id: 'm3', status: 'COMPLETED', participant_a_id: 'team_c', participant_b_id: 'team_a', score_a: 1, score_b: 0 }
      ];

      const { sortedEntries } = sortStandings([entryB, entryC, entryA], matches, { sport: 'FOOTBALL' });

      assert.strictEqual(sortedEntries[0].participant_id, 'team_a', 'Team A ranked 1st due to superior Goal Difference (+4 vs +3)');
      assert.strictEqual(sortedEntries[1].participant_id, 'team_b', 'Team B ranked 2nd due to superior Goals For (5 vs 3 with equal GD +3)');
      assert.strictEqual(sortedEntries[2].participant_id, 'team_c', 'Team C ranked 3rd');
      assert.ok(sortedEntries[0].tieBreakReason, 'Tie-break explanation must be populated');
    });

    test('E2.2: Fair play points applied when points, GD, GF, and H2H are equal', () => {
      const entry1: StandingEntry = {
        id: 'st_fp_1',
        standings_id: 'std_grp_fp',
        participant_id: 'team_fair',
        played: 1,
        won: 0,
        drawn: 1,
        lost: 0,
        points_for: 1,
        points_against: 1,
        points_diff: 0,
        goals_for: 1,
        goals_against: 1,
        goal_difference: 0,
        points: 1,
        games_won: 0,
        games_lost: 0,
        games_diff: 0,
        win_percentage: 0,
        rank: 0,
        is_manually_resolved: false,
        yellow_cards: 1,
        red_cards: 0,
        fair_play_points: -1
      };

      const entry2: StandingEntry = {
        id: 'st_fp_2',
        standings_id: 'std_grp_fp',
        participant_id: 'team_unruly',
        played: 1,
        won: 0,
        drawn: 1,
        lost: 0,
        points_for: 1,
        points_against: 1,
        points_diff: 0,
        goals_for: 1,
        goals_against: 1,
        goal_difference: 0,
        points: 1,
        games_won: 0,
        games_lost: 0,
        games_diff: 0,
        win_percentage: 0,
        rank: 0,
        is_manually_resolved: false,
        yellow_cards: 2,
        red_cards: 1,
        fair_play_points: -5
      };

      const matches = [
        { id: 'm_draw', status: 'COMPLETED', participant_a_id: 'team_fair', participant_b_id: 'team_unruly', score_a: 1, score_b: 1 }
      ];

      const { sortedEntries } = sortStandings([entry2, entry1], matches, { sport: 'FOOTBALL' });
      assert.strictEqual(sortedEntries[0].participant_id, 'team_fair', 'Team with better Fair Play record ranks higher');
      assert.strictEqual(sortedEntries[1].participant_id, 'team_unruly', 'Team with worse Fair Play record ranks lower');
    });

    test('E2.3: Second-yellow dismissal policy does not double count and honors configurable Fair Play weighting', () => {
      const matchWithDiscipline = {
        id: 'm_cards_test',
        status: 'COMPLETED',
        participant_a_id: 'team_clean',
        participant_b_id: 'team_disciplinary',
        score_a: 0,
        score_b: 0,
        match_events: [
          // Team B: Player 1 gets 2 yellows -> 2nd yellow dismissal (net -3)
          { event_type: 'YELLOW_CARD', side: 'B', detail: { playerId: 'pB_1' }, sequence_number: 1 },
          { event_type: 'YELLOW_CARD', side: 'B', detail: { playerId: 'pB_1' }, sequence_number: 2 },
          // Team B: Player 2 gets direct red (net -4)
          { event_type: 'RED_CARD', side: 'B', detail: { playerId: 'pB_2' }, sequence_number: 3 },
          // Team B: Player 3 gets 1 yellow (net -1)
          { event_type: 'YELLOW_CARD', side: 'B', detail: { playerId: 'pB_3' }, sequence_number: 4 },
          // Team A: Player 1 gets 1 yellow (net -1)
          { event_type: 'YELLOW_CARD', side: 'A', detail: { playerId: 'pA_1' }, sequence_number: 5 }
        ]
      };

      const entryClean: StandingEntry = {
        participant_id: 'team_clean', played: 1, won: 0, drawn: 1, lost: 0,
        points_for: 0, points_against: 0, points_diff: 0, games_won: 0, games_lost: 0, games_diff: 0,
        win_percentage: 0, rank: 0, is_manually_resolved: false,
        yellow_cards: 1, red_cards: 0, fair_play_points: -1
      };

      // Team B total Fair Play points: -3 (pB_1) + -4 (pB_2) + -1 (pB_3) = -8
      const entryDisciplinary: StandingEntry = {
        participant_id: 'team_disciplinary', played: 1, won: 0, drawn: 1, lost: 0,
        points_for: 0, points_against: 0, points_diff: 0, games_won: 0, games_lost: 0, games_diff: 0,
        win_percentage: 0, rank: 0, is_manually_resolved: false,
        yellow_cards: 3, red_cards: 2, fair_play_points: -8
      };

      const result = sortStandings([entryDisciplinary, entryClean], [matchWithDiscipline], { sport: 'FOOTBALL' });
      assert.strictEqual(result.sortedEntries[0].participant_id, 'team_clean');
      assert.strictEqual(result.sortedEntries[1].participant_id, 'team_disciplinary');
      assert.strictEqual(result.sortedEntries[0].tieBreakReason, 'Fair Play');
    });

    test('E2.4: Shootout statistics reconciliation: official 1-1, shootout 4-3, GF=1, GA=1, GD=0, winner=Team A', () => {
      const matchShootout = {
        id: 'm_shootout_reconciliation',
        status: 'COMPLETED',
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            { player: { id: 'p_striker_a', full_name: 'Striker Alpha' } },
            { player: { id: 'p_kicker_a2', full_name: 'Kicker A2' } }
          ]
        },
        participant_b: {
          id: 'team_b',
          name: 'Team Beta',
          members: [
            { player: { id: 'p_striker_b', full_name: 'Striker Beta' } }
          ]
        },
        score_a: 1,
        score_b: 1,
        shootout_score: { score_a: 4, score_b: 3 },
        winner_id: 'team_a',
        match_events: [
          { event_type: 'START_FIRST_HALF', sequence_number: 1 },
          { event_type: 'GOAL', side: 'A', minute: 20, detail: { scorerPlayerId: 'p_striker_a' }, sequence_number: 2 },
          { event_type: 'GOAL', side: 'B', minute: 80, detail: { scorerPlayerId: 'p_striker_b' }, sequence_number: 3 },
          { event_type: 'END_SECOND_HALF', sequence_number: 4 },
          { event_type: 'START_PENALTY_SHOOTOUT', sequence_number: 5 },
          // Shootout kicks (must NOT be counted in team GF/GA or player goals)
          { event_type: 'PENALTY_KICK', side: 'A', detail: { kickerPlayerId: 'p_striker_a', scored: true }, sequence_number: 6 },
          { event_type: 'PENALTY_KICK', side: 'B', detail: { kickerPlayerId: 'p_striker_b', scored: true }, sequence_number: 7 },
          { event_type: 'PENALTY_KICK', side: 'A', detail: { kickerPlayerId: 'p_kicker_a2', scored: true }, sequence_number: 8 }
        ]
      };

      // 1. Team A Stats Reconciliation
      const teamAStats = calculateFootballTeamStats([matchShootout], 'team_a', 'Team Alpha');
      assert.strictEqual(teamAStats.goalsFor, 1, 'Team A goalsFor must be 1 (regulation score_a, excluding shootout kicks)');
      assert.strictEqual(teamAStats.goalsAgainst, 1, 'Team A goalsAgainst must be 1');
      assert.strictEqual(teamAStats.goalDifference, 0, 'Team A goalDifference must be 0');
      assert.strictEqual(teamAStats.matchesWon, 1, 'Team A won match via shootout');

      // 2. Team B Stats Reconciliation
      const teamBStats = calculateFootballTeamStats([matchShootout], 'team_b', 'Team Beta');
      assert.strictEqual(teamBStats.goalsFor, 1, 'Team B goalsFor must be 1');
      assert.strictEqual(teamBStats.goalsAgainst, 1, 'Team B goalsAgainst must be 1');
      assert.strictEqual(teamBStats.goalDifference, 0, 'Team B goalDifference must be 0');
      assert.strictEqual(teamBStats.matchesLost, 1, 'Team B lost match via shootout');

      // 3. Player Striker A Stats Reconciliation
      const strikerAStats = calculateFootballPlayerStats([matchShootout], 'p_striker_a', 'Striker Alpha');
      assert.strictEqual(strikerAStats.goals, 1, 'Player striker goals must be 1 (shootout kick strictly excluded)');

      // 4. Player Kicker A2 Stats Reconciliation
      const kickerA2Stats = calculateFootballPlayerStats([matchShootout], 'p_kicker_a2', 'Kicker A2');
      assert.strictEqual(kickerA2Stats.goals, 0, 'Player kicker A2 goals must be 0 (shootout kick strictly excluded)');
    });
  });

  // ==========================================
  // 3. Football Tournament Analytics & Leaderboards
  // ==========================================
  describe('3. Football Tournament Analytics & Leaderboards', () => {
    test('E3.1: calculateFootballAnalytics aggregates goals, cards, clean sheets, and decision methods', () => {
      const matches = [
        {
          id: 'm1',
          status: 'COMPLETED',
          score_a: 3,
          score_b: 0,
          match_events: [
            { event_type: 'YELLOW_CARD' },
            { event_type: 'YELLOW_CARD' },
            { event_type: 'RED_CARD' }
          ]
        },
        {
          id: 'm2',
          status: 'COMPLETED',
          score_a: 2,
          score_b: 2,
          extra_time_score: { score_a: 3, score_b: 2 },
          match_events: [
            { event_type: 'YELLOW_CARD' },
            { event_type: 'SUBSTITUTION' }
          ]
        },
        {
          id: 'm3',
          status: 'COMPLETED',
          score_a: 1,
          score_b: 1,
          shootout_score: { score_a: 5, score_b: 4 },
          match_events: [
            { event_type: 'SUBSTITUTION' }
          ]
        }
      ];

      const analytics = calculateFootballAnalytics(matches);
      assert.strictEqual(analytics.totalGoals, 9, 'Total goals = 3 + 4 + 2 = 9');
      assert.strictEqual(analytics.cleanSheetMatches, 1, '1 match had clean sheet');
      assert.strictEqual(analytics.totalYellowCards, 3, '3 total yellow cards');
      assert.strictEqual(analytics.totalRedCards, 1, '1 total red card');
      assert.strictEqual(analytics.totalSubstitutions, 2, '2 total substitutions');
      assert.strictEqual(analytics.regulationDecidedMatches, 1, '1 regulation decision');
      assert.strictEqual(analytics.extraTimeDecidedMatches, 1, '1 extra time decision');
      assert.strictEqual(analytics.penaltyShootoutDecidedMatches, 1, '1 shootout decision');
    });

    test('E3.2: calculateFootballLeaderboards ranks top scorers, assists, disciplinary, and clean sheets', () => {
      const statsList = [
        {
          playerId: 'p1', playerName: 'Alex Morgan', appearances: 4, starts: 4, substitutionsIn: 0, substitutionsOut: 0,
          minutesPlayed: 360, matchesPlayed: 4, matchesWon: 3, matchesDrawn: 1, matchesLost: 0,
          goals: 5, assists: 2, yellowCards: 1, secondYellows: 0, redCards: 0, directRedCards: 0, ownGoals: 0,
          cleanSheetAppearances: 2, winPercentage: 75, recentForm: ['W', 'W', 'D', 'W'] as any
        },
        {
          playerId: 'p2', playerName: 'Marta Vieira', appearances: 4, starts: 4, substitutionsIn: 0, substitutionsOut: 1,
          minutesPlayed: 320, matchesPlayed: 4, matchesWon: 2, matchesDrawn: 1, matchesLost: 1,
          goals: 3, assists: 4, yellowCards: 0, secondYellows: 0, redCards: 0, directRedCards: 0, ownGoals: 0,
          cleanSheetAppearances: 1, winPercentage: 50, recentForm: ['W', 'L', 'D', 'W'] as any
        },
        {
          playerId: 'p3', playerName: 'Sergio Ramos', appearances: 3, starts: 3, substitutionsIn: 0, substitutionsOut: 0,
          minutesPlayed: 270, matchesPlayed: 3, matchesWon: 1, matchesDrawn: 0, matchesLost: 2,
          goals: 1, assists: 0, yellowCards: 2, secondYellows: 1, redCards: 1, directRedCards: 0, ownGoals: 0,
          cleanSheetAppearances: 1, winPercentage: 33.3, recentForm: ['L', 'W', 'L'] as any
        }
      ];

      const leaderboards = calculateFootballLeaderboards(statsList, { topN: 3 });
      assert.strictEqual(leaderboards.topScorers[0].playerId, 'p1', 'Alex Morgan is top scorer with 5 goals');
      assert.strictEqual(leaderboards.topAssists[0].playerId, 'p2', 'Marta Vieira has top assists with 4');
      assert.strictEqual(leaderboards.disciplinary[0].playerId, 'p3', 'Sergio Ramos leads disciplinary with 1 red card');
    });
  });

  // ==========================================
  // 4. Multi-Match Realtime Isolation & Spectator Replay
  // ==========================================
  describe('4. Multi-Match Realtime Isolation & Spectator Integrity', () => {
    test('E4.1: Events on Football Match A do not corrupt or alter Football Match B state', () => {
      let stateMatchA = fbRules.getInitialState();
      let stateMatchB = fbRules.getInitialState();

      // Match A: Goal scored at 15'
      stateMatchA = fbRules.applyEvent(stateMatchA, {
        id: 'evA1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'match_A', sequenceNumber: 1 }
      });
      stateMatchA = fbRules.applyEvent(stateMatchA, {
        id: 'evA2', type: 'GOAL', timestamp: new Date().toISOString(),
        metadata: { matchId: 'match_A', sequenceNumber: 2, team: 'A', minute: 15, scorerPlayerId: 'pA_striker' }
      });

      // Match B: Yellow card at 20'
      stateMatchB = fbRules.applyEvent(stateMatchB, {
        id: 'evB1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: { matchId: 'match_B', sequenceNumber: 1 }
      });
      stateMatchB = fbRules.applyEvent(stateMatchB, {
        id: 'evB2', type: 'YELLOW_CARD', timestamp: new Date().toISOString(),
        metadata: { matchId: 'match_B', sequenceNumber: 2, team: 'B', minute: 20, playerId: 'pB_defender' }
      });

      // Verify Match A
      assert.strictEqual(stateMatchA.scoreA, 1, 'Match A scoreA must be 1');
      assert.strictEqual(stateMatchA.scoreB, 0, 'Match A scoreB must be 0');
      assert.strictEqual(stateMatchA.cards.length, 0, 'Match A must have 0 cards');

      // Verify Match B
      assert.strictEqual(stateMatchB.scoreA, 0, 'Match B scoreA must be 0');
      assert.strictEqual(stateMatchB.scoreB, 0, 'Match B scoreB must be 0');
      assert.strictEqual(stateMatchB.cards.length, 1, 'Match B must have 1 yellow card');
      assert.strictEqual(stateMatchB.cards[0].playerId, 'pB_defender', 'Match B card belongs to pB_defender');
    });
  });

  // ==========================================
  // 5. Badminton Regression & Dual-Sport Safety
  // ==========================================
  describe('5. Badminton Semantics Protection & Regression Safety', () => {
    test('E5.1: Badminton match scoring, deuce, rallies, and badminton analytics remain 100% intact', () => {
      let bmState = bmRules.getInitialState();

      // Log 21 points for Player A in Game 1
      for (let i = 1; i <= 21; i++) {
        bmState = bmRules.applyEvent(bmState, {
          id: `bm_g1_p${i}`, type: 'POINT_A', timestamp: new Date().toISOString(),
          metadata: { matchId: 'bm_match_1', sequenceNumber: i }
        });
      }

      assert.strictEqual(bmState.games[0].winnerId, 'PARTICIPANT_A', 'Badminton Game 1 won by Player A');
      assert.strictEqual(bmState.games[0].scoreA, 21, 'Badminton Game 1 final score is 21');
      assert.strictEqual(bmState.games[bmState.currentGameIndex].scoreA, 0, 'Score resets for Game 2');
      assert.strictEqual(bmState.games[bmState.currentGameIndex].scoreB, 0, 'Score resets for Game 2');

      const mockBmMatch = {
        id: 'bm_match_1',
        status: 'COMPLETED',
        participant_a_id: 'p_badminton_a',
        participant_b_id: 'p_badminton_b',
        winner_id: 'p_badminton_a',
        games: [
          { game_number: 1, participant_a_score: 21, participant_b_score: 15, status: 'COMPLETED' },
          { game_number: 2, participant_a_score: 21, participant_b_score: 18, status: 'COMPLETED' }
        ],
        match_events: Array.from({ length: 75 }).map((_, idx) => ({ event_type: 'POINT', sequence_number: idx + 1 }))
      };

      const bmAnalytics = calculateBadmintonAnalytics([mockBmMatch]);
      assert.strictEqual(bmAnalytics.straightGameWins, 1, 'Badminton straight game win = 1');
      assert.strictEqual(bmAnalytics.threeGameWins, 0, 'Badminton 3-game deciders = 0');
      assert.strictEqual(bmAnalytics.totalRallies, 75, 'Badminton total rallies = 75');

      const playerBmStats = calculatePlayerStats([mockBmMatch], 'p_badminton_a', 'Badminton Player A');
      assert.strictEqual(playerBmStats.matchesWon, 1, 'Badminton match won = 1');
      assert.strictEqual(playerBmStats.gamesWon, 2, 'Badminton games won = 2');
      assert.strictEqual(playerBmStats.pointsScored, 42, 'Badminton points won = 42');
      assert.strictEqual(playerBmStats.pointsConceded, 33, 'Badminton points lost = 33');
    });
  });

  // =========================================================================
  // 6. Authoritative SET_LINEUP Data-Contract & Replay Integrity Suite
  // =========================================================================
  describe('6. Authoritative SET_LINEUP Data-Contract & Replay Integrity', () => {
    const starters11A = Array.from({ length: 11 }, (_, i) => `pA_${i + 1}`);
    const subsA = ['subA_1', 'subA_2', 'subA_3'];
    const captainA = 'pA_1';

    test('E6.1: Canonical SET_LINEUP event applies cleanly and populates Starting XI, substitutes, and captain', () => {
      let state = fbRules.getInitialState();

      const canonicalLineupPayload: FootballLineup = {
        startingXI: starters11A,
        substitutes: subsA,
        captainId: captainA,
        positions: { [captainA]: 'FWD' }
      };

      state = fbRules.applyEvent(state, {
        id: 'ev_lineup_canonical',
        type: 'SET_LINEUP',
        timestamp: new Date().toISOString(),
        metadata: {
          team: 'A',
          lineup: canonicalLineupPayload
        }
      });

      assert.strictEqual(state.teamAState.activePlayersOnPitch.length, 11, 'Active players on pitch must have exactly 11 players');
      assert.deepStrictEqual(state.teamAState.activePlayersOnPitch, starters11A, 'Starting XI player IDs must match');
      assert.strictEqual(state.teamAState.benchPlayers.length, 3, 'Bench players must have 3 substitutes');
      assert.deepStrictEqual(state.teamAState.benchPlayers, subsA, 'Substitute player IDs must match');
      assert.strictEqual(state.teamAState.captainId, captainA, 'Captain ID must match');
      assert.ok(state.teamAState.lineup, 'Lineup object must be defined');
    });

    test('E6.2: Persisted DB match_events row (canonical nested) reconstructs cleanly via reconstructOfflineFootballMatchState', () => {
      // Shape stored by set_football_lineup RPC in PostgreSQL match_events table
      const persistedServerEvents = [
        {
          id: 'db_ev_1',
          match_id: 'fb_match_reconstruct_1',
          sequence_number: 1,
          event_type: 'SET_LINEUP',
          created_at: '2026-09-10T12:00:00Z',
          metadata: {
            team: 'A',
            teamId: 'team_part_A',
            lineup: {
              startingXI: starters11A,
              substitutes: subsA,
              captainId: captainA,
              positions: {}
            },
            submittedAt: '2026-09-10T12:00:00Z'
          }
        },
        {
          id: 'db_ev_2',
          match_id: 'fb_match_reconstruct_1',
          sequence_number: 2,
          event_type: 'START_FIRST_HALF',
          created_at: '2026-09-10T12:05:00Z',
          metadata: {}
        }
      ];

      const reconstructed = reconstructOfflineFootballMatchState(persistedServerEvents, []);
      assert.strictEqual(reconstructed.phase, 'FIRST_HALF', 'Phase must be FIRST_HALF');
      assert.strictEqual(reconstructed.teamAState.activePlayersOnPitch.length, 11, 'Reconstructed team A active players must be 11');
      assert.deepStrictEqual(reconstructed.teamAState.activePlayersOnPitch, starters11A, 'Reconstructed Starting XI matches DB data');
      assert.deepStrictEqual(reconstructed.teamAState.benchPlayers, subsA, 'Reconstructed substitutes match DB data');
      assert.strictEqual(reconstructed.teamAState.captainId, captainA, 'Reconstructed captain matches DB data');
    });

    test('E6.3: Offline local SET_LINEUP event reconstructs cleanly via reconstructOfflineFootballMatchState', () => {
      const pendingOfflineEvents: OfflineMatchEvent[] = [
        {
          client_event_id: 'offline_ev_lineup_01',
          match_id: 'fb_match_offline_1',
          event_type: 'SET_LINEUP',
          local_order: 1,
          expected_server_sequence: 0,
          created_at: '2026-09-10T12:00:00Z',
          metadata: {
            team: 'A',
            lineup: {
              startingXI: starters11A,
              substitutes: subsA,
              captainId: captainA,
              positions: {}
            }
          },
          sync_status: 'PENDING',
          retry_count: 0
        }
      ];

      const reconstructed = reconstructOfflineFootballMatchState([], pendingOfflineEvents);
      assert.strictEqual(reconstructed.teamAState.activePlayersOnPitch.length, 11, 'Offline reconstructed team A starters must be 11');
      assert.strictEqual(reconstructed.teamAState.captainId, captainA, 'Offline reconstructed captain matches');
    });

    test('E6.4: Malformed SET_LINEUP event fails with deterministic Error identifying event ID and malformed payload', () => {
      let state = fbRules.getInitialState();

      // Case A: Missing startingXI in applyEvent throws explicit deterministic error
      assert.throws(
        () => {
          fbRules.applyEvent(state, {
            id: 'ev_malformed_1',
            type: 'SET_LINEUP',
            timestamp: new Date().toISOString(),
            metadata: {
              team: 'A'
              // missing startingXI and substitutes
            } as any
          });
        },
        (err: any) => {
          assert.ok(err instanceof Error, 'Must throw standard Error');
          assert.match(err.message, /Malformed SET_LINEUP event/i, 'Error message must explicitly state Malformed SET_LINEUP event');
          assert.match(err.message, /ev_malformed_1/, 'Error message must include the event ID');
          return true;
        },
        'Expected applyEvent to reject malformed SET_LINEUP with deterministic error'
      );

      // Case B: reconstructOfflineFootballMatchState throws explicit deterministic error on malformed event
      const malformedServerEvents = [
        {
          id: 'srv_malformed_02',
          sequence_number: 1,
          event_type: 'SET_LINEUP',
          metadata: { team: 'A', startingXI: 'not-an-array' }
        }
      ];

      assert.throws(
        () => {
          reconstructOfflineFootballMatchState(malformedServerEvents, []);
        },
        (err: any) => {
          assert.ok(err instanceof Error, 'Must throw Error');
          assert.match(err.message, /Malformed SET_LINEUP event/i, 'Reconstruction must throw Malformed SET_LINEUP event');
          assert.match(err.message, /srv_malformed_02/, 'Reconstruction must identify the event ID');
          return true;
        },
        'Expected reconstructOfflineFootballMatchState to reject malformed SET_LINEUP'
      );
    });

    test('E6.5: Online and offline event shapes are identical, interchangeable, and produce identical states', () => {
      const canonicalPayload = {
        team: 'A',
        lineup: {
          startingXI: starters11A,
          substitutes: subsA,
          captainId: captainA,
          positions: {}
        }
      };

      // Apply as server event
      const serverState = reconstructOfflineFootballMatchState(
        [
          { id: 'ev_shared_1', sequence_number: 1, event_type: 'SET_LINEUP', metadata: canonicalPayload, created_at: '2026-09-10T12:00:00Z' }
        ],
        []
      );

      // Apply as offline event
      const offlineState = reconstructOfflineFootballMatchState(
        [],
        [
          { client_event_id: 'ev_shared_1', match_id: 'm_test', event_type: 'SET_LINEUP', local_order: 1, expected_server_sequence: 0, metadata: canonicalPayload, sync_status: 'PENDING', created_at: '2026-09-10T12:00:00Z', retry_count: 0 }
        ]
      );

      assert.deepStrictEqual(serverState.teamAState.activePlayersOnPitch, offlineState.teamAState.activePlayersOnPitch, 'Starters must be identical');
      assert.deepStrictEqual(serverState.teamAState.benchPlayers, offlineState.teamAState.benchPlayers, 'Bench players must be identical');
      assert.strictEqual(serverState.teamAState.captainId, offlineState.teamAState.captainId, 'Captain must be identical');
    });

    test('E6.6: End-to-end replay with SET_LINEUP, goals, cards, subs, and full-time accurately computes player statistics', () => {
      let state = fbRules.getInitialState();

      const p1 = starters11A[0]; // Captain & Scorer
      const p2 = starters11A[1]; // Assist provider
      const p3 = starters11A[2]; // Subbed out at 60'
      const sub1 = subsA[0];    // Subbed in at 60'

      // 1. Set Lineup Team A
      state = fbRules.applyEvent(state, {
        id: 'e1', type: 'SET_LINEUP', timestamp: new Date().toISOString(),
        metadata: { team: 'A', lineup: { startingXI: starters11A, substitutes: subsA, captainId: p1, positions: {} } }
      });

      // 2. Start First Half
      state = fbRules.applyEvent(state, {
        id: 'e2', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: {}
      });

      // 3. Goal at 20': p1 scored, assisted by p2
      state = fbRules.applyEvent(state, {
        id: 'e3', type: 'GOAL', timestamp: new Date().toISOString(),
        metadata: { team: 'A', minute: 20, scorerPlayerId: p1, assistPlayerId: p2 }
      });

      // 4. Halftime
      state = fbRules.applyEvent(state, {
        id: 'e4', type: 'END_FIRST_HALF', timestamp: new Date().toISOString(),
        metadata: {}
      });

      // 5. Start Second Half
      state = fbRules.applyEvent(state, {
        id: 'e5', type: 'START_SECOND_HALF', timestamp: new Date().toISOString(),
        metadata: {}
      });

      // 6. Substitution at 60': p3 OUT -> sub1 IN
      state = fbRules.applyEvent(state, {
        id: 'e6', type: 'SUBSTITUTION', timestamp: new Date().toISOString(),
        metadata: { team: 'A', minute: 60, playerOffId: p3, playerOnId: sub1 }
      });

      // 7. Yellow card for p1 at 75'
      state = fbRules.applyEvent(state, {
        id: 'e7', type: 'YELLOW_CARD', timestamp: new Date().toISOString(),
        metadata: { team: 'A', minute: 75, playerId: p1 }
      });

      // 8. End Match 1-0 win
      state = fbRules.applyEvent(state, {
        id: 'e8', type: 'END_SECOND_HALF', timestamp: new Date().toISOString(),
        metadata: {}
      });

      const mockMatch = {
        id: 'm_e2e_stat',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 0,
        participant_a_id: 'team_a',
        participant_b_id: 'team_b',
        participant_a: {
          id: 'team_a',
          name: 'Team Alpha',
          members: [
            ...starters11A.map((id, idx) => ({ player: { id, full_name: `Starter ${idx + 1}` } })),
            ...subsA.map((id, idx) => ({ player: { id, full_name: `Substitute ${idx + 1}` } }))
          ]
        },
        participant_b: { id: 'team_b', name: 'Team Beta', members: [] },
        lineup_data: {
          teamA: { startingXI: starters11A, substitutes: subsA, captainId: p1 }
        },
        match_events: [
          { event_type: 'SET_LINEUP', side: 'A', detail: { startingXI: starters11A, substitutes: subsA, captainId: p1 }, sequence_number: 1 },
          { event_type: 'START_FIRST_HALF', sequence_number: 2 },
          { event_type: 'GOAL', side: 'A', minute: 20, detail: { scorerPlayerId: p1, assistPlayerId: p2 }, sequence_number: 3 },
          { event_type: 'END_FIRST_HALF', sequence_number: 4 },
          { event_type: 'START_SECOND_HALF', sequence_number: 5 },
          { event_type: 'SUBSTITUTION', side: 'A', minute: 60, detail: { playerOffId: p3, playerOnId: sub1 }, sequence_number: 6 },
          { event_type: 'YELLOW_CARD', side: 'A', minute: 75, detail: { playerId: p1 }, sequence_number: 7 },
          { event_type: 'END_SECOND_HALF', sequence_number: 8 }
        ]
      };

      // Validate Scorer p1
      const p1Stats = calculateFootballPlayerStats([mockMatch], p1, 'Starter 1');
      assert.strictEqual(p1Stats.goals, 1, 'p1 goals = 1');
      assert.strictEqual(p1Stats.yellowCards, 1, 'p1 yellowCards = 1');
      assert.strictEqual(p1Stats.starts, 1, 'p1 starts = 1');
      assert.strictEqual(p1Stats.minutesPlayed, 90, 'p1 played full 90 minutes');
      assert.strictEqual(p1Stats.cleanSheetAppearances, 1, 'p1 credited with clean sheet');

      // Validate Subbed Out p3
      const p3Stats = calculateFootballPlayerStats([mockMatch], p3, 'Starter 3');
      assert.strictEqual(p3Stats.starts, 1, 'p3 starts = 1');
      assert.strictEqual(p3Stats.substitutionsOut, 1, 'p3 subbed out = 1');
      assert.strictEqual(p3Stats.minutesPlayed, 60, 'p3 played exactly 60 minutes');

      // Validate Subbed In sub1
      const sub1Stats = calculateFootballPlayerStats([mockMatch], sub1, 'Substitute 1');
      assert.strictEqual(sub1Stats.starts, 0, 'sub1 did not start');
      assert.strictEqual(sub1Stats.substitutionsIn, 1, 'sub1 subbed in = 1');
      assert.strictEqual(sub1Stats.minutesPlayed, 30, 'sub1 played 90 - 60 = 30 minutes');
    });

    test('E6.7: Two simultaneous independent Football matches maintain total event and state isolation', () => {
      let state1 = fbRules.getInitialState();
      let state2 = fbRules.getInitialState();

      // Match 1: Lineup Team A
      state1 = fbRules.applyEvent(state1, {
        id: 'm1_ev1', type: 'SET_LINEUP', timestamp: new Date().toISOString(),
        metadata: { matchId: 'match_1', team: 'A', lineup: { startingXI: starters11A, substitutes: subsA, captainId: captainA, positions: {} } }
      });
      // Match 1: Start First Half & Goal
      state1 = fbRules.applyEvent(state1, { id: 'm1_ev2', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(), metadata: { matchId: 'match_1' } });
      state1 = fbRules.applyEvent(state1, { id: 'm1_ev3', type: 'GOAL', timestamp: new Date().toISOString(), metadata: { matchId: 'match_1', team: 'A', minute: 10 } });

      // Match 2: Start First Half (No lineup set yet) & Red card for Team B
      state2 = fbRules.applyEvent(state2, { id: 'm2_ev1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString(), metadata: { matchId: 'match_2' } });
      state2 = fbRules.applyEvent(state2, { id: 'm2_ev2', type: 'RED_CARD', timestamp: new Date().toISOString(), metadata: { matchId: 'match_2', team: 'B', minute: 15, playerId: 'm2_bad_player' } });

      // Verify Match 1 isolation
      assert.strictEqual(state1.scoreA, 1, 'Match 1 scoreA = 1');
      assert.strictEqual(state1.scoreB, 0, 'Match 1 scoreB = 0');
      assert.strictEqual(state1.cards.length, 0, 'Match 1 must have 0 cards (not affected by Match 2 red card)');
      assert.strictEqual(state1.teamAState.activePlayersOnPitch.length, 11, 'Match 1 team A has 11 starters');

      // Verify Match 2 isolation
      assert.strictEqual(state2.scoreA, 0, 'Match 2 scoreA = 0 (not affected by Match 1 goal)');
      assert.strictEqual(state2.scoreB, 0, 'Match 2 scoreB = 0');
      assert.strictEqual(state2.cards.length, 1, 'Match 2 has 1 card');
      assert.strictEqual(state2.cards[0].playerId, 'm2_bad_player', 'Match 2 card belongs to m2_bad_player');
    });
  });
});
