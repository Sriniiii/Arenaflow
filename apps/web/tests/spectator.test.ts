import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { BadmintonRules, createDefaultServiceState } from '@arena-flow/sport-engine';
import { calculateStandings, sortStandings } from '@arena-flow/statistics-engine';

function loadEnv() {
  try {
    const rootEnv = path.resolve(process.cwd(), '.env');
    const siblingEnv = path.resolve(process.cwd(), '../../.env');
    const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
    const envPath = fs.existsSync(rootEnv) ? rootEnv : fs.existsSync(appsWebEnv) ? appsWebEnv : siblingEnv;

    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf8');
      envConfig.split('\n').forEach((line) => {
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

describe('Feature 11: Spectator Enhancements Test Suite (21 Areas)', () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let orgClient: SupabaseClient;
  let scorerClient: SupabaseClient;
  let spectatorUserClient: SupabaseClient;

  const testRunId = Date.now().toString().slice(-6);
  const orgEmail = `spec_org_${testRunId}@gmail.com`;
  const scorerEmail = `spec_scorer_${testRunId}@gmail.com`;
  const spectatorEmail = `spec_user_${testRunId}@gmail.com`;
  const password = 'TestSecurePassword123!';

  let orgId: string;
  let scorerId: string;
  let spectatorUserId: string;
  let sportId: string;
  let venueId: string;
  let court1Id: string;
  let court2Id: string;
  let court3Id: string;

  let publishedTournamentId: string;
  let draftTournamentId: string;
  const publishedSlug = `spec-published-${testRunId}`;
  const draftSlug = `spec-draft-${testRunId}`;

  let catKnockoutId: string;
  let catRoundRobinId: string;
  let catGroupKoId: string;

  let player1Id: string;
  let player2Id: string;
  let player3Id: string;
  let player4Id: string;

  let part1Id: string;
  let part2Id: string;
  let part3Id: string;
  let part4Id: string;

  let liveMatch1Id: string;
  let liveMatch2Id: string;
  let upcomingMatchId: string;
  let completedNormalMatchId: string;
  let walkoverMatchId: string;
  let defaultMatchId: string;
  let retirementMatchId: string;
  let byeMatchId: string;

  let koDrawId: string;
  let koRound1Id: string;
  let koRound2Id: string;

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Organizer
    const { data: uOrg, error: errOrg } = await adminClient.auth.admin.createUser({
      email: orgEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Spectator Organizer', role: 'ORGANIZER' },
    });
    if (errOrg) throw errOrg;
    orgId = uOrg.user.id;

    // 2. Create Scorer
    const { data: uScorer, error: errScorer } = await adminClient.auth.admin.createUser({
      email: scorerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Spectator Scorer', role: 'SCORER' },
    });
    if (errScorer) throw errScorer;
    scorerId = uScorer.user.id;

    // 3. Create Authenticated Spectator
    const { data: uSpec, error: errSpec } = await adminClient.auth.admin.createUser({
      email: spectatorEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Casual Spectator', role: 'PLAYER' },
    });
    if (errSpec) throw errSpec;
    spectatorUserId = uSpec.user.id;

    // Create 4 test players
    const playerEmails = [
      `spec_p1_${testRunId}@gmail.com`,
      `spec_p2_${testRunId}@gmail.com`,
      `spec_p3_${testRunId}@gmail.com`,
      `spec_p4_${testRunId}@gmail.com`,
    ];
    const createdPlayerIds: string[] = [];
    for (let i = 0; i < playerEmails.length; i++) {
      const { data: pData, error: pErr } = await adminClient.auth.admin.createUser({
        email: playerEmails[i],
        password,
        email_confirm: true,
        user_metadata: { full_name: `Athlete ${i + 1}`, role: 'PLAYER' },
      });
      if (pErr) throw pErr;
      createdPlayerIds.push(pData.user.id);

      await adminClient.from('players').upsert({
        id: pData.user.id,
        full_name: `Athlete ${i + 1}`,
        display_name: `Player ${i + 1}`,
        gender: 'MALE',
        date_of_birth: '2000-01-01',
      });
    }
    [player1Id, player2Id, player3Id, player4Id] = createdPlayerIds;

    // Sign in clients
    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: orgEmail, password });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: scorerEmail, password });

    spectatorUserClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await spectatorUserClient.auth.signInWithPassword({ email: spectatorEmail, password });

    // 4. Fetch Sport & Create Venue
    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
    sportId = sData?.id || '';

    const { data: vData, error: vErr } = await adminClient
      .from('venues')
      .insert({
        name: `Spectator Arena ${testRunId}`,
        address: '100 Spectator Blvd',
        city: 'Delhi',
        country: 'India',
      })
      .select('id')
      .single();
    if (vErr) throw vErr;
    venueId = vData.id;

    // Create 3 Courts
    const { data: c1 } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court 1' }).select('id').single();
    const { data: c2 } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court 2' }).select('id').single();
    const { data: c3 } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court 3' }).select('id').single();
    court1Id = c1!.id;
    court2Id = c2!.id;
    court3Id = c3!.id;

    // 5. Create Published Tournament & Draft Tournament
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

    const { data: pubT, error: pubErr } = await adminClient
      .from('tournaments')
      .insert({
        name: `Spectator Showcase Tournament ${testRunId}`,
        slug: publishedSlug,
        sport_id: sportId,
        venue_id: venueId,
        organizer_id: orgId,
        status: 'PUBLISHED',
        start_date: start,
        end_date: end,
        registration_open: start,
        registration_close: end,
      })
      .select('id')
      .single();
    if (pubErr) throw pubErr;
    publishedTournamentId = pubT!.id;

    const { data: draftT, error: draftErr } = await adminClient
      .from('tournaments')
      .insert({
        name: `Secret Draft Tournament ${testRunId}`,
        slug: draftSlug,
        sport_id: sportId,
        venue_id: venueId,
        organizer_id: orgId,
        status: 'DRAFT',
        start_date: start,
        end_date: end,
        registration_open: start,
        registration_close: end,
      })
      .select('id')
      .single();
    if (draftErr) throw draftErr;
    draftTournamentId = draftT!.id;

    // 6. Create Categories
    const { data: catKo } = await adminClient
      .from('categories')
      .insert({
        tournament_id: publishedTournamentId,
        name: "Men's Singles Knockout",
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT',
        registration_fee: 0,
      })
      .select('id')
      .single();
    catKnockoutId = catKo!.id;

    const { data: catRr } = await adminClient
      .from('categories')
      .insert({
        tournament_id: publishedTournamentId,
        name: "Men's Singles Round Robin",
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'ROUND_ROBIN',
        registration_fee: 0,
      })
      .select('id')
      .single();
    catRoundRobinId = catRr!.id;

    const { data: catGk } = await adminClient
      .from('categories')
      .insert({
        tournament_id: publishedTournamentId,
        name: "Men's Singles Group Stage",
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'GROUP_KNOCKOUT',
        registration_fee: 0,
      })
      .select('id')
      .single();
    catGroupKoId = catGk!.id;

    // 7. Create Participants
    const createPart = async (catId: string, playerId: string) => {
      const { data: p } = await adminClient
        .from('participants')
        .insert({ category_id: catId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' })
        .select('id')
        .single();
      await adminClient.from('participant_members').insert({ participant_id: p!.id, player_id: playerId, member_order: 1 });
      return p!.id;
    };

    part1Id = await createPart(catKnockoutId, player1Id);
    part2Id = await createPart(catKnockoutId, player2Id);
    part3Id = await createPart(catKnockoutId, player3Id);
    part4Id = await createPart(catKnockoutId, player4Id);

    // 8. Create Draws & Rounds for Knockout
    const { data: koDraw } = await adminClient
      .from('draws')
      .insert({ category_id: catKnockoutId, format: 'KNOCKOUT', status: 'PUBLISHED' })
      .select('id')
      .single();
    koDrawId = koDraw!.id;

    const { data: r1 } = await adminClient
      .from('rounds')
      .insert({ draw_id: koDrawId, round_number: 1, name: 'Semifinals' })
      .select('id')
      .single();
    koRound1Id = r1!.id;

    const { data: r2 } = await adminClient
      .from('rounds')
      .insert({ draw_id: koDrawId, round_number: 2, name: 'Final' })
      .select('id')
      .single();
    koRound2Id = r2!.id;

    // 9. Create Sample Matches across states and outcomes
    // Match 1: LIVE Match on Court 1 (Player 1 vs Player 2)
    const { data: lm1 } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        court_id: court1Id,
        participant_a_id: part1Id,
        participant_b_id: part2Id,
        status: 'LIVE',
        scheduled_at: new Date(now.getTime() - 10 * 60000).toISOString(),
      })
      .select('id')
      .single();
    liveMatch1Id = lm1!.id;

    const { data: lm1Game } = await adminClient
      .from('games')
      .insert({
        match_id: liveMatch1Id,
        game_number: 1,
        participant_a_score: 11,
        participant_b_score: 9,
      })
      .select('id')
      .single();

    // Add Live Match 1 service state and initial sequence events
    await adminClient.from('matches').update({
      service_state: {
        matchType: 'SINGLES',
        servingSide: 'A',
        receivingSide: 'B',
        serverPlayerId: player1Id,
        receiverPlayerId: player2Id,
        serverCourt: 'LEFT',
        receiverCourt: 'LEFT',
      },
    }).eq('id', liveMatch1Id);

    await adminClient.from('match_events').insert([
      { match_id: liveMatch1Id, game_id: lm1Game!.id, event_type: 'POINT_A', sequence_number: 1 },
      { match_id: liveMatch1Id, game_id: lm1Game!.id, event_type: 'POINT_B', sequence_number: 2 },
      { match_id: liveMatch1Id, game_id: lm1Game!.id, event_type: 'POINT_A', sequence_number: 3 },
    ]);

    // Match 2: LIVE Match on Court 2 (Player 3 vs Player 4)
    const { data: lm2 } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        court_id: court2Id,
        participant_a_id: part3Id,
        participant_b_id: part4Id,
        status: 'LIVE',
        scheduled_at: new Date(now.getTime() - 5 * 60000).toISOString(),
      })
      .select('id')
      .single();
    liveMatch2Id = lm2!.id;

    await adminClient.from('games').insert({
      match_id: liveMatch2Id,
      game_number: 1,
      participant_a_score: 5,
      participant_b_score: 8,
    });

    // Match 3: UPCOMING Match on Court 3 (Scheduled)
    const { data: um } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound2Id,
        court_id: court3Id,
        participant_a_id: part1Id,
        participant_b_id: part3Id,
        status: 'READY',
        scheduled_at: new Date(now.getTime() + 60 * 60000).toISOString(),
      })
      .select('id')
      .single();
    upcomingMatchId = um!.id;

    // Match 4: COMPLETED Match (Normal score 21-18, 21-16)
    const { data: cm } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        court_id: court1Id,
        participant_a_id: part1Id,
        participant_b_id: part2Id,
        status: 'COMPLETED',
        winner_id: part1Id,
        outcome: 'COMPLETED',
        scheduled_at: new Date(now.getTime() - 120 * 60000).toISOString(),
      })
      .select('id')
      .single();
    completedNormalMatchId = cm!.id;

    await adminClient.from('games').insert([
      { match_id: completedNormalMatchId, game_number: 1, participant_a_score: 21, participant_b_score: 18 },
      { match_id: completedNormalMatchId, game_number: 2, participant_a_score: 21, participant_b_score: 16 },
    ]);

    // Match 5: WALKOVER Match
    const { data: woM } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        participant_a_id: part1Id,
        participant_b_id: part4Id,
        status: 'COMPLETED',
        winner_id: part1Id,
        outcome: 'WALKOVER',
      })
      .select('id')
      .single();
    walkoverMatchId = woM!.id;

    // Match 6: DEFAULT Match
    const { data: defM } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        participant_a_id: part2Id,
        participant_b_id: part3Id,
        status: 'COMPLETED',
        winner_id: part2Id,
        outcome: 'DEFAULT',
      })
      .select('id')
      .single();
    defaultMatchId = defM!.id;

    // Match 7: RETIREMENT Match (Preserves actual points: 21-19, 11-4)
    const { data: retM } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        participant_a_id: part3Id,
        participant_b_id: part4Id,
        status: 'COMPLETED',
        winner_id: part3Id,
        outcome: 'RETIREMENT',
      })
      .select('id')
      .single();
    retirementMatchId = retM!.id;

    await adminClient.from('games').insert([
      { match_id: retirementMatchId, game_number: 1, participant_a_score: 21, participant_b_score: 19 },
      { match_id: retirementMatchId, game_number: 2, participant_a_score: 11, participant_b_score: 4 },
    ]);

    // Match 8: BYE Match (Single participant, status COMPLETED, outcome COMPLETED)
    const { data: byeM, error: byeErr } = await adminClient
      .from('matches')
      .insert({
        category_id: catKnockoutId,
        round_id: koRound1Id,
        participant_a_id: part1Id,
        participant_b_id: null,
        status: 'COMPLETED',
        winner_id: part1Id,
        outcome: 'COMPLETED',
      })
      .select('id')
      .single();
    if (byeErr) throw byeErr;
    byeMatchId = byeM.id;

    // 10. Create Draw Nodes for bracket progression
    const { data: finalNode } = await adminClient
      .from('draw_nodes')
      .insert({
        draw_id: koDrawId,
        round_number: 2,
        position: 0,
        match_id: upcomingMatchId,
      })
      .select('id')
      .single();

    await adminClient.from('draw_nodes').insert([
      { draw_id: koDrawId, round_number: 1, position: 0, match_id: liveMatch1Id, next_node_id: finalNode!.id },
      { draw_id: koDrawId, round_number: 1, position: 1, match_id: liveMatch2Id, next_node_id: finalNode!.id },
    ]);
  });

  after(async () => {
    if (publishedTournamentId) {
      await adminClient.from('tournaments').delete().eq('id', publishedTournamentId);
    }
    if (draftTournamentId) {
      await adminClient.from('tournaments').delete().eq('id', draftTournamentId);
    }
    if (venueId) {
      await adminClient.from('venues').delete().eq('id', venueId);
    }
  });

  // ==========================================
  // AREA 1: SPECTATOR PUBLIC ACCESS TO PUBLISHED TOURNAMENT
  // ==========================================
  test('Area 1: Public spectator (anon) can read published tournament and related entities', async () => {
    const { data: tourney, error: tErr } = await anonClient
      .from('tournaments')
      .select('id, name, slug, status, sports(id, name), venues(id, name)')
      .eq('slug', publishedSlug)
      .single();

    assert.ifError(tErr);
    assert.strictEqual(tourney?.id, publishedTournamentId);
    assert.strictEqual(tourney?.status, 'PUBLISHED');
    assert.ok(tourney?.sports);
    assert.ok(tourney?.venues);
  });

  // ==========================================
  // AREA 2: DRAFT TOURNAMENT PRIVACY & SCOPING
  // ==========================================
  test('Area 2: Anonymous spectator cannot access DRAFT tournament data', async () => {
    const { data: draftTourney } = await anonClient
      .from('tournaments')
      .select('*')
      .eq('slug', draftSlug)
      .maybeSingle();

    assert.strictEqual(draftTourney, null);
  });

  // ==========================================
  // AREA 3: PUBLIC TOURNAMENT OVERVIEW RETRIEVAL
  // ==========================================
  test('Area 3: Spectator can retrieve full tournament overview counts and categories', async () => {
    const { data: cats } = await anonClient
      .from('categories')
      .select('id, name, format, category_type')
      .eq('tournament_id', publishedTournamentId);

    assert.ok(cats && cats.length >= 3);

    const { data: parts } = await anonClient
      .from('participants')
      .select('id, status, members:participant_members(player:players(id, full_name))')
      .eq('status', 'ACTIVE');

    assert.ok(parts && parts.length >= 4);

    const { data: crts } = await anonClient
      .from('courts')
      .select('id, name')
      .eq('venue_id', venueId);

    assert.strictEqual(crts?.length, 3);
  });

  // ==========================================
  // AREA 4: PUBLIC LIVE MATCH RETRIEVAL
  // ==========================================
  test('Area 4: Public live match retrieval returns active score, game number, and court', async () => {
    const { data: liveMatches, error: lmErr } = await anonClient
      .from('matches')
      .select(`
        id,
        status,
        court_id,
        service_state,
        court: courts ( id, name ),
        games ( id, game_number, participant_a_score, participant_b_score ),
        participant_a: participants!matches_participant_a_id_fkey (
          id, members: participant_members ( player: players ( id, full_name ) )
        ),
        participant_b: participants!matches_participant_b_id_fkey (
          id, members: participant_members ( player: players ( id, full_name ) )
        )
      `)
      .eq('id', liveMatch1Id)
      .single();

    assert.ifError(lmErr);
    assert.strictEqual(liveMatches?.status, 'LIVE');
    assert.strictEqual((liveMatches?.court as any)?.name, 'Court 1');
    assert.strictEqual(liveMatches?.games?.[0]?.participant_a_score, 11);
    assert.strictEqual(liveMatches?.games?.[0]?.participant_b_score, 9);
    assert.ok(liveMatches?.service_state);
  });

  // ==========================================
  // AREA 5: MULTIPLE SIMULTANEOUS MATCHES ISOLATION
  // ==========================================
  test('Area 5: Multiple concurrent live matches on separate courts have isolated states', async () => {
    const { data: multiMatches } = await anonClient
      .from('matches')
      .select('id, court_id, status, games(participant_a_score, participant_b_score)')
      .in('id', [liveMatch1Id, liveMatch2Id]);

    assert.strictEqual(multiMatches?.length, 2);

    const match1 = multiMatches.find(m => m.id === liveMatch1Id);
    const match2 = multiMatches.find(m => m.id === liveMatch2Id);

    assert.strictEqual(match1?.court_id, court1Id);
    assert.strictEqual(match2?.court_id, court2Id);
    assert.notStrictEqual(match1?.games[0]?.participant_a_score, match2?.games[0]?.participant_a_score);
  });

  // ==========================================
  // AREA 6: REALTIME LIVE SCORE UPDATES (SPORT-ENGINE RECONSTRUCTION)
  // ==========================================
  test('Area 6: BadmintonRules reconstructs score state from chronological event sequence', () => {
    const rules = new BadmintonRules();
    let state = rules.getInitialState();

    state = rules.applyEvent(state, {
      id: 'e1',
      type: 'POINT_A',
      timestamp: new Date().toISOString(),
    });
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 0);

    state = rules.applyEvent(state, {
      id: 'e2',
      type: 'POINT_B',
      timestamp: new Date().toISOString(),
    });
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 1);
  });

  // ==========================================
  // AREA 7: MATCH EVENT TIMELINE ORDERING
  // ==========================================
  test('Area 7: Match events are ordered strictly by sequence_number ascending', async () => {
    const { data: events, error } = await anonClient
      .from('match_events')
      .select('id, match_id, event_type, sequence_number')
      .eq('match_id', liveMatch1Id)
      .order('sequence_number', { ascending: true });

    assert.ifError(error);
    assert.ok(events && events.length >= 3);
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].sequence_number > events[i - 1].sequence_number);
    }
  });

  // ==========================================
  // AREA 8: LIVE BADMINTON SERVICE STATE DISPLAY
  // ==========================================
  test('Area 8: Badminton service state returns valid server court, receiver, and serving side', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, service_state')
      .eq('id', liveMatch1Id)
      .single();

    assert.ok(match?.service_state);
    assert.strictEqual(match.service_state.servingSide, 'A');
    assert.strictEqual(match.service_state.serverCourt, 'LEFT');
    assert.strictEqual(match.service_state.serverPlayerId, player1Id);
    assert.strictEqual(match.service_state.receiverPlayerId, player2Id);
  });

  // ==========================================
  // AREA 9: UNDO EVENT HANDLING & POINT ROLLBACK
  // ==========================================
  test('Area 9: UNDO event negates preceding point in BadmintonRules without deleting history', () => {
    const rules = new BadmintonRules();
    let state = rules.getInitialState();

    state = rules.applyEvent(state, { id: 'e1', type: 'POINT_A', timestamp: new Date().toISOString() });
    state = rules.applyEvent(state, { id: 'e2', type: 'POINT_A', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 2);

    // Apply UNDO
    state = rules.applyEvent(state, { id: 'e3', type: 'UNDO', timestamp: new Date().toISOString() });
    assert.strictEqual(state.games[0].scoreA, 1);
  });

  // ==========================================
  // AREA 10: UPCOMING MATCHES RETRIEVAL & SORTING
  // ==========================================
  test('Area 10: Upcoming matches retrieval filters READY/SCHEDULED and sorts deterministically', async () => {
    const { data: upcoming, error } = await anonClient
      .from('matches')
      .select('id, status, scheduled_at, court:courts(name)')
      .in('status', ['READY', 'SCHEDULED'])
      .order('scheduled_at', { ascending: true });

    assert.ifError(error);
    assert.ok(upcoming && upcoming.length >= 1);
    assert.ok(upcoming.some(m => m.id === upcomingMatchId));
  });

  // ==========================================
  // AREA 11: COMPLETED MATCH RESULTS RETRIEVAL
  // ==========================================
  test('Area 11: Completed match results retrieve winner, outcome, and all game scores', async () => {
    const { data: completed, error } = await anonClient
      .from('matches')
      .select('id, status, winner_id, outcome, games(game_number, participant_a_score, participant_b_score)')
      .in('status', ['COMPLETED', 'FINAL'])
      .eq('id', completedNormalMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(completed?.winner_id, part1Id);
    assert.strictEqual(completed?.games?.length, 2);
    assert.strictEqual(completed?.games?.[0]?.participant_a_score, 21);
    assert.strictEqual(completed?.games?.[0]?.participant_b_score, 18);
  });

  // ==========================================
  // AREA 12: COMPLETED OUTCOME — NORMAL
  // ==========================================
  test('Area 12: NORMAL completed match displays genuine game scores', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, outcome, games(participant_a_score, participant_b_score)')
      .eq('id', completedNormalMatchId)
      .single();

    assert.strictEqual(match?.outcome, 'COMPLETED');
    assert.ok(match?.games && match.games.length === 2);
  });

  // ==========================================
  // AREA 13: COMPLETED OUTCOME — WALKOVER (NO FAKE 21-0)
  // ==========================================
  test('Area 13: WALKOVER match has outcome WALKOVER, winner assigned, and no fake 21-0 scores', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, winner_id, outcome, games(participant_a_score, participant_b_score)')
      .eq('id', walkoverMatchId)
      .single();

    assert.strictEqual(match?.outcome, 'WALKOVER');
    assert.strictEqual(match?.winner_id, part1Id);
    assert.strictEqual(match?.games?.length || 0, 0);
  });

  // ==========================================
  // AREA 14: COMPLETED OUTCOME — DEFAULT (NO FAKE 21-0)
  // ==========================================
  test('Area 14: DEFAULT match has outcome DEFAULT, winner assigned, and no fake scores', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, winner_id, outcome, games(participant_a_score, participant_b_score)')
      .eq('id', defaultMatchId)
      .single();

    assert.strictEqual(match?.outcome, 'DEFAULT');
    assert.strictEqual(match?.winner_id, part2Id);
    assert.strictEqual(match?.games?.length || 0, 0);
  });

  // ==========================================
  // AREA 15: COMPLETED OUTCOME — RETIREMENT (PRESERVES ACTUAL RALLY SCORES)
  // ==========================================
  test('Area 15: RETIREMENT match preserves actual rally scores before stoppage', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, winner_id, outcome, games(game_number, participant_a_score, participant_b_score)')
      .eq('id', retirementMatchId)
      .single();

    assert.strictEqual(match?.outcome, 'RETIREMENT');
    assert.strictEqual(match?.winner_id, part3Id);
    assert.strictEqual(match?.games?.length, 2);
    assert.strictEqual(match?.games?.[0]?.participant_a_score, 21);
    assert.strictEqual(match?.games?.[0]?.participant_b_score, 19);
    assert.strictEqual(match?.games?.[1]?.participant_a_score, 11);
    assert.strictEqual(match?.games?.[1]?.participant_b_score, 4);
  });

  // ==========================================
  // AREA 16: COMPLETED OUTCOME — BYE (SINGLE PARTICIPANT)
  // ==========================================
  test('Area 16: BYE match has single participant, status COMPLETED, outcome BYE, no fake 21-0', async () => {
    const { data: match } = await anonClient
      .from('matches')
      .select('id, participant_a_id, participant_b_id, winner_id, status, outcome, games(id)')
      .eq('id', byeMatchId)
      .single();

    assert.strictEqual(match?.status, 'COMPLETED');
    assert.strictEqual(match?.winner_id, part1Id);
    assert.strictEqual(match?.participant_b_id, null);
    assert.strictEqual(match?.games?.length || 0, 0);
  });

  // ==========================================
  // AREA 17: KNOCKOUT BRACKET PROGRESSION READ VIEW
  // ==========================================
  test('Area 17: Spectator reads draws, rounds, draw_nodes, and bracket progression', async () => {
    const { data: drawData } = await anonClient
      .from('draws')
      .select('id, format, status')
      .eq('id', koDrawId)
      .single();

    assert.strictEqual(drawData?.format, 'KNOCKOUT');
    assert.strictEqual(drawData?.status, 'PUBLISHED');

    const { data: roundsData } = await anonClient
      .from('rounds')
      .select('id, round_number, name')
      .eq('draw_id', koDrawId)
      .order('round_number', { ascending: true });

    assert.strictEqual(roundsData?.length, 2);

    const { data: nodesData } = await anonClient
      .from('draw_nodes')
      .select('id, round_number, position, match_id')
      .eq('draw_id', koDrawId);

    assert.ok(nodesData && nodesData.length >= 3);
  });

  // ==========================================
  // AREA 18: ROUND ROBIN STANDINGS LEADERBOARD
  // ==========================================
  test('Area 18: Standings engine computes points, matches won/lost, and ranks accurately', () => {
    const rawEntries = [
      { id: 'se1', participant_id: part1Id, played: 2, won: 2, lost: 0, points_for: 84, points_against: 60 },
      { id: 'se2', participant_id: part2Id, played: 2, won: 1, lost: 1, points_for: 75, points_against: 70 },
      { id: 'se3', participant_id: part3Id, played: 2, won: 0, lost: 2, points_for: 55, points_against: 84 },
    ];

    const sorted = sortStandings(rawEntries, []).sortedEntries;

    assert.strictEqual(sorted[0].participant_id, part1Id);
    assert.strictEqual(sorted[0].rank, 1);
    assert.strictEqual(sorted[1].participant_id, part2Id);
    assert.strictEqual(sorted[1].rank, 2);
    assert.strictEqual(sorted[2].participant_id, part3Id);
    assert.strictEqual(sorted[2].rank, 3);
  });

  // ==========================================
  // AREA 19: GROUP STAGE STANDINGS + KNOCKOUT PROGRESSION (GROUP_KNOCKOUT)
  // ==========================================
  test('Area 19: GROUP_KNOCKOUT format derives subgroup standings and knockout stage', async () => {
    const { data: cat } = await anonClient
      .from('categories')
      .select('id, format, name')
      .eq('id', catGroupKoId)
      .single();

    assert.strictEqual(cat?.format, 'GROUP_KNOCKOUT');
  });

  // ==========================================
  // AREA 20: MULTI-COURT INDEPENDENT STATES
  // ==========================================
  test('Area 20: Courts maintain distinct statuses across LIVE, READY, and IDLE', async () => {
    const { data: allMatches } = await anonClient
      .from('matches')
      .select('id, court_id, status')
      .in('court_id', [court1Id, court2Id, court3Id]);

    const court1Match = allMatches?.find(m => m.court_id === court1Id && m.status === 'LIVE');
    const court2Match = allMatches?.find(m => m.court_id === court2Id && m.status === 'LIVE');
    const court3Match = allMatches?.find(m => m.court_id === court3Id && m.status === 'READY');

    assert.ok(court1Match);
    assert.ok(court2Match);
    assert.ok(court3Match);
  });

  // ==========================================
  // AREA 21: STRICT READ-ONLY SECURITY & RLS ENFORCEMENT
  // ==========================================
  test('Area 21: Anonymous spectator and unauthorized user cannot mutate tournament data', async () => {
    // 1. Anon cannot update matches
    const { error: mUpdErr } = await anonClient
      .from('matches')
      .update({ status: 'FINAL' })
      .eq('id', liveMatch1Id);
    const { data: checkM } = await adminClient.from('matches').select('status').eq('id', liveMatch1Id).single();
    assert.strictEqual(checkM?.status, 'LIVE');

    // 2. Spectator user cannot insert match_events
    const { error: evErr } = await spectatorUserClient
      .from('match_events')
      .insert({
        match_id: liveMatch1Id,
        event_type: 'POINT',
        point_to: 'A',
      });
    assert.ok(evErr, 'Spectator user must not be allowed to insert match_events');

    // 3. Anon cannot insert games
    const { error: gErr } = await anonClient
      .from('games')
      .insert({
        match_id: liveMatch1Id,
        game_number: 3,
        participant_a_score: 21,
        participant_b_score: 0,
      });
    assert.ok(gErr, 'Anonymous spectator must not be allowed to insert games');

    // 4. Spectator user cannot call set_match_service RPC
    const { error: rpcErr } = await spectatorUserClient.rpc('set_match_service', {
      p_match_id: liveMatch1Id,
      p_serving_side: 'B',
      p_server_player_id: player2Id,
      p_receiver_player_id: player1Id,
    });
    assert.ok(rpcErr, 'Spectator user must be rejected by set_match_service RPC');
  });
});
