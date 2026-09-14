import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  allocateParticipantsToGroups,
  getCrossGroupKnockoutPairings,
  generateRoundRobinFixtures,
  sortStandings
} from '@arena-flow/tournament-engine';

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

describe('Group + Knockout (GROUP_KNOCKOUT) Format Integration Suite', () => {
  // =========================================================================
  // PART 1: TOURNAMENT ENGINE UNIT TESTS
  // =========================================================================
  describe('Tournament Engine Group Allocation & Cross-Group Pairings', () => {
    test('allocateParticipantsToGroups: 2 groups snake distribution with seeds', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const seeds = { p1: 1, p2: 2, p3: 3, p4: 4 };

      const groups = allocateParticipantsToGroups(players, 2, {
        method: 'SNAKE',
        seeds
      });

      assert.strictEqual(groups.length, 2);
      assert.strictEqual(groups[0].groupName, 'Group A');
      assert.strictEqual(groups[1].groupName, 'Group B');

      // Seed snake: p1 -> Group A, p2 -> Group B, p3 -> Group B, p4 -> Group A
      // Unseeded snake: p5 -> Group A, p6 -> Group B, p7 -> Group B, p8 -> Group A
      assert.deepStrictEqual(groups[0].participantIds, ['p1', 'p4', 'p5', 'p8']);
      assert.deepStrictEqual(groups[1].participantIds, ['p2', 'p3', 'p6', 'p7']);
    });

    test('allocateParticipantsToGroups: 4 groups snake distribution', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const seeds = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8 };

      const groups = allocateParticipantsToGroups(players, 4, {
        method: 'SNAKE',
        seeds
      });

      assert.strictEqual(groups.length, 4);
      // Row 1 (forward): G0:p1, G1:p2, G2:p3, G3:p4
      // Row 2 (backward): G3:p5, G2:p6, G1:p7, G0:p8
      assert.deepStrictEqual(groups[0].participantIds, ['p1', 'p8']);
      assert.deepStrictEqual(groups[1].participantIds, ['p2', 'p7']);
      assert.deepStrictEqual(groups[2].participantIds, ['p3', 'p6']);
      assert.deepStrictEqual(groups[3].participantIds, ['p4', 'p5']);
    });

    test('getCrossGroupKnockoutPairings: 2 groups, Top 2 qualifiers (Semifinals -> Finals)', () => {
      const groups = [
        { groupName: 'Group A', qualifiers: ['pA1', 'pA2'] },
        { groupName: 'Group B', qualifiers: ['pB1', 'pB2'] }
      ];

      const { round1Lineup, pairings } = getCrossGroupKnockoutPairings(groups);

      assert.strictEqual(pairings.length, 2);
      // SF1: A1 vs B2
      assert.strictEqual(pairings[0].participantA.participantId, 'pA1');
      assert.strictEqual(pairings[0].participantB.participantId, 'pB2');
      // SF2: B1 vs A2
      assert.strictEqual(pairings[1].participantA.participantId, 'pB1');
      assert.strictEqual(pairings[1].participantB.participantId, 'pA2');

      assert.deepStrictEqual(round1Lineup, ['pA1', 'pB2', 'pB1', 'pA2']);
    });

    test('getCrossGroupKnockoutPairings: 4 groups, Top 2 qualifiers (Quarterfinals)', () => {
      const groups = [
        { groupName: 'Group A', qualifiers: ['pA1', 'pA2'] },
        { groupName: 'Group B', qualifiers: ['pB1', 'pB2'] },
        { groupName: 'Group C', qualifiers: ['pC1', 'pC2'] },
        { groupName: 'Group D', qualifiers: ['pD1', 'pD2'] }
      ];

      const { round1Lineup, pairings } = getCrossGroupKnockoutPairings(groups);

      assert.strictEqual(pairings.length, 4);
      // QF1: A1 vs B2
      assert.strictEqual(pairings[0].participantA.participantId, 'pA1');
      assert.strictEqual(pairings[0].participantB.participantId, 'pB2');
      // QF2: C1 vs D2
      assert.strictEqual(pairings[1].participantA.participantId, 'pC1');
      assert.strictEqual(pairings[1].participantB.participantId, 'pD2');
      // QF3: B1 vs A2
      assert.strictEqual(pairings[2].participantA.participantId, 'pB1');
      assert.strictEqual(pairings[2].participantB.participantId, 'pA2');
      // QF4: D1 vs C2
      assert.strictEqual(pairings[3].participantA.participantId, 'pD1');
      assert.strictEqual(pairings[3].participantB.participantId, 'pC2');

      assert.strictEqual(round1Lineup.length, 8);
    });
  });

  // =========================================================================
  // PART 2: DATABASE ATOMIC GROUP + KNOCKOUT INTEGRATION TESTS
  // =========================================================================
  describe('Database Group Knockout Lifecycle & Integrity', () => {
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
    let categoryId: string;

    const userIds: Record<string, string> = {};
    const participantIds: string[] = [];

    before(async () => {
      anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      // 1. Create 1 Organizer and 8 Players
      const roles = ['org', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      for (const r of roles) {
        const email = `gk_${r}_${testRunId}@example.com`;
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
      await orgClient.auth.signInWithPassword({ email: `gk_org_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

      playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await playerClient.auth.signInWithPassword({ email: `gk_p1_${testRunId}@example.com`, password: 'TestSecurePassword123!' });

      // 2. Fetch or Create Sport & Venue
      const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
      if (sData) {
        sportId = sData.id;
      } else {
        const { data: newSport } = await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${testRunId}` }).select('id').single();
        sportId = newSport!.id;
      }

      const { data: vData, error: vErr } = await adminClient.from('venues').insert({
        name: `National Arena ${testRunId}`,
        city: 'Metropolis',
        country: 'India',
        owner_id: userIds['org']
      }).select('id').single();
      if (vErr) throw vErr;
      venueId = vData.id;

      // 3. Create Tournament
      const { data: tData, error: tErr } = await adminClient.from('tournaments').insert({
        name: `Group Knockout Championship ${testRunId}`,
        slug: `gk-championship-${testRunId}`,
        sport_id: sportId,
        venue_id: venueId,
        organizer_id: userIds['org'],
        status: 'PUBLISHED',
        start_date: new Date(Date.now() + 86400000).toISOString(),
        end_date: new Date(Date.now() + 86400000 * 5).toISOString(),
        registration_open: new Date(Date.now() - 86400000).toISOString(),
        registration_close: new Date(Date.now() + 86400000).toISOString()
      }).select('id').single();
      if (tErr) throw tErr;
      tournamentId = tData.id;

      // 4. Create GROUP_KNOCKOUT Category
      const { data: catData, error: catErr } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Men Singles Group+KO',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'GROUP_KNOCKOUT',
        match_duration: 45,
        buffer_time: 10
      }).select('id').single();
      if (catErr) throw catErr;
      categoryId = catData.id;

      // 5. Register 8 Players
      for (let i = 1; i <= 8; i++) {
        const pKey = `p${i}`;
        const { data: part, error: partErr } = await adminClient.from('participants').insert({
          category_id: categoryId,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select('id').single();
        if (partErr) throw partErr;

        await adminClient.from('participant_members').insert({
          participant_id: part.id,
          player_id: userIds[pKey],
          member_order: 1
        });

        await adminClient.from('registrations').insert({
          category_id: categoryId,
          participant_id: part.id,
          status: 'APPROVED'
        });

        participantIds.push(part.id);
      }

    });

    after(async () => {
      // Cleanup tournament
      if (tournamentId) {
        await adminClient.from('tournaments').delete().eq('id', tournamentId);
      }
      if (venueId) {
        await adminClient.from('venues').delete().eq('id', venueId);
      }
      for (const uid of Object.values(userIds)) {
        await adminClient.auth.admin.deleteUser(uid);
      }
    });

    test('1. RBAC & Validation: Anon or Player cannot generate GROUP_KNOCKOUT draw', async () => {
      const { error: anonErr } = await anonClient.rpc('generate_tournament_draw', {
        p_category_id: categoryId,
        p_format: 'GROUP_KNOCKOUT'
      });
      assert.ok(anonErr, 'Anon should be rejected');

      const { error: pErr } = await playerClient.rpc('generate_tournament_draw', {
        p_category_id: categoryId,
        p_format: 'GROUP_KNOCKOUT'
      });
      assert.ok(pErr, 'Player should be rejected');
    });

    test('2. Atomic Group Stage Generation: Organizer generates 2 groups with snake allocation', async () => {
      const seeds: Record<string, number> = {};
      seeds[participantIds[0]] = 1;
      seeds[participantIds[1]] = 2;
      seeds[participantIds[2]] = 3;
      seeds[participantIds[3]] = 4;

      const { data, error } = await orgClient.rpc('generate_tournament_draw', {
        p_category_id: categoryId,
        p_format: 'GROUP_KNOCKOUT',
        p_seeds: seeds,
        p_options: {
          num_groups: 2,
          allocation_method: 'SNAKE',
          force_regenerate: true
        }
      });

      assert.ifError(error);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.format, 'GROUP_KNOCKOUT');
      assert.strictEqual(data.groups_count, 2);
      assert.strictEqual(data.participants_count, 8);

      // Verify Root Draw
      const { data: rootDraw } = await adminClient
        .from('draws')
        .select('*')
        .eq('category_id', categoryId)
        .is('parent_draw_id', null)
        .single();
      assert.ok(rootDraw);
      assert.strictEqual(rootDraw.format, 'GROUP_KNOCKOUT');

      // Verify Child Group Draws
      const { data: groupDraws } = await adminClient
        .from('draws')
        .select('*')
        .eq('parent_draw_id', rootDraw.id)
        .order('group_name', { ascending: true });

      assert.strictEqual(groupDraws!.length, 2);
      assert.strictEqual(groupDraws![0].group_name, 'Group A');
      assert.strictEqual(groupDraws![1].group_name, 'Group B');

      // Verify Standings exist for each group
      for (const gd of groupDraws!) {
        const { data: std } = await adminClient
          .from('standings')
          .select('*, standings_entries(*)')
          .eq('draw_id', gd.id)
          .single();
        assert.ok(std, `Standings must exist for ${gd.group_name}`);
        assert.strictEqual(std.standings_entries.length, 4, 'Each group must have 4 standing entries');
      }

      // Verify Matches created in READY state
      const { data: groupMatches } = await adminClient
        .from('matches')
        .select('*')
        .eq('category_id', categoryId);

      // 4 players in round robin = 6 matches per group => 12 matches total
      assert.strictEqual(groupMatches!.length, 12);
      assert.ok(groupMatches!.every(m => m.status === 'READY'));
    });

    test('3. Incomplete Group Protection: Cannot generate knockout stage while group matches are in progress', async () => {
      const { error } = await orgClient.rpc('generate_knockout_from_groups', {
        p_category_id: categoryId,
        p_options: { qualifiers_per_group: 2 }
      });

      assert.ok(error, 'Should reject generating knockout stage while matches are in progress');
      assert.match(error.message, /group stage matches are still in progress/i);
    });

    test('4. Complete Group Matches & Update Standings', async () => {
      const { data: rootDraw } = await adminClient
        .from('draws')
        .select('id')
        .eq('category_id', categoryId)
        .is('parent_draw_id', null)
        .single();

      const { data: groupDraws } = await adminClient
        .from('draws')
        .select('id, group_name')
        .eq('parent_draw_id', rootDraw!.id)
        .order('group_name', { ascending: true });

      // For each group, complete all matches deterministically
      for (const gd of groupDraws!) {
        const { data: gRounds } = await adminClient.from('rounds').select('id').eq('draw_id', gd.id);
        const roundIds = gRounds!.map(r => r.id);

        const { data: gMatches } = await adminClient.from('matches').select('*').in('round_id', roundIds);

        for (const m of gMatches!) {
          // Participant A wins 21-15, 21-18
          const winnerId = m.participant_a_id;
          await adminClient.from('games').insert([
            { match_id: m.id, game_number: 1, participant_a_score: 21, participant_b_score: 15 },
            { match_id: m.id, game_number: 2, participant_a_score: 21, participant_b_score: 18 }
          ]);

          await adminClient.from('matches').update({
            status: 'COMPLETED',
            winner_id: winnerId,
            outcome: 'COMPLETED',
            ended_at: new Date().toISOString()
          }).eq('id', m.id);
        }

        // Update standings entries for this group
        const { data: std } = await adminClient.from('standings').select('id').eq('draw_id', gd.id).single();
        const { data: entries } = await adminClient.from('standings_entries').select('*').eq('standings_id', std!.id);

        // Assign ranks based on wins
        for (let idx = 0; idx < entries!.length; idx++) {
          await adminClient.from('standings_entries').update({
            rank: idx + 1,
            played: 3,
            won: 3 - idx,
            lost: idx,
            points_for: (3 - idx) * 42,
            points_against: idx * 33
          }).eq('id', entries![idx].id);
        }
      }

      // Verify all 12 group matches are COMPLETED
      const { data: allMatches } = await adminClient.from('matches').select('status').eq('category_id', categoryId);
      assert.ok(allMatches!.every(m => m.status === 'COMPLETED'));
    });

    test('5. Atomic Knockout Stage Generation: Deterministic cross-group seeding (A1 vs B2, B1 vs A2)', async () => {
      const { data, error } = await orgClient.rpc('generate_knockout_from_groups', {
        p_category_id: categoryId,
        p_options: { qualifiers_per_group: 2, force_regenerate: true }
      });

      assert.ifError(error);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.qualifiers_count, 4);
      assert.strictEqual(data.format, 'KNOCKOUT');

      // Verify Knockout Child Draw
      const { data: koDraw } = await adminClient
        .from('draws')
        .select('*')
        .eq('id', data.draw_id)
        .single();

      assert.ok(koDraw);
      assert.strictEqual(koDraw.group_name, 'Knockout Stage');
      assert.strictEqual(koDraw.format, 'KNOCKOUT');

      // Verify Knockout Rounds (Semi-Final, Final)
      const { data: koRounds } = await adminClient
        .from('rounds')
        .select('*')
        .eq('draw_id', koDraw.id)
        .order('round_number', { ascending: true });

      assert.strictEqual(koRounds!.length, 2);
      assert.strictEqual(koRounds![0].name, 'Knockout Semi-Final');
      assert.strictEqual(koRounds![1].name, 'Knockout Final');

      // Verify Round 1 matches are READY with 2 participants each
      const { data: sfMatches } = await adminClient
        .from('matches')
        .select('*')
        .eq('round_id', koRounds![0].id);

      assert.strictEqual(sfMatches!.length, 2);
      assert.ok(sfMatches![0].participant_a_id && sfMatches![0].participant_b_id);
      assert.ok(sfMatches![1].participant_a_id && sfMatches![1].participant_b_id);
      assert.strictEqual(sfMatches![0].status, 'READY');
      assert.strictEqual(sfMatches![1].status, 'READY');

      // Verify Final match is SCHEDULED with NULL participants
      const { data: finalMatch } = await adminClient
        .from('matches')
        .select('*')
        .eq('round_id', koRounds![1].id)
        .single();

      assert.ok(finalMatch);
      assert.strictEqual(finalMatch.status, 'SCHEDULED');
      assert.strictEqual(finalMatch.participant_a_id, null);
      assert.strictEqual(finalMatch.participant_b_id, null);
    });

    test('6. Bracket Advancement: Completing Semifinal matches advances winners to Final and transitions to READY', async () => {
      const { data: koDraw } = await adminClient
        .from('draws')
        .select('id')
        .eq('category_id', categoryId)
        .eq('group_name', 'Knockout Stage')
        .single();

      const { data: koRounds } = await adminClient
        .from('rounds')
        .select('id, round_number')
        .eq('draw_id', koDraw!.id)
        .order('round_number', { ascending: true });

      const sfRoundId = koRounds![0].id;
      const finalRoundId = koRounds![1].id;

      const { data: sfNodes } = await adminClient
        .from('draw_nodes')
        .select('*, match:matches(*)')
        .eq('draw_id', koDraw!.id)
        .eq('round_number', 1)
        .order('position', { ascending: true });

      const sf1Match = (sfNodes![0] as any).match;
      const sf2Match = (sfNodes![1] as any).match;

      // Complete SF 1 (Position 0 -> advances to Final Participant A)
      const sf1Winner = sf1Match.participant_a_id;
      await orgClient.rpc('complete_match_and_advance', {
        p_match_id: sf1Match.id,
        p_winner_id: sf1Winner,
        p_status: 'COMPLETED',
        p_outcome: 'COMPLETED'
      });

      // Complete SF 2 (Position 1 -> advances to Final Participant B)
      const sf2Winner = sf2Match.participant_b_id;
      await orgClient.rpc('complete_match_and_advance', {
        p_match_id: sf2Match.id,
        p_winner_id: sf2Winner,
        p_status: 'COMPLETED',
        p_outcome: 'COMPLETED'
      });

      // Verify Final Match has both winners populated and transitioned to READY
      const { data: finalMatch } = await adminClient
        .from('matches')
        .select('*')
        .eq('round_id', finalRoundId)
        .single();

      assert.strictEqual(finalMatch!.participant_a_id, sf1Winner);
      assert.strictEqual(finalMatch!.participant_b_id, sf2Winner);
      assert.strictEqual(finalMatch!.status, 'READY', 'Final match must transition to READY once both finalists are advanced');
    });


    test('7. Match-Started Protection: Cannot regenerate knockout stage once knockout matches have completed', async () => {
      const { error } = await orgClient.rpc('generate_knockout_from_groups', {
        p_category_id: categoryId,
        p_options: { qualifiers_per_group: 2, force_regenerate: true }
      });

      assert.ok(error, 'Should reject regenerating knockout stage once matches have started');
      assert.match(error.message, /knockout matches have already started or completed/i);
    });

    test('8. Match-Started Protection: Cannot delete or regenerate root draw once matches have started', async () => {
      const { error: delErr } = await orgClient.rpc('delete_tournament_draw', {
        p_category_id: categoryId
      });
      assert.ok(delErr, 'Should reject deleting draw with completed matches');
      assert.match(delErr.message, /matches have already started or completed/i);

      const { error: regenErr } = await orgClient.rpc('generate_tournament_draw', {
        p_category_id: categoryId,
        p_format: 'GROUP_KNOCKOUT',
        p_options: { force_regenerate: true }
      });
      assert.ok(regenErr, 'Should reject regenerating draw with completed matches');
      assert.match(regenErr.message, /matches have already started or completed/i);
    });

    test('9. Rollback Safety: Simulated transaction failure rolls back cleanly', async () => {
      // Create a separate test category for rollback test
      const { data: catRollback } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Rollback Test Category',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'GROUP_KNOCKOUT'
      }).select('id').single();

      for (let i = 1; i <= 4; i++) {
        const { data: part } = await adminClient.from('participants').insert({
          category_id: catRollback!.id,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select('id').single();
      }

      // Attempt draw generation with simulate_failure
      const { error } = await orgClient.rpc('generate_tournament_draw', {
        p_category_id: catRollback!.id,
        p_format: 'GROUP_KNOCKOUT',
        p_options: {
          num_groups: 2,
          simulate_failure: true
        }
      });

      assert.ok(error, 'Simulated failure must throw error');
      assert.match(error.message, /Simulated transaction failure/i);

      // Verify zero orphan draws or matches exist for this category
      const { data: orphanDraws } = await adminClient.from('draws').select('id').eq('category_id', catRollback!.id);
      const { data: orphanMatches } = await adminClient.from('matches').select('id').eq('category_id', catRollback!.id);

      assert.strictEqual(orphanDraws!.length, 0, 'Zero orphan draws must remain after rollback');
      assert.strictEqual(orphanMatches!.length, 0, 'Zero orphan matches must remain after rollback');
    });
  });
});
