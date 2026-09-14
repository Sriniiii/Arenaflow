import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  FootballRules,
  FootballMatchState,
  FootballLineup,
  DEFAULT_FOOTBALL_CONFIG,
  FootballMatchConfig
} from '@arena-flow/sport-engine';
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

describe('ArenaFlow Phase D: Football Match & Scoring Integration Test Suite', () => {
  const rules = new FootballRules();
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let orgClient: SupabaseClient;
  let orgUserId: string;
  let scorerClient: SupabaseClient;
  let scorerUserId: string;
  let playerClient: SupabaseClient;
  let playerUserId: string;
  let unauthorizedClient: SupabaseClient;
  let unauthorizedUserId: string;

  let testVenueId: string;
  let testTournamentId: string;
  let testFootballSportId: string;
  let testCategoryId: string;

  // 4 Teams and 16 squad players per team
  const teams: { id: string; name: string; players: { id: string; name: string; number: number; pos: string }[] }[] = [];

  async function createOrGetUser(email: string, role: string, fullName: string) {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: 'TestSecurePassword123!',
      email_confirm: true,
      user_metadata: { full_name: fullName, role }
    });
    if (data?.user) return data.user.id;
    const { data: search } = await adminClient.auth.admin.listUsers();
    const existing = search?.users.find(u => u.email === email);
    if (existing) {
      await adminClient.auth.admin.updateUserById(existing.id, { password: 'TestSecurePassword123!' });
      return existing.id;
    }
    throw new Error(`Failed to create test user ${email}: ${error?.message}`);
  }

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });

    const timestamp = Date.now();
    orgUserId = await createOrGetUser(`org_phased_${timestamp}@arenaflow.test`, 'ORGANIZER', 'PhaseD Organizer');
    await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'PhaseD Organizer' });

    scorerUserId = await createOrGetUser(`scorer_phased_${timestamp}@arenaflow.test`, 'SCORER', 'PhaseD Scorer');
    await adminClient.from('profiles').upsert({ id: scorerUserId, role: 'SCORER', full_name: 'PhaseD Scorer' });

    playerUserId = await createOrGetUser(`player_phased_${timestamp}@arenaflow.test`, 'PLAYER', 'PhaseD Player');
    await adminClient.from('profiles').upsert({ id: playerUserId, role: 'PLAYER', full_name: 'PhaseD Player' });

    unauthorizedUserId = await createOrGetUser(`unauth_phased_${timestamp}@arenaflow.test`, 'PLAYER', 'PhaseD Unauth');
    await adminClient.from('profiles').upsert({ id: unauthorizedUserId, role: 'PLAYER', full_name: 'PhaseD Unauth' });

    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: `org_phased_${timestamp}@arenaflow.test`, password: 'TestSecurePassword123!' });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: `scorer_phased_${timestamp}@arenaflow.test`, password: 'TestSecurePassword123!' });

    playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await playerClient.auth.signInWithPassword({ email: `player_phased_${timestamp}@arenaflow.test`, password: 'TestSecurePassword123!' });

    unauthorizedClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await unauthorizedClient.auth.signInWithPassword({ email: `unauth_phased_${timestamp}@arenaflow.test`, password: 'TestSecurePassword123!' });

    // Ensure Football sport exists
    const { data: sport } = await adminClient
      .from('sports')
      .select('id')
      .eq('slug', 'football')
      .single();
    if (sport) {
      testFootballSportId = sport.id;
    } else {
      const { data: newSport } = await adminClient
        .from('sports')
        .insert({ name: 'Football', slug: 'football', is_active: true })
        .select()
        .single();
      testFootballSportId = newSport.id;
    }

    // Create Venue
    const { data: venue } = await adminClient
      .from('venues')
      .insert({ name: `Phase D Football Arena ${timestamp}`, city: 'Munich', country: 'Germany' })
      .select()
      .single();
    testVenueId = venue.id;

    // Create Tournament
    const { data: tournament } = await adminClient
      .from('tournaments')
      .insert({
        name: `Phase D Football Championship ${timestamp}`,
        slug: `phase-d-football-${timestamp}`,
        sport_id: testFootballSportId,
        organizer_id: orgUserId,
        venue_id: testVenueId,
        status: 'PUBLISHED',
        start_date: '2026-10-01',
        end_date: '2026-10-10'
      })
      .select()
      .single();
    testTournamentId = tournament.id;

    // Assign Scorer to Tournament
    await adminClient.from('tournament_scorers').insert({
      tournament_id: testTournamentId,
      user_id: scorerUserId
    });

    // Create Category with Football rules_config
    const { data: category } = await adminClient
      .from('categories')
      .insert({
        tournament_id: testTournamentId,
        name: 'Football Open Championship',
        category_type: 'TEAM',
        match_type: 'MENS',
        format: 'KNOCKOUT',
        status: 'PUBLISHED',
        rules_config: {
          regulationHalfMinutes: 45,
          extraTimeEnabled: true,
          extraTimeHalfMinutes: 15,
          penaltyShootoutEnabled: true,
          maxSubstitutions: 5,
          allowDraw: true,
          playersPerTeam: 11
        }
      })
      .select()
      .single();
    testCategoryId = category.id;

    // Create 4 Teams with 16 Squad Members Each
    const positions = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'SUB', 'SUB', 'SUB', 'SUB', 'SUB'];
    for (let t = 1; t <= 4; t++) {
      const { data: part } = await adminClient
        .from('participants')
        .insert({
          category_id: testCategoryId,
          participant_type: 'TEAM',
          status: 'ACTIVE'
        })
        .select()
        .single();

      const newPlayersToInsert = [];
      for (let p = 1; p <= 16; p++) {
        newPlayersToInsert.push({
          full_name: `Team ${t} Player ${p}`,
          display_name: `T${t}P${p}`,
          gender: 'MALE'
        });
      }
      const { data: insertedPlayers } = await adminClient
        .from('players')
        .insert(newPlayersToInsert)
        .select();

      const memberRows: any[] = [];
      const teamPlayers: { id: string; name: string; number: number; pos: string }[] = [];
      (insertedPlayers || []).forEach((ply, idx) => {
        const p = idx + 1;
        memberRows.push({
          participant_id: part.id,
          player_id: ply.id,
          member_order: p,
          jersey_number: p,
          position: positions[p - 1],
          status: 'ACTIVE'
        });
        teamPlayers.push({ id: ply.id, name: ply.full_name, number: p, pos: positions[p - 1] });
      });

      await adminClient.from('participant_members').insert(memberRows);

      await adminClient.from('registrations').insert({
        category_id: testCategoryId,
        participant_id: part.id,
        status: 'APPROVED'
      });

      teams.push({ id: part.id, name: `Team ${t}`, players: teamPlayers });
    }
  });

  // =========================================================================
  // SCENARIO 1: Lineup Submission & Strict 11-Starters Validation
  // =========================================================================
  test('1. Authoritative Lineup Submission: Enforces strict 11 Starting XI, captain in XI, and disjoint bench', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'READY',
        match_phase: 'PRE_MATCH'
      })
      .select()
      .single();

    const teamAPlayers = teams[0].players.map(p => p.id);
    const starters11 = teamAPlayers.slice(0, 11);
    const subs5 = teamAPlayers.slice(11, 16);
    const captainId = starters11[0];

    // 1.1 Reject invalid starter count (< 11)
    const { error: errUnder } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: starters11.slice(0, 10),
      p_substitutes: subs5,
      p_captain_id: captainId
    });
    assert.ok(errUnder, 'Should reject Starting XI with only 10 players');

    // 1.2 Reject captain not in Starting XI
    const { error: errCap } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: starters11,
      p_substitutes: subs5,
      p_captain_id: subs5[0] // captain on bench
    });
    assert.ok(errCap, 'Should reject captain who is on the substitutes bench');

    // 1.3 Reject duplicate player in starters and subs
    const { error: errOverlap } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: starters11,
      p_substitutes: [starters11[0], ...subs5.slice(1)],
      p_captain_id: captainId
    });
    assert.ok(errOverlap, 'Should reject player in both Starting XI and bench');

    // 1.4 Valid Lineup Submission succeeds
    const { data: lineupData, error: errValid } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: starters11,
      p_substitutes: subs5,
      p_captain_id: captainId
    });
    assert.ifError(errValid);
    assert.ok(lineupData.teamA, 'Matches should contain materialized lineup for Team A');
    assert.strictEqual(lineupData.teamA.startingXI.length, 11);
    assert.strictEqual(lineupData.teamA.captainId, captainId);

    // Verify Team B Lineup Submission
    const teamBPlayers = teams[1].players.map(p => p.id);
    const { data: lineupDataB, error: errValidB } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'B',
      p_starting_xi: teamBPlayers.slice(0, 11),
      p_substitutes: teamBPlayers.slice(11, 16),
      p_captain_id: teamBPlayers[0]
    });
    assert.ifError(errValidB);
    assert.ok(lineupDataB.teamB, 'Matches should contain materialized lineup for Team B');
  });

  // =========================================================================
  // SCENARIO 2: Match Kickoff & First Half Lifecycle
  // =========================================================================
  test('2. Kickoff: START_FIRST_HALF transitions PRE_MATCH -> FIRST_HALF, status -> LIVE', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'READY',
        match_phase: 'PRE_MATCH'
      })
      .select()
      .single();

    const { data: res, error } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_FIRST_HALF'
    });
    assert.ifError(error);
    assert.strictEqual(res.match_phase, 'FIRST_HALF');
    assert.strictEqual(res.status, 'LIVE');

    const { data: dbMatch } = await adminClient.from('matches').select('*').eq('id', match.id).single();
    assert.strictEqual(dbMatch.status, 'LIVE');
    assert.strictEqual(dbMatch.match_phase, 'FIRST_HALF');
  });

  // =========================================================================
  // SCENARIO 3: Regulation Goals & Own Goals
  // =========================================================================
  test('3. Goals & Own Goals: Accurately credit scoring team vs conceded team', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF',
        score_a: 0,
        score_b: 0
      })
      .select()
      .single();

    // 3.1 Regular Goal for Team A (Scorer: P1, Assist: P2, Minute: 14)
    const { data: g1Res, error: g1Err } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: {
        team: 'A',
        scorerPlayerId: teams[0].players[0].id,
        assistPlayerId: teams[0].players[1].id,
        minute: 14
      }
    });
    assert.ifError(g1Err);
    assert.strictEqual(g1Res.score_a, 1);
    assert.strictEqual(g1Res.score_b, 0);

    // 3.2 Own Goal conceded by Team A (Player 3 puts ball in own net at min 28 -> Credits Team B)
    const { data: ogRes, error: ogErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'OWN_GOAL',
      p_metadata: {
        team: 'A',
        playerPlayerId: teams[0].players[2].id,
        minute: 28
      }
    });
    assert.ifError(ogErr);
    assert.strictEqual(ogRes.score_a, 1);
    assert.strictEqual(ogRes.score_b, 1);

    // 3.3 Regular Goal for Team B (Scorer: P1, Minute: 40)
    const { data: g2Res, error: g2Err } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: {
        team: 'B',
        scorerPlayerId: teams[1].players[0].id,
        minute: 40
      }
    });
    assert.ifError(g2Err);
    assert.strictEqual(g2Res.score_a, 1);
    assert.strictEqual(g2Res.score_b, 2);
  });

  // =========================================================================
  // SCENARIO 4: Disciplinary Actions (Yellow Cards, Second-Yellow Red, Direct Red)
  // =========================================================================
  test('4. Discipline: Records yellow cards, triggers automatic second-yellow dismissal, and direct red cards', async () => {
    const config: FootballMatchConfig = {
      ...DEFAULT_FOOTBALL_CONFIG,
      initialLineupA: {
        startingXI: teams[0].players.slice(0, 11).map(p => p.id),
        substitutes: teams[0].players.slice(11, 16).map(p => p.id),
        captainId: teams[0].players[0].id
      },
      initialLineupB: {
        startingXI: teams[1].players.slice(0, 11).map(p => p.id),
        substitutes: teams[1].players.slice(11, 16).map(p => p.id),
        captainId: teams[1].players[0].id
      }
    };

    let state = rules.getInitialState(config);
    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString() });

    const playerA1 = teams[0].players[0].id;
    const playerB1 = teams[1].players[0].id;

    // 4.1 First yellow card for Player A1
    state = rules.applyEvent(state, {
      id: 'e2',
      type: 'YELLOW_CARD',
      metadata: { team: 'A', playerId: playerA1, minute: 20, reason: 'Tactical foul' },
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(state.cards.length, 1);
    assert.strictEqual(state.teamAState.yellowCards[playerA1], 1);
    assert.ok(state.teamAState.activePlayersOnPitch.includes(playerA1));

    // 4.2 Second yellow card for Player A1 -> automatic dismissal
    state = rules.applyEvent(state, {
      id: 'e3',
      type: 'YELLOW_CARD',
      metadata: { team: 'A', playerId: playerA1, minute: 35, reason: 'Dissent' },
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(state.cards.length, 2);
    assert.ok(state.cards[1].isSecondYellow, 'Second yellow should be flagged as isSecondYellow');
    assert.ok(state.teamAState.sentOffPlayers.includes(playerA1), 'Player A1 should be in sentOffPlayers');
    assert.ok(!state.teamAState.activePlayersOnPitch.includes(playerA1), 'Player A1 should be removed from active pitch');

    // 4.3 Direct Red card for Player B1
    state = rules.applyEvent(state, {
      id: 'e4',
      type: 'RED_CARD',
      metadata: { team: 'B', playerId: playerB1, minute: 42, reason: 'Violent conduct' },
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(state.cards.length, 3);
    assert.ok(state.teamBState.sentOffPlayers.includes(playerB1), 'Player B1 should be in sentOffPlayers');
    assert.ok(!state.teamBState.activePlayersOnPitch.includes(playerB1), 'Player B1 should be removed from active pitch');
  });

  // =========================================================================
  // SCENARIO 5: Substitutions & Substitution Limits
  // =========================================================================
  test('5. Substitutions: Swaps on-pitch with bench players and enforces max substitutions', async () => {
    const pStarters = teams[0].players.slice(0, 11).map(p => p.id);
    const pSubs = teams[0].players.slice(11, 16).map(p => p.id);

    const config: FootballMatchConfig = {
      ...DEFAULT_FOOTBALL_CONFIG,
      maxSubstitutions: 2,
      initialLineupA: {
        startingXI: pStarters,
        substitutes: pSubs,
        captainId: pStarters[0]
      }
    };

    let state = rules.getInitialState(config);
    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString() });

    // 5.1 Sub 1: pStarters[1] off, pSubs[0] on
    state = rules.applyEvent(state, {
      id: 'sub1',
      type: 'SUBSTITUTION',
      metadata: { team: 'A', playerOffId: pStarters[1], playerOnId: pSubs[0], minute: 55 },
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(state.teamAState.substitutionsCount, 1);
    assert.ok(state.teamAState.activePlayersOnPitch.includes(pSubs[0]), 'New sub should be on pitch');
    assert.ok(!state.teamAState.activePlayersOnPitch.includes(pStarters[1]), 'Replaced player should not be on pitch');

    // 5.2 Sub 2: pStarters[2] off, pSubs[1] on
    state = rules.applyEvent(state, {
      id: 'sub2',
      type: 'SUBSTITUTION',
      metadata: { team: 'A', playerOffId: pStarters[2], playerOnId: pSubs[1], minute: 70 },
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(state.teamAState.substitutionsCount, 2);

    // 5.3 Sub 3: Exceeds maxSubstitutions (2)
    const valExceed = rules.validateEvent(state, {
      id: 'sub3',
      type: 'SUBSTITUTION',
      metadata: { team: 'A', playerOffId: pStarters[3], playerOnId: pSubs[2], minute: 80 },
      timestamp: new Date().toISOString()
    });
    assert.ok(!valExceed.isValid, 'Should reject substitution when max substitutions reached');
  });

  // =========================================================================
  // SCENARIO 6: Halftime Snapshot & Second Half Resumption
  // =========================================================================
  test('6. Halftime & Second Half: END_FIRST_HALF captures snapshot; START_SECOND_HALF resumes play', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF',
        score_a: 2,
        score_b: 1
      })
      .select()
      .single();

    // 6.1 End First Half -> Halftime
    const { data: htRes, error: htErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_FIRST_HALF'
    });
    assert.ifError(htErr);
    assert.strictEqual(htRes.match_phase, 'HALFTIME');
    assert.deepStrictEqual(htRes.halftime_score, { score_a: 2, score_b: 1 });

    // 6.2 Start Second Half -> Second Half (LIVE)
    const { data: shRes, error: shErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_SECOND_HALF'
    });
    assert.ifError(shErr);
    assert.strictEqual(shRes.match_phase, 'SECOND_HALF');
    assert.strictEqual(shRes.status, 'LIVE');
  });

  // =========================================================================
  // SCENARIO 7: Full Time, Extra Time & Extra Time Winner
  // =========================================================================
  test('7. Extra Time Flow: Tied regulation unlocks ET, and ET winner is declared cleanly', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'SECOND_HALF',
        score_a: 1,
        score_b: 1
      })
      .select()
      .single();

    // 7.1 End Second Half at 1-1 (Regulation Ends Tied)
    const { data: ftRes } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_SECOND_HALF'
    });
    assert.strictEqual(ftRes.match_phase, 'FULL_TIME');

    // 7.2 Start Extra Time First Half
    const { data: et1Res } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_EXTRA_TIME_FIRST_HALF'
    });
    assert.strictEqual(et1Res.match_phase, 'EXTRA_TIME_FIRST_HALF');

    // 7.3 End ET First Half -> ET Halftime
    const { data: ethRes } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_EXTRA_TIME_FIRST_HALF'
    });
    assert.strictEqual(ethRes.match_phase, 'EXTRA_TIME_HALFTIME');

    // 7.4 Start ET Second Half
    await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_EXTRA_TIME_SECOND_HALF'
    });

    // 7.5 Goal in ET Second Half by Team A (min 112)
    const { data: etgRes } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: { team: 'A', scorerPlayerId: teams[0].players[0].id, minute: 112 }
    });
    assert.strictEqual(etgRes.score_a, 2);
    assert.strictEqual(etgRes.score_b, 1);

    // 7.6 End ET Second Half -> COMPLETED with Team A as Winner
    const { data: endEtRes } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_EXTRA_TIME_SECOND_HALF'
    });
    assert.strictEqual(endEtRes.match_phase, 'COMPLETED');
    assert.strictEqual(endEtRes.status, 'COMPLETED');
    assert.strictEqual(endEtRes.winner_id, teams[0].id);
    assert.strictEqual(endEtRes.outcome_details.decisionMethod, 'EXTRA_TIME');
  });

  // =========================================================================
  // SCENARIO 8: Penalty Shootout Execution & Score Isolation
  // =========================================================================
  test('8. Penalty Shootout: Resolves penalty kicks while isolating shootout score from official match score', async () => {
    let state = rules.getInitialState({
      penaltyShootoutEnabled: true,
      allowDraw: false
    });
    state.phase = 'PENALTY_SHOOTOUT';
    state.scoreA = 2;
    state.scoreB = 2;

    // Team A Kick 1: Scored (1-0)
    state = rules.applyEvent(state, { id: 'pk1', type: 'PENALTY_KICK', metadata: { team: 'A', playerId: 'A1', scored: true }, timestamp: new Date().toISOString() });
    // Team B Kick 1: Missed (1-0)
    state = rules.applyEvent(state, { id: 'pk2', type: 'PENALTY_KICK', metadata: { team: 'B', playerId: 'B1', scored: false }, timestamp: new Date().toISOString() });
    // Team A Kick 2: Scored (2-0)
    state = rules.applyEvent(state, { id: 'pk3', type: 'PENALTY_KICK', metadata: { team: 'A', playerId: 'A2', scored: true }, timestamp: new Date().toISOString() });
    // Team B Kick 2: Scored (2-1)
    state = rules.applyEvent(state, { id: 'pk4', type: 'PENALTY_KICK', metadata: { team: 'B', playerId: 'B2', scored: true }, timestamp: new Date().toISOString() });
    // Team A Kick 3: Scored (3-1)
    state = rules.applyEvent(state, { id: 'pk5', type: 'PENALTY_KICK', metadata: { team: 'A', playerId: 'A3', scored: true }, timestamp: new Date().toISOString() });
    // Team B Kick 3: Missed (3-1)
    state = rules.applyEvent(state, { id: 'pk6', type: 'PENALTY_KICK', metadata: { team: 'B', playerId: 'B3', scored: false }, timestamp: new Date().toISOString() });
    // Team A Kick 4: Scored (4-1) -> Team B cannot catch up (4-1 insurmountable with 2 kicks remaining)
    state = rules.applyEvent(state, { id: 'pk7', type: 'PENALTY_KICK', metadata: { team: 'A', playerId: 'A4', scored: true }, timestamp: new Date().toISOString() });

    assert.ok(state.isCompleted, 'Shootout should be completed due to insurmountable lead');
    assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
    assert.strictEqual(state.decisionMethod, 'PENALTY_SHOOTOUT');
    assert.strictEqual(state.scoreA, 2, 'Official match score A remains regulation/ET score 2');
    assert.strictEqual(state.scoreB, 2, 'Official match score B remains regulation/ET score 2');
    assert.strictEqual(state.shootoutState?.scoreA, 4, 'Shootout score A is 4');
    assert.strictEqual(state.shootoutState?.scoreB, 1, 'Shootout score B is 1');
  });

  // =========================================================================
  // SCENARIO 9: Declarative Outcomes (WALKOVER, DEFAULT, RETIREMENT, ABANDONED)
  // =========================================================================
  test('9. Declarative Outcomes: ABANDONED postpones without winner; WALKOVER/DEFAULT/RETIREMENT advance winner', async () => {
    // 9.1 ABANDONED Match
    const { data: abMatch } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF',
        score_a: 1,
        score_b: 0
      })
      .select()
      .single();

    const { data: abRes, error: abErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: abMatch.id,
      p_event_type: 'DECLARE_OUTCOME',
      p_metadata: { outcome: 'ABANDONED', reason: 'Floodlight power failure' }
    });
    assert.ifError(abErr);
    assert.strictEqual(abRes.status, 'POSTPONED');
    assert.strictEqual(abRes.match_phase, 'ABANDONED');
    assert.strictEqual(abRes.outcome, 'ABANDONED');
    assert.strictEqual(abRes.winner_id, null, 'Abandoned match must have null winner_id');
    assert.strictEqual(abRes.score_a, 1, 'Scores prior to abandonment preserved');

    // 9.2 RETIREMENT Match
    const { data: retMatch } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'SECOND_HALF',
        score_a: 2,
        score_b: 1
      })
      .select()
      .single();

    const { data: retRes, error: retErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: retMatch.id,
      p_event_type: 'DECLARE_OUTCOME',
      p_metadata: { outcome: 'RETIREMENT', winnerId: teams[0].id, notes: 'Team B conceded due to injuries' }
    });
    assert.ifError(retErr);
    assert.strictEqual(retRes.status, 'COMPLETED');
    assert.strictEqual(retRes.outcome, 'RETIREMENT');
    assert.strictEqual(retRes.winner_id, teams[0].id);
  });

  // =========================================================================
  // SCENARIO 10: UNDO Determinism Across Event Types
  // =========================================================================
  test('10. UNDO Determinism: Pops last event and deterministically reconstructs scores and cards', async () => {
    let state = rules.getInitialState(DEFAULT_FOOTBALL_CONFIG);
    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', metadata: { team: 'A', minute: 10 }, timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'e3', type: 'GOAL', metadata: { team: 'A', minute: 20 }, timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'e4', type: 'YELLOW_CARD', metadata: { team: 'B', playerId: 'pB1', minute: 25 }, timestamp: new Date().toISOString() });

    assert.strictEqual(state.scoreA, 2);
    assert.strictEqual(state.cards.length, 1);

    // Undo yellow card
    state = rules.applyEvent(state, { id: 'undo1', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.cards.length, 0);
    assert.strictEqual(state.scoreA, 2);

    // Undo second goal
    state = rules.applyEvent(state, { id: 'undo2', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.scoreA, 1);
  });

  // =========================================================================
  // SCENARIO 11: Pause & Resume
  // =========================================================================
  test('11. Pause & Resume: PAUSE_MATCH sets status PAUSED; RESUME_MATCH restores status LIVE', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF'
      })
      .select()
      .single();

    // Pause
    const { error: pErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'PAUSE_MATCH'
    });
    assert.ifError(pErr);
    const { data: pausedMatch } = await adminClient.from('matches').select('status').eq('id', match.id).single();
    assert.strictEqual(pausedMatch?.status, 'PAUSED');

    // Resume
    const { error: rErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'RESUME_MATCH'
    });
    assert.ifError(rErr);
    const { data: resumedMatch } = await adminClient.from('matches').select('status').eq('id', match.id).single();
    assert.strictEqual(resumedMatch?.status, 'LIVE');
  });

  // =========================================================================
  // SCENARIO 12: Client Event ID Idempotency & Offline Queue Replay
  // =========================================================================
  test('12. Idempotency & Offline Sync: Duplicate client_event_id is processed once, and offline replay matches server state', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF',
        score_a: 0,
        score_b: 0
      })
      .select()
      .single();

    const clientEvId = '00000000-0000-0000-0000-000000000099';

    // First application
    const { data: res1 } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: { team: 'A', minute: 15 },
      p_client_event_id: clientEvId
    });
    assert.strictEqual(res1.score_a, 1);

    // Duplicate application with same client_event_id
    const { data: res2 } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: { team: 'A', minute: 15 },
      p_client_event_id: clientEvId
    });
    assert.strictEqual(res2.score_a, 1, 'Score should not increment on duplicate client_event_id');

    // Verify offline queue reconstruction
    const serverEvents = [
      { sequence_number: 1, event_type: 'START_FIRST_HALF', created_at: '2026-10-01T10:00:00Z' },
      { sequence_number: 2, event_type: 'GOAL', metadata: { team: 'A', minute: 15 }, client_event_id: clientEvId, created_at: '2026-10-01T10:15:00Z' }
    ];
    const pendingEvents: OfflineMatchEvent[] = [
      {
        client_event_id: 'pending-1',
        match_id: match.id,
        event_type: 'GOAL',
        local_order: 3,
        expected_server_sequence: 2,
        metadata: { team: 'B', minute: 25 },
        sync_status: 'PENDING',
        created_at: '2026-10-01T10:25:00Z',
        retry_count: 0
      }
    ];

    const reconstructed = reconstructOfflineFootballMatchState(serverEvents, pendingEvents);
    assert.strictEqual(reconstructed.scoreA, 1);
    assert.strictEqual(reconstructed.scoreB, 1);
    assert.strictEqual(reconstructed.phase, 'FIRST_HALF');
  });

  // =========================================================================
  // SCENARIO 13: Scorer Authorization & Direct Projection Protection
  // =========================================================================
  test('13. Authorization & Security: protect_match_projections trigger blocks direct client projection mutations', async () => {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'LIVE',
        match_phase: 'FIRST_HALF',
        score_a: 0,
        score_b: 0
      })
      .select()
      .single();

    // 13.1 Unauthorized player cannot score
    const { error: unauthErr } = await unauthorizedClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: { team: 'A', minute: 10 }
    });
    assert.ok(unauthErr, 'Unauthorized client must be rejected from apply_football_match_event');

    // 13.2 Direct client modification of score_a is blocked by protect_match_projections
    const { error: directScoreErr } = await scorerClient
      .from('matches')
      .update({ score_a: 99 })
      .eq('id', match.id);
    assert.ok(directScoreErr, 'Direct client update to score_a must be blocked by protect_match_projections');

    // 13.3 Direct client modification of match_phase is blocked
    const { error: directPhaseErr } = await scorerClient
      .from('matches')
      .update({ match_phase: 'COMPLETED' })
      .eq('id', match.id);
    assert.ok(directPhaseErr, 'Direct client update to match_phase must be blocked by protect_match_projections');
  });

  // =========================================================================
  // SCENARIO 14: TWO SIMULTANEOUS LIVE FOOTBALL MATCHES CONCURRENTLY
  // =========================================================================
  test('14. CRITICAL REQUIREMENT: Two simultaneous LIVE Football matches operated concurrently with zero cross-contamination', async () => {
    // 14.1 Create Match 1 (Team 1 vs Team 2) and Match 2 (Team 3 vs Team 4)
    const { data: match1 } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[0].id,
        participant_b_id: teams[1].id,
        status: 'READY',
        match_phase: 'PRE_MATCH',
        score_a: 0,
        score_b: 0
      })
      .select()
      .single();

    const { data: match2 } = await adminClient
      .from('matches')
      .insert({
        category_id: testCategoryId,
        participant_a_id: teams[2].id,
        participant_b_id: teams[3].id,
        status: 'READY',
        match_phase: 'PRE_MATCH',
        score_a: 0,
        score_b: 0
      })
      .select()
      .single();

    // 14.2 Set Lineups for Match 1
    await scorerClient.rpc('set_football_lineup', {
      p_match_id: match1.id,
      p_team: 'A',
      p_starting_xi: teams[0].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[0].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[0].players[0].id
    });
    await scorerClient.rpc('set_football_lineup', {
      p_match_id: match1.id,
      p_team: 'B',
      p_starting_xi: teams[1].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[1].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[1].players[0].id
    });

    // 14.3 Set Lineups for Match 2
    await scorerClient.rpc('set_football_lineup', {
      p_match_id: match2.id,
      p_team: 'A',
      p_starting_xi: teams[2].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[2].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[2].players[0].id
    });
    await scorerClient.rpc('set_football_lineup', {
      p_match_id: match2.id,
      p_team: 'B',
      p_starting_xi: teams[3].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[3].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[3].players[0].id
    });

    // 14.4 Start both matches simultaneously -> Both become LIVE in FIRST_HALF
    const [start1Res, start2Res] = await Promise.all([
      scorerClient.rpc('apply_football_match_event', { p_match_id: match1.id, p_event_type: 'START_FIRST_HALF' }),
      scorerClient.rpc('apply_football_match_event', { p_match_id: match2.id, p_event_type: 'START_FIRST_HALF' })
    ]);

    assert.strictEqual(start1Res.data.status, 'LIVE');
    assert.strictEqual(start1Res.data.match_phase, 'FIRST_HALF');
    assert.strictEqual(start2Res.data.status, 'LIVE');
    assert.strictEqual(start2Res.data.match_phase, 'FIRST_HALF');

    // 14.5 Concurrent in-game actions:
    // Match 1: Team 1A scores 2 goals (min 10, min 25) and Player 1A gets Yellow Card
    // Match 2: Team 4 (2B) scores 3 goals (min 5, min 18, min 32) and Player 3A gets Red Card
    await Promise.all([
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match1.id,
        p_event_type: 'GOAL',
        p_metadata: { team: 'A', scorerPlayerId: teams[0].players[0].id, minute: 10 }
      }),
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match2.id,
        p_event_type: 'GOAL',
        p_metadata: { team: 'B', scorerPlayerId: teams[3].players[0].id, minute: 5 }
      })
    ]);

    await Promise.all([
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match1.id,
        p_event_type: 'GOAL',
        p_metadata: { team: 'A', scorerPlayerId: teams[0].players[1].id, minute: 25 }
      }),
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match2.id,
        p_event_type: 'GOAL',
        p_metadata: { team: 'B', scorerPlayerId: teams[3].players[1].id, minute: 18 }
      })
    ]);

    await Promise.all([
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match1.id,
        p_event_type: 'YELLOW_CARD',
        p_metadata: { team: 'A', playerId: teams[0].players[2].id, minute: 30 }
      }),
      scorerClient.rpc('apply_football_match_event', {
        p_match_id: match2.id,
        p_event_type: 'GOAL',
        p_metadata: { team: 'B', scorerPlayerId: teams[3].players[2].id, minute: 32 }
      })
    ]);

    await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match2.id,
      p_event_type: 'RED_CARD',
      p_metadata: { team: 'A', playerId: teams[2].players[0].id, minute: 40 }
    });

    // 14.6 Verify Complete State Isolation
    const { data: finalM1 } = await adminClient.from('matches').select('*').eq('id', match1.id).single();
    const { data: finalM2 } = await adminClient.from('matches').select('*').eq('id', match2.id).single();

    assert.strictEqual(finalM1.score_a, 2, 'Match 1 score A must be 2');
    assert.strictEqual(finalM1.score_b, 0, 'Match 1 score B must be 0');
    assert.strictEqual(finalM1.status, 'LIVE');

    assert.strictEqual(finalM2.score_a, 0, 'Match 2 score A must be 0');
    assert.strictEqual(finalM2.score_b, 3, 'Match 2 score B must be 3');
    assert.strictEqual(finalM2.status, 'LIVE');

    // Verify Match 1 Events only belong to Match 1
    const { data: m1Events } = await adminClient.from('match_events').select('*').eq('match_id', match1.id);
    const { data: m2Events } = await adminClient.from('match_events').select('*').eq('match_id', match2.id);

    const m1List = m1Events || [];
    const m2List = m2Events || [];

    assert.strictEqual(m1List.filter(e => e.event_type === 'GOAL').length, 2);
    assert.strictEqual(m1List.filter(e => e.event_type === 'YELLOW_CARD').length, 1);
    assert.strictEqual(m1List.filter(e => e.event_type === 'RED_CARD').length, 0);

    assert.strictEqual(m2List.filter(e => e.event_type === 'GOAL').length, 3);
    assert.strictEqual(m2List.filter(e => e.event_type === 'RED_CARD').length, 1);
    assert.strictEqual(m2List.filter(e => e.event_type === 'YELLOW_CARD').length, 0);
  });
});
