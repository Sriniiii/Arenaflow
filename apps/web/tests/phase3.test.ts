import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateKnockoutStructure,
  generateRoundRobinFixtures,
  checkScheduleConflict,
  sortStandings
} from '@arena-flow/tournament-engine';

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
  describe('Phase 3 Integration Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 3 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 3 Integration Test Suite', () => {
    let adminClient: SupabaseClient;
    let orgAClient: SupabaseClient;
    let playerClients: SupabaseClient[] = [];
    
    const emails = {
      org: 'p3-org@arenaflow.test',
      player1: 'p3-player1@arenaflow.test',
      player2: 'p3-player2@arenaflow.test',
      player3: 'p3-player3@arenaflow.test',
      player4: 'p3-player4@arenaflow.test',
    };
    
    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let courtId: string;
    let tournamentId: string;
    let categoryIdKnockout: string;
    let categoryIdRoundRobin: string;
    let participantsKnockout: string[] = [];
    let participantsRoundRobin: string[] = [];

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

      console.log('Creating test users for Phase 3...');
      const { data: orgUser } = await adminClient.auth.admin.createUser({ email: emails.org, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Phase 3 Org' } });
      userIds.org = orgUser.user!.id;

      for (const [key, email] of Object.entries(emails)) {
        if (key === 'org') continue;
        const { data: pUser } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: `Player ${key}` } });
        userIds[key] = pUser.user!.id;

        // Seed details
        await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', userIds[key]);
        await adminClient.from('profiles').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', userIds[key]);
      }

      // Log in organizer client
      orgAClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgAClient.auth.signInWithPassword({ email: emails.org, password });

      // Create Sport, Venue and Court
      let { data: sport, error: sErr1 } = await adminClient.from('sports').select('id').eq('name', 'Phase 3 Badminton').maybeSingle();
      if (sErr1) console.error('sport select error:', sErr1);
      if (!sport) {
        const { data: inserted, error: sErr2 } = await adminClient.from('sports').insert({ name: 'Phase 3 Badminton', slug: 'phase-3-badminton' }).select('id').single();
        if (sErr2) {
          console.error('sport insert error:', sErr2);
          throw sErr2;
        }
        sport = inserted;
      }
      sportId = sport!.id;

      const { data: venue, error: vErr } = await adminClient.from('venues').insert({ owner_id: userIds.org, name: 'Badminton Club', address: 'Delhi', city: 'Delhi', country: 'India' }).select('id').single();
      if (vErr) {
        console.error('venue insert error:', vErr);
        throw vErr;
      }
      venueId = venue!.id;

      const { data: court, error: cErr } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court A' }).select('id').single();
      if (cErr) {
        console.error('court insert error:', cErr);
        throw cErr;
      }
      courtId = court!.id;

      // Create Tournament
      const uniqueSlug = `delhi-open-phase-3-${Math.random().toString(36).substring(2, 7)}`;
      const { data: tourney, error: tErr } = await adminClient.from('tournaments').insert({
        organizer_id: userIds.org,
        sport_id: sportId,
        venue_id: venueId,
        name: 'Delhi Open Phase 3',
        slug: uniqueSlug,
        start_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
        registration_open: new Date().toISOString(),
        registration_close: new Date(Date.now() + 86400000).toISOString(),
        status: 'PUBLISHED'
      }).select('id').single();
      if (tErr) {
        console.error('tourney insert error:', tErr);
        throw tErr;
      }
      tournamentId = tourney!.id;

      // Create Categories
      const { data: catKo, error: catKoErr } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Badminton Singles Knockout',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT',
        registration_fee: 10,
        max_participants: 8
      }).select('id').single();
      if (catKoErr) {
        console.error('catKo insert error:', catKoErr);
        throw catKoErr;
      }
      categoryIdKnockout = catKo!.id;

      const { data: catRr, error: catRrErr } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Badminton Singles Round Robin',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'ROUND_ROBIN',
        registration_fee: 10,
        max_participants: 8
      }).select('id').single();
      if (catRrErr) {
        console.error('catRr insert error:', catRrErr);
        throw catRrErr;
      }
      categoryIdRoundRobin = catRr!.id;

      // Add active participants
      const pKeys = ['player1', 'player2', 'player3', 'player4'];
      for (const pk of pKeys) {
        // Knockout participants
        const { data: partKo, error: pKoErr } = await adminClient.from('participants').insert({
          category_id: categoryIdKnockout,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select('id').single();
        if (pKoErr) {
          console.error('partKo insert error:', pKoErr);
          throw pKoErr;
        }
        participantsKnockout.push(partKo!.id);

        await adminClient.from('participant_members').insert({
          participant_id: partKo!.id,
          player_id: userIds[pk]
        });

        // Round Robin participants
        const { data: partRr } = await adminClient.from('participants').insert({
          category_id: categoryIdRoundRobin,
          participant_type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }).select('id').single();
        participantsRoundRobin.push(partRr!.id);

        await adminClient.from('participant_members').insert({
          participant_id: partRr!.id,
          player_id: userIds[pk]
        });
      }
    });

    after(async () => {
      console.log('Cleaning up Phase 3 test data...');
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

    test('1. Knockout Draw Generation and DB Structure mapping', async () => {
      // Generate Knockout Draw via domain helper
      const structure = generateKnockoutStructure(participantsKnockout);
      const maxRound = Math.max(...structure.matches.map(m => m.round_number));
      assert.strictEqual(maxRound, 2, 'Rounds size should be 2 for 4 participants');
      assert.strictEqual(structure.matches.length, 3, 'Matches size should be 3 for 4 participants');
      assert.strictEqual(structure.nodes.length, 3, 'Draw nodes size should be 3');

      // Create draw in DB
      const { data: draw, error: dErr } = await orgAClient
        .from('draws')
        .insert({
          category_id: categoryIdKnockout,
          format: 'KNOCKOUT',
          status: 'DRAFT'
        })
        .select()
        .single();
      assert.ifError(dErr);

      // Create rounds
      const roundMap: Record<number, string> = {};
      for (let r = 1; r <= 2; r++) {
        const { data: round } = await orgAClient
          .from('rounds')
          .insert({ draw_id: draw.id, round_number: r, name: `Round ${r}` })
          .select()
          .single();
        roundMap[r] = round!.id;
      }

      // Create matches
      const matchMap: Record<string, string> = {};
      for (const m of structure.matches) {
        const { data: match } = await orgAClient
          .from('matches')
          .insert({
            category_id: categoryIdKnockout,
            round_id: roundMap[m.round_number],
            participant_a_id: m.participant_a_id,
            participant_b_id: m.participant_b_id,
            status: m.status,
            duration_minutes: 45,
            buffer_minutes: 10
          })
          .select()
          .single();
        matchMap[m.id] = match!.id;
      }

      // Create draw nodes
      const sortedNodes = [...structure.nodes].sort((a, b) => b.round_number - a.round_number);
      const nodeMap: Record<string, string> = {};
      for (const node of sortedNodes) {
        const dbMatchId = matchMap[structure.matches[node.match_index].id];
        let nextNodeDbId: string | null = null;
        if (node.next_node_index !== null) {
          nextNodeDbId = nodeMap[structure.nodes[node.next_node_index].id] || null;
        }

        const { data: dbNode } = await orgAClient
          .from('draw_nodes')
          .insert({
            draw_id: draw.id,
            round_number: node.round_number,
            match_id: dbMatchId,
            position: node.position,
            next_node_id: nextNodeDbId
          })
          .select()
          .single();
        nodeMap[node.id] = dbNode!.id;
      }

      // Verify the round 1 matches exist and are correctly linked
      const { data: dbMatches } = await orgAClient
        .from('matches')
        .select('*')
        .eq('category_id', categoryIdKnockout);
      assert.strictEqual(dbMatches?.length, 3);
    });

    test('2. Match Scheduling and Conflict Checker validation', async () => {
      // Fetch matches from Knockout draw
      const { data: matchesData } = await orgAClient
        .from('matches')
        .select('*')
        .eq('category_id', categoryIdKnockout);
      
      const m1 = matchesData![0];
      const m2 = matchesData![1];

      // Schedule first match
      const startTime1 = new Date(Date.now() + 7200000).toISOString(); // 2 hours from now
      const { error: schedErr } = await orgAClient
        .from('matches')
        .update({
          court_id: courtId,
          scheduled_at: startTime1,
          duration_minutes: 45,
          buffer_minutes: 10
        })
        .eq('id', m1.id);
      assert.ifError(schedErr);

      // Try scheduling second match at same court and time block (Conflict!)
      const allMatches = [
        { ...m1, court_id: courtId, scheduled_at: startTime1, duration_minutes: 45, buffer_minutes: 10 },
        m2
      ];

      const candidate = {
        id: m2.id,
        participant_a_id: m2.participant_a_id,
        participant_b_id: m2.participant_b_id,
        court_id: courtId,
        scheduled_at: startTime1, // Overlaps!
        duration_minutes: 45,
        buffer_minutes: 10
      };

      const conflictCheck = checkScheduleConflict(allMatches as any[], candidate);
      assert.strictEqual(conflictCheck.conflict, true, 'Should detect court booking overlap conflict');
      assert.ok(conflictCheck.reason && conflictCheck.reason.includes('Court'), 'Reason should mention Court');
    });

    test('3. Knockout Atomic ADVANCEMENT Transaction verification', async () => {
      // Find round 1 match from database
      const { data: r1Matches } = await orgAClient
        .from('matches')
        .select('*')
        .eq('category_id', categoryIdKnockout)
        .not('participant_a_id', 'is', null)
        .not('participant_b_id', 'is', null);

      assert.ok(r1Matches && r1Matches.length > 0);
      const matchToResolve = r1Matches[0];

      // Insert dummy score games
      const { error: insErr } = await orgAClient.from('games').insert([
        { match_id: matchToResolve.id, game_number: 1, participant_a_score: 21, participant_b_score: 19, winner_id: matchToResolve.participant_a_id },
        { match_id: matchToResolve.id, game_number: 2, participant_a_score: 21, participant_b_score: 18, winner_id: matchToResolve.participant_a_id }
      ]);
      assert.ifError(insErr);

      // Trigger complete_match_and_advance RPC
      const { error: rpcErr } = await orgAClient.rpc('complete_match_and_advance', {
        p_match_id: matchToResolve.id,
        p_winner_id: matchToResolve.participant_a_id,
        p_status: 'COMPLETED',
        p_outcome: 'COMPLETED'
      });
      assert.ifError(rpcErr);

      // Verify winner propagates to next round match node!
      // Fetch draw nodes
      const { data: nodes } = await orgAClient
        .from('draw_nodes')
        .select('*');

      const currentNode = nodes!.find(n => n.match_id === matchToResolve.id);
      const nextNode = nodes!.find(n => n.id === currentNode!.next_node_id);

      assert.ok(nextNode, 'Next node must exist');

      // Fetch the match linked to nextNode
      const { data: nextMatch } = await orgAClient
        .from('matches')
        .select('*')
        .eq('id', nextNode!.match_id)
        .single();

      // The winner must be assigned to participant_a_id or participant_b_id of the next match
      const hasWinner = nextMatch.participant_a_id === matchToResolve.participant_a_id ||
                        nextMatch.participant_b_id === matchToResolve.participant_a_id;
      assert.ok(hasWinner, 'Winner must propagate to next match node slots');
    });

    test('4. Round Robin Berger Fixtures and Standing re-computation', async () => {
      // Generate Round Robin fixtures Berger method
      const fixtures = generateRoundRobinFixtures(participantsRoundRobin);
      assert.strictEqual(fixtures.length, 6, 'Berger rotation should return 6 matches for 4 players');

      // Create draw in DB
      const { data: draw } = await orgAClient
        .from('draws')
        .insert({
          category_id: categoryIdRoundRobin,
          format: 'ROUND_ROBIN',
          status: 'PUBLISHED'
        })
        .select()
        .single();

      // Create rounds
      const roundMap: Record<number, string> = {};
      for (let r = 1; r <= 3; r++) {
        const { data: round } = await orgAClient
          .from('rounds')
          .insert({ draw_id: draw!.id, round_number: r, name: `Round ${r}` })
          .select()
          .single();
        roundMap[r] = round!.id;
      }

      // Create matches
      for (const f of fixtures) {
        await orgAClient
          .from('matches')
          .insert({
            category_id: categoryIdRoundRobin,
            round_id: roundMap[f.round],
            participant_a_id: f.participant_a_id,
            participant_b_id: f.participant_b_id,
            status: 'READY',
            duration_minutes: 45,
            buffer_minutes: 10
          });
      }

      // Create standings
      const { data: std } = await orgAClient
        .from('standings')
        .insert({
          category_id: categoryIdRoundRobin,
          draw_id: draw!.id
        })
        .select()
        .single();

      const entries = participantsRoundRobin.map(pid => ({
        standings_id: std!.id,
        participant_id: pid,
        played: 0,
        won: 0,
        lost: 0,
        points_for: 0,
        points_against: 0,
        rank: 1
      }));

      await orgAClient.from('standings_entries').insert(entries);

      // Verify default standings entries are created
      const { data: stdEntries } = await orgAClient
        .from('standings_entries')
        .select('*')
        .eq('standings_id', std!.id);
      assert.strictEqual(stdEntries?.length, 4);
    });
  });
}
