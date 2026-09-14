import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Helper to load env variables manually from root if not loaded
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
  describe('Security and RLS Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING SECURITY TESTS: SUPABASE_SERVICE_ROLE_KEY or SUPABASE env variables are missing.');
      console.warn('Ensure you have a .env file containing the URL, Anon Key, and Service Role Key.');
      assert.ok(true);
    });
  });
} else {
  describe('Security and RLS Test Suite', () => {
    let adminClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let playerClient: SupabaseClient;
    let orgAClient: SupabaseClient;
    let orgBClient: SupabaseClient;
    let scorerClient: SupabaseClient;

    const emails = {
      player: 'test-player@arenaflow.test',
      orgA: 'test-org-a@arenaflow.test',
      orgB: 'test-org-b@arenaflow.test',
      scorer: 'test-scorer@arenaflow.test',
    };
    
    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let tournamentIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let categoryId: string;
    let matchId: string;

    before(async () => {
      // 1. Initialize Clients
      adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
      anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

      console.log('Cleaning up old test users if any...');
      for (const email of Object.values(emails)) {
        const { data: search } = await adminClient.auth.admin.listUsers();
        const existingUser = search?.users.find(u => u.email === email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }

      console.log('Creating test users...');
      // Player Signup
      const { data: pUser, error: pErr } = await adminClient.auth.admin.createUser({
        email: emails.player,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Test Player', role: 'PLAYER' }
      });
      if (pErr) throw pErr;
      userIds.player = pUser.user.id;

      // Organizer A Signup
      const { data: oaUser, error: oaErr } = await adminClient.auth.admin.createUser({
        email: emails.orgA,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Organizer A', role: 'ORGANIZER' }
      });
      if (oaErr) throw oaErr;
      userIds.orgA = oaUser.user.id;

      // Organizer B Signup
      const { data: obUser, error: obErr } = await adminClient.auth.admin.createUser({
        email: emails.orgB,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Organizer B', role: 'ORGANIZER' }
      });
      if (obErr) throw obErr;
      userIds.orgB = obUser.user.id;

      // Scorer Signup
      const { data: sUser, error: sErr } = await adminClient.auth.admin.createUser({
        email: emails.scorer,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Test Scorer', role: 'SCORER' }
      });
      if (sErr) throw sErr;
      userIds.scorer = sUser.user.id;

      // 2. Sign In to instantiate separate clients for each role
      playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerClient.auth.signInWithPassword({ email: emails.player, password });

      orgAClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgAClient.auth.signInWithPassword({ email: emails.orgA, password });

      orgBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgBClient.auth.signInWithPassword({ email: emails.orgB, password });

      scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await scorerClient.auth.signInWithPassword({ email: emails.scorer, password });

      // 3. Setup Test Data (Sport and Tournaments)
      // Retrieve or create Badminton sport
      const { data: sport } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
      if (sport) {
        sportId = sport.id;
      } else {
        const { data: newSport, error: sportErr } = await adminClient.from('sports').insert({
          name: 'Badminton',
          slug: 'badminton',
          is_active: true
        }).select('id').single();
        if (sportErr) throw sportErr;
        sportId = newSport.id;
      }

      // Create Venue
      const { data: venue, error: venueErr } = await adminClient.from('venues').insert({
        name: 'Main Arena'
      }).select('id').single();
      if (venueErr) throw venueErr;
      venueId = venue.id;

      // Create Draft Tournament (Organizer A)
      const { data: draftTourney, error: dtErr } = await adminClient.from('tournaments').insert({
        name: 'Draft Cup A',
        slug: 'draft-cup-a',
        sport_id: sportId,
        organizer_id: userIds.orgA,
        status: 'DRAFT'
      }).select('id').single();
      if (dtErr) throw dtErr;
      tournamentIds.draft = draftTourney.id;

      // Create Published Tournament (Organizer A)
      const { data: pubTourney, error: ptErr } = await adminClient.from('tournaments').insert({
        name: 'Published Open A',
        slug: 'pub-open-a',
        sport_id: sportId,
        organizer_id: userIds.orgA,
        status: 'PUBLISHED'
      }).select('id').single();
      if (ptErr) throw ptErr;
      tournamentIds.published = pubTourney.id;

      // Create category for the published tournament
      const { data: cat, error: catErr } = await adminClient.from('categories').insert({
        tournament_id: tournamentIds.published,
        name: 'Mens Singles V1',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT'
      }).select('id').single();
      if (catErr) throw catErr;
      categoryId = cat.id;

      // Create two participants
      const { data: pA, error: pAErr } = await adminClient.from('participants').insert({
        category_id: categoryId,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }).select('id').single();
      if (pAErr) throw pAErr;

      const { data: pB, error: pBErr } = await adminClient.from('participants').insert({
        category_id: categoryId,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }).select('id').single();
      if (pBErr) throw pBErr;

      // Assign members to satisfy constraints/triggers
      await adminClient.from('participant_members').insert({
        participant_id: pA.id,
        player_id: userIds.player,
        member_order: 1
      });
      await adminClient.from('participant_members').insert({
        participant_id: pB.id,
        player_id: userIds.scorer,
        member_order: 1
      });

      // Create match inside that category with both participants
      const { data: match, error: matchErr } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: pA.id,
        participant_b_id: pB.id,
        status: 'SCHEDULED'
      }).select('id').single();
      if (matchErr) throw matchErr;
      matchId = match.id;
    });

    after(async () => {
      console.log('Cleaning up test data...');
      if (tournamentIds.draft) await adminClient.from('tournaments').delete().eq('id', tournamentIds.draft);
      if (tournamentIds.published) await adminClient.from('tournaments').delete().eq('id', tournamentIds.published);
      if (venueId) await adminClient.from('venues').delete().eq('id', venueId);
      
      for (const uid of Object.values(userIds)) {
        await adminClient.auth.admin.deleteUser(uid);
      }
    });

    test('1. Anonymous/Spectator RLS Restrictions', async () => {
      // Spectator attempts to view draft tournament (should be blank/empty due to RLS select)
      const { data: draftSelect } = await anonClient
        .from('tournaments')
        .select('*')
        .eq('id', tournamentIds.draft);
      
      assert.strictEqual(draftSelect?.length, 0, 'Anonymous users must not be able to read DRAFT tournaments');

      // Spectator attempts to view published tournament (should succeed)
      const { data: pubSelect } = await anonClient
        .from('tournaments')
        .select('*')
        .eq('id', tournamentIds.published);

      assert.strictEqual(pubSelect?.length, 1, 'Anonymous users must be able to read PUBLISHED tournaments');
      assert.strictEqual(pubSelect[0].name, 'Published Open A');
    });

    test('2. Organizer Isolation & CRUD', async () => {
      // Organizer A attempts to read their own draft tournament (should succeed)
      const { data: orgASelect } = await orgAClient
        .from('tournaments')
        .select('*')
        .eq('id', tournamentIds.draft);
      assert.strictEqual(orgASelect?.length, 1, 'Organizer must be able to read their own DRAFT tournaments');

      // Organizer B attempts to read Organizer A's draft tournament (should return empty due to RLS)
      const { data: orgBSelect } = await orgBClient
        .from('tournaments')
        .select('*')
        .eq('id', tournamentIds.draft);
      assert.strictEqual(orgBSelect?.length, 0, 'Organizer must NOT be able to read another organizer\'s DRAFT tournaments');

      // Organizer B attempts to update Organizer A's published tournament (should not update any rows)
      const { data: updateData, error: updateErr } = await orgBClient
        .from('tournaments')
        .update({ name: 'Hacked name' })
        .eq('id', tournamentIds.published)
        .select();

      assert.strictEqual(updateData?.length, 0, 'Organizer must NOT be able to modify another organizer\'s tournament');
    });

    test('3. Scorer Permissions Boundaries', async () => {
      // Scorer client attempts to insert match event to unassigned match (should fail RLS)
      const { data: eventFail, error: errFail } = await scorerClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 1,
          event_type: 'POINT_A'
        });

      assert.ok(errFail, 'Unassigned scorer must be blocked from inserting match events');

      // Assign scorer to match using admin client
      const { error: assignErr } = await adminClient
        .from('match_scorers')
        .insert({
          match_id: matchId,
          user_id: userIds.scorer
        });
      assert.ifError(assignErr);

      // Ensure match is LIVE so scoring is allowed under Phase 6 rules
      const { error: liveErr } = await adminClient
        .from('matches')
        .update({ status: 'LIVE' })
        .eq('id', matchId);
      assert.ifError(liveErr);

      // Scorer client attempts to insert match event to assigned match (should succeed)
      const { data: eventOk, error: errOk } = await scorerClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 1,
          event_type: 'POINT_A'
        })
        .select();

      assert.ifError(errOk);
      assert.strictEqual(eventOk?.length, 1, 'Assigned scorer must be able to insert match events');

      // Clean up assignment
      await adminClient.from('match_scorers').delete().eq('match_id', matchId);
    });

    test('4. DB-level Role Protection (Self-Promotion Prevention)', async () => {
      // Get Player profile role
      const { data: profilePre } = await playerClient
        .from('profiles')
        .select('role')
        .eq('id', userIds.player)
        .single();
      
      assert.strictEqual(profilePre?.role, 'PLAYER');

      // Player attempts to self-update their role to PLATFORM_ADMIN
      await playerClient
        .from('profiles')
        .update({ role: 'PLATFORM_ADMIN' })
        .eq('id', userIds.player);

      // Fetch profile again, check that role remains PLAYER (reverted by trigger)
      const { data: profilePost } = await playerClient
        .from('profiles')
        .select('role')
        .eq('id', userIds.player)
        .single();

      assert.strictEqual(profilePost?.role, 'PLAYER', 'Self-promotion attempt must be silently reverted by DB triggers');
    });

    test('5. Audit Log Immutability and Write Restrictions', async () => {
      // Player attempts to insert into audit logs directly (should be blocked by RLS `check(false)`)
      const { error: insertErr } = await playerClient
        .from('audit_logs')
        .insert({
          actor_id: userIds.player,
          action: 'HACK',
          target_type: 'profiles',
          target_id: userIds.player
        });

      assert.ok(insertErr, 'Direct client inserts to audit logs must be blocked by RLS');

      // Admin attempts to query audit logs (should succeed)
      const { data: logs } = await adminClient
        .from('audit_logs')
        .select('*');
      
      assert.ok(Array.isArray(logs), 'Admin client must be able to view audit logs');
    });
  });
}
