import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { calculateStandings, calculatePlayerStats } from '@arena-flow/statistics-engine';

function loadEnv() {
  try {
    const rootEnv = path.resolve(process.cwd(), '.env');
    const siblingEnv = path.resolve(process.cwd(), '../../.env');
    const envPath = fs.existsSync(rootEnv) ? rootEnv : siblingEnv;
    
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
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const canRunTests = supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey;

if (!canRunTests) {
  describe('Outcomes Integration Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️ SKIPPING OUTCOMES TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Match Outcomes Integration Suite (Walkover, Retirement, Default)', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let scorerClient: SupabaseClient;
    let playerClient: SupabaseClient;
    let anonClient: SupabaseClient;

    const testRunId = Date.now();
    const emails = {
      org: `outcomes-org-${testRunId}@arenaflow.test`,
      scorer: `outcomes-scorer-${testRunId}@arenaflow.test`,
      playerA: `outcomes-player-a-${testRunId}@arenaflow.test`,
      playerB: `outcomes-player-b-${testRunId}@arenaflow.test`,
      unauthorizedPlayer: `outcomes-player-c-${testRunId}@arenaflow.test`,
    };

    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let tournamentId: string;
    let categoryId: string;
    let partAId: string;
    let partBId: string;
    let drawId: string;
    let round1Id: string;
    let round2Id: string;
    let matchWoId: string;
    let matchFinalsId: string;
    let matchRetId: string;

    before(async () => {
      adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      // 1. Create users with unique emails
      for (const [key, email] of Object.entries(emails)) {
        const role = key === 'org' ? 'ORGANIZER' : 'PLAYER';
        const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: `Outcomes ${key}` }
        });
        if (authErr || !authUser.user) throw new Error(`Failed to create test user ${email}: ${authErr?.message}`);
        userIds[key] = authUser.user.id;

        await adminClient.from('profiles').upsert({
          id: userIds[key],
          role,
          full_name: `Outcomes ${key}`
        });

        await adminClient.from('players').upsert({
          id: userIds[key],
          user_id: userIds[key],
          full_name: `Outcomes ${key}`,
          gender: 'MALE',
          date_of_birth: '1995-01-01'
        });
      }

      // 2. Initialize authenticated clients
      const createAuthClient = async (email: string) => {
        const client = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return client;
      };

      orgClient = await createAuthClient(emails.org);
      scorerClient = await createAuthClient(emails.scorer);
      playerClient = await createAuthClient(emails.unauthorizedPlayer);

      // 3. Setup sport and venue
      const { data: sData } = await adminClient.from('sports').select('id').eq('name', 'Badminton').single();
      sportId = sData?.id || (await adminClient.from('sports').insert({ name: 'Badminton', description: 'Test sport' }).select('id').single()).data?.id;

      const { data: vData } = await adminClient.from('venues').insert({
        name: `Outcomes Test Arena ${testRunId}`,
        address: '100 Court St',
        city: 'Metropolis',
        country: 'India'
      }).select('id').single();
      venueId = vData!.id;

      // 4. Create Tournament & Category
      const { data: tData } = await adminClient.from('tournaments').insert({
        name: `Outcomes Championship ${testRunId}`,
        slug: `outcomes-tourney-${testRunId}`,
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

      // Assign scorer to tournament
      await adminClient.from('tournament_scorers').insert({
        tournament_id: tournamentId,
        user_id: userIds.scorer
      });

      const { data: cData } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: "Men's Singles",
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT'
      }).select('id').single();
      categoryId = cData!.id;

      // Create Participants
      const { data: pA } = await adminClient.from('participants').insert({
        category_id: categoryId,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }).select('id').single();
      partAId = pA!.id;
      await adminClient.from('participant_members').insert({ participant_id: partAId, player_id: userIds.playerA });

      const { data: pB } = await adminClient.from('participants').insert({
        category_id: categoryId,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }).select('id').single();
      partBId = pB!.id;
      await adminClient.from('participant_members').insert({ participant_id: partBId, player_id: userIds.playerB });

      // Create Knockout Draw & Rounds & Draw Nodes
      const { data: dData } = await adminClient.from('draws').insert({
        category_id: categoryId,
        format: 'KNOCKOUT',
        status: 'PUBLISHED'
      }).select('id').single();
      drawId = dData!.id;

      const { data: r1 } = await adminClient.from('rounds').insert({
        draw_id: drawId,
        round_number: 1,
        name: 'Semifinals'
      }).select('id').single();
      round1Id = r1!.id;

      const { data: r2 } = await adminClient.from('rounds').insert({
        draw_id: drawId,
        round_number: 2,
        name: 'Finals'
      }).select('id').single();
      round2Id = r2!.id;

      // Create Finals Match (initially unassigned)
      const { data: mFinals } = await adminClient.from('matches').insert({
        category_id: categoryId,
        round_id: round2Id,
        status: 'SCHEDULED'
      }).select('id').single();
      matchFinalsId = mFinals!.id;

      // Create Walkover Match (Semifinal 1) - partA vs partB (position: 0 for participant_a advancement)
      const { data: mWo } = await adminClient.from('matches').insert({
        category_id: categoryId,
        round_id: round1Id,
        participant_a_id: partAId,
        participant_b_id: partBId,
        status: 'READY'
      }).select('id').single();
      matchWoId = mWo!.id;

      // Create Retirement Match (Semifinal 2) - partA vs partB (starts in READY, will transition to LIVE)
      const { data: mRet } = await adminClient.from('matches').insert({
        category_id: categoryId,
        round_id: round1Id,
        participant_a_id: partAId,
        participant_b_id: partBId,
        status: 'READY'
      }).select('id').single();
      matchRetId = mRet!.id;

      // Link draw nodes
      const { data: nodeFinals } = await adminClient.from('draw_nodes').insert({
        draw_id: drawId,
        round_number: 2,
        position: 0,
        match_id: matchFinalsId
      }).select('id').single();

      await adminClient.from('draw_nodes').insert({
        draw_id: drawId,
        round_number: 1,
        position: 0,
        match_id: matchWoId,
        next_node_id: nodeFinals!.id
      });
    });

    after(async () => {
      // Clean up test users
      for (const uid of Object.values(userIds)) {
        await adminClient.auth.admin.deleteUser(uid);
      }
      if (venueId) {
        await adminClient.from('venues').delete().eq('id', venueId);
      }
    });

    // -------------------------------------------------------------------------
    // 1. Authorization & Role Enforcement
    // -------------------------------------------------------------------------
    test('1. Anonymous/Spectator client cannot call declare_match_outcome', async () => {
      const { error } = await anonClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'WALKOVER',
        p_winner_id: partAId
      });

      assert.ok(error, 'Anonymous user must be rejected from declaring match outcome');
      assert.match(error.message, /Unauthorized/i);
    });

    test('2. Unauthorized player cannot declare outcome on match', async () => {
      const { error } = await playerClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'WALKOVER',
        p_winner_id: partAId
      });

      assert.ok(error, 'Unauthorized player must be rejected');
      assert.match(error.message, /Unauthorized/i);
    });

    // -------------------------------------------------------------------------
    // 2. Lifecycle & Outcome Semantic Validation
    // -------------------------------------------------------------------------
    test('3. Rejects invalid outcome values', async () => {
      const { error } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'INVALID_OUTCOME',
        p_winner_id: partAId
      });

      assert.ok(error, 'Invalid outcome format must be rejected');
      assert.match(error.message, /Invalid match outcome/i);
    });

    test('4. Rejects winner not belonging to match participants', async () => {
      const fakeWinnerId = '00000000-0000-0000-0000-000000000001';
      const { error } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'WALKOVER',
        p_winner_id: fakeWinnerId
      });

      assert.ok(error, 'Foreign winner ID must be rejected');
      assert.match(error.message, /not a participant/i);
    });

    test('5. Rejects RETIREMENT when match is unstarted (READY / SCHEDULED)', async () => {
      const { error } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'RETIREMENT',
        p_winner_id: partAId
      });

      assert.ok(error, 'Retirement on unstarted match must be rejected');
      assert.match(error.message, /active matches in progress/i);
    });

    // -------------------------------------------------------------------------
    // 3. Walkover Execution & Bracket Advancement
    // -------------------------------------------------------------------------
    test('6. Assigned Scorer successfully declares WALKOVER and advances winner atomically', async () => {
      const { error } = await scorerClient.rpc('declare_match_outcome', {
        p_match_id: matchWoId,
        p_outcome: 'WALKOVER',
        p_winner_id: partAId,
        p_notes: 'Player B did not show up'
      });

      assert.ifError(error);

      // Verify Walkover Match updated
      const { data: mWo } = await adminClient.from('matches').select('*').eq('id', matchWoId).single();
      assert.strictEqual(mWo.status, 'COMPLETED');
      assert.strictEqual(mWo.outcome, 'WALKOVER');
      assert.strictEqual(mWo.winner_id, partAId);
      assert.ok(mWo.ended_at, 'ended_at must be set');

      // Verify Finals Match advanced Winner A
      const { data: mFinals } = await adminClient.from('matches').select('*').eq('id', matchFinalsId).single();
      assert.strictEqual(mFinals.participant_a_id, partAId, 'Winner A must advance to next bracket match as participant_a');

      // Verify Audit Log recorded OUTCOME_DECLARED
      const { data: logs } = await adminClient.from('audit_logs')
        .select('*')
        .eq('target_id', matchWoId)
        .eq('action', 'OUTCOME_DECLARED');
      assert.ok(logs && logs.length > 0, 'Audit log entry must be created');
      assert.strictEqual(logs[0].new_data.outcome, 'WALKOVER');
      assert.strictEqual(logs[0].new_data.winner_id, partAId);
    });

    // -------------------------------------------------------------------------
    // 4. Scoring Event Protection: Walkover / Default blocked once points exist
    // -------------------------------------------------------------------------
    test('7. Walkover / Default is rejected once legitimate scoring events have occurred', async () => {
      // Transition Retirement Match to LIVE
      await adminClient.from('matches').update({ status: 'LIVE' }).eq('id', matchRetId);

      // Insert score points for Retirement Match
      await adminClient.from('match_events').insert([
        { match_id: matchRetId, sequence_number: 1, event_type: 'POINT_A' },
        { match_id: matchRetId, sequence_number: 2, event_type: 'POINT_B' },
        { match_id: matchRetId, sequence_number: 3, event_type: 'POINT_A' },
      ]);

      await adminClient.from('games').upsert({
        match_id: matchRetId,
        game_number: 1,
        participant_a_score: 2,
        participant_b_score: 1,
        status: 'LIVE'
      }, { onConflict: 'match_id,game_number' });

      // Attempting WALKOVER must be rejected because scoring has occurred!
      const { error: woErr } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchRetId,
        p_outcome: 'WALKOVER',
        p_winner_id: partAId
      });

      assert.ok(woErr, 'Walkover must be rejected when points exist');
      assert.match(woErr.message, /scoring points have already been recorded.*Use RETIREMENT instead/i);

      // Attempting DEFAULT must also be rejected because scoring has occurred!
      const { error: defErr } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchRetId,
        p_outcome: 'DEFAULT',
        p_winner_id: partAId
      });

      assert.ok(defErr, 'Default must be rejected when points exist');
      assert.match(defErr.message, /scoring points have already been recorded.*Use RETIREMENT instead/i);
    });

    // -------------------------------------------------------------------------
    // 5. Retirement Execution: Preserves existing games and points
    // -------------------------------------------------------------------------
    test('8. RETIREMENT succeeds mid-match, preserving played points and game rallies', async () => {
      // Declare Retirement on matchRetId by Participant A (so Participant B wins)
      const { error } = await orgClient.rpc('declare_match_outcome', {
        p_match_id: matchRetId,
        p_outcome: 'RETIREMENT',
        p_winner_id: partBId,
        p_retiring_participant_id: partAId,
        p_notes: 'Player A pulled hamstring in Game 1'
      });

      assert.ifError(error);

      // Verify Match state
      const { data: mRet } = await adminClient.from('matches').select('*').eq('id', matchRetId).single();
      assert.strictEqual(mRet.status, 'COMPLETED');
      assert.strictEqual(mRet.outcome, 'RETIREMENT');
      assert.strictEqual(mRet.winner_id, partBId);

      // Verify existing game scores were PRESERVED untouched
      const { data: gData } = await adminClient.from('games').select('*').eq('match_id', matchRetId).single();
      assert.strictEqual(gData.participant_a_score, 2, 'Played points must remain intact');
      assert.strictEqual(gData.participant_b_score, 1, 'Played points must remain intact');

      // Verify Match Events were PRESERVED untouched
      const { data: events } = await adminClient.from('match_events').select('*').eq('match_id', matchRetId);
      assert.strictEqual(events!.length, 3, 'Scoring stream must remain intact without fake events');
    });

    // -------------------------------------------------------------------------
    // 6. Statistics Engine Integration
    // -------------------------------------------------------------------------
    test('9. Statistics Engine calculates correct standings and player stats for outcomes', () => {
      const matchHistory: any[] = [
        // Walkover match: P1 wins over P2 (0-0 games/points)
        {
          id: 'm_wo',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P1',
          outcome: 'WALKOVER',
          status: 'COMPLETED',
          games: []
        },
        // Retirement match: P1 retires against P3 at 21-18, 9-11
        {
          id: 'm_ret',
          participant_a_id: 'P1',
          participant_b_id: 'P3',
          winner_id: 'P3',
          outcome: 'RETIREMENT',
          status: 'COMPLETED',
          games: [
            { game_number: 1, participant_a_score: 21, participant_b_score: 18, isCompleted: true },
            { game_number: 2, participant_a_score: 9, participant_b_score: 11, isCompleted: false },
          ]
        }
      ];

      // Standings
      const { sortedEntries } = calculateStandings(['P1', 'P2', 'P3'], matchHistory);

      const p1Entry = sortedEntries.find(e => e.participant_id === 'P1');
      const p2Entry = sortedEntries.find(e => e.participant_id === 'P2');
      const p3Entry = sortedEntries.find(e => e.participant_id === 'P3');

      assert.strictEqual(p1Entry?.played, 2);
      assert.strictEqual(p1Entry?.won, 1);
      assert.strictEqual(p1Entry?.lost, 1);
      assert.strictEqual(p1Entry?.points_for, 30); // 21 + 9 (from ret match only; WO adds 0)
      assert.strictEqual(p1Entry?.points_against, 29); // 18 + 11

      assert.strictEqual(p2Entry?.played, 1);
      assert.strictEqual(p2Entry?.won, 0);
      assert.strictEqual(p2Entry?.lost, 1);
      assert.strictEqual(p2Entry?.points_for, 0); // 0 points for walkover loser

      assert.strictEqual(p3Entry?.played, 1);
      assert.strictEqual(p3Entry?.won, 1);
      assert.strictEqual(p3Entry?.lost, 0);
      assert.strictEqual(p3Entry?.points_for, 29); // 18 + 11

      // Player Stats
      const p1Stats = calculatePlayerStats(matchHistory, 'P1');
      assert.strictEqual(p1Stats.matchesPlayed, 2);
      assert.strictEqual(p1Stats.matchesWon, 1);
      assert.strictEqual(p1Stats.matchesLost, 1);
      assert.strictEqual(p1Stats.walkoversReceived, 1);
      assert.strictEqual(p1Stats.retirementsGiven, 1);
      assert.strictEqual(p1Stats.retirementsReceived, 0);

      const p3Stats = calculatePlayerStats(matchHistory, 'P3');
      assert.strictEqual(p3Stats.matchesWon, 1);
      assert.strictEqual(p3Stats.retirementsReceived, 1);
    });
  });
}
