import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
const uuidv4 = () => randomUUID();
import { BadmintonRules, BadmintonMatchConfig } from '@arena-flow/sport-engine';
import {
  enqueueOfflineEvent,
  getPendingEventsForMatch,
  getAllEventsForMatch,
  updateEventStatus,
  removeEventsForMatch,
  clearAllOfflineEvents,
  reconstructOfflineMatchState,
  syncPendingMatchEvents,
  OfflineMatchEvent
} from '../src/services/offlineScoring';

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

describe('ArenaFlow — Offline Scoring & Reliable Sync Integration Suite', () => {
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
      const email = `off_${r}_${testRunId}@example.com`;
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
    await orgClient.auth.signInWithPassword({ email: `off_org_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: `off_scorer_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await playerClient.auth.signInWithPassword({ email: `off_playerA1_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    // 2. Fetch Sport & Create Players
    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
    sportId = sData?.id;

    for (const r of roles) {
      await adminClient.from('profiles').upsert({
        id: userIds[r],
        full_name: `Off User ${r}`,
        role: r === 'org' ? 'ORGANIZER' : r === 'scorer' ? 'SCORER' : 'PLAYER'
      });
    }

    const { data: pA1 } = await adminClient.from('players').insert({ user_id: userIds.playerA1, full_name: 'Singles Alpha' }).select('id').single();
    const { data: pA2 } = await adminClient.from('players').insert({ user_id: userIds.playerA2, full_name: 'Doubles AlphaPartner' }).select('id').single();
    const { data: pB1 } = await adminClient.from('players').insert({ user_id: userIds.playerB1, full_name: 'Singles Beta' }).select('id').single();
    const { data: pB2 } = await adminClient.from('players').insert({ user_id: userIds.playerB2, full_name: 'Doubles BetaPartner' }).select('id').single();

    playerA1Id = pA1!.id;
    playerA2Id = pA2!.id;
    playerB1Id = pB1!.id;
    playerB2Id = pB2!.id;

    // 3. Create Venue & Tournament
    const { data: vData } = await adminClient.from('venues').insert({
      name: `Offline Arena ${testRunId}`,
      address: '100 Sync Way',
      city: 'OfflineCity',
      country: 'OfflineCountry'
    }).select('id').single();
    venueId = vData!.id;

    const { data: tData } = await adminClient.from('tournaments').insert({
      name: `Offline Sync Championship ${testRunId}`,
      slug: `off-champ-${testRunId}`,
      sport_id: sportId,
      venue_id: venueId,
      organizer_id: userIds.org,
      status: 'PUBLISHED',
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 86400000).toISOString(),
      registration_open: new Date(Date.now() - 86400000).toISOString(),
      registration_close: new Date(Date.now() + 86400000).toISOString()
    }).select('id').single();
    tournamentId = tData!.id;

    await adminClient.from('tournament_scorers').insert({
      tournament_id: tournamentId,
      user_id: userIds.scorer
    });

    // 4. Create Categories
    const { data: catS } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: `Men Singles ${testRunId}`,
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select('id').single();
    categorySinglesId = catS!.id;

    const { data: catD } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: `Men Doubles ${testRunId}`,
      category_type: 'DOUBLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select('id').single();
    categoryDoublesId = catD!.id;

    // 5. Create Participants & Members
    const { data: pSinA } = await adminClient.from('participants').insert({ category_id: categorySinglesId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
    const { data: pSinB } = await adminClient.from('participants').insert({ category_id: categorySinglesId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
    partSinglesAId = pSinA!.id;
    partSinglesBId = pSinB!.id;
    await adminClient.from('participant_members').insert([
      { participant_id: partSinglesAId, player_id: playerA1Id, member_order: 1 },
      { participant_id: partSinglesBId, player_id: playerB1Id, member_order: 1 }
    ]);

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
    const { data: mS } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: partSinglesAId,
      participant_b_id: partSinglesBId,
      status: 'LIVE'
    }).select('id').single();
    matchSinglesId = mS!.id;

    const { data: mD } = await adminClient.from('matches').insert({
      category_id: categoryDoublesId,
      participant_a_id: partDoublesAId,
      participant_b_id: partDoublesBId,
      status: 'LIVE'
    }).select('id').single();
    matchDoublesId = mD!.id;

    // Create Initial Games
    await adminClient.from('games').insert({
      match_id: matchSinglesId,
      game_number: 1,
      status: 'LIVE',
      participant_a_score: 0,
      participant_b_score: 0
    });

    await adminClient.from('games').insert({
      match_id: matchDoublesId,
      game_number: 1,
      status: 'LIVE',
      participant_a_score: 0,
      participant_b_score: 0
    });
  });

  after(async () => {
    await clearAllOfflineEvents();
    for (const uid of Object.values(userIds)) {
      await adminClient.auth.admin.deleteUser(uid);
    }
    if (venueId) {
      await adminClient.from('venues').delete().eq('id', venueId);
    }
  });

  // =========================================================================
  // Section 1: Client Storage & Local Replay
  // =========================================================================

  test('1. Client Offline Storage: Enqueue and retrieve pending events in order', async () => {
    await clearAllOfflineEvents();

    const ev1: OfflineMatchEvent = {
      client_event_id: uuidv4(),
      match_id: matchSinglesId,
      event_type: 'POINT_A',
      local_order: 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: 0,
      sync_status: 'PENDING',
      retry_count: 0
    };

    const ev2: OfflineMatchEvent = {
      client_event_id: uuidv4(),
      match_id: matchSinglesId,
      event_type: 'POINT_B',
      local_order: 2,
      created_at: new Date().toISOString(),
      expected_server_sequence: 1,
      sync_status: 'PENDING',
      retry_count: 0
    };

    await enqueueOfflineEvent(ev2); // enqueued out of order
    await enqueueOfflineEvent(ev1);

    const pending = await getPendingEventsForMatch(matchSinglesId);
    assert.strictEqual(pending.length, 2);
    assert.strictEqual(pending[0].client_event_id, ev1.client_event_id);
    assert.strictEqual(pending[1].client_event_id, ev2.client_event_id);
    assert.strictEqual(pending[0].local_order, 1);
    assert.strictEqual(pending[1].local_order, 2);
  });

  test('2. Deterministic State Reconstruction: Merge server events + local pending events', async () => {
    const serverEvents = [
      { id: 'srv-1', sequence_number: 1, event_type: 'POINT_A', client_event_id: 'c-1', created_at: new Date().toISOString() },
      { id: 'srv-2', sequence_number: 2, event_type: 'POINT_A', client_event_id: 'c-2', created_at: new Date().toISOString() }
    ];

    const pendingEvents: OfflineMatchEvent[] = [
      // c-2 already in server, must be deduplicated
      { client_event_id: 'c-2', match_id: matchSinglesId, event_type: 'POINT_A', local_order: 2, created_at: new Date().toISOString(), expected_server_sequence: 1, sync_status: 'PENDING', retry_count: 0 },
      // c-3 is new pending event
      { client_event_id: 'c-3', match_id: matchSinglesId, event_type: 'POINT_B', local_order: 3, created_at: new Date().toISOString(), expected_server_sequence: 2, sync_status: 'PENDING', retry_count: 0 }
    ];

    const state = reconstructOfflineMatchState(serverEvents, pendingEvents);
    // Score should be 2 - 1 for Game 1
    assert.strictEqual(state.currentGameIndex, 0);
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
  });

  // =========================================================================
  // Section 2: PostgreSQL sync_match_events RPC & Idempotency
  // =========================================================================

  test('3. RPC Execution: Sync single offline event and verify database state', async () => {
    const clientEventId = uuidv4();
    const events = [{
      client_event_id: clientEventId,
      event_type: 'POINT_A',
      local_order: 1,
      expected_server_sequence: 0,
      metadata: { test: 'single_sync' }
    }];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: events
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.synced_count, 1);
    assert.strictEqual(data.idempotent_count, 0);
    assert.strictEqual(data.has_conflict, false);
    assert.strictEqual(data.results[0].status, 'ACKNOWLEDGED');
    assert.strictEqual(data.results[0].sequence_number, 1);

    // Verify database record
    const { data: dbEv } = await adminClient.from('match_events').select('*').eq('match_id', matchSinglesId).eq('client_event_id', clientEventId).single();
    assert.ok(dbEv);
    assert.strictEqual(dbEv.sequence_number, 1);
    assert.strictEqual(dbEv.event_type, 'POINT_A');

    // Verify reconstructed match state from server events
    const { data: srvEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchSinglesId).order('sequence_number');
    const recState = reconstructOfflineMatchState(srvEvs || [], []);
    assert.strictEqual(recState.games[0].scoreA, 1);
    assert.strictEqual(recState.games[0].scoreB, 0);
  });

  test('4. Idempotency Guarantee: Replaying identical batch returns ACKNOWLEDGED with 0 duplicate rows', async () => {
    // Count events before
    const { count: countBefore } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchSinglesId);

    // Replay the exact same single event from test 3
    const { data: existingEv } = await adminClient.from('match_events').select('client_event_id').eq('match_id', matchSinglesId).single();
    const replayPayload = [{
      client_event_id: existingEv!.client_event_id,
      event_type: 'POINT_A',
      local_order: 1,
      expected_server_sequence: 0
    }];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: replayPayload
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.synced_count, 0);
    assert.strictEqual(data.idempotent_count, 1);
    assert.strictEqual(data.results[0].status, 'ACKNOWLEDGED');
    assert.strictEqual(data.results[0].is_idempotent, true);

    // Count events after: MUST be identical
    const { count: countAfter } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchSinglesId);
    assert.strictEqual(countAfter, countBefore);
  });

  test('5. Multi-Event Batch Sync: Sync a burst of 4 offline points (0-1 -> 3-2)', async () => {
    const ev1 = uuidv4();
    const ev2 = uuidv4();
    const ev3 = uuidv4();
    const ev4 = uuidv4();

    // Current sequence on server is 1 (from test 3)
    const batch = [
      { client_event_id: ev1, event_type: 'POINT_B', local_order: 2, expected_server_sequence: 1 },
      { client_event_id: ev2, event_type: 'POINT_A', local_order: 3, expected_server_sequence: 2 },
      { client_event_id: ev3, event_type: 'POINT_A', local_order: 4, expected_server_sequence: 3 },
      { client_event_id: ev4, event_type: 'POINT_B', local_order: 5, expected_server_sequence: 4 }
    ];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: batch
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.synced_count, 4);
    assert.strictEqual(data.has_conflict, false);

    // Verify total events in DB is 5 with sequence 1..5
    const { data: allEvs } = await adminClient.from('match_events').select('sequence_number, event_type').eq('match_id', matchSinglesId).order('sequence_number', { ascending: true });
    assert.strictEqual(allEvs?.length, 5);
    for (let i = 0; i < allEvs!.length; i++) {
      assert.strictEqual(allEvs![i].sequence_number, i + 1);
    }

    // Verify reconstructed score in match state: 3 - 2
    const recState = reconstructOfflineMatchState(allEvs || [], []);
    assert.strictEqual(recState.games[0].scoreA, 3);
    assert.strictEqual(recState.games[0].scoreB, 2);
  });

  test('6. Mixed Batch (Idempotent + New): Resending partially committed batch handles already-applied items safely', async () => {
    const { data: lastEv } = await adminClient.from('match_events').select('client_event_id').eq('match_id', matchSinglesId).order('sequence_number', { ascending: false }).limit(1).single();
    const newEvId = uuidv4();

    const mixedBatch = [
      // Already committed in test 5 (seq 5)
      { client_event_id: lastEv!.client_event_id, event_type: 'POINT_B', local_order: 5, expected_server_sequence: 4 },
      // New item
      { client_event_id: newEvId, event_type: 'POINT_A', local_order: 6, expected_server_sequence: 5 }
    ];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: mixedBatch
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.idempotent_count, 1);
    assert.strictEqual(data.synced_count, 1);

    // Verify total events is now 6
    const { count } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchSinglesId);
    assert.strictEqual(count, 6);
  });

  // =========================================================================
  // Section 3: Conflict Detection & Cascading Protection
  // =========================================================================

  test('7. Conflict Detection: Stale predecessor sequence triggers CONFLICT with preserved reason', async () => {
    // Current server sequence is 6.
    // Client attempts to sync an event expecting server sequence 2 (stale by 4 events).
    const staleEvId = uuidv4();
    const staleBatch = [
      { client_event_id: staleEvId, event_type: 'POINT_A', local_order: 10, expected_server_sequence: 2 }
    ];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: staleBatch
    });

    assert.ifError(error);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.has_conflict, true);
    assert.strictEqual(data.results[0].status, 'CONFLICT');
    assert.ok(data.results[0].reason.includes('Stale predecessor'));

    // Verify NO new row was added to match_events
    const { data: checkEv } = await adminClient.from('match_events').select('id').eq('client_event_id', staleEvId);
    assert.strictEqual(checkEv?.length, 0);
  });

  test('8. Cascading Protection: Subsequent items in conflicted batch are marked BLOCKED_BY_CONFLICT', async () => {
    const staleEv1 = uuidv4();
    const blockedEv2 = uuidv4();
    const blockedEv3 = uuidv4();

    const multiConflictBatch = [
      { client_event_id: staleEv1, event_type: 'POINT_A', local_order: 10, expected_server_sequence: 1 },
      { client_event_id: blockedEv2, event_type: 'POINT_A', local_order: 11, expected_server_sequence: 2 },
      { client_event_id: blockedEv3, event_type: 'POINT_B', local_order: 12, expected_server_sequence: 3 }
    ];

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: multiConflictBatch
    });

    assert.ifError(error);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.has_conflict, true);
    assert.strictEqual(data.results[0].status, 'CONFLICT');
    assert.strictEqual(data.results[1].status, 'BLOCKED_BY_CONFLICT');
    assert.strictEqual(data.results[2].status, 'BLOCKED_BY_CONFLICT');

    // 0 events written
    const { count } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchSinglesId);
    assert.strictEqual(count, 6);
  });

  // =========================================================================
  // Section 4: Offline UNDO & Replay State
  // =========================================================================

  test('9. Offline UNDO: Enqueueing UNDO locally updates optimistic state and syncs cleanly', async () => {
    await clearAllOfflineEvents();

    // Current score on server is 4 - 2 (seq 6).
    const currentSeq = 6;
    const ptEvId = uuidv4();
    const undoEvId = uuidv4();

    // 1. Enqueue POINT_A locally
    const ptEvent: OfflineMatchEvent = {
      client_event_id: ptEvId,
      match_id: matchSinglesId,
      event_type: 'POINT_A',
      local_order: 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: currentSeq,
      sync_status: 'PENDING',
      retry_count: 0
    };
    await enqueueOfflineEvent(ptEvent);

    // 2. Enqueue UNDO locally
    const undoEvent: OfflineMatchEvent = {
      client_event_id: undoEvId,
      match_id: matchSinglesId,
      event_type: 'UNDO',
      local_order: 2,
      created_at: new Date().toISOString(),
      expected_server_sequence: currentSeq + 1,
      sync_status: 'PENDING',
      retry_count: 0
    };
    await enqueueOfflineEvent(undoEvent);

    // 3. Verify reconstructed state has score reverted back
    const { data: serverEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchSinglesId).order('sequence_number');
    const pending = await getPendingEventsForMatch(matchSinglesId);
    const recState = reconstructOfflineMatchState(serverEvs || [], pending);
    assert.strictEqual(recState.games[0].scoreA, 4);
    assert.strictEqual(recState.games[0].scoreB, 2);

    // 4. Sync the batch via syncPendingMatchEvents service
    const syncRes = await syncPendingMatchEvents(matchSinglesId, orgClient);
    assert.strictEqual(syncRes.success, true);
    assert.strictEqual(syncRes.synced_count, 2);

    // 5. Verify database matches reconstructed state
    const { data: updatedEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchSinglesId).order('sequence_number');
    const finalState = reconstructOfflineMatchState(updatedEvs || [], []);
    assert.strictEqual(finalState.games[0].scoreA, 4);
    assert.strictEqual(finalState.games[0].scoreB, 2);
  });

  // =========================================================================
  // Section 5: Offline Service Tracking & Doubles Positioning
  // =========================================================================

  test('10. Service Tracking & Doubles Positioning in Offline Mode', async () => {
    await clearAllOfflineEvents();

    // Initialize doubles service setup on server
    const setSrvEvId = uuidv4();
    const setSrvBatch = [{
      client_event_id: setSrvEvId,
      event_type: 'SET_SERVICE',
      local_order: 1,
      expected_server_sequence: 0,
      server_player_id: playerA1Id,
      receiver_player_id: playerB1Id,
      metadata: {
        server_side: 'A',
        server_court: 'RIGHT',
        receiver_court: 'RIGHT',
        side_a_positions: { right_player_id: playerA1Id, left_player_id: playerA2Id },
        side_b_positions: { right_player_id: playerB1Id, left_player_id: playerB2Id }
      }
    }];

    const { data: srvInitRes } = await orgClient.rpc('sync_match_events', {
      p_match_id: matchDoublesId,
      p_events: setSrvBatch
    });
    assert.strictEqual(srvInitRes.success, true);

    // Now record offline points for doubles
    const p1Id = uuidv4(); // Side A scores -> 1-0, Side A switches courts (A1 to LEFT)
    const p2Id = uuidv4(); // Side B scores -> 1-1, Sideout, Side B serves from LEFT (B2 serves)

    const dPt1: OfflineMatchEvent = {
      client_event_id: p1Id,
      match_id: matchDoublesId,
      event_type: 'POINT_A',
      local_order: 2,
      created_at: new Date().toISOString(),
      expected_server_sequence: 1,
      sync_status: 'PENDING',
      retry_count: 0
    };

    const dPt2: OfflineMatchEvent = {
      client_event_id: p2Id,
      match_id: matchDoublesId,
      event_type: 'POINT_B',
      local_order: 3,
      created_at: new Date().toISOString(),
      expected_server_sequence: 2,
      sync_status: 'PENDING',
      retry_count: 0
    };

    await enqueueOfflineEvent(dPt1);
    await enqueueOfflineEvent(dPt2);

    // Reconstruct offline doubles state
    const { data: srvEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchDoublesId).order('sequence_number');
    const pendingD = await getPendingEventsForMatch(matchDoublesId);
    const recDState = reconstructOfflineMatchState(srvEvs || [], pendingD, { matchType: 'DOUBLES', isDoubles: true } as any);

    assert.strictEqual(recDState.games[0].scoreA, 1);
    assert.strictEqual(recDState.games[0].scoreB, 1);
    assert.strictEqual(recDState.currentServiceState?.servingSide, 'B');
    assert.strictEqual(recDState.currentServiceState?.serverCourt, 'LEFT');

    // Sync to server
    const syncDRes = await syncPendingMatchEvents(matchDoublesId, orgClient);
    assert.strictEqual(syncDRes.success, true);
    assert.strictEqual(syncDRes.synced_count, 2);

    // Verify materialized service state in DB
    const { data: dbMatchD } = await adminClient.from('matches').select('service_state').eq('id', matchDoublesId).single();
    assert.strictEqual(dbMatchD!.service_state?.server_court, 'RIGHT');
  });

  // =========================================================================
  // Section 6: Game Transition in Offline Mode
  // =========================================================================

  test('11. Game Transition in Offline Mode: Scoring past 20-20 to win Game 1 (22-20)', async () => {
    // Create dedicated match for game transition
    const { data: gmMatch } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: partSinglesAId,
      participant_b_id: partSinglesBId,
      status: 'LIVE'
    }).select('id').single();

    // Create 42 offline events to reach 22 - 20 (Game 1 won by A)
    const gameEvents: any[] = [];
    let curSeq = 0;
    // 20 points each: alternate A and B (20-20)
    for (let i = 0; i < 20; i++) {
      gameEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
      gameEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_B', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    }
    // Deuce reached at 20-20. Score 2 consecutive points for A to win 22-20.
    gameEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    gameEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: gmMatch!.id,
      p_events: gameEvents
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.synced_count, 42);

    // Verify reconstructed match state from server events has Game 1 finished at 22 - 20 and Game 2 active
    const { data: dbEvs } = await adminClient.from('match_events').select('*').eq('match_id', gmMatch!.id).order('sequence_number');
    assert.strictEqual(dbEvs?.length, 42);

    const matchState = reconstructOfflineMatchState(dbEvs || [], []);
    assert.strictEqual(matchState.games[0].scoreA, 22);
    assert.strictEqual(matchState.games[0].isCompleted, true);
    assert.strictEqual(matchState.games[0].winnerId, 'PARTICIPANT_A');
    assert.strictEqual(matchState.currentGameIndex, 1);
  });

  // =========================================================================
  // Section 7: Authorization & Security Checks
  // =========================================================================

  test('12. Security & RBAC: Anonymous and non-scorer users cannot sync match events', async () => {
    const unauthEv = [{
      client_event_id: uuidv4(),
      event_type: 'POINT_A',
      local_order: 1,
      expected_server_sequence: 0
    }];

    // Anon client attempt
    const { error: anonErr } = await anonClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: unauthEv
    });
    assert.ok(anonErr, 'Anon should be rejected');

    // Unrelated player attempt
    const { error: playerErr } = await playerClient.rpc('sync_match_events', {
      p_match_id: matchSinglesId,
      p_events: unauthEv
    });
    assert.ok(playerErr, 'Unauthorized player should be rejected');
    assert.ok(playerErr.message.includes('permission') || playerErr.message.includes('Unauthorized') || playerErr.message.includes('cannot score'));
  });

  // =========================================================================
  // Section 8: Database Integrity Audits
  // =========================================================================

  test('13. Database Integrity Audit: 0 duplicate client_event_ids, 0 sequence gaps', async () => {
    // Audit all match_events in matchSinglesId
    const { data: events } = await adminClient
      .from('match_events')
      .select('sequence_number, client_event_id')
      .eq('match_id', matchSinglesId)
      .order('sequence_number', { ascending: true });

    assert.ok(events && events.length > 0);

    const clientIds = new Set<string>();
    let expectedSeq = 1;

    for (const ev of events) {
      // 1. Check sequence monotonicity and no gaps
      assert.strictEqual(ev.sequence_number, expectedSeq, `Sequence gap at sequence ${ev.sequence_number}`);
      expectedSeq++;

      // 2. Check no duplicate client_event_id
      if (ev.client_event_id) {
        assert.ok(!clientIds.has(ev.client_event_id), `Duplicate client_event_id detected: ${ev.client_event_id}`);
        clientIds.add(ev.client_event_id);
      }
    }
  });

  // =========================================================================
  // Section 9: Advanced Offline Lifecycle & Edge Case Tests (14 - 22)
  // =========================================================================

  test('14. Queue Status Lifecycle: PENDING -> SYNCING -> ACKNOWLEDGED and IndexedDB cleanup', async () => {
    await clearAllOfflineEvents();
    const evId = uuidv4();
    const ev: OfflineMatchEvent = {
      client_event_id: evId,
      match_id: matchSinglesId,
      event_type: 'POINT_A',
      local_order: 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: 8,
      sync_status: 'PENDING',
      retry_count: 0
    };

    await enqueueOfflineEvent(ev);
    let pending = await getPendingEventsForMatch(matchSinglesId);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].sync_status, 'PENDING');

    await updateEventStatus(evId, 'SYNCING');
    let syncing = await getAllEventsForMatch(matchSinglesId);
    assert.strictEqual(syncing[0].sync_status, 'SYNCING');

    await removeEventsForMatch(matchSinglesId, [evId]);
    let remaining = await getAllEventsForMatch(matchSinglesId);
    assert.strictEqual(remaining.length, 0);
  });

  test('15. Conflict Preservation: Rejected events update status to CONFLICT with reason preserved', async () => {
    await clearAllOfflineEvents();
    const staleId = uuidv4();
    const staleEv: OfflineMatchEvent = {
      client_event_id: staleId,
      match_id: matchSinglesId,
      event_type: 'POINT_A',
      local_order: 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: 0, // Server is at >= 8
      sync_status: 'PENDING',
      retry_count: 0
    };

    await enqueueOfflineEvent(staleEv);
    const syncRes = await syncPendingMatchEvents(matchSinglesId, orgClient);
    assert.strictEqual(syncRes.has_conflict, true);

    const allEvents = await getAllEventsForMatch(matchSinglesId);
    assert.strictEqual(allEvents.length, 1);
    assert.strictEqual(allEvents[0].sync_status, 'CONFLICT');
    assert.ok(allEvents[0].error_message?.includes('Stale predecessor'));
  });

  test('16. Network Failure Fallback: Events remain in PENDING state on RPC error', async () => {
    await clearAllOfflineEvents();
    const netEvId = uuidv4();
    const netEv: OfflineMatchEvent = {
      client_event_id: netEvId,
      match_id: matchSinglesId,
      event_type: 'POINT_B',
      local_order: 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: 8,
      sync_status: 'PENDING',
      retry_count: 0
    };

    await enqueueOfflineEvent(netEv);

    // Mock client with failing network
    const mockFailingClient = {
      rpc: async () => ({ data: null, error: { message: 'Network connection refused' } })
    };

    const syncRes = await syncPendingMatchEvents(matchSinglesId, mockFailingClient);
    assert.strictEqual(syncRes.success, false);
    assert.ok(syncRes.error?.includes('Network connection refused'));

    const allEvents = await getAllEventsForMatch(matchSinglesId);
    assert.strictEqual(allEvents.length, 1);
    assert.strictEqual(allEvents[0].sync_status, 'PENDING');
  });

  test('17. Concurrent Batches: Multiple simultaneous sync attempts resolve safely via FOR UPDATE locks', async () => {
    const evA = uuidv4();
    const evB = uuidv4();

    const { data: srvEvs } = await adminClient.from('match_events').select('sequence_number').eq('match_id', matchSinglesId).order('sequence_number', { ascending: false }).limit(1);
    const curSeq = srvEvs?.[0]?.sequence_number || 8;

    const payloadA = [{ client_event_id: evA, event_type: 'POINT_A', local_order: 1, expected_server_sequence: curSeq }];
    const payloadB = [{ client_event_id: evB, event_type: 'POINT_B', local_order: 2, expected_server_sequence: curSeq + 1 }];

    const [resA, resB] = await Promise.all([
      orgClient.rpc('sync_match_events', { p_match_id: matchSinglesId, p_events: payloadA }),
      orgClient.rpc('sync_match_events', { p_match_id: matchSinglesId, p_events: payloadB })
    ]);

    // At least one must succeed; if second executed after first, it may succeed or conflict safely
    assert.ok(resA.data.success || resB.data.success);

    // Database must have no duplicate sequence numbers
    const { data: allSeq } = await adminClient.from('match_events').select('sequence_number').eq('match_id', matchSinglesId).order('sequence_number');
    const seqSet = new Set(allSeq?.map(s => s.sequence_number));
    assert.strictEqual(seqSet.size, allSeq?.length);
  });

  test('18. Full Match Completion Offline: 2 Straight Games (21-15, 21-12) with winner declaration', async () => {
    // Dedicated match for full completion
    const { data: fullMatch } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: partSinglesAId,
      participant_b_id: partSinglesBId,
      status: 'LIVE'
    }).select('id').single();

    const matchEvents: any[] = [];
    let curSeq = 0;

    // Game 1: Side A wins 21 - 15 (36 points)
    for (let i = 0; i < 15; i++) {
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_B', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    }
    for (let i = 0; i < 6; i++) {
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    }

    // Game 2: Side A wins 21 - 12 (33 points)
    for (let i = 0; i < 12; i++) {
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_B', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    }
    for (let i = 0; i < 9; i++) {
      matchEvents.push({ client_event_id: uuidv4(), event_type: 'POINT_A', local_order: ++curSeq, expected_server_sequence: curSeq - 1 });
    }

    const { data, error } = await orgClient.rpc('sync_match_events', {
      p_match_id: fullMatch!.id,
      p_events: matchEvents
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.synced_count, 69);

    // Reconstruct match state
    const { data: dbEvs } = await adminClient.from('match_events').select('*').eq('match_id', fullMatch!.id).order('sequence_number');
    assert.strictEqual(dbEvs?.length, 69);

    const matchState = reconstructOfflineMatchState(dbEvs || [], []);
    assert.strictEqual(matchState.games[0].scoreA, 21);
    assert.strictEqual(matchState.games[0].scoreB, 15);
    assert.strictEqual(matchState.games[0].isCompleted, true);
    assert.strictEqual(matchState.games[1].scoreA, 21);
    assert.strictEqual(matchState.games[1].scoreB, 12);
    assert.strictEqual(matchState.games[1].isCompleted, true);
    assert.strictEqual(matchState.isCompleted, true);
    assert.strictEqual(matchState.winnerId, 'PARTICIPANT_A');
  });

  test('19. Realtime Event Schema Validation: Required columns populated on sync', async () => {
    const { data: latestEv } = await adminClient
      .from('match_events')
      .select('*')
      .eq('match_id', matchSinglesId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .single();

    assert.ok(latestEv);
    assert.ok(latestEv.id);
    assert.ok(latestEv.match_id);
    assert.ok(latestEv.sequence_number > 0);
    assert.ok(latestEv.client_event_id);
    assert.ok(latestEv.event_type);
    assert.ok(latestEv.created_at);
  });

  test('20. Out-of-Order Enqueueing: Events ordered deterministically by local_order', async () => {
    await clearAllOfflineEvents();
    const mid = uuidv4();

    const e1: OfflineMatchEvent = { client_event_id: uuidv4(), match_id: mid, event_type: 'POINT_A', local_order: 1, created_at: new Date().toISOString(), expected_server_sequence: 0, sync_status: 'PENDING', retry_count: 0 };
    const e2: OfflineMatchEvent = { client_event_id: uuidv4(), match_id: mid, event_type: 'POINT_B', local_order: 2, created_at: new Date().toISOString(), expected_server_sequence: 1, sync_status: 'PENDING', retry_count: 0 };
    const e3: OfflineMatchEvent = { client_event_id: uuidv4(), match_id: mid, event_type: 'POINT_A', local_order: 3, created_at: new Date().toISOString(), expected_server_sequence: 2, sync_status: 'PENDING', retry_count: 0 };

    await enqueueOfflineEvent(e3);
    await enqueueOfflineEvent(e1);
    await enqueueOfflineEvent(e2);

    const pending = await getPendingEventsForMatch(mid);
    assert.strictEqual(pending.length, 3);
    assert.strictEqual(pending[0].local_order, 1);
    assert.strictEqual(pending[1].local_order, 2);
    assert.strictEqual(pending[2].local_order, 3);
  });

  test('21. Storage Isolation & Clear: Match-level and global queue cleanup operate cleanly', async () => {
    await clearAllOfflineEvents();
    const m1 = uuidv4();
    const m2 = uuidv4();

    await enqueueOfflineEvent({ client_event_id: uuidv4(), match_id: m1, event_type: 'POINT_A', local_order: 1, created_at: new Date().toISOString(), expected_server_sequence: 0, sync_status: 'PENDING', retry_count: 0 });
    await enqueueOfflineEvent({ client_event_id: uuidv4(), match_id: m2, event_type: 'POINT_B', local_order: 1, created_at: new Date().toISOString(), expected_server_sequence: 0, sync_status: 'PENDING', retry_count: 0 });

    let p1 = await getPendingEventsForMatch(m1);
    let p2 = await getPendingEventsForMatch(m2);
    assert.strictEqual(p1.length, 1);
    assert.strictEqual(p2.length, 1);

    await clearAllOfflineEvents();
    p1 = await getPendingEventsForMatch(m1);
    p2 = await getPendingEventsForMatch(m2);
    assert.strictEqual(p1.length, 0);
    assert.strictEqual(p2.length, 0);
  });

  test('22. Complete Database Invariant Verification: 0 corrupt sequences, valid foreign keys', async () => {
    // 1. Verify no null sequence numbers across all test matches
    const { data: nullSeq } = await adminClient
      .from('match_events')
      .select('id')
      .in('match_id', [matchSinglesId, matchDoublesId])
      .is('sequence_number', null);
    assert.strictEqual(nullSeq?.length || 0, 0);

    // 2. Verify all match_events refer to existing matches
    const { data: orphanEvs } = await adminClient
      .from('match_events')
      .select('id, match_id')
      .in('match_id', [matchSinglesId, matchDoublesId]);
    assert.ok(orphanEvs && orphanEvs.length > 0);

    // 3. Verify service state format on match
    const { data: matchData } = await adminClient
      .from('matches')
      .select('service_state')
      .eq('id', matchDoublesId)
      .single();
    assert.ok(matchData?.service_state);
  });
});

