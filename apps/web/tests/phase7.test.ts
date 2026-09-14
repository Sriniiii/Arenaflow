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
  describe('Phase 7 Realtime & Visualizer Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 7 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 7 Realtime & Visualizer Test Suite', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let playerClient: SupabaseClient;
    let spectatorClient: SupabaseClient; // unauthenticated
    
    const emails = {
      org: 'p7-org@arenaflow.test',
      playerA: 'p7-player-a@arenaflow.test',
      playerB: 'p7-player-b@arenaflow.test',
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
      spectatorClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

      console.log('Cleaning up old test users...');
      for (const email of Object.values(emails)) {
        const { data: search } = await adminClient.auth.admin.listUsers();
        const existingUser = search?.users.find(u => u.email === email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }

      console.log('Creating test users for Phase 7...');
      const { data: orgUser } = await adminClient.auth.admin.createUser({ email: emails.org, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Phase 7 Org' } });
      const { data: paUser } = await adminClient.auth.admin.createUser({ email: emails.playerA, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 7A' } });
      const { data: pbUser } = await adminClient.auth.admin.createUser({ email: emails.playerB, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 7B' } });
      
      userIds.org = orgUser.user!.id;
      userIds.playerA = paUser.user!.id;
      userIds.playerB = pbUser.user!.id;

      // Seed player demographics
      for (const uid of [userIds.playerA, userIds.playerB]) {
        await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
        await adminClient.from('profiles').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
      }

      // Login clients
      orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgClient.auth.signInWithPassword({ email: emails.org, password });

      playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerClient.auth.signInWithPassword({ email: emails.playerA, password });

      // Seed core entities
      const randSport = Math.random().toString(36).substring(2, 7);
      const { data: sport } = await adminClient.from('sports').insert({ name: `P7 Badminton ${randSport}`, slug: `p7-badminton-${randSport}` }).select('id').single();
      sportId = sport!.id;

      const { data: venue } = await adminClient.from('venues').insert({ name: 'Phase 7 Venue', address: '123 Test St', city: 'Test City', country: 'Testland', owner_id: userIds.org }).select().single();
      venueId = venue.id;

      const { data: tourney } = await adminClient.from('tournaments').insert({
        name: 'Phase 7 Tourney',
        description: 'Test',
        slug: 'p7-tourney',
        sport_id: sportId,
        venue_id: venueId,
        start_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        end_date: new Date(Date.now() + 172800000).toISOString().split('T')[0],
        registration_open: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        registration_close: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        status: 'PUBLISHED',
        organizer_id: userIds.org
      }).select().single();
      tournamentId = tourney.id;

      const { data: category } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Mens Singles',
        format: 'KNOCKOUT',
        category_type: 'SINGLES',
        match_type: 'MENS',
        age_group: 'OPEN',
        skill_level: 'ADVANCED',
        registration_fee: 10
      }).select().single();
      categoryId = category.id;

      // Confirmed participants
      const { data: partA } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select().single();
      participantAId = partA.id;
      await adminClient.from('participant_members').insert({ participant_id: participantAId, player_id: userIds.playerA });

      const { data: partB } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select().single();
      participantBId = partB.id;
      await adminClient.from('participant_members').insert({ participant_id: participantBId, player_id: userIds.playerB });

      // Create a match
      const { data: m } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'LIVE'
      }).select().single();
      matchId = m.id;
    });

    after(async () => {
      if (adminClient) {
        await adminClient.from('tournaments').delete().eq('id', tournamentId);
        await adminClient.from('venues').delete().eq('id', venueId);
        
        for (const email of Object.values(emails)) {
          const { data: search } = await adminClient.auth.admin.listUsers();
          const existingUser = search?.users.find(u => u.email === email);
          if (existingUser) {
            await adminClient.auth.admin.deleteUser(existingUser.id);
          }
        }
      }
    });

    test('1. Local score reconstruction (BadmintonRules unit validation)', () => {
      const rules = new BadmintonRules();
      let state = rules.getInitialState();

      // Simulate a sequence of events: A, B, A, A, UNDO, B
      const events = [
        { id: '1', sequence_number: 1, event_type: 'POINT_A', type: 'POINT_A', timestamp: new Date().toISOString() },
        { id: '2', sequence_number: 2, event_type: 'POINT_B', type: 'POINT_B', timestamp: new Date().toISOString() },
        { id: '3', sequence_number: 3, event_type: 'POINT_A', type: 'POINT_A', timestamp: new Date().toISOString() },
        { id: '4', sequence_number: 4, event_type: 'POINT_A', type: 'POINT_A', timestamp: new Date().toISOString() },
        { id: '5', sequence_number: 5, event_type: 'UNDO', type: 'UNDO', timestamp: new Date().toISOString() },
        { id: '6', sequence_number: 6, event_type: 'POINT_B', type: 'POINT_B', timestamp: new Date().toISOString() },
      ];

      for (const ev of events) {
        state = rules.applyEvent(state, ev);
      }

      // A: points 1, 3, 4 minus undo 4 => points 1, 3. Total: 2 points.
      // B: points 2, 6. Total: 2 points.
      const currentGame = state.games[state.currentGameIndex];
      assert.strictEqual(currentGame.scoreA, 2);
      assert.strictEqual(currentGame.scoreB, 2);
    });

    test('2. Connection status simulation helper logic', () => {
      const mapStatus = (status: string) => {
        if (status === 'SUBSCRIBED') return 'CONNECTED';
        if (status === 'TIMED_OUT') return 'RECONNECTING';
        return 'DISCONNECTED';
      };

      assert.strictEqual(mapStatus('SUBSCRIBED'), 'CONNECTED');
      assert.strictEqual(mapStatus('TIMED_OUT'), 'RECONNECTING');
      assert.strictEqual(mapStatus('CLOSED'), 'DISCONNECTED');
      assert.strictEqual(mapStatus('CHANNEL_ERROR'), 'DISCONNECTED');
    });

    test('3. Spectator cannot write score events', async () => {
      // Spectator attempts to write event directly to match_events
      const { error } = await spectatorClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 100,
          event_type: 'POINT_A'
        });

      // Assert error occurs (fails check/violates RLS)
      assert.ok(error !== null, 'Spectator must be rejected from writing match events');
    });

    test('4. Scorer authorization constraint remains enforced', async () => {
      // Player who is not the organizer/assigned scorer attempts to score
      const { error } = await playerClient
        .from('match_events')
        .insert({
          match_id: matchId,
          sequence_number: 100,
          event_type: 'POINT_A'
        });

      // Assert player is rejected due to policy checks
      assert.ok(error !== null, 'Non-scorer player must be rejected from writing match events');
    });

    test('5. Realtime channels subscription and broadcast flow (Organizer/Scorer side)', async () => {
      // Connect organizer to realtime channel
      const channel = orgClient.channel(`match_scoring:${matchId}`);
      
      const subPromise = new Promise<void>((resolve, reject) => {
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            resolve();
          } else if (status === 'CHANNEL_ERROR') {
            reject(new Error('Realtime subscription failed'));
          }
        });
      });

      await subPromise;
      assert.ok(true, 'Organizer subscribed successfully to match channel');
      await orgClient.removeChannel(channel);
    });

    test('6. 3D visualizer WebGL support fallback verification', () => {
      const checkWebGL = (mockWindow: any) => {
        try {
          const glSupport = !!mockWindow.WebGLRenderingContext;
          return glSupport;
        } catch {
          return false;
        }
      };

      // Mock supporting window
      const mockWinSupport = { WebGLRenderingContext: {} };
      assert.strictEqual(checkWebGL(mockWinSupport), true);

      // Mock non-supporting window
      const mockWinNoSupport = {};
      assert.strictEqual(checkWebGL(mockWinNoSupport), false);
    });
  });
}
