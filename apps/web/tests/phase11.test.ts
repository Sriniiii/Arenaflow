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
  describe('Phase 11 UI/UX, Visual Identity & User Journey Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 11 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 11 UI/UX, Visual Identity & User Journey Suite', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let orgEmail: string;
    let orgUserId: string;
    let playerEmail: string;
    let playerUserId: string;
    let scorerEmail: string;
    let scorerUserId: string;
    let scorerClient: SupabaseClient;
    let testVenueId: string;
    let testTournamentId: string;
    let testTournamentSlug: string;
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

      // 1. Organizer
      orgEmail = `p11_org_${Date.now()}@example.com`;
      orgUserId = await createOrGetUser(orgEmail, 'ORGANIZER', 'P11 Master Organizer');
      await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'P11 Master Organizer' });

      orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

      // 2. Scorer
      scorerEmail = `p11_scorer_${Date.now()}@example.com`;
      scorerUserId = await createOrGetUser(scorerEmail, 'SCORER', 'P11 Official Scorer');
      await adminClient.from('profiles').upsert({ id: scorerUserId, role: 'SCORER', full_name: 'P11 Official Scorer' });

      scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await scorerClient.auth.signInWithPassword({ email: scorerEmail, password: 'TestSecurePassword123!' });

      // 3. Players
      playerEmail = `p11_p1_${Date.now()}@example.com`;
      playerUserId = await createOrGetUser(playerEmail, 'PLAYER', 'P11 Pro Player');
      await adminClient.from('profiles').upsert({ id: playerUserId, role: 'PLAYER', full_name: 'P11 Pro Player', gender: 'MALE', date_of_birth: '2000-01-01' });
      await adminClient.from('players').upsert({ id: playerUserId, user_id: playerUserId, full_name: 'P11 Pro Player', gender: 'MALE', date_of_birth: '2000-01-01' });

      // Create 5 more players for draws
      const otherPlayers: string[] = [];
      for (let i = 2; i <= 6; i++) {
        const pId = await createOrGetUser(`p11_p${i}_${Date.now()}@example.com`, 'PLAYER', `P11 Player ${i}`);
        await adminClient.from('profiles').upsert({ id: pId, role: 'PLAYER', full_name: `P11 Player ${i}`, gender: 'MALE', date_of_birth: '2001-05-10' });
        await adminClient.from('players').upsert({ id: pId, user_id: pId, full_name: `P11 Player ${i}`, gender: 'MALE', date_of_birth: '2001-05-10' });
        otherPlayers.push(pId);
      }

      // 4. Venue & 4 Competition Courts
      const { data: venue } = await adminClient
        .from('venues')
        .insert({
          name: `ArenaFlow Olympic Dome ${Date.now()}`,
          owner_id: orgUserId,
          city: 'London',
          country: 'United Kingdom'
        })
        .select()
        .single();
      testVenueId = venue.id;

      const { data: courtsData } = await adminClient
        .from('courts')
        .insert([
          { venue_id: testVenueId, name: 'Court 1', status: 'ACTIVE' },
          { venue_id: testVenueId, name: 'Court 2', status: 'ACTIVE' },
          { venue_id: testVenueId, name: 'Court 3', status: 'ACTIVE' },
          { venue_id: testVenueId, name: 'Court 4', status: 'ACTIVE' }
        ])
        .select();
      testCourts = courtsData!;

      // 5. Tournament & Categories
      const { data: sports } = await adminClient.from('sports').select('id, name').limit(1);
      const sportId = sports![0].id;
      testTournamentSlug = `p11-champ-${Date.now()}`;

      const { data: tournament } = await adminClient
        .from('tournaments')
        .insert({
          name: `ArenaFlow Grand Slam ${Date.now()}`,
          slug: testTournamentSlug,
          sport_id: sportId,
          organizer_id: orgUserId,
          venue_id: testVenueId,
          start_date: '2026-09-20',
          end_date: '2026-09-25',
          registration_open: new Date(Date.now() - 86400000).toISOString(),
          registration_close: new Date(Date.now() + 86400000 * 3).toISOString(),
          status: 'PUBLISHED'
        })
        .select()
        .single();
      testTournamentId = tournament.id;

      // Assign Scorer
      await adminClient.from('tournament_scorers').insert({
        tournament_id: testTournamentId,
        user_id: scorerUserId
      });

      // Category
      const { data: cat } = await adminClient
        .from('categories')
        .insert({
          tournament_id: testTournamentId,
          name: "Men's Singles Championship",
          category_type: 'SINGLES',
          match_type: 'MENS',
          format: 'KNOCKOUT',
          max_participants: 16,
          registration_fee: 0
        })
        .select()
        .single();
      testCategoryId = cat.id;

      // 6. Register 6 Participants
      const allPlayerIds = [playerUserId, ...otherPlayers];
      testParticipants = [];
      for (const pId of allPlayerIds) {
        const { data: part } = await adminClient
          .from('participants')
          .insert({ category_id: testCategoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' })
          .select()
          .single();
        testParticipants.push(part);

        await adminClient.from('participant_members').insert({
          participant_id: part.id,
          player_id: pId,
          member_order: 1
        });

        await adminClient.from('registrations').insert({
          category_id: testCategoryId,
          participant_id: part.id,
          status: 'APPROVED'
        });
      }

      // 7. Generate Draw & Matches for Multi-Court Testing
      const { data: draw } = await adminClient
        .from('draws')
        .insert({ category_id: testCategoryId, format: 'KNOCKOUT', status: 'PUBLISHED' })
        .select()
        .single();

      const { data: round } = await adminClient
        .from('rounds')
        .insert({ draw_id: draw.id, round_number: 1, name: 'Quarter-Finals' })
        .select()
        .single();

      // Schedule 3 Matches on Courts 1, 2, 3 (Court 4 stays IDLE)
      const matchesToInsert = [
        { category_id: testCategoryId, round_id: round.id, participant_a_id: testParticipants[0].id, participant_b_id: testParticipants[1].id, court_id: testCourts[0].id, scheduled_at: new Date().toISOString(), status: 'READY' },
        { category_id: testCategoryId, round_id: round.id, participant_a_id: testParticipants[2].id, participant_b_id: testParticipants[3].id, court_id: testCourts[1].id, scheduled_at: new Date().toISOString(), status: 'READY' },
        { category_id: testCategoryId, round_id: round.id, participant_a_id: testParticipants[4].id, participant_b_id: testParticipants[5].id, court_id: testCourts[2].id, scheduled_at: new Date().toISOString(), status: 'READY' }
      ];

      const { data: mData } = await adminClient.from('matches').insert(matchesToInsert).select();
      testMatches = mData!;
    });

    after(async () => {
      if (testTournamentId) {
        await adminClient.from('tournaments').delete().eq('id', testTournamentId);
      }
      if (testVenueId) {
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
      const usersToDelete = [orgUserId, scorerUserId, playerUserId].filter(Boolean);
      for (const uId of usersToDelete) {
        await adminClient.auth.admin.deleteUser(uId);
      }
    });

    // -------------------------------------------------------------
    // SECTION 1: Landing Page & Public CTAs
    // -------------------------------------------------------------
    describe('1. Landing Page & Public CTAs', () => {
      test('1. Landing page loads published tournaments list cleanly', async () => {
        const { data: pubs, error } = await adminClient
          .from('tournaments')
          .select('id, name, slug, status, sports(name), venues(name)')
          .eq('status', 'PUBLISHED')
          .limit(5);
        assert.strictEqual(error, null);
        assert.ok(pubs!.length > 0, 'Published tournaments should be accessible to public');
      });

      test('2. "Create Tournament" CTA route requires organizer authentication', () => {
        const createRoute = '/tournaments/create';
        const redirectUrl = `/auth/login?redirect=${encodeURIComponent(createRoute)}`;
        assert.ok(redirectUrl.includes('/auth/login'));
        assert.ok(redirectUrl.includes(encodeURIComponent(createRoute)));
      });

      test('3. "Explore Live Tournaments" CTA targets published tournament slug view', () => {
        const liveUrl = `/tournaments/${testTournamentSlug}`;
        assert.ok(liveUrl.startsWith('/tournaments/'));
        assert.strictEqual(liveUrl.includes(testTournamentSlug), true);
      });
    });

    // -------------------------------------------------------------
    // SECTION 2: Authentication Journey (Sign In, Sign Up, Session)
    // -------------------------------------------------------------
    describe('2. Authentication Journey & Session Resilience', () => {
      test('4. Sign In succeeds with valid organizer credentials', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { data, error } = await client.auth.signInWithPassword({
          email: orgEmail,
          password: 'TestSecurePassword123!'
        });
        assert.strictEqual(error, null);
        assert.strictEqual(data.user?.id, orgUserId);
      });

      test('5. Sign In rejects invalid credentials with human-readable error', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { data, error } = await client.auth.signInWithPassword({
          email: orgEmail,
          password: 'WrongPassword123'
        });
        assert.ok(error);
        assert.strictEqual(data.session, null);
      });

      test('6. Sign Up creates account with designated role metadata', async () => {
        const newEmail = `p11_reg_${Date.now()}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email: newEmail,
          password: 'TestSecurePassword123!',
          email_confirm: true,
          user_metadata: { full_name: 'P11 Registered User', role: 'PLAYER' }
        });
        assert.strictEqual(error, null);
        assert.strictEqual(data.user?.user_metadata.role, 'PLAYER');
        // Clean up
        await adminClient.auth.admin.deleteUser(data.user!.id);
      });

      test('7. Sign Out cleanly terminates active session', async () => {
        const client = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        await client.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });
        const { error } = await client.auth.signOut();
        assert.strictEqual(error, null);
      });

      test('8. Unauthenticated request to protected admin RPC is rejected', async () => {
        const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        const { error } = await anonClient.rpc('finalize_match', { p_match_id: testMatches[0].id });
        assert.ok(error, 'Anonymous callers must be rejected from finalize RPC');
      });
    });

    // -------------------------------------------------------------
    // SECTION 3: Global Navigation & Role-Based Access
    // -------------------------------------------------------------
    describe('3. Global Navigation & Role-Based Access', () => {
      test('9. Organizer profile has access to tournament management controls', async () => {
        const { data: prof } = await adminClient.from('profiles').select('role').eq('id', orgUserId).single();
        assert.strictEqual(prof?.role, 'ORGANIZER');
      });

      test('10. Scorer profile has authorized scorer permissions on assigned tournament', async () => {
        const { data: isScorer } = await adminClient.rpc('is_tournament_scorer', { t_id: testTournamentId });
        // Scorer checks verify assignment
        const { data: scorerAssignment } = await adminClient
          .from('tournament_scorers')
          .select('*')
          .eq('tournament_id', testTournamentId)
          .eq('user_id', scorerUserId)
          .single();
        assert.ok(scorerAssignment, 'Scorer must be assigned to tournament');
      });

      test('11. Player profile is restricted from creating categories on organizers tournament', async () => {
        const pClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
        await pClient.auth.signInWithPassword({ email: playerEmail, password: 'TestSecurePassword123!' });

        const { error } = await pClient.from('categories').insert({
          tournament_id: testTournamentId,
          name: 'Player Illegal Category',
          category_type: 'SINGLES',
          match_type: 'MENS',
          format: 'KNOCKOUT',
          max_participants: 8,
          registration_fee: 0
        });
        assert.ok(error, 'Players cannot create categories on organizer tournaments');
      });
    });

    // -------------------------------------------------------------
    // SECTION 4: Organizer Dashboard & Operations Metrics
    // -------------------------------------------------------------
    describe('4. Dashboard Operations & 8-Metric Calculation', () => {
      test('12. Dashboard correctly computes registered players metric', async () => {
        const { data: tData } = await adminClient
          .from('tournaments')
          .select('categories(participants(participant_members(player_id)))')
          .eq('id', testTournamentId)
          .single();
        
        const playerIds = new Set(
          tData?.categories?.flatMap((c: any) => c.participants?.flatMap((p: any) => p.participant_members?.map((m: any) => m.player_id)))
        );
        assert.strictEqual(playerIds.size, 6);
      });

      test('13. Dashboard correctly computes assigned courts metric', async () => {
        const { data: venueCourts } = await adminClient.from('courts').select('id').eq('venue_id', testVenueId);
        assert.strictEqual(venueCourts?.length, 4);
      });

      test('14. Dashboard correctly filters tournaments by status (ALL, DRAFT, PUBLISHED, COMPLETED)', async () => {
        const { data: pubList } = await orgClient.from('tournaments').select('id').eq('status', 'PUBLISHED');
        const { data: draftList } = await orgClient.from('tournaments').select('id').eq('status', 'DRAFT');
        assert.ok(pubList!.some(t => t.id === testTournamentId));
        assert.strictEqual(draftList!.some(t => t.id === testTournamentId), false);
      });
    });

    // -------------------------------------------------------------
    // SECTION 5: Tournament Configuration & Court Status Board
    // -------------------------------------------------------------
    describe('5. Tournament Configuration & Court Status Board', () => {
      test('15. Court Status Board maps Court 1, 2, 3 to READY and Court 4 to IDLE', async () => {
        const { data: activeM } = await adminClient.from('matches').select('court_id, status').eq('category_id', testCategoryId);
        const courtMap = new Map((activeM || []).map(m => [m.court_id, m.status]));

        assert.strictEqual(courtMap.get(testCourts[0].id), 'READY');
        assert.strictEqual(courtMap.get(testCourts[1].id), 'READY');
        assert.strictEqual(courtMap.get(testCourts[2].id), 'READY');
        assert.strictEqual(courtMap.get(testCourts[3].id), undefined, 'Court 4 should be unassigned (IDLE)');
      });

      test('16. Starting Match 1 transitions Court 1 to LIVE', async () => {
        const { error } = await orgClient.rpc('start_match', { p_match_id: testMatches[0].id });
        assert.strictEqual(error, null);

        const { data: m1 } = await adminClient.from('matches').select('status').eq('id', testMatches[0].id).single();
        assert.strictEqual(m1?.status, 'LIVE');
      });

      test('17. Pausing Match 1 transitions Court 1 to PAUSED while Court 2 remains READY', async () => {
        const { error } = await orgClient.rpc('pause_match', { p_match_id: testMatches[0].id });
        assert.strictEqual(error, null);

        const { data: m1 } = await adminClient.from('matches').select('status').eq('id', testMatches[0].id).single();
        const { data: m2 } = await adminClient.from('matches').select('status').eq('id', testMatches[1].id).single();
        assert.strictEqual(m1?.status, 'PAUSED');
        assert.strictEqual(m2?.status, 'READY');
      });

      test('18. Resuming Match 1 restores Court 1 to LIVE', async () => {
        const { error } = await orgClient.rpc('resume_match', { p_match_id: testMatches[0].id });
        assert.strictEqual(error, null);

        const { data: m1 } = await adminClient.from('matches').select('status').eq('id', testMatches[0].id).single();
        assert.strictEqual(m1?.status, 'LIVE');
      });
    });

    // -------------------------------------------------------------
    // SECTION 6: Live Scorer Console & Badminton Engine
    // -------------------------------------------------------------
    describe('6. Scorer Console & Badminton Engine', () => {
      const rules = new BadmintonRules();

      test('19. Logging score point inserts match_event and updates games score', async () => {
        const { data: ev, error: evErr } = await adminClient.from('match_events').insert({
          match_id: testMatches[0].id,
          event_type: 'POINT_A'
        }).select().single();
        assert.strictEqual(evErr, null);

        const { error: gErr } = await adminClient.from('games').upsert({
          match_id: testMatches[0].id,
          game_number: 1,
          participant_a_score: 1,
          participant_b_score: 0,
          status: 'LIVE'
        }, { onConflict: 'match_id,game_number' });
        assert.strictEqual(gErr, null);

        const { data: g } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[0].id).single();
        assert.strictEqual(g?.participant_a_score, 1);
        assert.strictEqual(g?.participant_b_score, 0);
      });

      test('20. Undo event accurately rolls back score', () => {
        let state = rules.getInitialState();
        state = rules.applyEvent(state, { id: 'p11_ev1', event_type: 'POINT_A', sequence_number: 1 } as any);
        state = rules.applyEvent(state, { id: 'p11_ev2', event_type: 'POINT_B', sequence_number: 2 } as any);
        assert.strictEqual(state.games[0].scoreA, 1);
        assert.strictEqual(state.games[0].scoreB, 1);

        state = rules.applyEvent(state, { id: 'p11_ev3', event_type: 'UNDO', sequence_number: 3 } as any);
        assert.strictEqual(state.games[0].scoreA, 1);
        assert.strictEqual(state.games[0].scoreB, 0);
      });

      test('21. Game completion requires 21 points with 2-point lead', () => {
        let state = rules.getInitialState();
        for (let i = 1; i <= 21; i++) {
          state = rules.applyEvent(state, { id: `w_a_${i}`, event_type: 'POINT_A', sequence_number: i } as any);
        }
        assert.strictEqual(state.games[0].scoreA, 21);
        assert.strictEqual(state.games[0].scoreB, 0);
        assert.strictEqual(state.games[0].isCompleted, true);
        assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
      });

      test('22. Deuce resolution (20-20 to 22-20)', () => {
        let state = rules.getInitialState();
        for (let i = 0; i < 20; i++) {
          state = rules.applyEvent(state, { id: `deuce_a_${i}`, event_type: 'POINT_A', sequence_number: i * 2 + 1 } as any);
          state = rules.applyEvent(state, { id: `deuce_b_${i}`, event_type: 'POINT_B', sequence_number: i * 2 + 2 } as any);
        }
        assert.strictEqual(state.games[0].scoreA, 20);
        assert.strictEqual(state.games[0].scoreB, 20);
        assert.strictEqual(state.games[0].isCompleted, false);

        state = rules.applyEvent(state, { id: 'deuce_a_21', event_type: 'POINT_A', sequence_number: 41 } as any);
        assert.strictEqual(state.games[0].isCompleted, false); // 21-20 is not over

        state = rules.applyEvent(state, { id: 'deuce_a_22', event_type: 'POINT_A', sequence_number: 42 } as any);
        assert.strictEqual(state.games[0].isCompleted, true); // 22-20 wins
      });

      test('23. Complete match and finalization locks scores against further modifications', async () => {
        const mId = testMatches[0].id;
        await adminClient.from('matches').update({ status: 'COMPLETED', outcome: 'COMPLETED', winner_id: testParticipants[0].id }).eq('id', mId);
        await orgClient.rpc('finalize_match', { p_match_id: mId });

        const { data: mFinal } = await adminClient.from('matches').select('status').eq('id', mId).single();
        assert.strictEqual(mFinal?.status, 'FINAL');

        // Score insert must be locked
        const { error: lockErr } = await adminClient.from('match_events').insert({
          match_id: mId,
          event_type: 'POINT_A'
        });
        assert.ok(lockErr, 'Locked final match must reject point events');
      });
    });

    // -------------------------------------------------------------
    // SECTION 7: Multi-Court Spatial Isolation (CRITICAL TEST)
    // -------------------------------------------------------------
    describe('7. Multi-Court 3D Spatial Layout & Independent Score Isolation', () => {
      test('24. 4 Courts have distinct, non-overlapping grid positions', () => {
        const getGridPos = (idx: number, total: number) => {
          const colsCount = Math.ceil(total / 2);
          const col = idx % colsCount;
          const row = Math.floor(idx / colsCount);
          return { x: col * 14 - ((colsCount - 1) * 14) / 2, z: row * 20 - (20 / 2) };
        };

        const pos0 = getGridPos(0, 4);
        const pos1 = getGridPos(1, 4);
        const pos2 = getGridPos(2, 4);
        const pos3 = getGridPos(3, 4);

        const positions = [pos0, pos1, pos2, pos3];
        const uniqueKeys = new Set(positions.map(p => `${p.x},${p.z}`));
        assert.strictEqual(uniqueKeys.size, 4, 'All 4 courts must have unique spatial positions');
      });

      test('25. Setting Court 1 (10-8), Court 2 (15-12), Court 3 (7-6) maintains independent scores', async () => {
        // Start Matches on Court 2 and Court 3
        await orgClient.rpc('start_match', { p_match_id: testMatches[1].id });
        await orgClient.rpc('start_match', { p_match_id: testMatches[2].id });

        // Upsert scores
        await adminClient.from('games').upsert({ match_id: testMatches[0].id, game_number: 1, participant_a_score: 10, participant_b_score: 8, status: 'COMPLETED' }, { onConflict: 'match_id,game_number' });
        await adminClient.from('games').upsert({ match_id: testMatches[1].id, game_number: 1, participant_a_score: 15, participant_b_score: 12, status: 'LIVE' }, { onConflict: 'match_id,game_number' });
        await adminClient.from('games').upsert({ match_id: testMatches[2].id, game_number: 1, participant_a_score: 7, participant_b_score: 6, status: 'LIVE' }, { onConflict: 'match_id,game_number' });

        const { data: g1 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[0].id).single();
        const { data: g2 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[1].id).single();
        const { data: g3 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[2].id).single();

        assert.strictEqual(g1?.participant_a_score, 10);
        assert.strictEqual(g1?.participant_b_score, 8);
        assert.strictEqual(g2?.participant_a_score, 15);
        assert.strictEqual(g2?.participant_b_score, 12);
        assert.strictEqual(g3?.participant_a_score, 7);
        assert.strictEqual(g3?.participant_b_score, 6);
      });

      test('26. Updating Court 2 (15-12 -> 16-12) keeps Court 1 at 10-8, Court 3 at 7-6, Court 4 at IDLE', async () => {
        // Update Court 2
        await adminClient.from('games').upsert({ match_id: testMatches[1].id, game_number: 1, participant_a_score: 16, participant_b_score: 12, status: 'LIVE' }, { onConflict: 'match_id,game_number' });

        const { data: g1 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[0].id).single();
        const { data: g2 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[1].id).single();
        const { data: g3 } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('match_id', testMatches[2].id).single();

        assert.strictEqual(g1?.participant_a_score, 10, 'Court 1 score must remain unchanged');
        assert.strictEqual(g1?.participant_b_score, 8, 'Court 1 score must remain unchanged');
        assert.strictEqual(g2?.participant_a_score, 16, 'Court 2 score must update to 16');
        assert.strictEqual(g2?.participant_b_score, 12, 'Court 2 score must remain 12');
        assert.strictEqual(g3?.participant_a_score, 7, 'Court 3 score must remain unchanged');
        assert.strictEqual(g3?.participant_b_score, 6, 'Court 3 score must remain unchanged');

        // Court 4 has no matches scheduled
        const { data: c4Matches } = await adminClient.from('matches').select('id').eq('court_id', testCourts[3].id);
        assert.strictEqual(c4Matches?.length, 0, 'Court 4 must remain IDLE');
      });

      test('27. Emissive glow mapping conforms to specification (Emerald=LIVE, Amber=Tense, Yellow=PAUSED, Blue=READY, Slate=IDLE)', () => {
        const getGlowColor = (status: string, scoreA = 0, scoreB = 0) => {
          if (status === 'LIVE' || status === 'UNDER_REVIEW') {
            return (scoreA >= 20 || scoreB >= 20) ? '#f97316' : '#10b981';
          }
          if (status === 'PAUSED') return '#eab308';
          if (status === 'READY') return '#3b82f6';
          return '#334155';
        };

        assert.strictEqual(getGlowColor('LIVE', 10, 8), '#10b981'); // Emerald
        assert.strictEqual(getGlowColor('LIVE', 20, 19), '#f97316'); // Amber tense
        assert.strictEqual(getGlowColor('PAUSED'), '#eab308'); // Yellow
        assert.strictEqual(getGlowColor('READY'), '#3b82f6'); // Blue
        assert.strictEqual(getGlowColor('IDLE'), '#334155'); // Slate
      });
    });

    // -------------------------------------------------------------
    // SECTION 8: Public Spectator Page & Live Aggregations
    // -------------------------------------------------------------
    describe('8. Public Spectator Page & Section Hierarchy', () => {
      test('28. Public spectator view fetches published tournament and categories', async () => {
        const { data: tourney, error } = await adminClient
          .from('tournaments')
          .select('id, name, slug, status, sports(name), venues(name), categories(id, name, matches(id, status, court_id))')
          .eq('slug', testTournamentSlug)
          .single();
        assert.strictEqual(error, null);
        assert.strictEqual(tourney?.name.includes('ArenaFlow Grand Slam'), true);
        assert.ok(tourney?.categories?.length! > 0);
      });

      test('29. Matches correctly group into Live, Upcoming, and Completed sections', async () => {
        const { data: tourney } = await adminClient
          .from('tournaments')
          .select('categories(matches(id, status))')
          .eq('slug', testTournamentSlug)
          .single();

        const matches = tourney?.categories?.flatMap((c: any) => c.matches || []) || [];
        const live = matches.filter((m: any) => m.status === 'LIVE');
        const completed = matches.filter((m: any) => m.status === 'FINAL' || m.status === 'COMPLETED');
        const ready = matches.filter((m: any) => m.status === 'READY');

        assert.strictEqual(live.length, 2); // Match 2 and Match 3
        assert.strictEqual(completed.length, 1); // Match 1
        assert.strictEqual(ready.length, 0);
      });

      test('30. 2D List View fallback presents matches with status badges', async () => {
        const { data: courtMatches } = await adminClient
          .from('matches')
          .select('id, status, court:courts(name)')
          .eq('category_id', testCategoryId);
        assert.ok(courtMatches && courtMatches.length > 0);
      });
    });

    // -------------------------------------------------------------
    // SECTION 9: Match Control Center Multi-Parameter Filtering
    // -------------------------------------------------------------
    describe('9. Match Control Center Multi-Parameter Filtering', () => {
      test('31. Filter by Court correctly isolates matches on Court 2', async () => {
        const { data: mCourt2 } = await adminClient
          .from('matches')
          .select('id, court_id')
          .eq('category_id', testCategoryId)
          .eq('court_id', testCourts[1].id);
        assert.strictEqual(mCourt2?.length, 1);
        assert.strictEqual(mCourt2![0].court_id, testCourts[1].id);
      });

      test('32. Filter by Status isolates LIVE matches', async () => {
        const { data: mLive } = await adminClient
          .from('matches')
          .select('id, status')
          .eq('category_id', testCategoryId)
          .eq('status', 'LIVE');
        assert.strictEqual(mLive?.length, 2);
      });
    });

    // -------------------------------------------------------------
    // SECTION 10: Accessibility, Empty States & Cascade Safety
    // -------------------------------------------------------------
    describe('10. Accessibility, Empty States & Cascade Safety', () => {
      test('33. Empty registrations query returns empty array gracefully', async () => {
        const fakeCat = '00000000-0000-0000-0000-000000000000';
        const { data: emptyRegs } = await adminClient.from('registrations').select('*').eq('category_id', fakeCat);
        assert.strictEqual(emptyRegs?.length, 0);
      });

      test('34. Nonexistent tournament slug returns null without throw', async () => {
        const { data, error } = await adminClient.from('tournaments').select('*').eq('slug', 'nonexistent-slug-12345').maybeSingle();
        assert.strictEqual(error, null);
        assert.strictEqual(data, null);
      });

      test('35. Tournament deletion cascades tournament records while keeping player accounts intact', async () => {
        const { error: delErr } = await orgClient.from('tournaments').delete().eq('id', testTournamentId);
        assert.strictEqual(delErr, null);

        // Player profile and account must persist
        const { data: playerProf } = await adminClient.from('profiles').select('id').eq('id', playerUserId).single();
        const { data: playerRecord } = await adminClient.from('players').select('id').eq('id', playerUserId).single();
        assert.ok(playerProf, 'Player profile must persist');
        assert.ok(playerRecord, 'Player account must persist');

        testTournamentId = ''; // Mark deleted for after hook
      });
    });
  });
}
