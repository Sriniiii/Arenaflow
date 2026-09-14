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
  describe('Phase 5 Integration Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 5 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 5 Integration Test Suite', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let playerClient: SupabaseClient;
    
    const emails = {
      org: 'p5-org@arenaflow.test',
      playerA: 'p5-player-a@arenaflow.test',
      playerB: 'p5-player-b@arenaflow.test',
    };
    
    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let tournamentId: string;
    let categoryId: string;
    let participantAId: string;
    let participantBId: string;
    let matchId: string;

    before(async () => {
      adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

      console.log('Cleaning up old test users...');
      for (const email of Object.values(emails)) {
        const { data: search } = await adminClient.auth.admin.listUsers();
        const existingUser = search?.users.find(u => u.email === email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }

      console.log('Creating test users for Phase 5...');
      const { data: orgUser } = await adminClient.auth.admin.createUser({ email: emails.org, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Phase 5 Org' } });
      const { data: paUser } = await adminClient.auth.admin.createUser({ email: emails.playerA, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 5A' } });
      const { data: pbUser } = await adminClient.auth.admin.createUser({ email: emails.playerB, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 5B' } });
      
      userIds.org = orgUser.user!.id;
      userIds.playerA = paUser.user!.id;
      userIds.playerB = pbUser.user!.id;

      // Seed profiles
      for (const uid of [userIds.playerA, userIds.playerB]) {
        await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
        await adminClient.from('profiles').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
      }

      // Log in clients
      orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgClient.auth.signInWithPassword({ email: emails.org, password });

      playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerClient.auth.signInWithPassword({ email: emails.playerA, password });

      // Create Sport, Venue
      let { data: sport } = await adminClient.from('sports').select('id').eq('name', 'Phase 5 Badminton').maybeSingle();
      if (!sport) {
        const { data: inserted } = await adminClient.from('sports').insert({ name: 'Phase 5 Badminton', slug: 'phase-5-badminton' }).select('id').single();
        sport = inserted;
      }
      sportId = sport!.id;

      const { data: venue } = await adminClient.from('venues').insert({ owner_id: userIds.org, name: 'Badminton Hall', address: 'Delhi', city: 'Delhi', country: 'India' }).select('id').single();
      venueId = venue!.id;

      // Create Tournament
      const uniqueSlug = `delhi-open-phase-5-${Math.random().toString(36).substring(2, 7)}`;
      const { data: tourney } = await adminClient.from('tournaments').insert({
        organizer_id: userIds.org,
        sport_id: sportId,
        venue_id: venueId,
        name: 'Delhi Open Phase 5',
        slug: uniqueSlug,
        start_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
        registration_open: new Date().toISOString(),
        registration_close: new Date(Date.now() + 86400000).toISOString(),
        status: 'PUBLISHED'
      }).select('id').single();
      tournamentId = tourney!.id;

      // Create Category
      const { data: cat } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Men Singles P5',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT',
        registration_fee: 10,
        max_participants: 8
      }).select('id').single();
      categoryId = cat!.id;

      // Create active participants
      const { data: partA } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
      const { data: partB } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
      participantAId = partA!.id;
      participantBId = partB!.id;

      await adminClient.from('participant_members').insert({ participant_id: participantAId, player_id: userIds.playerA, member_order: 1 });
      await adminClient.from('participant_members').insert({ participant_id: participantBId, player_id: userIds.playerB, member_order: 1 });

      // Create Match
      const { data: match } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'LIVE'
      }).select('id').single();
      matchId = match!.id;
    });

    after(async () => {
      console.log('Cleaning up Phase 5 test data...');
      if (tournamentId) {
        await adminClient.from('tournaments').delete().eq('id', tournamentId);
      }
      if (sportId) {
        await adminClient.from('sports').delete().eq('id', sportId);
      }
      if (venueId) {
        await adminClient.from('venues').delete().eq('id', venueId);
      }
      for (const email of Object.values(emails)) {
        const { data: search } = await adminClient.auth.admin.listUsers();
        const existingUser = search?.users.find(u => u.email === email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }
    });

    test('1. Scorer authorization checks', async () => {
      // Organizer should be authorized
      const { data: orgAuth, error: errA } = await orgClient.rpc('can_score_match', { m_id: matchId, u_id: userIds.org });
      assert.ifError(errA);
      assert.strictEqual(orgAuth, true);

      // Random player not assigned to score should NOT be authorized
      const { data: pAuth, error: errB } = await playerClient.rpc('can_score_match', { m_id: matchId, u_id: userIds.playerA });
      assert.ifError(errB);
      assert.strictEqual(pAuth, false);
    });

    test('2. Live score point logging and games table sync', async () => {
      // 1. Insert POINT_A event as organizer
      const { data: evA, error: err1 } = await orgClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 1,
          event_type: 'POINT_A'
        })
        .select()
        .single();
      assert.ifError(err1);

      // Sync games table
      const { error: gErr1 } = await orgClient
        .from('games')
        .upsert({
          match_id: matchId,
          game_number: 1,
          participant_a_score: 1,
          participant_b_score: 0,
          status: 'LIVE'
        }, { onConflict: 'match_id,game_number' });
      assert.ifError(gErr1);

      // Verify games score is updated
      const { data: game } = await orgClient
        .from('games')
        .select('*')
        .eq('match_id', matchId)
        .eq('game_number', 1)
        .single();

      assert.strictEqual(game.participant_a_score, 1);
      assert.strictEqual(game.participant_b_score, 0);
      assert.strictEqual(game.status, 'LIVE');
    });

    test('3. Scorer Undo logic with games restoration', async () => {
      // 1. Insert POINT_B event
      const { data: evB, error: err2 } = await orgClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 2,
          event_type: 'POINT_B'
        })
        .select()
        .single();
      assert.ifError(err2);

      // Sync games score to 1-1
      const { error: gErr2 } = await orgClient
        .from('games')
        .upsert({
          match_id: matchId,
          game_number: 1,
          participant_a_score: 1,
          participant_b_score: 1,
          status: 'LIVE'
        }, { onConflict: 'match_id,game_number' });
      assert.ifError(gErr2);

      // 2. Scorer performs Undo -> Insert UNDO event
      const { data: evUndo, error: err3 } = await orgClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 3,
          event_type: 'UNDO'
        })
        .select()
        .single();
      assert.ifError(err3);

      // Read events history and reconstruct score locally
      const { data: eventsData } = await orgClient
        .from('match_events')
        .select('*')
        .eq('match_id', matchId)
        .order('sequence_number', { ascending: true });

      const rules = new BadmintonRules();
      let state = rules.getInitialState();
      for (const e of eventsData || []) {
        state = rules.applyEvent(state, e);
      }

      // Reconstructed score should have scoreB = 0 (undone)
      assert.strictEqual(state.games[0].scoreA, 1);
      assert.strictEqual(state.games[0].scoreB, 0);

      // Sync the reconstructed score back to the database
      const { error: gErrSync } = await orgClient
        .from('games')
        .upsert({
          match_id: matchId,
          game_number: 1,
          participant_a_score: state.games[0].scoreA,
          participant_b_score: state.games[0].scoreB,
          status: 'LIVE'
        }, { onConflict: 'match_id,game_number' });
      assert.ifError(gErrSync);

      const { data: finalGame } = await orgClient
        .from('games')
        .select('*')
        .eq('match_id', matchId)
        .eq('game_number', 1)
        .single();

      assert.strictEqual(finalGame.participant_a_score, 1);
      assert.strictEqual(finalGame.participant_b_score, 0);
    });

    test('4. Complete match scoring and brackets advancement', async () => {
      // Simulate straight games win (2 games won by A)
      const rules = new BadmintonRules();
      let state = rules.getInitialState();

      // Generate 21 POINT_A events for game 1
      const eventsToInsert = [];
      let seqNum = 4; // Continue sequence
      
      for (let i = 0; i < 21; i++) {
        eventsToInsert.push({
          match_id: matchId,
          sequence_number: seqNum++,
          event_type: 'POINT_A'
        });
      }
      // Generate 21 POINT_A events for game 2
      for (let i = 0; i < 21; i++) {
        eventsToInsert.push({
          match_id: matchId,
          sequence_number: seqNum++,
          event_type: 'POINT_A'
        });
      }

      // Insert all events
      const { error: bulkErr } = await adminClient.from('match_events').insert(eventsToInsert);
      assert.ifError(bulkErr);

      // Fetch all events and calculate reconstructed final state
      const { data: allEvents } = await adminClient
        .from('match_events')
        .select('*')
        .eq('match_id', matchId)
        .order('sequence_number', { ascending: true });

      for (const e of allEvents || []) {
        state = rules.applyEvent(state, e);
      }

      assert.strictEqual(state.isCompleted, true);
      assert.strictEqual(state.winnerId, 'PARTICIPANT_A');

      // Trigger complete match advancement
      const { error: rpcErr } = await adminClient.rpc('complete_match_and_advance', {
        p_match_id: matchId,
        p_winner_id: participantAId,
        p_status: 'COMPLETED',
        p_outcome: 'COMPLETED'
      });
      assert.ifError(rpcErr);

      // Verify match state is completed with winner set
      const { data: finalMatch } = await adminClient
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .single();

      assert.strictEqual(finalMatch.status, 'COMPLETED');
      assert.strictEqual(finalMatch.winner_id, participantAId);
    });
  });
}
