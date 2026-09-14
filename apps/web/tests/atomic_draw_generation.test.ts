import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

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

describe('Atomic Draw Generation & Integrity Integration Suite', () => {
  const adminClient: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const testRunId = Date.now().toString().slice(-6);

  let orgClient: SupabaseClient;
  let playerClient: SupabaseClient;
  let anonClient: SupabaseClient;

  let sportId: string;
  let venueId: string;
  let tournamentId: string;

  // Categories
  let catKo4Id: string;
  let catKo8Id: string;
  let catKo3Id: string;
  let catKo5Id: string;
  let catRr4Id: string;
  let catRr5Id: string;
  let catRegenId: string;
  let catRollbackId: string;
  let catConcurrencyId: string;

  const userIds: Record<string, string> = {};
  const playerIds: string[] = [];
  const partMap: Record<string, string[]> = {};

  before(async () => {
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Create Auth Users (1 Org, 10 Players)
    const roles = ['org', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
    for (const r of roles) {
      const email = `draw_${r}_${testRunId}@example.com`;
      const { data: uData, error: uErr } = await adminClient.auth.admin.createUser({
        email,
        password: 'TestSecurePassword123!',
        email_confirm: true,
        user_metadata: { role: r === 'org' ? 'ORGANIZER' : 'PLAYER' }
      });
      if (uErr) throw uErr;
      userIds[r] = uData.user.id;
    }

    // Sign in clients
    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: `draw_org_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await playerClient.auth.signInWithPassword({ email: `draw_p1_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

    // 2. Fetch or Create Sport & Venue
    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
    if (sData) {
      sportId = sData.id;
    } else {
      const { data: newSport } = await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${testRunId}` }).select('id').single();
      sportId = newSport!.id;
    }

    const { data: vData } = await adminClient.from('venues').insert({
      name: `Draw Test Arena ${testRunId}`,
      owner_id: userIds.org
    }).select('id').single();
    venueId = vData!.id;

    // 3. Create Tournament
    const { data: tData } = await adminClient.from('tournaments').insert({
      name: `Atomic Draw Championship ${testRunId}`,
      slug: `atomic-draw-championship-${testRunId}`,
      sport_id: sportId,
      venue_id: venueId,
      organizer_id: userIds.org,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 86400000 * 7).toISOString(),
      registration_open: new Date(Date.now() - 86400000).toISOString(),
      registration_close: new Date(Date.now() + 86400000).toISOString(),
      status: 'PUBLISHED'
    }).select('id').single();
    tournamentId = tData!.id;

    // 4. Create Players in public.players
    for (let i = 1; i <= 10; i++) {
      const uid = userIds[`p${i}`];
      const { data: pl } = await adminClient.from('players').select('id').eq('user_id', uid).maybeSingle();
      if (pl) {
        playerIds.push(pl.id);
      } else {
        const { data: newPl } = await adminClient.from('players').insert({
          user_id: uid,
          full_name: `Athlete ${i}`,
          gender: 'MALE',
          date_of_birth: '2000-01-01'
        }).select('id').single();
        playerIds.push(newPl!.id);
      }
    }

    // Helper to create category with N participants
    async function setupCategory(name: string, count: number, format: 'KNOCKOUT' | 'ROUND_ROBIN' = 'KNOCKOUT') {
      const { data: cat } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: `${name} ${testRunId}`,
        category_type: 'SINGLES',
        match_type: 'MENS',
        format
      }).select('id').single();

      const catId = cat!.id;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const { data: part } = await adminClient.from('participants').insert({
          category_id: catId,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select('id').single();
        parts.push(part!.id);

        await adminClient.from('participant_members').insert({
          participant_id: part!.id,
          player_id: playerIds[i],
          member_order: 1
        });
      }
      partMap[catId] = parts;
      return catId;
    }

    catKo4Id = await setupCategory('Knockout 4', 4, 'KNOCKOUT');
    catKo8Id = await setupCategory('Knockout 8', 8, 'KNOCKOUT');
    catKo3Id = await setupCategory('Knockout 3', 3, 'KNOCKOUT');
    catKo5Id = await setupCategory('Knockout 5', 5, 'KNOCKOUT');
    catRr4Id = await setupCategory('Round Robin 4', 4, 'ROUND_ROBIN');
    catRr5Id = await setupCategory('Round Robin 5', 5, 'ROUND_ROBIN');
    catRegenId = await setupCategory('Regen Protected', 4, 'KNOCKOUT');
    catRollbackId = await setupCategory('Rollback Category', 4, 'KNOCKOUT');
    catConcurrencyId = await setupCategory('Concurrency Category', 4, 'KNOCKOUT');
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
  // 1. Authorization & Format Validation
  // ---------------------------------------------------------------------------
  test('1. Unauthorized spectator cannot generate draw', async () => {
    const { error } = await anonClient.rpc('generate_tournament_draw', {
      p_category_id: catKo4Id,
      p_format: 'KNOCKOUT'
    });
    assert.ok(error, 'Spectator must be rejected');
  });

  test('2. Unauthorized player cannot generate draw', async () => {
    const { error } = await playerClient.rpc('generate_tournament_draw', {
      p_category_id: catKo4Id,
      p_format: 'KNOCKOUT'
    });
    assert.ok(error, 'Player must be rejected');
  });

  test('3. Rejects unsupported GROUP_KNOCKOUT format', async () => {
    const { error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catKo4Id,
      p_format: 'GROUP_KNOCKOUT'
    });
    assert.ok(error, 'GROUP_KNOCKOUT must be rejected');
    assert.match(error.message, /GROUP_KNOCKOUT.*not currently supported/i);
  });

  // ---------------------------------------------------------------------------
  // 2. Rollback Verification (Real Database Failure Simulation)
  // ---------------------------------------------------------------------------
  test('4. Rollback on Failure: Simulated error leaves zero orphan rows in database', async () => {
    // Before state
    const { count: drawsBefore } = await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', catRollbackId);
    const { count: roundsBefore } = await adminClient.from('rounds').select('*', { count: 'exact', head: true });
    const { count: matchesBefore } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', catRollbackId);
    const { count: nodesBefore } = await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true });

    assert.strictEqual(drawsBefore, 0);
    assert.strictEqual(matchesBefore, 0);

    // Call RPC with simulate_failure = true
    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catRollbackId,
      p_format: 'KNOCKOUT',
      p_options: { simulate_failure: true }
    });

    assert.ok(error, 'Simulation must raise exception');
    assert.match(error.message, /Simulated transaction failure/i);

    // After state: verify strict rollback to 0
    const { count: drawsAfter } = await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', catRollbackId);
    const { count: matchesAfter } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', catRollbackId);
    const { count: roundsAfter } = await adminClient.from('rounds').select('*', { count: 'exact', head: true });
    const { count: nodesAfter } = await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true });

    assert.strictEqual(drawsAfter, 0, 'Draws count must be 0 after rollback');
    assert.strictEqual(matchesAfter, 0, 'Matches count must be 0 after rollback');
    assert.strictEqual(roundsAfter, roundsBefore, 'Rounds must remain unchanged after rollback');
    assert.strictEqual(nodesAfter, nodesBefore, 'Draw nodes must remain unchanged after rollback');
  });

  // ---------------------------------------------------------------------------
  // 3. Atomic Knockout Generation & Seeding
  // ---------------------------------------------------------------------------
  test('5. Atomic Knockout Generation (4 Players): Exact rounds, nodes, matches, linkages', async () => {
    const parts = partMap[catKo4Id];
    const seeds = { [parts[0]]: 1, [parts[1]]: 2, [parts[2]]: 3, [parts[3]]: 4 };

    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catKo4Id,
      p_format: 'KNOCKOUT',
      p_seeds: seeds
    });

    assert.ifError(error);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.rounds_count, 2);
    assert.strictEqual(data.matches_count, 3);
    assert.strictEqual(data.nodes_count, 3);

    // Verify DB Entities
    const { data: dbDraw } = await adminClient.from('draws').select('*').eq('category_id', catKo4Id).single();
    assert.strictEqual(dbDraw!.format, 'KNOCKOUT');

    const { data: dbRounds } = await adminClient.from('rounds').select('*').eq('draw_id', dbDraw!.id).order('round_number', { ascending: true });
    assert.strictEqual(dbRounds!.length, 2);
    assert.strictEqual(dbRounds![0].name, 'Semi-Final');
    assert.strictEqual(dbRounds![1].name, 'Final');

    const { data: dbMatches } = await adminClient.from('matches').select('*').eq('category_id', catKo4Id);
    assert.strictEqual(dbMatches!.length, 3);

    const { data: dbNodes } = await adminClient.from('draw_nodes').select('*').eq('draw_id', dbDraw!.id).order('round_number', { ascending: true });
    assert.strictEqual(dbNodes!.length, 3);

    // Node linkages: Semi-finals point to Final node
    const finalNode = dbNodes!.find(n => n.round_number === 2);
    const r1Nodes = dbNodes!.filter(n => n.round_number === 1);
    assert.strictEqual(r1Nodes[0].next_node_id, finalNode!.id);
    assert.strictEqual(r1Nodes[1].next_node_id, finalNode!.id);
    assert.strictEqual(finalNode!.next_node_id, null);

    // Seeding: Match 0 has Seed 1 (parts[0]) vs Seed 4 (parts[3])
    const r1Matches = dbMatches!.filter(m => m.round_id === dbRounds![0].id);
    assert.strictEqual(r1Matches[0].participant_a_id, parts[0]);
    assert.strictEqual(r1Matches[0].participant_b_id, parts[3]);
    assert.strictEqual(r1Matches[0].status, 'READY');

    // Match 1 has Seed 2 (parts[1]) vs Seed 3 (parts[2])
    assert.strictEqual(r1Matches[1].participant_a_id, parts[1]);
    assert.strictEqual(r1Matches[1].participant_b_id, parts[2]);
    assert.strictEqual(r1Matches[1].status, 'READY');
  });

  test('6. Atomic Knockout Generation (8 Players): Canonical BWF 8-bracket seeding', async () => {
    const parts = partMap[catKo8Id];
    const seeds: Record<string, number> = {};
    for (let i = 0; i < 8; i++) {
      seeds[parts[i]] = i + 1;
    }

    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catKo8Id,
      p_format: 'KNOCKOUT',
      p_seeds: seeds
    });

    assert.ifError(error);
    assert.strictEqual(data.rounds_count, 3);
    assert.strictEqual(data.matches_count, 7);
    assert.strictEqual(data.nodes_count, 7);

    const { data: dbDraw } = await adminClient.from('draws').select('*').eq('category_id', catKo8Id).single();
    const { data: dbRounds } = await adminClient.from('rounds').select('*').eq('draw_id', dbDraw!.id).order('round_number', { ascending: true });
    assert.strictEqual(dbRounds![0].name, 'Quarter-Final');
    assert.strictEqual(dbRounds![1].name, 'Semi-Final');
    assert.strictEqual(dbRounds![2].name, 'Final');

    const { data: dbMatches } = await adminClient.from('matches').select('*').eq('category_id', catKo8Id).eq('round_id', dbRounds![0].id);
    assert.strictEqual(dbMatches!.length, 4);

    // BWF 8 Order: [1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6]
    assert.strictEqual(dbMatches![0].participant_a_id, parts[0]); // 1
    assert.strictEqual(dbMatches![0].participant_b_id, parts[7]); // 8

    assert.strictEqual(dbMatches![1].participant_a_id, parts[3]); // 4
    assert.strictEqual(dbMatches![1].participant_b_id, parts[4]); // 5

    assert.strictEqual(dbMatches![2].participant_a_id, parts[1]); // 2
    assert.strictEqual(dbMatches![2].participant_b_id, parts[6]); // 7

    assert.strictEqual(dbMatches![3].participant_a_id, parts[2]); // 3
    assert.strictEqual(dbMatches![3].participant_b_id, parts[5]); // 6
  });

  // ---------------------------------------------------------------------------
  // 4. Non-Power-of-Two & BYE Handling
  // ---------------------------------------------------------------------------
  test('7. 3-Player Knockout: 1 BYE automatically advances Seed 1 without fake scoring events', async () => {
    const parts = partMap[catKo3Id];
    const seeds = { [parts[0]]: 1, [parts[1]]: 2, [parts[2]]: 3 };

    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catKo3Id,
      p_format: 'KNOCKOUT',
      p_seeds: seeds
    });

    assert.ifError(error);
    assert.strictEqual(data.matches_count, 3);

    const { data: matches } = await adminClient.from('matches').select('*').eq('category_id', catKo3Id);
    const { data: draw } = await adminClient.from('draws').select('id').eq('category_id', catKo3Id).single();
    const { data: rounds } = await adminClient.from('rounds').select('*').eq('draw_id', draw!.id).order('round_number', { ascending: true });

    // Round 1 Matches
    const r1 = matches!.filter(m => m.round_id === rounds![0].id);
    // Match 0: BYE match for Seed 1 (parts[0])
    assert.strictEqual(r1[0].participant_a_id, parts[0]);
    assert.strictEqual(r1[0].participant_b_id, null);
    assert.strictEqual(r1[0].status, 'COMPLETED');
    assert.strictEqual(r1[0].winner_id, parts[0]);

    // Verify NO scoring events or games were created for the BYE match
    const { count: eventsCount } = await adminClient.from('match_events').select('*', { count: 'exact', head: true }).eq('match_id', r1[0].id);
    const { count: gamesCount } = await adminClient.from('games').select('*', { count: 'exact', head: true }).eq('match_id', r1[0].id);
    assert.strictEqual(eventsCount, 0, 'BYE match must have 0 match_events');
    assert.strictEqual(gamesCount, 0, 'BYE match must have 0 games');

    // Final Match: Seed 1 is advanced into participant_a_id
    const r2 = matches!.filter(m => m.round_id === rounds![1].id);
    assert.strictEqual(r2[0].participant_a_id, parts[0]);
    assert.strictEqual(r2[0].participant_b_id, null); // Waiting for winner of r1[1]
    assert.strictEqual(r2[0].status, 'SCHEDULED');
  });

  // ---------------------------------------------------------------------------
  // 5. Round Robin Generation & Standings Initialization
  // ---------------------------------------------------------------------------
  test('8. Atomic Round Robin (4 Players): 3 rounds, 6 unique fixtures, standings initialized', async () => {
    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catRr4Id,
      p_format: 'ROUND_ROBIN'
    });

    assert.ifError(error);
    assert.strictEqual(data.rounds_count, 3);
    assert.strictEqual(data.matches_count, 6);

    // Verify standings
    const { data: std } = await adminClient.from('standings').select('*').eq('category_id', catRr4Id).single();
    assert.ok(std);

    const { data: entries } = await adminClient.from('standings_entries').select('*').eq('standings_id', std!.id);
    assert.strictEqual(entries!.length, 4);
    entries!.forEach(e => {
      assert.strictEqual(e.played, 0);
      assert.strictEqual(e.won, 0);
      assert.strictEqual(e.lost, 0);
    });

    // Verify pairing uniqueness
    const { data: matches } = await adminClient.from('matches').select('*').eq('category_id', catRr4Id);
    assert.strictEqual(matches!.length, 6);

    const pairSet = new Set<string>();
    for (const m of matches!) {
      assert.notStrictEqual(m.participant_a_id, m.participant_b_id);
      const pair = [m.participant_a_id, m.participant_b_id].sort().join('-');
      assert.ok(!pairSet.has(pair), `Pair ${pair} must be unique`);
      pairSet.add(pair);
    }
  });

  test('9. Atomic Round Robin (5 Players - Odd N): 5 rounds, 10 matches, 2 matches per round', async () => {
    const { data, error } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catRr5Id,
      p_format: 'ROUND_ROBIN'
    });

    assert.ifError(error);
    assert.strictEqual(data.rounds_count, 5);
    assert.strictEqual(data.matches_count, 10);

    const { data: draw } = await adminClient.from('draws').select('id').eq('category_id', catRr5Id).single();
    const { data: rounds } = await adminClient.from('rounds').select('*').eq('draw_id', draw!.id);
    assert.strictEqual(rounds!.length, 5);

    for (const r of rounds!) {
      const { data: rMatches } = await adminClient.from('matches').select('*').eq('round_id', r.id);
      assert.strictEqual(rMatches!.length, 2, 'Each round in 5-player RR must have exactly 2 matches');
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Idempotency & Concurrency Safety
  // ---------------------------------------------------------------------------
  test('10. Idempotent Generation: Calling generate twice sequentially returns existing draw with identical counts', async () => {
    // 1st Call
    const { data: d1 } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catConcurrencyId,
      p_format: 'KNOCKOUT'
    });
    assert.strictEqual(d1.idempotent, false);

    // Check DB counts after 1st call
    const { count: draws1 } = await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', catConcurrencyId);
    const { count: matches1 } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', catConcurrencyId);
    const { count: nodes1 } = await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', d1.draw_id);

    // 2nd Call without force_regenerate
    const { data: d2, error: err2 } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catConcurrencyId,
      p_format: 'KNOCKOUT'
    });
    assert.ifError(err2);
    assert.strictEqual(d2.idempotent, true);
    assert.strictEqual(d2.draw_id, d1.draw_id);

    // Check DB counts after 2nd call: MUST BE IDENTICAL
    const { count: draws2 } = await adminClient.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', catConcurrencyId);
    const { count: matches2 } = await adminClient.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', catConcurrencyId);
    const { count: nodes2 } = await adminClient.from('draw_nodes').select('*', { count: 'exact', head: true }).eq('draw_id', d1.draw_id);

    assert.strictEqual(draws2, draws1, 'Draws count must remain 1');
    assert.strictEqual(matches2, matches1, 'Matches count must remain 3');
    assert.strictEqual(nodes2, nodes1, 'Draw nodes count must remain 3');
  });

  test('11. Database Constraint: Rejects direct duplicate root draw insertion', async () => {
    const { error } = await adminClient.from('draws').insert({
      category_id: catConcurrencyId,
      format: 'KNOCKOUT',
      status: 'DRAFT'
    });
    assert.ok(error, 'Unique index idx_unique_root_draw_per_category must reject duplicate root draw');
  });

  // ---------------------------------------------------------------------------
  // 7. Regeneration & Deletion Protection (Match-Started Safety)
  // ---------------------------------------------------------------------------
  test('12. Regeneration Protection: Rejects draw regeneration and deletion once match is LIVE or has events', async () => {
    // Generate draw for catRegenId
    await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catRegenId,
      p_format: 'KNOCKOUT'
    });

    // Start one of the matches
    const { data: matches } = await adminClient.from('matches').select('*').eq('category_id', catRegenId).eq('status', 'READY');
    const targetMatchId = matches![0].id;

    await orgClient.rpc('start_match', { p_match_id: targetMatchId });

    // Verify status is LIVE
    const { data: liveMatch } = await adminClient.from('matches').select('status').eq('id', targetMatchId).single();
    assert.strictEqual(liveMatch!.status, 'LIVE');

    // Attempt force_regenerate -> MUST FAIL
    const { error: regenErr } = await orgClient.rpc('generate_tournament_draw', {
      p_category_id: catRegenId,
      p_format: 'KNOCKOUT',
      p_options: { force_regenerate: true }
    });
    assert.ok(regenErr, 'Regeneration must be blocked when match is LIVE');
    assert.match(regenErr.message, /matches have already started or completed/i);

    // Attempt delete_tournament_draw -> MUST FAIL
    const { error: delErr } = await orgClient.rpc('delete_tournament_draw', {
      p_category_id: catRegenId
    });
    assert.ok(delErr, 'Deletion must be blocked when match is LIVE');
    assert.match(delErr.message, /matches have already started or completed/i);
  });

  // ---------------------------------------------------------------------------
  // 8. Bracket Advancement Integration
  // ---------------------------------------------------------------------------
  test('13. Bracket Advancement: complete_match_and_advance advances winner into linked parent match', async () => {
    const { data: dbDraw } = await adminClient.from('draws').select('*').eq('category_id', catKo4Id).single();
    const { data: r1Nodes } = await adminClient.from('draw_nodes').select('*').eq('draw_id', dbDraw!.id).eq('round_number', 1).order('position', { ascending: true });
    const { data: finalNode } = await adminClient.from('draw_nodes').select('*').eq('draw_id', dbDraw!.id).eq('round_number', 2).single();

    const match0 = await adminClient.from('matches').select('*').eq('id', r1Nodes![0].match_id).single();
    const match1 = await adminClient.from('matches').select('*').eq('id', r1Nodes![1].match_id).single();

    // Start and Complete Match 0 (Winner: participant_a_id)
    await orgClient.rpc('start_match', { p_match_id: match0.data!.id });
    await orgClient.rpc('complete_match_and_advance', {
      p_match_id: match0.data!.id,
      p_winner_id: match0.data!.participant_a_id,
      p_status: 'COMPLETED',
      p_outcome: 'COMPLETED'
    });

    // Check Final match has participant_a_id populated
    let { data: finalMatch } = await adminClient.from('matches').select('*').eq('id', finalNode!.match_id).single();
    assert.strictEqual(finalMatch!.participant_a_id, match0.data!.participant_a_id);
    assert.strictEqual(finalMatch!.participant_b_id, null);
    assert.strictEqual(finalMatch!.status, 'SCHEDULED');

    // Start and Complete Match 1 (Winner: participant_b_id)
    await orgClient.rpc('start_match', { p_match_id: match1.data!.id });
    await orgClient.rpc('complete_match_and_advance', {
      p_match_id: match1.data!.id,
      p_winner_id: match1.data!.participant_b_id,
      p_status: 'COMPLETED',
      p_outcome: 'COMPLETED'
    });

    // Check Final match now has both participants and is transitioned to READY
    finalMatch = (await adminClient.from('matches').select('*').eq('id', finalNode!.match_id).single()).data;
    assert.strictEqual(finalMatch!.participant_a_id, match0.data!.participant_a_id);
    assert.strictEqual(finalMatch!.participant_b_id, match1.data!.participant_b_id);
    assert.strictEqual(finalMatch!.status, 'READY');
  });
});
