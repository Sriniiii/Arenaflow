import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { BadmintonRules, BadmintonMatchConfig } from '@arena-flow/sport-engine';

function loadEnv() {
  try {
    const rootEnv = path.resolve(process.cwd(), '.env');
    const siblingEnv = path.resolve(process.cwd(), '../../.env');
    const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
    const envPath = fs.existsSync(rootEnv) ? rootEnv : fs.existsSync(appsWebEnv) ? appsWebEnv : siblingEnv;
    
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf8');
      envConfig.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
          process.env[key] = value;
        }
      });
    }
  } catch (err) {
    console.warn('Failed to load root .env file:', err);
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Badminton Server & Receiver Tracking Integration Suite', () => {
  const adminClient: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const testRunId = Date.now().toString().slice(-6);

  let orgClient: SupabaseClient;
  let scorerClient: SupabaseClient;
  let playerClient: SupabaseClient;
  let anonClient: SupabaseClient;

  let sportId: string;
  let venueId: string;
  let tournamentId: string;
  let categorySinglesId: string;
  let categoryDoublesId: string;

  let playerA1Id: string;
  let playerA2Id: string;
  let playerB1Id: string;
  let playerB2Id: string;

  let partSinglesAId: string;
  let partSinglesBId: string;
  let partDoublesAId: string;
  let partDoublesBId: string;

  let matchSinglesId: string;
  let matchDoublesId: string;

  const userIds: Record<string, string> = {};

  before(async () => {
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Create Auth Users
    const roles = ['org', 'scorer', 'playerA1', 'playerA2', 'playerB1', 'playerB2'];
    for (const r of roles) {
      const email = `srv_${r}_${testRunId}@example.com`;
      const { data: uData, error: uErr } = await adminClient.auth.admin.createUser({
        email,
        password: 'TestSecurePassword123!',
        email_confirm: true,
        user_metadata: { role: r === 'org' ? 'ORGANIZER' : r === 'scorer' ? 'SCORER' : 'PLAYER' }
      });
      if (uErr) throw uErr;
      userIds[r] = uData.user.id;
    }

    // Sign in clients
    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: `srv_org_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: `srv_scorer_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await playerClient.auth.signInWithPassword({ email: `srv_playerA1_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    // 2. Fetch Sport & Create Players
    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
    sportId = sData?.id;

    const { data: plA1 } = await adminClient.from('players').insert({ full_name: 'Alice Alpha', user_id: userIds.playerA1 }).select('id').single();
    const { data: plA2 } = await adminClient.from('players').insert({ full_name: 'Amanda Alpha', user_id: userIds.playerA2 }).select('id').single();
    const { data: plB1 } = await adminClient.from('players').insert({ full_name: 'Bob Beta', user_id: userIds.playerB1 }).select('id').single();
    const { data: plB2 } = await adminClient.from('players').insert({ full_name: 'Brian Beta', user_id: userIds.playerB2 }).select('id').single();

    playerA1Id = plA1!.id;
    playerA2Id = plA2!.id;
    playerB1Id = plB1!.id;
    playerB2Id = plB2!.id;

    // 3. Create Venue & Tournament
    const { data: vData } = await adminClient.from('venues').insert({
      name: `Service Test Arena ${testRunId}`,
      address: '100 Badminton Way',
      city: 'Delhi',
      country: 'India'
    }).select('id').single();
    venueId = vData!.id;

    const { data: tData } = await adminClient.from('tournaments').insert({
      name: `Service Championship ${testRunId}`,
      slug: `service-tourney-${testRunId}`,
      sport_id: sportId,
      venue_id: venueId,
      organizer_id: userIds.org,
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 172800000).toISOString(),
      registration_open: new Date(Date.now() - 86400000).toISOString(),
      registration_close: new Date(Date.now() + 86400000).toISOString(),
      status: 'PUBLISHED'
    }).select('id').single();
    tournamentId = tData!.id;

    await adminClient.from('tournament_scorers').insert({
      tournament_id: tournamentId,
      user_id: userIds.scorer
    });

    // 4. Create Categories (Singles & Doubles)
    const { data: catSingles } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Singles",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select('id').single();
    categorySinglesId = catSingles!.id;

    const { data: catDoubles } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Doubles",
      category_type: 'DOUBLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select('id').single();
    categoryDoublesId = catDoubles!.id;

    // 5. Create Participants & Members
    // Singles Participants
    const { data: pSinA } = await adminClient.from('participants').insert({ category_id: categorySinglesId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
    const { data: pSinB } = await adminClient.from('participants').insert({ category_id: categorySinglesId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
    partSinglesAId = pSinA!.id;
    partSinglesBId = pSinB!.id;
    await adminClient.from('participant_members').insert([
      { participant_id: partSinglesAId, player_id: playerA1Id, member_order: 1 },
      { participant_id: partSinglesBId, player_id: playerB1Id, member_order: 1 }
    ]);

    // Doubles Participants
    const { data: pDoubA } = await adminClient.from('participants').insert({ category_id: categoryDoublesId, participant_type: 'TEAM', status: 'ACTIVE' }).select('id').single();
    const { data: pDoubB } = await adminClient.from('participants').insert({ category_id: categoryDoublesId, participant_type: 'TEAM', status: 'ACTIVE' }).select('id').single();
    partDoublesAId = pDoubA!.id;
    partDoublesBId = pDoubB!.id;
    await adminClient.from('participant_members').insert([
      { participant_id: partDoublesAId, player_id: playerA1Id, member_order: 1 },
      { participant_id: partDoublesAId, player_id: playerA2Id, member_order: 2 },
      { participant_id: partDoublesBId, player_id: playerB1Id, member_order: 1 },
      { participant_id: partDoublesBId, player_id: playerB2Id, member_order: 2 }
    ]);

    // 6. Create Matches
    const { data: mSin } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: partSinglesAId,
      participant_b_id: partSinglesBId,
      status: 'READY'
    }).select('id').single();
    matchSinglesId = mSin!.id;

    const { data: mDoub } = await adminClient.from('matches').insert({
      category_id: categoryDoublesId,
      participant_a_id: partDoublesAId,
      participant_b_id: partDoublesBId,
      status: 'READY'
    }).select('id').single();
    matchDoublesId = mDoub!.id;
  });

  after(async () => {
    for (const uid of Object.values(userIds)) {
      await adminClient.auth.admin.deleteUser(uid);
    }
    if (venueId) {
      await adminClient.from('venues').delete().eq('id', venueId);
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Authorization & Database Constraints
  // ---------------------------------------------------------------------------
  test('1. Unauthorized spectator cannot call set_match_service', async () => {
    const { error } = await anonClient.rpc('set_match_service', {
      p_match_id: matchSinglesId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerB1Id
    });
    assert.ok(error, 'Anonymous spectator must be rejected');
  });

  test('2. Unauthorized player cannot call set_match_service', async () => {
    const { error } = await playerClient.rpc('set_match_service', {
      p_match_id: matchSinglesId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerB1Id
    });
    assert.ok(error, 'Player must be rejected');
  });

  test('3. Rejects invalid server/receiver combinations (e.g. server == receiver or wrong team)', async () => {
    // Server == Receiver
    const { error: errSame } = await scorerClient.rpc('set_match_service', {
      p_match_id: matchSinglesId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerA1Id
    });
    assert.ok(errSame, 'Same server and receiver must be rejected');

    // Server player does not belong to declared serving side
    const { error: errWrongSide } = await scorerClient.rpc('set_match_service', {
      p_match_id: matchSinglesId,
      p_serving_side: 'A',
      p_server_player_id: playerB1Id,
      p_receiver_player_id: playerA1Id
    });
    assert.ok(errWrongSide, 'Player from opposing team as server must be rejected');
  });

  // ---------------------------------------------------------------------------
  // 2. Singles Service Tracking End-to-End
  // ---------------------------------------------------------------------------
  test('4. Assigned Scorer successfully configures Singles initial service via set_match_service', async () => {
    const { data, error } = await scorerClient.rpc('set_match_service', {
      p_match_id: matchSinglesId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerB1Id
    });

    assert.ifError(error);
    assert.strictEqual(data.servingSide, 'A');
    assert.strictEqual(data.serverPlayerId, playerA1Id);
    assert.strictEqual(data.receiverPlayerId, playerB1Id);
    assert.strictEqual(data.serverCourt, 'RIGHT');
    assert.strictEqual(data.receiverCourt, 'RIGHT');

    // Verify persisted in matches and match_events
    const { data: match } = await adminClient.from('matches').select('service_state').eq('id', matchSinglesId).single();
    assert.strictEqual(match?.service_state?.serverPlayerId, playerA1Id);

    const { data: events } = await adminClient.from('match_events').select('*').eq('match_id', matchSinglesId);
    assert.strictEqual(events?.length, 1);
    assert.strictEqual(events?.[0].event_type, 'SET_SERVICE');
    assert.strictEqual(events?.[0].server_player_id, playerA1Id);
  });

  test('5. Singles point progression updates server court parity and side-outs', async () => {
    // Start match
    await scorerClient.rpc('start_match', { p_match_id: matchSinglesId });

    const config: BadmintonMatchConfig = {
      matchType: 'SINGLES',
      participantA: { id: partSinglesAId, playerIds: [playerA1Id] },
      participantB: { id: partSinglesBId, playerIds: [playerB1Id] },
      initialServingSide: 'A',
      initialServerPlayerId: playerA1Id,
      initialReceiverPlayerId: playerB1Id
    };

    const rules = new BadmintonRules();
    let state = rules.getInitialState(config);

    // Rally 1: Side A scores (1-0) -> A1 serves from LEFT to B1 in LEFT
    state = rules.applyEvent(state, { id: 's-1', type: 'POINT_A', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');

    // Rally 2: Side A scores (2-0) -> A1 serves from RIGHT to B1 in RIGHT
    state = rules.applyEvent(state, { id: 's-2', type: 'POINT_A', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');

    // Rally 3: Side B scores (Side-Out! 2-1) -> B1 serves from LEFT to A1 in LEFT
    state = rules.applyEvent(state, { id: 's-3', type: 'POINT_B', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerB1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
  });

  // ---------------------------------------------------------------------------
  // 3. Doubles Service Tracking & Court Swaps
  // ---------------------------------------------------------------------------
  test('6. Assigned Scorer successfully configures Doubles initial service & court positions', async () => {
    const { data, error } = await scorerClient.rpc('set_match_service', {
      p_match_id: matchDoublesId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerB1Id,
      p_side_a_positions: { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id },
      p_side_b_positions: { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id }
    });

    assert.ifError(error);
    assert.strictEqual(data.matchType, 'DOUBLES');
    assert.strictEqual(data.servingSide, 'A');
    assert.strictEqual(data.serverPlayerId, playerA1Id);
    assert.strictEqual(data.receiverPlayerId, playerB1Id);
    assert.deepStrictEqual(data.sideAPositions, { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id });
    assert.deepStrictEqual(data.sideBPositions, { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id });
  });

  test('7. Doubles state machine: Case A (Serving side wins -> court swap) & Case B (Side-out -> score parity)', () => {
    const config: BadmintonMatchConfig = {
      matchType: 'DOUBLES',
      participantA: { id: partDoublesAId, playerIds: [playerA1Id, playerA2Id] },
      participantB: { id: partDoublesBId, playerIds: [playerB1Id, playerB2Id] },
      initialServingSide: 'A',
      initialServerPlayerId: playerA1Id,
      initialReceiverPlayerId: playerB1Id,
      initialSideAPositions: { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id },
      initialSideBPositions: { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id }
    };

    const rules = new BadmintonRules();
    let state = rules.getInitialState(config);

    // Initial 0-0: A1 serves to B1 from RIGHT
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB1Id);

    // RALLY 1: Side A wins (1-0)
    // - Server remains A1
    // - Side A SWAPS positions: Right=A2, Left=A1
    // - Side B stays: Right=B1, Left=B2
    // - Server A1 is in LEFT court -> Receiver is player in B's LEFT court (B2)
    state = rules.applyEvent(state, { id: 'd-1', type: 'POINT_A', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB2Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA2Id, leftPlayerId: playerA1Id });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id });

    // RALLY 2: Side A wins again (2-0)
    // - Server remains A1
    // - Side A SWAPS positions: Right=A1, Left=A2
    // - Server A1 is in RIGHT court -> Receiver is player in B's RIGHT court (B1)
    state = rules.applyEvent(state, { id: 'd-2', type: 'POINT_A', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id });

    // RALLY 3: Side B wins (Side-Out! 2-1)
    // - Side B becomes new serving side
    // - NEITHER side swaps positions:
    //     A: Right=A1, Left=A2
    //     B: Right=B1, Left=B2
    // - Side B's score is 1 (odd) -> player in Side B's LEFT court serves -> B2!
    // - Receiver is player in Side A's LEFT court -> A2!
    state = rules.applyEvent(state, { id: 'd-3', type: 'POINT_B', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerB2Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerA2Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id });

    // RALLY 4: Side B wins again (2-2)
    // - Server remains B2
    // - Side B SWAPS positions: Right=B2, Left=B1
    // - Server B2 is in RIGHT court (2 is even) -> Receiver is player in A's RIGHT court (A1)
    state = rules.applyEvent(state, { id: 'd-4', type: 'POINT_B', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 2);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerB2Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: playerB2Id, leftPlayerId: playerB1Id });
  });

  // ---------------------------------------------------------------------------
  // 4. Multi-Step UNDO Verification
  // ---------------------------------------------------------------------------
  test('8. Multi-Step UNDO restores exact scores, server, receiver, and court positions', () => {
    const config: BadmintonMatchConfig = {
      matchType: 'DOUBLES',
      participantA: { id: partDoublesAId, playerIds: [playerA1Id, playerA2Id] },
      participantB: { id: partDoublesBId, playerIds: [playerB1Id, playerB2Id] },
      initialServingSide: 'A',
      initialServerPlayerId: playerA1Id,
      initialReceiverPlayerId: playerB1Id,
      initialSideAPositions: { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id },
      initialSideBPositions: { rightPlayerId: playerB1Id, leftPlayerId: playerB2Id }
    };

    const rules = new BadmintonRules();
    let state = rules.getInitialState(config);

    // Apply 3 points
    state = rules.applyEvent(state, { id: 'u-1', type: 'POINT_A', timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'u-2', type: 'POINT_A', timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'u-3', type: 'POINT_B', timestamp: new Date().toISOString() });

    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerB2Id);

    // UNDO 1: Restores 2-0 (A1 serving to B1 in RIGHT)
    state = rules.applyEvent(state, { id: 'undo-1', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id });

    // UNDO 2: Restores 1-0 (A1 serving to B2 in LEFT)
    state = rules.applyEvent(state, { id: 'undo-2', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB2Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA2Id, leftPlayerId: playerA1Id });

    // UNDO 3: Restores initial 0-0 (A1 serving to B1 in RIGHT)
    state = rules.applyEvent(state, { id: 'undo-3', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 0);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, playerA1Id);
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, playerB1Id);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: playerA1Id, leftPlayerId: playerA2Id });
  });

  // ---------------------------------------------------------------------------
  // 5. Outcome Integration (Retirement vs Walkover)
  // ---------------------------------------------------------------------------
  test('9. Retirement preserves service history and rally points without fabricating fake events', async () => {
    // Create new live match for retirement
    const { data: mRet } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: partSinglesAId,
      participant_b_id: partSinglesBId,
      status: 'READY'
    }).select('id').single();
    const retMatchId = mRet!.id;

    await scorerClient.rpc('start_match', { p_match_id: retMatchId });
    await scorerClient.rpc('set_match_service', {
      p_match_id: retMatchId,
      p_serving_side: 'A',
      p_server_player_id: playerA1Id,
      p_receiver_player_id: playerB1Id
    });

    // Score 2 points for A
    await adminClient.from('match_events').insert([
      { match_id: retMatchId, sequence_number: 2, event_type: 'POINT_A', server_player_id: playerA1Id, receiver_player_id: playerB1Id },
      { match_id: retMatchId, sequence_number: 3, event_type: 'POINT_A', server_player_id: playerA1Id, receiver_player_id: playerB1Id }
    ]);
    await adminClient.from('games').insert({
      match_id: retMatchId,
      game_number: 1,
      participant_a_score: 2,
      participant_b_score: 0,
      status: 'LIVE'
    });

    // Declare Retirement (Player A retires, Player B wins)
    const { error: retErr } = await scorerClient.rpc('declare_match_outcome', {
      p_match_id: retMatchId,
      p_outcome: 'RETIREMENT',
      p_winner_id: partSinglesBId,
      p_retiring_participant_id: partSinglesAId
    });
    assert.ifError(retErr);

    // Verify Match is COMPLETED with outcome RETIREMENT
    const { data: finalMatch } = await adminClient.from('matches').select('*').eq('id', retMatchId).single();
    assert.strictEqual(finalMatch?.status, 'COMPLETED');
    assert.strictEqual(finalMatch?.outcome, 'RETIREMENT');
    assert.strictEqual(finalMatch?.winner_id, partSinglesBId);

    // Verify game score was preserved
    const { data: game } = await adminClient.from('games').select('*').eq('match_id', retMatchId).single();
    assert.strictEqual(game?.participant_a_score, 2);
    assert.strictEqual(game?.participant_b_score, 0);

    // Verify events count is exactly 3 (1 SET_SERVICE + 2 POINT_A) with no fake points
    const { data: events } = await adminClient.from('match_events').select('*').eq('match_id', retMatchId);
    assert.strictEqual(events?.length, 3);
  });
});
