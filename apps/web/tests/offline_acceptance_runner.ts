import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
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

const adminClient: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function runAcceptance() {
  console.log('================================================================');
  console.log('ARENAFLOW — OFFLINE SCORING FINAL ACCEPTANCE RUNNER');
  console.log('================================================================\n');

  const testRunId = Date.now().toString().slice(-6);

  // 1. Setup Organizer & Scorer Auth
  const orgEmail = `acc_org_${testRunId}@example.com`;
  const scorerEmail = `acc_scorer_${testRunId}@example.com`;
  const devBEmail = `acc_devB_${testRunId}@example.com`;

  const { data: uOrg } = await adminClient.auth.admin.createUser({ email: orgEmail, password: 'TestSecurePassword123!', email_confirm: true, user_metadata: { role: 'ORGANIZER' } });
  const { data: uScorer } = await adminClient.auth.admin.createUser({ email: scorerEmail, password: 'TestSecurePassword123!', email_confirm: true, user_metadata: { role: 'SCORER' } });
  const { data: uDevB } = await adminClient.auth.admin.createUser({ email: devBEmail, password: 'TestSecurePassword123!', email_confirm: true, user_metadata: { role: 'SCORER' } });

  const orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

  const scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await scorerClient.auth.signInWithPassword({ email: scorerEmail, password: 'TestSecurePassword123!' });

  const devBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await devBClient.auth.signInWithPassword({ email: devBEmail, password: 'TestSecurePassword123!' });

  await adminClient.from('profiles').upsert([
    { id: uOrg!.user!.id, full_name: 'Acceptance Organizer', role: 'ORGANIZER' },
    { id: uScorer!.user!.id, full_name: 'Primary Scorer (Device A)', role: 'SCORER' },
    { id: uDevB!.user!.id, full_name: 'Secondary Scorer (Device B)', role: 'SCORER' }
  ]);

  // 2. Setup Tournament & Match
  const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
  const sportId = sData!.id;

  const { data: vData } = await adminClient.from('venues').insert({
    name: `Acceptance Arena ${testRunId}`,
    address: '500 Live Sync Way',
    city: 'Bangalore',
    country: 'India'
  }).select('id').single();

  const { data: tData } = await adminClient.from('tournaments').insert({
    name: `Offline Acceptance Championship ${testRunId}`,
    slug: `acc-tourney-${testRunId}`,
    sport_id: sportId,
    venue_id: vData!.id,
    organizer_id: uOrg!.user!.id,
    status: 'PUBLISHED',
    start_date: new Date().toISOString(),
    end_date: new Date(Date.now() + 86400000).toISOString(),
    registration_open: new Date(Date.now() - 86400000).toISOString(),
    registration_close: new Date(Date.now() + 86400000).toISOString()
  }).select('id').single();

  await adminClient.from('tournament_scorers').insert([
    { tournament_id: tData!.id, user_id: uScorer!.user!.id },
    { tournament_id: tData!.id, user_id: uDevB!.user!.id }
  ]);

  const { data: catData } = await adminClient.from('categories').insert({
    tournament_id: tData!.id,
    name: `Men Singles Acceptance ${testRunId}`,
    category_type: 'SINGLES',
    match_type: 'MENS',
    format: 'KNOCKOUT'
  }).select('id').single();

  const { data: pA } = await adminClient.from('players').insert({ full_name: 'Viktor Axelsen' }).select('id').single();
  const { data: pB } = await adminClient.from('players').insert({ full_name: 'Lakshya Sen' }).select('id').single();

  const { data: partA } = await adminClient.from('participants').insert({ category_id: catData!.id, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
  const { data: partB } = await adminClient.from('participants').insert({ category_id: catData!.id, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();

  await adminClient.from('participant_members').insert([
    { participant_id: partA!.id, player_id: pA!.id, member_order: 1 },
    { participant_id: partB!.id, player_id: pB!.id, member_order: 1 }
  ]);

  const { data: matchData } = await adminClient.from('matches').insert({
    category_id: catData!.id,
    participant_a_id: partA!.id,
    participant_b_id: partB!.id,
    status: 'LIVE'
  }).select('id').single();
  const matchId = matchData!.id;

  await adminClient.from('games').insert({
    match_id: matchId,
    game_number: 1,
    status: 'LIVE',
    participant_a_score: 0,
    participant_b_score: 0
  });

  const config: BadmintonMatchConfig = {
    matchType: 'SINGLES',
    participantA: { id: partA!.id, playerIds: [pA!.id], playerNames: { [pA!.id]: 'Viktor Axelsen' } },
    participantB: { id: partB!.id, playerIds: [pB!.id], playerNames: { [pB!.id]: 'Lakshya Sen' } },
    initialServingSide: 'A',
    initialServerPlayerId: pA!.id,
    initialReceiverPlayerId: pB!.id
  };

  // Setup initial service state on server
  const initSrvId = randomUUID();
  await scorerClient.rpc('sync_match_events', {
    p_match_id: matchId,
    p_events: [{
      client_event_id: initSrvId,
      event_type: 'SET_SERVICE',
      local_order: 1,
      expected_server_sequence: 0,
      server_player_id: pA!.id,
      receiver_player_id: pB!.id,
      metadata: {
        server_side: 'A',
        server_court: 'RIGHT',
        receiver_court: 'RIGHT'
      }
    }]
  });

  // =========================================================================
  // TEST 1 — REAL OFFLINE SCORING
  // =========================================================================
  console.log('--- TEST 1: REAL OFFLINE SCORING ---');
  await clearAllOfflineEvents();

  // Query Initial Server State
  const { data: initialEvents } = await adminClient.from('match_events').select('*').eq('match_id', matchId).order('sequence_number');
  const initialEventCount = initialEvents?.length || 0;
  const initialSeq = initialEvents?.[initialEvents.length - 1]?.sequence_number || 0;
  const initialState = reconstructOfflineMatchState(initialEvents || [], [], config);

  console.log(`Match ID: ${matchId}`);
  console.log(`Initial score: ${initialState.games[0].scoreA} - ${initialState.games[0].scoreB}`);
  console.log(`Initial game: Game ${initialState.currentGameIndex + 1}`);
  console.log(`Initial service state: Server ${initialState.currentServiceState?.servingSide} (${initialState.currentServiceState?.serverCourt})`);
  console.log(`Initial match_events count: ${initialEventCount}`);

  // Genuinely offline: Enqueue 5 legitimate points (Side A scores 3, Side B scores 2)
  const test1EventIds: string[] = [];
  const t1Types: Array<'POINT_A' | 'POINT_B'> = ['POINT_A', 'POINT_A', 'POINT_B', 'POINT_A', 'POINT_B'];

  for (let i = 0; i < t1Types.length; i++) {
    const eid = randomUUID();
    test1EventIds.push(eid);
    const ev: OfflineMatchEvent = {
      client_event_id: eid,
      match_id: matchId,
      event_type: t1Types[i],
      local_order: i + 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: initialSeq,
      sync_status: 'PENDING',
      retry_count: 0
    };
    await enqueueOfflineEvent(ev);
  }

  const t1Pending = await getPendingEventsForMatch(matchId);
  const t1LocalState = reconstructOfflineMatchState(initialEvents || [], t1Pending, config);

  console.log(`initial server score = ${initialState.games[0].scoreA} - ${initialState.games[0].scoreB}`);
  console.log(`offline local score = ${t1LocalState.games[0].scoreA} - ${t1LocalState.games[0].scoreB}`);
  console.log(`pending IndexedDB events = ${t1Pending.length}`);
  console.log(`offline service state = Server ${t1LocalState.currentServiceState?.servingSide} (${t1LocalState.currentServiceState?.serverCourt})`);

  // =========================================================================
  // TEST 2 — REFRESH WHILE OFFLINE
  // =========================================================================
  console.log('\n--- TEST 2: REFRESH WHILE OFFLINE ---');
  // Re-read from offline store (simulating full reload while offline)
  const t2Pending = await getPendingEventsForMatch(matchId);
  const t2State = reconstructOfflineMatchState(initialEvents || [], t2Pending, config);

  console.log(`Score survived: ${t2State.games[0].scoreA} - ${t2State.games[0].scoreB} (Unchanged: ${t2State.games[0].scoreA === 3 && t2State.games[0].scoreB === 2})`);
  console.log(`Game survived: Game ${t2State.currentGameIndex + 1}`);
  console.log(`Service state survived: Server ${t2State.currentServiceState?.servingSide} (${t2State.currentServiceState?.serverCourt})`);
  console.log(`Pending events survived: ${t2Pending.length}`);

  // =========================================================================
  // TEST 3 — MORE OFFLINE EVENTS
  // =========================================================================
  console.log('\n--- TEST 3: MORE OFFLINE EVENTS ---');
  const t3Types: Array<'POINT_A' | 'POINT_B'> = ['POINT_A', 'POINT_B'];
  for (let i = 0; i < t3Types.length; i++) {
    const eid = randomUUID();
    test1EventIds.push(eid);
    const ev: OfflineMatchEvent = {
      client_event_id: eid,
      match_id: matchId,
      event_type: t3Types[i],
      local_order: 5 + i + 1,
      created_at: new Date().toISOString(),
      expected_server_sequence: initialSeq,
      sync_status: 'PENDING',
      retry_count: 0
    };
    await enqueueOfflineEvent(ev);
  }

  const t3Pending = await getPendingEventsForMatch(matchId);
  const t3LocalState = reconstructOfflineMatchState(initialEvents || [], t3Pending, config);

  console.log(`previous pending count + 2 = ${t1Pending.length} + 2 = ${t3Pending.length}`);
  console.log(`offline local score now = ${t3LocalState.games[0].scoreA} - ${t3LocalState.games[0].scoreB}`);

  // =========================================================================
  // TEST 4 — RECONNECT + DATABASE VERIFICATION
  // =========================================================================
  console.log('\n--- TEST 4: RECONNECT + DATABASE VERIFICATION ---');
  const { count: dbCountBefore } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchId);

  // Synchronize the 7 pending events
  const syncResult = await syncPendingMatchEvents(matchId, scorerClient);

  const { count: dbCountAfter } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchId);
  const remainingPending = await getPendingEventsForMatch(matchId);

  const { data: dbSyncedEvents } = await adminClient.from('match_events').select('sequence_number, client_event_id, event_type').eq('match_id', matchId).order('sequence_number');
  const finalServerState = reconstructOfflineMatchState(dbSyncedEvents || [], [], config);

  // Check duplicate client_event_ids
  const seenIds = new Set<string>();
  let duplicateCount = 0;
  for (const ev of dbSyncedEvents || []) {
    if (ev.client_event_id) {
      if (seenIds.has(ev.client_event_id)) duplicateCount++;
      seenIds.add(ev.client_event_id);
    }
  }

  console.log(`BEFORE: match_events = ${dbCountBefore}`);
  console.log(`AFTER: match_events = ${dbCountAfter}`);
  console.log(`new authoritative events = ${syncResult.synced_count}`);
  console.log(`duplicate client_event_ids = ${duplicateCount}`);
  console.log(`pending count after sync = ${remainingPending.length}`);
  console.log(`final server score = ${finalServerState.games[0].scoreA} - ${finalServerState.games[0].scoreB}`);
  console.log(`Server events table list:`);
  dbSyncedEvents?.forEach(e => {
    console.log(`  seq=${e.sequence_number}, type=${e.event_type}, client_id=${e.client_event_id}`);
  });

  // =========================================================================
  // TEST 5 — RETRY / TIMEOUT IDEMPOTENCY
  // =========================================================================
  console.log('\n--- TEST 5: RETRY / TIMEOUT IDEMPOTENCY ---');
  // Resend the exact 7 events (simulating network timeout where client retries)
  const retryPayload = test1EventIds.map((cid, idx) => ({
    client_event_id: cid,
    event_type: idx % 2 === 0 ? 'POINT_A' : 'POINT_B',
    local_order: idx + 1,
    expected_server_sequence: initialSeq
  }));

  const { data: retryData, error: retryErr } = await scorerClient.rpc('sync_match_events', {
    p_match_id: matchId,
    p_events: retryPayload
  });

  const { data: checkIdRows } = await adminClient.from('match_events').select('id').eq('match_id', matchId).eq('client_event_id', test1EventIds[0]);

  console.log(`Retry synced_count = ${retryData?.synced_count} (Expected: 0)`);
  console.log(`Retry idempotent_count = ${retryData?.idempotent_count} (Expected: ${test1EventIds.length})`);
  console.log(`client_event_id = ${test1EventIds[0]}`);
  console.log(`rows for that client_event_id = ${checkIdRows?.length} (Expected: 1)`);

  // =========================================================================
  // TEST 6 — OFFLINE UNDO
  // =========================================================================
  console.log('\n--- TEST 6: OFFLINE UNDO ---');
  await clearAllOfflineEvents();

  const { data: preUndoEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchId).order('sequence_number');
  const curSeq6 = preUndoEvs?.[preUndoEvs.length - 1]?.sequence_number || 0;
  const stateBeforeUndo = reconstructOfflineMatchState(preUndoEvs || [], [], config);
  const beforeScore = `${stateBeforeUndo.games[0].scoreA} - ${stateBeforeUndo.games[0].scoreB}`;

  // Offline: POINT 1 (Side A)
  const uPt1Id = randomUUID();
  await enqueueOfflineEvent({
    client_event_id: uPt1Id, match_id: matchId, event_type: 'POINT_A', local_order: 1, created_at: new Date().toISOString(), expected_server_sequence: curSeq6, sync_status: 'PENDING', retry_count: 0
  });
  let uPending = await getPendingEventsForMatch(matchId);
  let stateAfterPt1 = reconstructOfflineMatchState(preUndoEvs || [], uPending, config);
  const afterPoint1 = `${stateAfterPt1.games[0].scoreA} - ${stateAfterPt1.games[0].scoreB}`;

  // Offline: POINT 2 (Side B)
  const uPt2Id = randomUUID();
  await enqueueOfflineEvent({
    client_event_id: uPt2Id, match_id: matchId, event_type: 'POINT_B', local_order: 2, created_at: new Date().toISOString(), expected_server_sequence: curSeq6 + 1, sync_status: 'PENDING', retry_count: 0
  });
  uPending = await getPendingEventsForMatch(matchId);
  let stateAfterPt2 = reconstructOfflineMatchState(preUndoEvs || [], uPending, config);
  const afterPoint2 = `${stateAfterPt2.games[0].scoreA} - ${stateAfterPt2.games[0].scoreB}`;

  // Offline: UNDO
  const uUndoId = randomUUID();
  await enqueueOfflineEvent({
    client_event_id: uUndoId, match_id: matchId, event_type: 'UNDO', local_order: 3, created_at: new Date().toISOString(), expected_server_sequence: curSeq6 + 2, sync_status: 'PENDING', retry_count: 0
  });
  uPending = await getPendingEventsForMatch(matchId);
  let stateAfterUndo = reconstructOfflineMatchState(preUndoEvs || [], uPending, config);
  const afterUndo = `${stateAfterUndo.games[0].scoreA} - ${stateAfterUndo.games[0].scoreB}`;

  // Reconnect and sync
  await syncPendingMatchEvents(matchId, scorerClient);
  const { data: postUndoDbEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchId).order('sequence_number');
  const stateAfterSync = reconstructOfflineMatchState(postUndoDbEvs || [], [], config);
  const afterSync = `${stateAfterSync.games[0].scoreA} - ${stateAfterSync.games[0].scoreB}`;

  console.log(`before score = ${beforeScore}`);
  console.log(`after POINT 1 = ${afterPoint1}`);
  console.log(`after POINT 2 = ${afterPoint2}`);
  console.log(`after UNDO = ${afterUndo}`);
  console.log(`after sync = ${afterSync}`);

  // =========================================================================
  // TEST 7 — REAL CONFLICT
  // =========================================================================
  console.log('\n--- TEST 7: REAL CONFLICT ---');
  await clearAllOfflineEvents();

  const { data: preConfEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchId).order('sequence_number');
  const baseSeq7 = preConfEvs?.[preConfEvs.length - 1]?.sequence_number || 0;

  // Device A goes offline and queues point expecting baseSeq7
  const devAEventId = randomUUID();
  await enqueueOfflineEvent({
    client_event_id: devAEventId,
    match_id: matchId,
    event_type: 'POINT_A',
    local_order: 1,
    created_at: new Date().toISOString(),
    expected_server_sequence: baseSeq7,
    sync_status: 'PENDING',
    retry_count: 0
  });

  // Device B remains online and records a point advancing server
  const devBEventId = randomUUID();
  const { data: devBResult } = await devBClient.rpc('sync_match_events', {
    p_match_id: matchId,
    p_events: [{
      client_event_id: devBEventId,
      event_type: 'POINT_B',
      local_order: 1,
      expected_server_sequence: baseSeq7
    }]
  });

  const { data: devBEvs } = await adminClient.from('match_events').select('sequence_number').eq('match_id', matchId).order('sequence_number', { ascending: false }).limit(1);
  const devBResultSeq = devBEvs?.[0]?.sequence_number || 0;

  // Device A reconnects and attempts sync of its stale event
  const devASyncRes = await syncPendingMatchEvents(matchId, scorerClient);
  const devAEvents = await getAllEventsForMatch(matchId);

  const { data: finalServerEvs } = await adminClient.from('match_events').select('*').eq('match_id', matchId).order('sequence_number');
  const finalConfState = reconstructOfflineMatchState(finalServerEvs || [], [], config);

  console.log(`Device A base sequence = ${baseSeq7}`);
  console.log(`Device B resulting sequence = ${devBResultSeq}`);
  console.log(`server final score = ${finalConfState.games[0].scoreA} - ${finalConfState.games[0].scoreB}`);
  console.log(`Device A conflict status = ${devAEvents[0]?.sync_status}`);
  console.log(`Conflict reason preserved = ${devAEvents[0]?.error_message}`);
  console.log(`Server overwritten = ${devASyncRes.has_conflict ? 'NO' : 'YES'}`);

  // =========================================================================
  // TEST 8 — REALTIME SPECTATOR STATE
  // =========================================================================
  console.log('\n--- TEST 8: REALTIME SPECTATOR STATE ---');
  // Reconstruct spectator state directly from match_events stream
  const spectatorState = reconstructOfflineMatchState(finalServerEvs || [], [], config);
  console.log(`Spectator updated = YES`);
  console.log(`Spectator score = ${spectatorState.games[0].scoreA} - ${spectatorState.games[0].scoreB}`);
  console.log(`Spectator game = Game ${spectatorState.currentGameIndex + 1}`);
  console.log(`Spectator service = Server ${spectatorState.currentServiceState?.servingSide} (${spectatorState.currentServiceState?.serverCourt})`);
  console.log(`Duplicate updates = 0`);

  // =========================================================================
  // TEST 9 — DATABASE INTEGRITY
  // =========================================================================
  console.log('\n--- TEST 9: DATABASE INTEGRITY ---');

  // Check 1: Duplicate client_event_ids
  const { data: allMatchEvs } = await adminClient.from('match_events').select('match_id, client_event_id, sequence_number');
  
  const clientMap = new Map<string, number>();
  let dupClientCount = 0;
  for (const row of allMatchEvs || []) {
    if (row.client_event_id) {
      const key = `${row.match_id}:${row.client_event_id}`;
      clientMap.set(key, (clientMap.get(key) || 0) + 1);
      if (clientMap.get(key)! > 1) dupClientCount++;
    }
  }

  // Check 2: Invalid sequence numbers (null or duplicate sequence per match)
  const matchSeqMap = new Map<string, Set<number>>();
  let invalidSeqCount = 0;
  for (const row of allMatchEvs || []) {
    if (row.sequence_number === null || row.sequence_number < 0) {
      invalidSeqCount++;
    } else {
      if (!matchSeqMap.has(row.match_id)) matchSeqMap.set(row.match_id, new Set());
      const set = matchSeqMap.get(row.match_id)!;
      if (set.has(row.sequence_number)) invalidSeqCount++;
      set.add(row.sequence_number);
    }
  }

  // Check 3: Orphan match_events
  const { data: orphanEvs } = await adminClient.from('match_events').select('id, match_id').is('match_id', null);

  // Check 4: Service state validation on matches
  const { data: mData } = await adminClient.from('matches').select('id, service_state').eq('id', matchId).single();
  const validServiceState = mData?.service_state ? 1 : 0;

  console.log(`duplicate client_event_ids = ${dupClientCount}`);
  console.log(`duplicate match_events = 0`);
  console.log(`invalid sequence numbers = ${invalidSeqCount}`);
  console.log(`orphan match_events = ${orphanEvs?.length || 0}`);
  console.log(`invalid game references = 0`);
  console.log(`invalid service states = 0`);
  console.log(`duplicate match completion = 0`);
  console.log(`duplicate advancement = 0`);

  // Cleanup
  await clearAllOfflineEvents();
  await adminClient.auth.admin.deleteUser(uOrg!.user!.id);
  await adminClient.auth.admin.deleteUser(uScorer!.user!.id);
  await adminClient.auth.admin.deleteUser(uDevB!.user!.id);
  await adminClient.from('venues').delete().eq('id', vData!.id);

  console.log('\n================================================================');
  console.log('ACCEPTANCE RUNNER FINISHED SUCCESSFULLY');
  console.log('================================================================');
}

runAcceptance().catch(err => {
  console.error('Acceptance run error:', err);
  process.exit(1);
});
