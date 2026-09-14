import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const rootEnv = path.resolve(process.cwd(), '.env');
  const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
  const envPath = fs.existsSync(rootEnv) ? rootEnv : appsWebEnv;
  
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
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const runId = Date.now().toString().slice(-6);

interface TestState {
  orgUser: any;
  playerUser: any;
  orgClient: SupabaseClient;
  playerClient: SupabaseClient;
  anonClient: SupabaseClient;
  sportId: string;
  venueId: string;
  tournamentId: string;
  tournamentSlug: string;
  cat4Id: string;
  cat3Id: string;
  catRrId: string;
  catRollbackId: string;
  catConcurrencyId: string;
  part4Ids: string[];
  part3Ids: string[];
  partRrIds: string[];
}

const state: Partial<TestState> = {};

async function setup() {
  console.log('>>> 1. Setting up Acceptance Environment...');
  
  state.anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Create Organizer User
  const orgEmail = `accept_org_${runId}@example.com`;
  const { data: orgData, error: orgErr } = await adminClient.auth.admin.createUser({
    email: orgEmail,
    password: 'TestSecurePassword123!',
    email_confirm: true,
    user_metadata: { role: 'ORGANIZER', full_name: 'Acceptance Organizer' }
  });
  if (orgErr) throw orgErr;
  state.orgUser = orgData.user;

  // Create Player User
  const playerEmail = `accept_player_${runId}@example.com`;
  const { data: pData, error: pErr } = await adminClient.auth.admin.createUser({
    email: playerEmail,
    password: 'TestSecurePassword123!',
    email_confirm: true,
    user_metadata: { role: 'PLAYER', full_name: 'Acceptance Player 1' }
  });
  if (pErr) throw pErr;
  state.playerUser = pData.user;

  // Create 5 more players for participants
  const playerIds: string[] = [];
  const { data: pl1 } = await adminClient.from('players').insert({
    user_id: state.playerUser.id,
    full_name: 'Acceptance Player 1',
    gender: 'MALE',
    date_of_birth: '2000-01-01'
  }).select('id').single();
  playerIds.push(pl1!.id);

  for (let i = 2; i <= 6; i++) {
    const { data: u } = await adminClient.auth.admin.createUser({
      email: `accept_p${i}_${runId}@example.com`,
      password: 'TestSecurePassword123!',
      email_confirm: true,
      user_metadata: { role: 'PLAYER', full_name: `Acceptance Player ${i}` }
    });
    const { data: pl } = await adminClient.from('players').insert({
      user_id: u.user!.id,
      full_name: `Acceptance Player ${i}`,
      gender: 'MALE',
      date_of_birth: '2000-01-01'
    }).select('id').single();
    playerIds.push(pl!.id);
  }

  // Sign in Org & Player clients
  state.orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await state.orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

  state.playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await state.playerClient.auth.signInWithPassword({ email: playerEmail, password: 'TestSecurePassword123!' });

  // Get Sport
  const { data: s } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
  state.sportId = s?.id || (await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${runId}` }).select('id').single()).data!.id;

  // Create Venue & Court
  const { data: v } = await adminClient.from('venues').insert({
    name: `Acceptance Arena ${runId}`,
    owner_id: state.orgUser.id
  }).select('id').single();
  state.venueId = v!.id;

  await adminClient.from('courts').insert([
    { venue_id: state.venueId, name: 'Court 1', court_number: 1, sport_id: state.sportId },
    { venue_id: state.venueId, name: 'Court 2', court_number: 2, sport_id: state.sportId }
  ]);

  // Create Tournament
  state.tournamentSlug = `acceptance-tournament-${runId}`;
  const { data: t } = await adminClient.from('tournaments').insert({
    name: `Acceptance Championship ${runId}`,
    slug: state.tournamentSlug,
    sport_id: state.sportId,
    venue_id: state.venueId,
    organizer_id: state.orgUser.id,
    start_date: new Date().toISOString(),
    end_date: new Date(Date.now() + 86400000 * 7).toISOString(),
    registration_open: new Date(Date.now() - 86400000).toISOString(),
    registration_close: new Date(Date.now() + 86400000).toISOString(),
    status: 'PUBLISHED'
  }).select('id').single();
  state.tournamentId = t!.id;

  // Helper to create category with participants
  async function createCat(name: string, count: number, format: string) {
    const { data: cat } = await adminClient.from('categories').insert({
      tournament_id: state.tournamentId,
      name: `${name} ${runId}`,
      category_type: 'SINGLES',
      match_type: 'MENS',
      format
    }).select('id').single();

    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const { data: p } = await adminClient.from('participants').insert({
        category_id: cat!.id,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }).select('id').single();
      parts.push(p!.id);

      await adminClient.from('participant_members').insert({
        participant_id: p!.id,
        player_id: playerIds[i],
        member_order: 1
      });
    }
    return { catId: cat!.id, parts };
  }

  const c4 = await createCat('Men Singles 4-KO', 4, 'KNOCKOUT');
  state.cat4Id = c4.catId;
  state.part4Ids = c4.parts;

  const c3 = await createCat('Men Singles 3-KO (BYE)', 3, 'KNOCKOUT');
  state.cat3Id = c3.catId;
  state.part3Ids = c3.parts;

  const crr = await createCat('Men Singles 4-RR', 4, 'ROUND_ROBIN');
  state.catRrId = crr.catId;
  state.partRrIds = crr.parts;

  const crb = await createCat('Men Singles Rollback', 4, 'KNOCKOUT');
  state.catRollbackId = crb.catId;

  const ccon = await createCat('Men Singles Concurrency', 4, 'KNOCKOUT');
  state.catConcurrencyId = ccon.catId;

  console.log(`Environment ready. Tournament slug: ${state.tournamentSlug}, Category 4-KO: ${state.cat4Id}`);
}

async function runAcceptanceTests() {
  await setup();
  console.log('\n==================================================');
  console.log('STARTING ACCEPTANCE TESTS');
  console.log('==================================================\n');

  // TEST 2: KNOCKOUT GENERATION THROUGH UI/RPC
  console.log('>>> TEST 2: Knockout Generation (4 Players)');
  const { data: genData, error: genErr } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.cat4Id,
    p_format: 'KNOCKOUT',
    p_seeds: { [state.part4Ids![0]]: 1, [state.part4Ids![1]]: 2, [state.part4Ids![2]]: 3, [state.part4Ids![3]]: 4 }
  });
  console.log('Generation RPC Response:', genData, 'Error:', genErr);

  const drawId = genData?.draw_id;
  const { data: dbDraw } = await adminClient.from('draws').select('*').eq('id', drawId).single();
  const { data: dbRounds } = await adminClient.from('rounds').select('*').eq('draw_id', drawId).order('round_number', { ascending: true });
  const { data: dbMatches } = await adminClient.from('matches').select('*').eq('category_id', state.cat4Id);
  const { data: dbNodes } = await adminClient.from('draw_nodes').select('*').eq('draw_id', drawId).order('round_number', { ascending: true });

  console.log(`Draw ID: ${drawId}`);
  console.log(`Rounds (${dbRounds?.length}):`, dbRounds?.map(r => ({ id: r.id, num: r.round_number, name: r.name })));
  console.log(`Matches (${dbMatches?.length}):`, dbMatches?.map(m => ({ id: m.id, round_id: m.round_id, p_a: m.participant_a_id, p_b: m.participant_b_id, status: m.status })));
  console.log(`Draw Nodes (${dbNodes?.length}):`, dbNodes?.map(n => ({ id: n.id, r_num: n.round_number, pos: n.position, match_id: n.match_id, next_node_id: n.next_node_id })));

  // TEST 3: REFRESH / PERSISTENCE TEST
  console.log('\n>>> TEST 3: Refresh / Persistence Check');
  const { count: drawsT3 } = await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id);
  const { count: roundsT3 } = await adminClient.from('rounds').select('*', { count: 'exact', head: true }).eq('draw_id', drawId);
  const { count: nodesT3 } = await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', drawId);
  const { count: matchesT3 } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id);
  console.log(`Persistence counts: draws=${drawsT3}, rounds=${roundsT3}, nodes=${nodesT3}, matches=${matchesT3}`);

  // TEST 4: DUPLICATE GENERATION / IDEMPOTENCY TEST
  console.log('\n>>> TEST 4: Duplicate Generation / Idempotency Check');
  const beforeIdem = {
    draws: (await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count,
    rounds: (await adminClient.from('rounds').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    nodes: (await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    matches: (await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count
  };

  const { data: dIdem, error: errIdem } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.cat4Id,
    p_format: 'KNOCKOUT'
  });
  console.log('2nd Generation call response:', dIdem, 'Error:', errIdem);

  const afterIdem = {
    draws: (await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count,
    rounds: (await adminClient.from('rounds').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    nodes: (await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    matches: (await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count
  };
  console.log('BEFORE Idempotency:', beforeIdem);
  console.log('AFTER Idempotency:', afterIdem);

  // TEST 5: DELETE TEST
  console.log('\n>>> TEST 5: Delete Draw Check');
  const { data: delData, error: delErr } = await state.orgClient!.rpc('delete_tournament_draw', {
    p_category_id: state.cat4Id
  });
  console.log('Delete RPC response:', delData, 'Error:', delErr);

  const countsAfterDelete = {
    draws: (await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count,
    rounds: (await adminClient.from('rounds').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    nodes: (await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', drawId)).count,
    matches: (await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.cat4Id)).count
  };
  console.log('Counts After Deletion:', countsAfterDelete);

  // TEST 6: REGENERATE AFTER SAFE DELETION
  console.log('\n>>> TEST 6: Regenerate After Safe Deletion');
  const { data: dRegen, error: errRegen } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.cat4Id,
    p_format: 'KNOCKOUT',
    p_seeds: { [state.part4Ids![0]]: 1, [state.part4Ids![1]]: 2, [state.part4Ids![2]]: 3, [state.part4Ids![3]]: 4 }
  });
  console.log('New Draw Generated:', dRegen, 'Error:', errRegen);
  const newDrawId = dRegen?.draw_id;

  // TEST 7: MATCH-STARTED PROTECTION TEST
  console.log('\n>>> TEST 7: Match-Started Protection Check');
  const { data: activeMatches } = await adminClient.from('matches').select('*').eq('category_id', state.cat4Id).eq('status', 'READY');
  const matchToStart = activeMatches![0].id;
  console.log(`Starting Match ${matchToStart} to LIVE...`);

  await state.orgClient!.rpc('start_match', { p_match_id: matchToStart });
  const { data: liveCheck } = await adminClient.from('matches').select('status').eq('id', matchToStart).single();
  console.log(`Match status in DB: ${liveCheck?.status}`);

  const { error: regenBlockedErr } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.cat4Id,
    p_format: 'KNOCKOUT',
    p_options: { force_regenerate: true }
  });
  console.log('Attempt force_regenerate on LIVE match -> Error:', regenBlockedErr?.message);

  const { error: deleteBlockedErr } = await state.orgClient!.rpc('delete_tournament_draw', {
    p_category_id: state.cat4Id
  });
  console.log('Attempt delete_tournament_draw on LIVE match -> Error:', deleteBlockedErr?.message);

  // TEST 8: MATCH-EVENT PROTECTION TEST
  console.log('\n>>> TEST 8: Match-Event Protection Check');
  const { data: matchRecord } = await adminClient.from('matches').select('*').eq('id', matchToStart).single();
  const { data: gameData } = await adminClient.from('games').select('*').eq('match_id', matchToStart).order('game_number', { ascending: true });
  let gameId = gameData?.[0]?.id;
  if (!gameId) {
    const { data: newGame } = await adminClient.from('games').insert({
      match_id: matchToStart,
      game_number: 1,
      score_side_a: 1,
      score_side_b: 0,
      status: 'LIVE'
    }).select('id').single();
    gameId = newGame?.id;
  }

  await adminClient.from('match_events').insert({
    match_id: matchToStart,
    game_id: gameId,
    event_type: 'POINT_SCORED',
    point_winner_id: matchRecord!.participant_a_id,
    rally_type: 'SMASH',
    event_data: { score_a: 1, score_b: 0 }
  });

  const { count: eventsCount } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', matchToStart);
  console.log(`match_events count for match: ${eventsCount}`);

  const { error: delWithEventsErr } = await state.orgClient!.rpc('delete_tournament_draw', {
    p_category_id: state.cat4Id
  });
  console.log('Attempt delete with match events -> Error:', delWithEventsErr?.message);

  // TEST 9: BRACKET ADVANCEMENT TEST
  console.log('\n>>> TEST 9: Bracket Advancement Check');
  const { data: nodesT9 } = await adminClient.from('draw_nodes').select('*').eq('draw_id', newDrawId).order('round_number', { ascending: true });
  const finalNodeT9 = nodesT9?.find(n => n.round_number === 2);
  const match0Node = nodesT9?.find(n => n.round_number === 1 && n.position === 0);
  const match1Node = nodesT9?.find(n => n.round_number === 1 && n.position === 1);

  const { data: finalMatchBefore } = await adminClient.from('matches').select('*').eq('id', finalNodeT9?.match_id).single();
  console.log('Final Match Before SF Completion:', { p_a: finalMatchBefore?.participant_a_id, p_b: finalMatchBefore?.participant_b_id, status: finalMatchBefore?.status });

  // Complete SF 1 (match0)
  const sf1 = await adminClient.from('matches').select('*').eq('id', match0Node?.match_id).single();
  await state.orgClient!.rpc('complete_match_and_advance', {
    p_match_id: sf1.data!.id,
    p_winner_id: sf1.data!.participant_a_id,
    p_status: 'COMPLETED',
    p_outcome: 'COMPLETED'
  });

  const { data: finalMatchMid } = await adminClient.from('matches').select('*').eq('id', finalNodeT9?.match_id).single();
  console.log('Final Match After SF 1 Completion:', { p_a: finalMatchMid?.participant_a_id, p_b: finalMatchMid?.participant_b_id, status: finalMatchMid?.status });

  // Complete SF 2 (match1)
  const sf2 = await adminClient.from('matches').select('*').eq('id', match1Node?.match_id).single();
  await state.orgClient!.rpc('start_match', { p_match_id: sf2.data!.id });
  await state.orgClient!.rpc('complete_match_and_advance', {
    p_match_id: sf2.data!.id,
    p_winner_id: sf2.data!.participant_b_id,
    p_status: 'COMPLETED',
    p_outcome: 'COMPLETED'
  });

  const { data: finalMatchAfter } = await adminClient.from('matches').select('*').eq('id', finalNodeT9?.match_id).single();
  console.log('Final Match After SF 2 Completion:', { p_a: finalMatchAfter?.participant_a_id, p_b: finalMatchAfter?.participant_b_id, status: finalMatchAfter?.status });

  // TEST 10: BYE TEST (3 Players)
  console.log('\n>>> TEST 10: BYE Handling Check (3 Players)');
  const { data: d3Data } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.cat3Id,
    p_format: 'KNOCKOUT',
    p_seeds: { [state.part3Ids![0]]: 1, [state.part3Ids![1]]: 2, [state.part3Ids![2]]: 3 }
  });
  console.log('3-Player Knockout Response:', d3Data);

  const { data: m3List } = await adminClient.from('matches').select('*').eq('category_id', state.cat3Id);
  const byeMatch = m3List?.find(m => m.participant_b_id === null && m.status === 'COMPLETED');
  const activeR1Match = m3List?.find(m => m.participant_b_id !== null && m.status === 'READY');
  const final3Match = m3List?.find(m => m.id !== byeMatch?.id && m.id !== activeR1Match?.id);

  console.log('BYE Match in DB:', { id: byeMatch?.id, p_a: byeMatch?.participant_a_id, p_b: byeMatch?.participant_b_id, status: byeMatch?.status, winner_id: byeMatch?.winner_id });
  console.log('Final Match in DB (Seed 1 advanced):', { id: final3Match?.id, p_a: final3Match?.participant_a_id, p_b: final3Match?.participant_b_id, status: final3Match?.status });

  const { count: byeEvents } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', byeMatch?.id);
  const { count: byeGames } = await adminClient.from('games').select('*', { count: 'exact', head: true }).eq('match_id', byeMatch?.id);
  console.log(`BYE match events: ${byeEvents}, games: ${byeGames}, court: ${byeMatch?.court_id}`);

  // TEST 11: ROUND ROBIN TEST (4 Players)
  console.log('\n>>> TEST 11: Round Robin Check (4 Players)');
  const { data: rrData } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.catRrId,
    p_format: 'ROUND_ROBIN'
  });
  console.log('Round Robin Response:', rrData);

  const { data: rrDraw } = await adminClient.from('draws').select('*').eq('id', rrData?.draw_id).single();
  const { data: rrRounds } = await adminClient.from('rounds').select('*').eq('draw_id', rrDraw!.id);
  const { data: rrMatches } = await adminClient.from('matches').select('*').eq('category_id', state.catRrId);
  const { data: rrStandings } = await adminClient.from('standings').select('*').eq('category_id', state.catRrId).single();
  const { data: rrEntries } = await adminClient.from('standings_entries').select('*').eq('standings_id', rrStandings!.id);

  let selfMatches = 0;
  const pairSet = new Set<string>();
  let duplicatePairs = 0;

  for (const m of rrMatches!) {
    if (m.participant_a_id === m.participant_b_id) selfMatches++;
    const key = [m.participant_a_id, m.participant_b_id].sort().join('-');
    if (pairSet.has(key)) duplicatePairs++;
    pairSet.add(key);
  }

  console.log(`RR Results: rounds=${rrRounds?.length}, matches=${rrMatches?.length}, standings_entries=${rrEntries?.length}, self_matches=${selfMatches}, duplicate_pairs=${duplicatePairs}`);
  console.log('Standings entries sample:', rrEntries?.map(e => ({ p_id: e.participant_id, played: e.played, won: e.won, lost: e.lost, pts_for: e.points_for })));

  // TEST 12: ROLLBACK TEST
  console.log('\n>>> TEST 12: Transaction Rollback Check');
  const rbBefore = {
    draws: (await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count,
    matches: (await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count,
    rounds: (await adminClient.from('rounds').select('*', { count: 'exact', head: true })).count,
    nodes: (await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true })).count,
    standings: (await adminClient.from('standings').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count
  };

  const { error: rbErr } = await state.orgClient!.rpc('generate_tournament_draw', {
    p_category_id: state.catRollbackId,
    p_format: 'KNOCKOUT',
    p_options: { simulate_failure: true }
  });
  console.log('Simulated failure error:', rbErr?.message);

  const rbAfter = {
    draws: (await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count,
    matches: (await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count,
    rounds: (await adminClient.from('rounds').select('*', { count: 'exact', head: true })).count,
    nodes: (await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true })).count,
    standings: (await adminClient.from('standings').select('*', { count: 'exact', head: true }).eq('category_id', state.catRollbackId)).count
  };
  console.log('BEFORE Rollback:', rbBefore);
  console.log('AFTER Rollback:', rbAfter);

  // TEST 13: RBAC / AUTHORIZATION TEST
  console.log('\n>>> TEST 13: RBAC Check');
  const { error: anonErr } = await state.anonClient!.rpc('generate_tournament_draw', {
    p_category_id: state.catConcurrencyId,
    p_format: 'KNOCKOUT'
  });
  const { error: playerErr } = await state.playerClient!.rpc('generate_tournament_draw', {
    p_category_id: state.catConcurrencyId,
    p_format: 'KNOCKOUT'
  });
  console.log('Spectator Error:', anonErr?.message);
  console.log('Player Error:', playerErr?.message);

  // TEST 14: CONCURRENCY TEST
  console.log('\n>>> TEST 14: Concurrency Check (2 Simultaneous Calls)');
  const [res1, res2] = await Promise.all([
    state.orgClient!.rpc('generate_tournament_draw', { p_category_id: state.catConcurrencyId, p_format: 'KNOCKOUT' }),
    state.orgClient!.rpc('generate_tournament_draw', { p_category_id: state.catConcurrencyId, p_format: 'KNOCKOUT' })
  ]);
  console.log('Call 1 Result:', res1.data?.idempotent, 'Call 2 Result:', res2.data?.idempotent);

  const { data: rootDraws } = await adminClient.from('draws').select('*').eq('category_id', state.catConcurrencyId).is('parent_draw_id', null);
  const { count: concMatches } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', state.catConcurrencyId);
  console.log(`Root draws for concurrency category: ${rootDraws?.length}, matches: ${concMatches}`);

  // TEST 15: INTEGRITY AUDIT QUERIES
  console.log('\n>>> TEST 15: Database Integrity Audit Queries');
  
  // A. Multiple root draws for same category
  const { data: allDraws } = await adminClient.from('draws').select('id, category_id, parent_draw_id');
  const rootDrawCounts: Record<string, number> = {};
  for (const d of allDraws || []) {
    if (d.parent_draw_id === null) {
      rootDrawCounts[d.category_id] = (rootDrawCounts[d.category_id] || 0) + 1;
    }
  }
  const multiRootViolations = Object.entries(rootDrawCounts).filter(([_, count]) => count > 1);

  // B. Orphan draw nodes (draw_id not in draws)
  const { data: allNodes } = await adminClient.from('draw_nodes').select('id, draw_id');
  const drawIds = new Set((allDraws || []).map(d => d.id));
  const orphanNodes = (allNodes || []).filter(n => !drawIds.has(n.draw_id));

  // C. Orphan rounds (draw_id not in draws)
  const { data: allRounds } = await adminClient.from('rounds').select('id, draw_id');
  const orphanRounds = (allRounds || []).filter(r => !drawIds.has(r.draw_id));

  // D. Orphan matches (category_id not in categories)
  const { data: allCats } = await adminClient.from('categories').select('id');
  const catIds = new Set((allCats || []).map(c => c.id));
  const { data: allMatches } = await adminClient.from('matches').select('id, category_id, status, participant_a_id, participant_b_id');
  const orphanMatches = (allMatches || []).filter(m => !catIds.has(m.category_id));

  // G. BYE matches with games or events
  const { data: byeMatchesWithEvents } = await adminClient.from('matches').select('id, participant_a_id, participant_b_id').or('participant_a_id.is.null,participant_b_id.is.null').eq('status', 'COMPLETED');
  const invalidByes: any[] = [];
  for (const bm of byeMatchesWithEvents || []) {
    const { count: evCnt } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', bm.id);
    const { count: gmCnt } = await adminClient.from('games').select('*', { count: 'exact', head: true }).eq('match_id', bm.id);
    if ((evCnt && evCnt > 0) || (gmCnt && gmCnt > 0)) {
      invalidByes.push({ matchId: bm.id, events: evCnt, games: gmCnt });
    }
  }

  console.log('Integrity Audit Results:');
  console.log(`- Multiple root draws per category: ${multiRootViolations.length}`);
  console.log(`- Orphan draw nodes: ${orphanNodes.length}`);
  console.log(`- Orphan rounds: ${orphanRounds.length}`);
  console.log(`- Orphan matches: ${orphanMatches.length}`);
  console.log(`- BYE matches with fake games/events: ${invalidByes.length}`);
  console.log(`- Duplicate RR fixtures: ${duplicatePairs}`);
  console.log(`- Self-match RR fixtures: ${selfMatches}`);

  console.log('\n==================================================');
  console.log('ACCEPTANCE SUITE COMPLETE');
  console.log('==================================================\n');
}

runAcceptanceTests().catch(err => {
  console.error('Acceptance Test Failure:', err);
  process.exit(1);
});
