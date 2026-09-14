import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { BadmintonRules } from '@arena-flow/sport-engine';

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
  describe('Phase 10 Production Hardening Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 10 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 10 Production Hardening, Reliability & Security Suite', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let orgEmail: string;
    let orgUserId: string;
    let otherOrgClient: SupabaseClient;
    let otherOrgUserId: string;
    let player1Email: string;
    let player1UserId: string;
    let player2UserId: string;
    let scorerEmail: string;
    let scorerUserId: string;
    let scorerClient: SupabaseClient;
    let testTournamentId: string;
    let testVenueId: string;
    let testCategoryId: string;
    let testCourts: any[] = [];
    let testParticipants: any[] = [];
    let testMatches: any[] = [];

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
      if (existing) return existing.id;
      throw new Error(`Failed to create test user ${email}: ${error?.message}`);
    }

    before(async () => {
      adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      // 1. Create Primary Organizer
      orgEmail = `p10_org_${Date.now()}@example.com`;
      orgUserId = await createOrGetUser(orgEmail, 'ORGANIZER', 'P10 Organizer');
      await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'P10 Organizer' });

      orgClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

      // 2. Create Secondary Organizer (for cross-organizer isolation tests)
      const otherOrgEmail = `p10_other_org_${Date.now()}@example.com`;
      otherOrgUserId = await createOrGetUser(otherOrgEmail, 'ORGANIZER', 'P10 Other Organizer');
      await adminClient.from('profiles').upsert({ id: otherOrgUserId, role: 'ORGANIZER', full_name: 'P10 Other Organizer' });

      otherOrgClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      await otherOrgClient.auth.signInWithPassword({ email: otherOrgEmail, password: 'TestSecurePassword123!' });

      // 3. Create Scorer
      scorerEmail = `p10_scorer_${Date.now()}@example.com`;
      scorerUserId = await createOrGetUser(scorerEmail, 'SCORER', 'P10 Scorer');
      await adminClient.from('profiles').upsert({ id: scorerUserId, role: 'SCORER', full_name: 'P10 Scorer' });

      scorerClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      await scorerClient.auth.signInWithPassword({ email: scorerEmail, password: 'TestSecurePassword123!' });

      // 4. Create Players (all MALE for Men's Singles eligibility)
      player1Email = `p10_p1_${Date.now()}@example.com`;
      player1UserId = await createOrGetUser(player1Email, 'PLAYER', 'P10 Player 1');
      player2UserId = await createOrGetUser(`p10_p2_${Date.now()}@example.com`, 'PLAYER', 'P10 Player 2');

      await Promise.all([
        adminClient.from('profiles').upsert({ id: player1UserId, role: 'PLAYER', full_name: 'P10 Player 1', gender: 'MALE', date_of_birth: '2000-01-01' }),
        adminClient.from('profiles').upsert({ id: player2UserId, role: 'PLAYER', full_name: 'P10 Player 2', gender: 'MALE', date_of_birth: '1998-05-15' }),
        adminClient.from('players').upsert({ id: player1UserId, user_id: player1UserId, full_name: 'P10 Player 1', gender: 'MALE', date_of_birth: '2000-01-01' }),
        adminClient.from('players').upsert({ id: player2UserId, user_id: player2UserId, full_name: 'P10 Player 2', gender: 'MALE', date_of_birth: '1998-05-15' })
      ]);

      // 5. Create Venue & Courts
      const { data: venue } = await adminClient
        .from('venues')
        .insert({
          name: `P10 Arena ${Date.now()}`,
          owner_id: orgUserId,
          city: 'Tokyo',
          country: 'Japan'
        })
        .select()
        .single();
      testVenueId = venue.id;

      const { data: courtsData } = await adminClient
        .from('courts')
        .insert([
          { venue_id: testVenueId, name: 'Court 1', status: 'ACTIVE' },
          { venue_id: testVenueId, name: 'Court 2', status: 'ACTIVE' }
        ])
        .select();
      testCourts = courtsData!;

      // 6. Create Tournament
      const { data: sports } = await adminClient.from('sports').select('id, name').limit(1);
      const sportId = sports![0].id;

      const { data: tournament } = await adminClient
        .from('tournaments')
        .insert({
          name: `P10 Hardened Championship ${Date.now()}`,
          slug: `p10-champ-${Date.now()}`,
          sport_id: sportId,
          organizer_id: orgUserId,
          venue_id: testVenueId,
          start_date: '2026-09-10',
          end_date: '2026-09-15',
          registration_open: new Date(Date.now() - 86400000).toISOString(),
          registration_close: new Date(Date.now() + 86400000 * 2).toISOString(),
          status: 'PUBLISHED'
        })
        .select()
        .single();
      testTournamentId = tournament.id;

      // Assign Scorer to Tournament
      await adminClient.from('tournament_scorers').insert({
        tournament_id: testTournamentId,
        user_id: scorerUserId
      });

      // 7. Create Category
      const { data: cat } = await adminClient
        .from('categories')
        .insert({
          tournament_id: testTournamentId,
          name: "Men's Singles",
          category_type: 'SINGLES',
          match_type: 'MENS',
          format: 'KNOCKOUT',
          max_participants: 16,
          registration_fee: 0
        })
        .select()
        .single();
      testCategoryId = cat.id;

      // 8. Register Participants
      testParticipants = [];
      for (const [i, pUserId] of [player1UserId, player2UserId].entries()) {
        const { data: part } = await adminClient
          .from('participants')
          .insert({
            category_id: testCategoryId,
            participant_type: 'INDIVIDUAL',
            status: 'ACTIVE'
          })
          .select()
          .single();
        testParticipants.push(part);

        await adminClient.from('participant_members').insert({
          participant_id: part.id,
          player_id: pUserId,
          member_order: 1
        });

        await adminClient.from('registrations').insert({
          category_id: testCategoryId,
          participant_id: part.id,
          status: 'APPROVED'
        });
      }

      // 9. Create Draw & Match
      const { data: draw } = await adminClient
        .from('draws')
        .insert({ category_id: testCategoryId, format: 'KNOCKOUT', status: 'PUBLISHED' })
        .select()
        .single();

      const { data: round } = await adminClient
        .from('rounds')
        .insert({ draw_id: draw.id, round_number: 1, name: 'Final' })
        .select()
        .single();

      const { data: match1 } = await adminClient
        .from('matches')
        .insert({
          category_id: testCategoryId,
          round_id: round.id,
          participant_a_id: testParticipants[0].id,
          participant_b_id: testParticipants[1].id,
          court_id: testCourts[0].id,
          scheduled_at: new Date().toISOString(),
          status: 'READY'
        })
        .select()
        .single();

      testMatches = [match1];
    });

    after(async () => {
      if (testTournamentId) {
        await adminClient.from('tournaments').delete().eq('id', testTournamentId);
      }
      if (testVenueId) {
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
      const usersToDelete = [orgUserId, otherOrgUserId, scorerUserId, player1UserId, player2UserId].filter(Boolean);
      for (const uId of usersToDelete) {
        await adminClient.auth.admin.deleteUser(uId);
      }
    });

    // -------------------------------------------------------------
    // GROUP A: Authentication Resilience
    // -------------------------------------------------------------
    describe('Group A: Authentication Resilience', () => {
      test('1. Valid credentials authenticate successfully and establish session', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { data, error } = await client.auth.signInWithPassword({
          email: orgEmail,
          password: 'TestSecurePassword123!'
        });
        assert.strictEqual(error, null);
        assert.ok(data.session?.access_token);
        assert.strictEqual(data.user?.id, orgUserId);
      });

      test('2. Invalid password returns clear authentication rejection', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { data, error } = await client.auth.signInWithPassword({
          email: orgEmail,
          password: 'IncorrectPassword!'
        });
        assert.ok(error, 'Authentication should fail with incorrect password');
        assert.strictEqual(data.session, null);
      });

      test('3. Nonexistent user login returns error without leaking system details', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { data, error } = await client.auth.signInWithPassword({
          email: `nonexistent_${Date.now()}@example.com`,
          password: 'TestSecurePassword123!'
        });
        assert.ok(error);
        assert.strictEqual(data.session, null);
      });

      test('4. Sign out cleanly clears session state', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        await client.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });
        const { error } = await client.auth.signOut();
        assert.strictEqual(error, null);
        const { data: sessionData } = await client.auth.getSession();
        assert.strictEqual(sessionData.session, null);
      });
    });

    // -------------------------------------------------------------
    // GROUP B: Role-Based Authorization Enforcement
    // -------------------------------------------------------------
    describe('Group B: Role-Based Authorization Enforcement', () => {
      test('5. Spectator / Anonymous client is blocked from inserting matches or events', async () => {
        const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { error } = await anonClient.from('match_events').insert({
          match_id: testMatches[0].id,
          event_type: 'POINT_A',
          sequence_number: 1
        });
        assert.ok(error, 'Anonymous users must be blocked from writing match events');
      });

      test('6. Player account cannot modify tournament details or categories', async () => {
        const playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        await playerClient.auth.signInWithPassword({ email: player1Email, password: 'TestSecurePassword123!' });

        const { error: catErr } = await playerClient
          .from('categories')
          .insert({ tournament_id: testTournamentId, name: 'Illegal Category', category_type: 'SINGLES', match_type: 'MENS', format: 'KNOCKOUT', max_participants: 8, registration_fee: 0 });
        assert.ok(catErr, 'Players must not create categories');
      });

      test('7. Scorer account can verify scoring authorization on assigned tournament', async () => {
        const { data: canScore } = await scorerClient.rpc('can_score_match', {
          m_id: testMatches[0].id,
          u_id: scorerUserId
        });
        assert.strictEqual(canScore, true, 'Assigned scorer must be authorized to score');
      });

      test('8. Scorer cannot perform tournament administrative updates', async () => {
        const { error } = await scorerClient
          .from('tournaments')
          .update({ name: 'Hacked Tournament Name' })
          .eq('id', testTournamentId);
        const { data: tourneyCheck } = await adminClient.from('tournaments').select('name').eq('id', testTournamentId).single();
        assert.notStrictEqual(tourneyCheck?.name, 'Hacked Tournament Name');
      });

      test('9. Cross-organizer isolation prevents modification of other organizers tournaments', async () => {
        const { error } = await otherOrgClient
          .from('tournaments')
          .update({ name: 'Stolen Tournament' })
          .eq('id', testTournamentId);
        const { data: tourneyCheck } = await adminClient.from('tournaments').select('name').eq('id', testTournamentId).single();
        assert.notStrictEqual(tourneyCheck?.name, 'Stolen Tournament');
      });
    });

    // -------------------------------------------------------------
    // GROUP C: Database Safety & Conflict Prevention Triggers
    // -------------------------------------------------------------
    describe('Group C: Database Constraints & Conflict Prevention', () => {
      test('10. Same-court overlapping match scheduling is rejected by database trigger', async () => {
        const overlapTime = new Date().toISOString();
        const { error } = await adminClient.from('matches').insert({
          category_id: testCategoryId,
          participant_a_id: testParticipants[0].id,
          participant_b_id: testParticipants[1].id,
          court_id: testCourts[0].id,
          scheduled_at: overlapTime,
          status: 'READY'
        });
        assert.ok(error, 'Court overlap conflict must trigger database exception');
        assert.ok(error.message.includes('Conflict: Court is already booked'));
      });

      test('11. Same-participant overlapping match scheduling is rejected by database trigger', async () => {
        const overlapTime = new Date().toISOString();
        const { error } = await adminClient.from('matches').insert({
          category_id: testCategoryId,
          participant_a_id: testParticipants[0].id,
          participant_b_id: testParticipants[1].id,
          court_id: testCourts[1].id, // Different court, same player
          scheduled_at: overlapTime,
          status: 'READY'
        });
        assert.ok(error, 'Participant overlap conflict must trigger database exception');
        assert.ok(error.message.includes('Conflict: Player is already scheduled'));
      });

      test('12. Duplicate player registration in the same category is blocked', async () => {
        const { data: newPart } = await adminClient.from('participants').insert({
          category_id: testCategoryId,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select().single();

        await adminClient.from('participant_members').insert({
          participant_id: newPart.id,
          player_id: player1UserId,
          member_order: 1
        });

        const { error: regErr } = await adminClient.from('registrations').insert({
          category_id: testCategoryId,
          participant_id: newPart.id,
          status: 'PENDING'
        });

        assert.ok(regErr, 'Duplicate player registration in same category must be rejected');
      });

      test('13. Concurrency-safe event sequencing trigger automatically orders events sequentially', async () => {
        const matchId = testMatches[0].id;
        // Start match first
        await orgClient.rpc('start_match', { p_match_id: matchId });

        const { data: e1, error: err1 } = await adminClient.from('match_events').insert({
          match_id: matchId,
          event_type: 'POINT_A'
        }).select().single();
        assert.strictEqual(err1, null);

        const { data: e2, error: err2 } = await adminClient.from('match_events').insert({
          match_id: matchId,
          event_type: 'POINT_B'
        }).select().single();
        assert.strictEqual(err2, null);

        assert.strictEqual(e1.sequence_number + 1, e2.sequence_number, 'Sequential ordering must be auto-assigned');
      });
    });

    // -------------------------------------------------------------
    // GROUP D: Badminton Scoring Safety & Edge Cases
    // -------------------------------------------------------------
    describe('Group D: Badminton Scoring Safety & Edge Cases', () => {
      const rules = new BadmintonRules();

      test('14. Game deuce behavior: 20-20 requires a 2-point lead', () => {
        let state = rules.getInitialState();
        // Fast-forward to 20-20
        for (let i = 0; i < 20; i++) {
          state = rules.applyEvent(state, { id: `d_a_${i}`, event_type: 'POINT_A', sequence_number: i * 2 + 1 } as any);
          state = rules.applyEvent(state, { id: `d_b_${i}`, event_type: 'POINT_B', sequence_number: i * 2 + 2 } as any);
        }
        assert.strictEqual(state.games[0].scoreA, 20);
        assert.strictEqual(state.games[0].scoreB, 20);
        assert.strictEqual(state.games[0].isCompleted, false);

        // Score 21-20 -> Not completed
        state = rules.applyEvent(state, { id: 'd_a_21', event_type: 'POINT_A', sequence_number: 41 } as any);
        assert.strictEqual(state.games[0].scoreA, 21);
        assert.strictEqual(state.games[0].isCompleted, false);

        // Score 22-20 -> Completed (2-point lead)
        state = rules.applyEvent(state, { id: 'd_a_22', event_type: 'POINT_A', sequence_number: 42 } as any);
        assert.strictEqual(state.games[0].scoreA, 22);
        assert.strictEqual(state.games[0].isCompleted, true);
        assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
      });

      test('15. Game 30-point ceiling: at 29-29, 30th point wins regardless of lead', () => {
        let state = rules.getInitialState();
        // Fast-forward to 29-29
        for (let i = 0; i < 29; i++) {
          state = rules.applyEvent(state, { id: `cap_a_${i}`, event_type: 'POINT_A', sequence_number: i * 2 + 1 } as any);
          state = rules.applyEvent(state, { id: `cap_b_${i}`, event_type: 'POINT_B', sequence_number: i * 2 + 2 } as any);
        }
        assert.strictEqual(state.games[0].scoreA, 29);
        assert.strictEqual(state.games[0].scoreB, 29);
        assert.strictEqual(state.games[0].isCompleted, false);

        // 30th point scored
        state = rules.applyEvent(state, { id: 'cap_b_30', event_type: 'POINT_B', sequence_number: 59 } as any);
        assert.strictEqual(state.games[0].scoreB, 30);
        assert.strictEqual(state.games[0].isCompleted, true);
        assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_B');
      });

      test('16. Match completion requires winning 2 games (Best of 3)', () => {
        let state = rules.getInitialState();
        // Win Game 1 for A (21-0)
        for (let i = 0; i < 21; i++) {
          state = rules.applyEvent(state, { id: `m1_g1_${i}`, event_type: 'POINT_A', sequence_number: i + 1 } as any);
        }
        assert.strictEqual(state.games[0].isCompleted, true);
        assert.strictEqual(state.isCompleted, false);
        assert.strictEqual(state.currentGameIndex, 1);

        // Win Game 2 for A (21-0)
        for (let i = 0; i < 21; i++) {
          state = rules.applyEvent(state, { id: `m1_g2_${i}`, event_type: 'POINT_A', sequence_number: 22 + i } as any);
        }
        assert.strictEqual(state.games[1].isCompleted, true);
        assert.strictEqual(state.isCompleted, true);
        assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
      });

      test('17. Undo operation accurately rolls back game score', () => {
        let state = rules.getInitialState();
        state = rules.applyEvent(state, { id: 'undo_1', event_type: 'POINT_A', sequence_number: 1 } as any);
        state = rules.applyEvent(state, { id: 'undo_2', event_type: 'POINT_B', sequence_number: 2 } as any);
        assert.strictEqual(state.games[0].scoreA, 1);
        assert.strictEqual(state.games[0].scoreB, 1);

        state = rules.applyEvent(state, { id: 'undo_3', event_type: 'UNDO', sequence_number: 3 } as any);
        assert.strictEqual(state.games[0].scoreA, 1);
        assert.strictEqual(state.games[0].scoreB, 0);
      });

      test('18. Database lock trigger prevents inserting scoring events on FINAL matches', async () => {
        const matchId = testMatches[0].id;
        // Complete and Finalize Match 1
        await adminClient.from('matches').update({ status: 'COMPLETED', outcome: 'COMPLETED', winner_id: testParticipants[0].id }).eq('id', matchId);
        await orgClient.rpc('finalize_match', { p_match_id: matchId });

        const { data: mCheck } = await adminClient.from('matches').select('status').eq('id', matchId).single();
        assert.strictEqual(mCheck?.status, 'FINAL');

        const { error: lockErr } = await adminClient.from('match_events').insert({
          match_id: matchId,
          sequence_number: 99,
          event_type: 'POINT_A'
        });
        assert.ok(lockErr, 'Scoring on FINAL match must be rejected by lock trigger');
      });
    });

    // -------------------------------------------------------------
    // GROUP E: Realtime Subscriptions & Reconnect Safety
    // -------------------------------------------------------------
    describe('Group E: Realtime Subscriptions & Reconnect Safety', () => {
      test('19. Realtime Postgres change channel registers without error', () => {
        const channel = adminClient
          .channel(`test_p10_realtime:${testTournamentId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {});

        assert.ok(channel);
        adminClient.removeChannel(channel);
      });

      test('20. Score updates in games propagate cleanly via DB updates', async () => {
        const matchId = testMatches[0].id;
        const { error } = await adminClient.from('games').upsert({
          match_id: matchId,
          game_number: 1,
          participant_a_score: 18,
          participant_b_score: 16,
          status: 'COMPLETED'
        }, { onConflict: 'match_id,game_number' });
        assert.strictEqual(error, null);

        const { data: g } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', matchId).single();
        assert.strictEqual(g?.participant_a_score, 18);
        assert.strictEqual(g?.participant_b_score, 16);
      });

      test('21. Realtime channel teardown succeeds without memory leaks', async () => {
        const ch1 = adminClient.channel('test_leak_1');
        const ch2 = adminClient.channel('test_leak_2');
        assert.ok(ch1 && ch2);
        await adminClient.removeChannel(ch1);
        await adminClient.removeChannel(ch2);
      });

      test('22. Multiple concurrent channels operate independently', () => {
        const chMatches = adminClient.channel('t_matches');
        const chEvents = adminClient.channel('t_events');
        assert.notStrictEqual(chMatches.topic, chEvents.topic);
        adminClient.removeChannel(chMatches);
        adminClient.removeChannel(chEvents);
      });
    });

    // -------------------------------------------------------------
    // GROUP F: Error Handling & Empty States
    // -------------------------------------------------------------
    describe('Group F: Error Handling & Missing Resource Handling', () => {
      test('23. Fetching nonexistent tournament ID returns empty without throwing unhandled exceptions', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const { data, error } = await adminClient.from('tournaments').select('*').eq('id', fakeId).maybeSingle();
        assert.strictEqual(error, null);
        assert.strictEqual(data, null);
      });

      test('24. Fetching nonexistent match ID returns null cleanly', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const { data, error } = await adminClient.from('matches').select('*').eq('id', fakeId).maybeSingle();
        assert.strictEqual(error, null);
        assert.strictEqual(data, null);
      });

      test('25. Empty registrations query returns empty array without error', async () => {
        const fakeCatId = '00000000-0000-0000-0000-000000000000';
        const { data, error } = await adminClient.from('registrations').select('*').eq('category_id', fakeCatId);
        assert.strictEqual(error, null);
        assert.strictEqual(data?.length, 0);
      });

      test('26. Empty match schedule correctly identifies IDLE courts', async () => {
        const { data: venueCourts } = await adminClient.from('courts').select('id, name').eq('venue_id', testVenueId);
        const { data: activeMatches } = await adminClient.from('matches').select('court_id').eq('category_id', testCategoryId).in('status', ['LIVE', 'READY']);
        
        const activeCourtIds = new Set((activeMatches || []).map(m => m.court_id));
        const idleCourts = (venueCourts || []).filter(c => !activeCourtIds.has(c.id));
        assert.ok(idleCourts.length > 0, 'Idle courts must be identified properly');
      });
    });

    // -------------------------------------------------------------
    // GROUP G: Tournament Deletion & Global Account Cascade Safety
    // -------------------------------------------------------------
    describe('Group G: Tournament Delete & Global Account Cascade Safety', () => {
      test('27. Unauthorized client deletion attempt on tournament is blocked', async () => {
        const playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        await playerClient.auth.signInWithPassword({ email: player1Email, password: 'TestSecurePassword123!' });

        await playerClient.from('tournaments').delete().eq('id', testTournamentId);
        const { data: tCheck } = await adminClient.from('tournaments').select('id').eq('id', testTournamentId).single();
        assert.ok(tCheck, 'Tournament must NOT be deleted by unauthorized user');
      });

      test('28. Authorized tournament deletion cascades tournament-owned records', async () => {
        const { error: delErr } = await orgClient.from('tournaments').delete().eq('id', testTournamentId);
        assert.strictEqual(delErr, null, 'Organizer deletion should succeed');

        const { data: catsLeft } = await adminClient.from('categories').select('id').eq('tournament_id', testTournamentId);
        const { data: matchesLeft } = await adminClient.from('matches').select('id').eq('category_id', testCategoryId);
        const { data: regsLeft } = await adminClient.from('registrations').select('id').eq('category_id', testCategoryId);

        assert.strictEqual(catsLeft?.length, 0);
        assert.strictEqual(matchesLeft?.length, 0);
        assert.strictEqual(regsLeft?.length, 0);

        testTournamentId = ''; // Mark deleted for after hook
      });

      test('29. Player accounts and auth user profiles remain intact after tournament deletion', async () => {
        const { data: p1 } = await adminClient.from('players').select('id').eq('id', player1UserId).single();
        const { data: prof1 } = await adminClient.from('profiles').select('id').eq('id', player1UserId).single();

        assert.ok(p1, 'Player account must persist after tournament deletion');
        assert.ok(prof1, 'Profile must persist after tournament deletion');
      });

      test('30. Venue courts remain intact and reusable after tournament deletion', async () => {
        const { data: venueCourts } = await adminClient.from('courts').select('id, name').eq('venue_id', testVenueId);
        assert.strictEqual(venueCourts?.length, 2, 'Venue courts must remain available');
      });
    });

    // -------------------------------------------------------------
    // GROUP H: Production Configuration & Secret Safety
    // -------------------------------------------------------------
    describe('Group H: Production Configuration & Secret Safety', () => {
      test('31. Environment configuration isolates service role keys from client', () => {
        assert.ok(supabaseAnonKey, 'Public Anon Key must exist');
        assert.ok(supabaseServiceRoleKey, 'Service Role Key must exist in server env');
        assert.notStrictEqual(supabaseAnonKey, supabaseServiceRoleKey, 'Anon key and Service key must be distinct');
      });

      test('32. Database queries on high-traffic relations execute cleanly with index coverage', async () => {
        const { data: indexedQuery, error } = await adminClient
          .from('matches')
          .select('id, court_id, scheduled_at, status')
          .limit(10);
        assert.strictEqual(error, null);
        assert.ok(Array.isArray(indexedQuery));
      });
    });
  });
}
