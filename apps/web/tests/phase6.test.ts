import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

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
  describe('Phase 6 Integration Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 6 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 6 Integration Test Suite', () => {
    let adminClient: SupabaseClient;
    let orgClient: SupabaseClient;
    let playerClient: SupabaseClient;
    
    const emails = {
      org: 'p6-org@arenaflow.test',
      playerA: 'p6-player-a@arenaflow.test',
      playerB: 'p6-player-b@arenaflow.test',
      playerC: 'p6-player-c@arenaflow.test',
    };
    
    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let tournamentId: string;
    let categoryId: string;
    let court1Id: string;
    let court2Id: string;
    let participantAId: string;
    let participantBId: string;
    let participantCId: string;
    let match1Id: string;
    let match2Id: string;

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

      console.log('Creating test users for Phase 6...');
      const { data: orgUser } = await adminClient.auth.admin.createUser({ email: emails.org, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Phase 6 Org' } });
      const { data: paUser } = await adminClient.auth.admin.createUser({ email: emails.playerA, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 6A' } });
      const { data: pbUser } = await adminClient.auth.admin.createUser({ email: emails.playerB, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 6B' } });
      const { data: pcUser } = await adminClient.auth.admin.createUser({ email: emails.playerC, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player 6C' } });
      
      userIds.org = orgUser.user!.id;
      userIds.playerA = paUser.user!.id;
      userIds.playerB = pbUser.user!.id;
      userIds.playerC = pcUser.user!.id;

      // Seed profiles
      for (const uid of [userIds.playerA, userIds.playerB, userIds.playerC]) {
        await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
        await adminClient.from('profiles').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
      }

      // Log in clients
      orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgClient.auth.signInWithPassword({ email: emails.org, password });

      playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerClient.auth.signInWithPassword({ email: emails.playerA, password });

      // Create Sport, Venue
      const randSport = Math.random().toString(36).substring(2, 7);
      const uniqueSportName = `Phase 6 Badminton ${randSport}`;
      const uniqueSportSlug = `phase-6-badminton-${randSport}`;
      
      const { data: insertedSport, error: sportErr } = await adminClient
        .from('sports')
        .insert({ name: uniqueSportName, slug: uniqueSportSlug })
        .select('id')
        .single();
      
      if (sportErr) throw new Error(`Sport insertion failed: ${sportErr.message}`);
      sportId = insertedSport.id;

      const { data: venue, error: venueErr } = await adminClient
        .from('venues')
        .insert({ owner_id: userIds.org, name: 'Badminton Hall', address: 'Delhi', city: 'Delhi', country: 'India' })
        .select('id')
        .single();
      if (venueErr) throw new Error(`Venue insertion failed: ${venueErr.message}`);
      venueId = venue.id;

      // Create courts
      const { data: court1, error: c1Err } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court A', status: 'ACTIVE' }).select('id').single();
      if (c1Err) throw new Error(`Court 1 insertion failed: ${c1Err.message}`);
      const { data: court2, error: c2Err } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court B', status: 'ACTIVE' }).select('id').single();
      if (c2Err) throw new Error(`Court 2 insertion failed: ${c2Err.message}`);
      
      court1Id = court1.id;
      court2Id = court2.id;

      // Create Tournament
      const uniqueSlug = `delhi-open-phase-6-${Math.random().toString(36).substring(2, 7)}`;
      const { data: tourney, error: tourneyErr } = await adminClient.from('tournaments').insert({
        organizer_id: userIds.org,
        sport_id: sportId,
        venue_id: venueId,
        name: 'Delhi Open Phase 6',
        slug: uniqueSlug,
        start_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
        registration_open: new Date().toISOString(),
        registration_close: new Date(Date.now() + 86400000).toISOString(),
        status: 'PUBLISHED'
      }).select('id').single();
      if (tourneyErr) throw new Error(`Tournament insertion failed: ${tourneyErr.message}`);
      tournamentId = tourney.id;

      // Create Category
      const { data: cat, error: catErr } = await adminClient.from('categories').insert({
        tournament_id: tournamentId,
        name: 'Men Singles P6',
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT',
        registration_fee: 10,
        max_participants: 8,
        match_duration: 30,
        buffer_time: 10
      }).select('id').single();
      if (catErr) throw new Error(`Category insertion failed: ${catErr.message}`);
      categoryId = cat.id;

      // Create active participants
      const { data: partA, error: pAErr } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
      if (pAErr) throw new Error(`Participant A insertion failed: ${pAErr.message}`);
      const { data: partB, error: pBErr } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
      if (pBErr) throw new Error(`Participant B insertion failed: ${pBErr.message}`);
      const { data: partC, error: pCErr } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' }).select('id').single();
      if (pCErr) throw new Error(`Participant C insertion failed: ${pCErr.message}`);
      
      participantAId = partA.id;
      participantBId = partB.id;
      participantCId = partC.id;

      const { error: pmAErr } = await adminClient.from('participant_members').insert({ participant_id: participantAId, player_id: userIds.playerA, member_order: 1 });
      if (pmAErr) throw new Error(`Participant member A insertion failed: ${pmAErr.message}`);
      const { error: pmBErr } = await adminClient.from('participant_members').insert({ participant_id: participantBId, player_id: userIds.playerB, member_order: 1 });
      if (pmBErr) throw new Error(`Participant member B insertion failed: ${pmBErr.message}`);
      const { error: pmCErr } = await adminClient.from('participant_members').insert({ participant_id: participantCId, player_id: userIds.playerC, member_order: 1 });
      if (pmCErr) throw new Error(`Participant member C insertion failed: ${pmCErr.message}`);

      // Create Matches
      const { data: match1, error: m1Err } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'SCHEDULED'
      }).select('id').single();
      if (m1Err) throw new Error(`Match 1 insertion failed: ${m1Err.message}`);
      match1Id = match1.id;

      const { data: match2, error: m2Err } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantBId,
        participant_b_id: participantCId,
        status: 'SCHEDULED'
      }).select('id').single();
      if (m2Err) throw new Error(`Match 2 insertion failed: ${m2Err.message}`);
      match2Id = match2.id;
    });

    after(async () => {
      console.log('Cleaning up Phase 6 test data...');
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

    test('1. Same-court overlapping matches are rejected', async () => {
      const scheduledTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      // Schedule first match on Court A
      const { error: err1 } = await orgClient
        .from('matches')
        .update({
          court_id: court1Id,
          scheduled_at: scheduledTime,
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match1Id);
      assert.ifError(err1);

      // Attempt to schedule second match on Court A during overlapping time
      const { error: errOverlap } = await orgClient
        .from('matches')
        .update({
          court_id: court1Id,
          scheduled_at: new Date(Date.now() + 3600000 + 15 * 60 * 1000).toISOString(), // 15 mins offset (overlap)
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match2Id);
      
      assert.ok(errOverlap);
      assert.ok(errOverlap.message.includes('Court is already booked'));
    });

    test('2. Same-participant overlapping matches are rejected', async () => {
      const scheduledTime = new Date(Date.now() + 7200000).toISOString(); // 2 hours from now

      // Schedule match1 with player B on Court A
      const { error: err1 } = await orgClient
        .from('matches')
        .update({
          court_id: court1Id,
          scheduled_at: scheduledTime,
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match1Id);
      assert.ifError(err1);

      // Attempt to schedule match2 (also with player B) on Court B at overlapping time
      const { error: errDoubleBook } = await orgClient
        .from('matches')
        .update({
          court_id: court2Id,
          scheduled_at: new Date(Date.now() + 7200000 + 10 * 60 * 1000).toISOString(), // 10 mins offset (overlap)
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match2Id);

      assert.ok(errDoubleBook);
      assert.ok(errDoubleBook.message.includes('Player is already scheduled'));
    });

    test('3. Non-overlapping matches are accepted', async () => {
      // Clear scheduling for match2 first
      await adminClient.from('matches').update({ court_id: null, scheduled_at: null }).eq('id', match2Id);

      const scheduledTime = new Date(Date.now() + 10800000).toISOString(); // 3 hours from now
      
      // Schedule match 1 on Court A
      const { error: err1 } = await orgClient
        .from('matches')
        .update({
          court_id: court1Id,
          scheduled_at: scheduledTime,
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match1Id);
      assert.ifError(err1);

      // Schedule match 2 on Court A 60 minutes later (duration 30 + buffer 10 = 40 min overlap window)
      const nonOverlappingTime = new Date(Date.now() + 10800000 + 60 * 60 * 1000).toISOString();
      const { error: err2 } = await orgClient
        .from('matches')
        .update({
          court_id: court1Id,
          scheduled_at: nonOverlappingTime,
          duration_minutes: 30,
          buffer_minutes: 10
        })
        .eq('id', match2Id);

      assert.ifError(err2);
    });

    test('4. Match lifecycle transitions (READY -> LIVE -> PAUSED -> LIVE -> COMPLETED -> FINAL)', async () => {
      // Initialize match state to READY by ensuring participants exist
      await adminClient.from('matches').update({ status: 'READY' }).eq('id', match1Id);

      // READY -> LIVE works via start_match
      const { error: errStart } = await orgClient.rpc('start_match', { p_match_id: match1Id });
      assert.ifError(errStart);

      let mData: any;
      const { data: res1 } = await orgClient.from('matches').select('status, started_at').eq('id', match1Id).single();
      mData = res1;
      assert.strictEqual(mData!.status, 'LIVE');
      assert.ok(mData!.started_at);

      // LIVE -> PAUSED works via pause_match
      const { error: errPause } = await orgClient.rpc('pause_match', { p_match_id: match1Id });
      assert.ifError(errPause);

      const { data: res2 } = await orgClient.from('matches').select('status').eq('id', match1Id).single();
      mData = res2;
      assert.strictEqual(mData!.status, 'PAUSED');

      // PAUSED -> LIVE works via resume_match
      const { error: errResume } = await orgClient.rpc('resume_match', { p_match_id: match1Id });
      assert.ifError(errResume);

      const { data: res3 } = await orgClient.from('matches').select('status').eq('id', match1Id).single();
      mData = res3;
      assert.strictEqual(mData!.status, 'LIVE');

      // Score completion to move to COMPLETED
      const { error: errComplete } = await orgClient.rpc('complete_match_and_advance', {
        p_match_id: match1Id,
        p_winner_id: participantAId,
        p_status: 'COMPLETED',
        p_outcome: 'COMPLETED'
      });
      assert.ifError(errComplete);

      const { data: res4 } = await orgClient.from('matches').select('status').eq('id', match1Id).single();
      mData = res4;
      assert.strictEqual(mData!.status, 'COMPLETED');

      // COMPLETED -> FINAL works via finalize_match
      const { error: errFinal } = await orgClient.rpc('finalize_match', { p_match_id: match1Id });
      assert.ifError(errFinal);

      const { data: res5 } = await orgClient.from('matches').select('status, ended_at').eq('id', match1Id).single();
      mData = res5;
      assert.strictEqual(mData!.status, 'FINAL');
      assert.ok(mData!.ended_at);
    });

    test('5. Invalid lifecycle transitions are rejected', async () => {
      // Reset match status to READY
      await adminClient.from('matches').update({ status: 'READY' }).eq('id', match2Id);

      // Try transition READY directly to FINAL (should fail)
      const { error: errInvalid1 } = await orgClient
        .from('matches')
        .update({ status: 'FINAL' })
        .eq('id', match2Id);
      assert.ok(errInvalid1);

      // Reset sequence properly to make the match FINAL
      await adminClient.from('matches').update({ status: 'READY' }).eq('id', match2Id);
      await adminClient.from('matches').update({ status: 'LIVE' }).eq('id', match2Id);
      await adminClient.from('matches').update({ status: 'COMPLETED' }).eq('id', match2Id);
      await adminClient.from('matches').update({ status: 'FINAL' }).eq('id', match2Id);

      // Try transition FINAL directly to LIVE (should fail)
      const { error: errInvalid2 } = await orgClient
        .from('matches')
        .update({ status: 'LIVE' })
        .eq('id', match2Id);
      assert.ok(errInvalid2);
    });

    test('6. Scoring lock rules (PAUSED / FINAL points rejected, LIVE / UNDER_REVIEW accepted)', async () => {
      // 1. Scoring while PAUSED
      const { data: mPaused } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'PAUSED'
      }).select('id').single();

      const { error: errScorePaused } = await orgClient.from('match_events').insert({
        match_id: mPaused!.id,
        sequence_number: 1,
        event_type: 'POINT_A'
      });
      assert.ok(errScorePaused);
      assert.ok(errScorePaused.message.includes('Scoring is only allowed when match is LIVE or UNDER_REVIEW'));

      // 2. Scoring while FINAL
      const { data: mFinal } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'FINAL'
      }).select('id').single();

      const { error: errScoreFinal } = await orgClient.from('match_events').insert({
        match_id: mFinal!.id,
        sequence_number: 1,
        event_type: 'POINT_A'
      });
      assert.ok(errScoreFinal);
      assert.ok(errScoreFinal.message.includes('Scoring is only allowed when match is LIVE or UNDER_REVIEW'));

      // 3. Scoring while LIVE
      const { data: mLive } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'LIVE'
      }).select('id').single();

      const { error: errScoreLive } = await orgClient.from('match_events').insert({
        match_id: mLive!.id,
        sequence_number: 1,
        event_type: 'POINT_A'
      });
      assert.ifError(errScoreLive);

      // 4. Scoring while UNDER_REVIEW
      const { data: mReview } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'UNDER_REVIEW'
      }).select('id').single();

      const { error: errScoreReview } = await orgClient.from('match_events').insert({
        match_id: mReview!.id,
        sequence_number: 1,
        event_type: 'POINT_B'
      });
      assert.ifError(errScoreReview);
    });

    test('7. Scorer permissions and Organizer reopened corrections', async () => {
      // Lock match 2 as FINAL by transitioning properly
      await adminClient.from('matches').update({ status: 'COMPLETED' }).eq('id', match2Id);
      await adminClient.from('matches').update({ status: 'FINAL' }).eq('id', match2Id);

      // Scorer (non-organizer player) cannot reopen FINAL match (RLS should block it -> 0 rows updated)
      const { data: updateData, error: errScorerReopen } = await playerClient
        .from('matches')
        .update({ status: 'UNDER_REVIEW' })
        .eq('id', match2Id)
        .select();
      
      assert.ifError(errScorerReopen);
      assert.strictEqual(updateData?.length, 0); // 0 rows updated because of RLS

      // Organizer can reopen FINAL -> UNDER_REVIEW
      const { error: errOrgReopen } = await orgClient
        .from('matches')
        .update({ status: 'UNDER_REVIEW' })
        .eq('id', match2Id);
      assert.ifError(errOrgReopen);

      // Organizer can write correction points while UNDER_REVIEW
      const { error: errCorrect } = await orgClient.from('match_events').insert({
        match_id: match2Id,
        sequence_number: 3,
        event_type: 'POINT_A'
      });
      assert.ifError(errCorrect);

      // Organizer can finalize the corrected match again
      const { error: errRefinalize } = await orgClient.rpc('finalize_match', { p_match_id: match2Id });
      assert.ifError(errRefinalize);

      const { data: finalState } = await orgClient.from('matches').select('status').eq('id', match2Id).single();
      assert.strictEqual(finalState!.status, 'FINAL');
    });

    test('8. Concurrency-safe event sequence number generation (duplicate avoidance)', async () => {
      // 1. Create a live match
      const { data: mLive } = await adminClient.from('matches').insert({
        category_id: categoryId,
        participant_a_id: participantAId,
        participant_b_id: participantBId,
        status: 'LIVE'
      }).select('id').single();

      // 2. Insert 5 events concurrently (simulated rapid clicks)
      // Even if client sends stale sequence_number = 1, trigger must override and serialize them safely
      const promises = Array.from({ length: 5 }).map(() => {
        return orgClient.from('match_events').insert({
          match_id: mLive!.id,
          sequence_number: 1,
          event_type: 'POINT_A'
        });
      });

      const results = await Promise.all(promises);

      // Verify no database unique constraint errors occurred
      for (const res of results) {
        assert.ifError(res.error);
      }

      // 3. Retrieve events and verify strict sequential ordering (1, 2, 3, 4, 5)
      const { data: events } = await orgClient
        .from('match_events')
        .select('sequence_number')
        .eq('match_id', mLive!.id)
        .order('sequence_number', { ascending: true });

      assert.strictEqual(events?.length, 5);
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(events![i].sequence_number, i + 1);
      }
    });
  });
}
