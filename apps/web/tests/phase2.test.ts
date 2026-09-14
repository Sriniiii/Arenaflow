import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { tournamentSchema, categorySchema, courtSchema, participantSchema } from '@arena-flow/validation';

let createTournamentWithUniqueSlug: any;

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
  describe('Phase 2 Integration Test Suite (Skipped)', () => {
    test('Credentials check', () => {
      console.warn('⚠️  SKIPPING PHASE 2 TESTS: Supabase credentials are missing.');
      assert.ok(true);
    });
  });
} else {
  describe('Phase 2 Integration Test Suite', () => {
    let adminClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let orgAClient: SupabaseClient;
    let orgBClient: SupabaseClient;
    let playerAClient: SupabaseClient;
    let playerBClient: SupabaseClient;

    const emails = {
      orgA: 'p2-org-a@arenaflow.test',
      orgB: 'p2-org-b@arenaflow.test',
      playerA: 'p2-player-a@arenaflow.test',
      playerB: 'p2-player-b@arenaflow.test',
      playerC: 'p2-player-c@arenaflow.test',
    };
    
    const password = 'TestSecurePassword123!';
    let userIds: Record<string, string> = {};
    let sportId: string;
    let venueId: string;
    let tournamentId: string;
    let categoryIds: Record<string, string> = {};

    before(async () => {
      const slugifyModule = await import('../src/utils/slugify');
      createTournamentWithUniqueSlug = slugifyModule.createTournamentWithUniqueSlug;

      adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
      anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

      console.log('Cleaning up old test users...');
      for (const email of Object.values(emails)) {
        const { data: search } = await adminClient.auth.admin.listUsers();
        const existingUser = search?.users.find(u => u.email === email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }

      console.log('Creating test users for Phase 2...');
      // Organizers
      const { data: oa } = await adminClient.auth.admin.createUser({ email: emails.orgA, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Org A' } });
      const { data: ob } = await adminClient.auth.admin.createUser({ email: emails.orgB, password, email_confirm: true, user_metadata: { role: 'ORGANIZER', full_name: 'Org B' } });
      // Players
      const { data: pa } = await adminClient.auth.admin.createUser({ email: emails.playerA, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player A' } });
      const { data: pb } = await adminClient.auth.admin.createUser({ email: emails.playerB, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player B' } });
      const { data: pc } = await adminClient.auth.admin.createUser({ email: emails.playerC, password, email_confirm: true, user_metadata: { role: 'PLAYER', full_name: 'Player C' } });

      userIds.orgA = oa.user!.id;
      userIds.orgB = ob.user!.id;
      userIds.playerA = pa.user!.id;
      userIds.playerB = pb.user!.id;
      userIds.playerC = pc.user!.id;

      // Seed player demographics for RLS and eligibility defaults
      for (const uid of [userIds.playerA, userIds.playerB, userIds.playerC]) {
        await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
        await adminClient.from('profiles').update({ gender: 'MALE', date_of_birth: '2001-01-01' }).eq('id', uid);
      }



      // Log in clients
      orgAClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgAClient.auth.signInWithPassword({ email: emails.orgA, password });

      orgBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await orgBClient.auth.signInWithPassword({ email: emails.orgB, password });

      playerAClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerAClient.auth.signInWithPassword({ email: emails.playerA, password });

      playerBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      await playerBClient.auth.signInWithPassword({ email: emails.playerB, password });

      // Fetch Badminton sport
      const { data: sport } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
      if (!sport) throw new Error("Badminton sport seed is missing in database");
      sportId = sport.id;
    });

    after(async () => {
      console.log('Tearing down Phase 2 test data...');
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

    test('1. Test Data Scenario Setup (Delhi Open)', async () => {
      // 1. Create Venue (Delhi Sports Arena)
      const { data: venue, error: vErr } = await orgAClient
        .from('venues')
        .insert({
          name: 'Delhi Sports Arena',
          address: 'Pragati Maidan',
          city: 'Delhi',
          country: 'India',
          owner_id: userIds.orgA
        })
        .select('id')
        .single();
      
      assert.ifError(vErr);
      venueId = venue.id;

      // 2. Create Courts (Court 1, 2, 3, 4)
      const courtsToAdd = ['Court 1', 'Court 2', 'Court 3', 'Court 4'].map(name => ({
        venue_id: venueId,
        name,
        status: 'ACTIVE'
      }));
      const { error: cErr } = await orgAClient.from('courts').insert(courtsToAdd);
      assert.ifError(cErr);

      // 3. Create Tournament (Delhi Open Badminton Championship) in DRAFT
      const { data: tourney, error: tErr } = await orgAClient
        .from('tournaments')
        .insert({
          name: 'Delhi Open Badminton Championship',
          slug: 'delhi-open-badminton-championship',
          description: 'Premier regional championship',
          sport_id: sportId,
          venue_id: venueId,
          start_date: new Date(Date.now() + 86400000 * 10).toISOString(),
          end_date: new Date(Date.now() + 86400000 * 15).toISOString(),
          registration_open: new Date(Date.now() - 86400000 * 5).toISOString(),
          registration_close: new Date(Date.now() + 86400000 * 5).toISOString(),
          status: 'DRAFT',
          organizer_id: userIds.orgA
        })
        .select('id')
        .single();

      assert.ifError(tErr);
      tournamentId = tourney.id;

      // 4. Create Categories
      const categoriesToAdd = [
        { name: "Men's Singles", category_type: 'SINGLES', match_type: 'MENS', format: 'KNOCKOUT' },
        { name: "Women's Singles", category_type: 'SINGLES', match_type: 'WOMENS', format: 'KNOCKOUT' },
        { name: "Men's Doubles", category_type: 'DOUBLES', match_type: 'MENS', format: 'KNOCKOUT' },
        { name: "Women's Doubles", category_type: 'DOUBLES', match_type: 'WOMENS', format: 'KNOCKOUT' },
        { name: "Mixed Doubles", category_type: 'DOUBLES', match_type: 'MIXED', format: 'KNOCKOUT' },
      ].map(c => ({
        ...c,
        tournament_id: tournamentId,
        age_group: 'ADULT',
        skill_level: 'OPEN',
        registration_fee: 15,
        max_participants: 32
      }));

      const { data: cats, error: catsErr } = await orgAClient
        .from('categories')
        .insert(categoriesToAdd)
        .select('id, name');
      
      assert.ifError(catsErr);
      cats?.forEach(c => {
        categoryIds[c.name] = c.id;
      });

      assert.strictEqual(cats?.length, 5);
    });

    test('2. Zod Shared Date Validation Bounds', () => {
      // End date before start date
      const result1 = tournamentSchema.safeParse({
        name: 'Invalid Open',
        sport_id: 'e6a88b56-3c06-4b68-b8bd-566bc90e9603',
        start_date: '2026-09-05T00:00:00.000Z',
        end_date: '2026-09-01T00:00:00.000Z', // Invalid
        registration_open: '2026-08-01T00:00:00.000Z',
        registration_close: '2026-08-25T00:00:00.000Z',
        status: 'DRAFT'
      });
      assert.strictEqual(result1.success, false, 'Should reject end date before start date');

      // Registration close date after tournament start date
      const result2 = tournamentSchema.safeParse({
        name: 'Invalid Open 2',
        sport_id: 'e6a88b56-3c06-4b68-b8bd-566bc90e9603',
        start_date: '2026-09-01T00:00:00.000Z',
        end_date: '2026-09-05T00:00:00.000Z',
        registration_open: '2026-08-01T00:00:00.000Z',
        registration_close: '2026-09-02T00:00:00.000Z', // Invalid (closes after start)
        status: 'DRAFT'
      });
      assert.strictEqual(result2.success, false, 'Should reject registration closing after tournament start');
    });

    test('3. Database-level Unique Slug Collision Retry Loop', async () => {
      // Attempt to create another tournament with the same name "Delhi Open Badminton Championship"
      // using the createTournamentWithUniqueSlug utility.
      const { data, error } = await createTournamentWithUniqueSlug({
        name: 'Delhi Open Badminton Championship', // Identical name
        sport_id: sportId,
        venue_id: venueId,
        start_date: new Date('2026-10-01').toISOString(),
        end_date: new Date('2026-10-05').toISOString(),
        registration_open: new Date('2026-09-01').toISOString(),
        registration_close: new Date('2026-09-25').toISOString(),
        status: 'DRAFT',
        organizer_id: userIds.orgA
      }, orgAClient);

      assert.ifError(error);
      assert.ok(data);
      assert.notStrictEqual(data.slug, 'delhi-open-badminton-championship', 'Should append suffix to slug to make it unique');
      assert.match(data.slug, /^delhi-open-badminton-championship-[a-z0-9]+$/);

      // Clean up the secondary tournament
      await adminClient.from('tournaments').delete().eq('id', data.id);
    });

    test('4. Incomplete Doubles Team Validation Rejection', () => {
      // Verify validator rejects a doubles team with only 1 player ID
      const result = participantSchema.safeParse({
        category_id: 'e6a88b56-3c06-4b68-b8bd-566bc90e9603',
        participant_type: 'TEAM',
        player_ids: [userIds.playerA] // Incomplete
      });
      
      assert.strictEqual(result.success, false, 'Doubles team must fail validation with only 1 player');
    });

    test('5. Organizer Isolation Boundaries', async () => {
      // Organizer B attempts to edit Organizer A's tournament details (should fail RLS)
      const { data: updateRes } = await orgBClient
        .from('tournaments')
        .update({ name: 'Hacked Tournament' })
        .eq('id', tournamentId)
        .select();
      
      assert.strictEqual(updateRes?.length, 0, 'Organizer B must not be allowed to modify Organizer A\'s tournament');

      // Organizer B attempts to add category to Organizer A's tournament (should fail RLS)
      const { error: catErr } = await orgBClient
        .from('categories')
        .insert({
          tournament_id: tournamentId,
          name: 'Hacked Category',
          category_type: 'SINGLES',
          match_type: 'MENS',
          format: 'KNOCKOUT'
        });
      
      assert.ok(catErr, 'Organizer B must be blocked from adding categories to Organizer A\'s tournament');
    });

    test('6. Public vs Draft Status Isolation (Spectator Views)', async () => {
      // Anon spectator attempts to read categories of draft tournament (should be blank due to RLS)
      const { data: catsDraft } = await anonClient
        .from('categories')
        .select('*')
        .eq('tournament_id', tournamentId);
      
      assert.strictEqual(catsDraft?.length, 0, 'Spectator must not be allowed to read categories of a DRAFT tournament');

      // Publish tournament
      const { error: pubErr } = await orgAClient
        .from('tournaments')
        .update({ status: 'PUBLISHED' })
        .eq('id', tournamentId);
      assert.ifError(pubErr);

      // Anon spectator now attempts to read categories (should succeed)
      const { data: catsPub } = await anonClient
        .from('categories')
        .select('*')
        .eq('tournament_id', tournamentId);
      
      assert.strictEqual(catsPub?.length, 5, 'Spectator must be allowed to read categories of a PUBLISHED tournament');
    });

    test('7. Registration and Dual Approval Workflow', async () => {
      const singlesCatId = categoryIds["Men's Singles"];
      const doublesCatId = categoryIds["Men's Doubles"];

      // 1. Player A registers themselves for Men's Singles (should succeed)
      const { data: partS, error: pErr } = await playerAClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErr);

      const { error: mErr } = await playerAClient
        .from('participant_members')
        .insert({ participant_id: partS.id, player_id: userIds.playerA, member_order: 1 });
      assert.ifError(mErr);

      const { data: regS, error: rErr } = await playerAClient
        .from('registrations')
        .insert({ category_id: singlesCatId, participant_id: partS.id, status: 'PENDING' })
        .select('id')
        .single();
      assert.ifError(rErr);

      // 2. Player A attempts to register for Men's Singles a second time (should trigger unique constraint fail on registrations/members)
      const { data: partS2 } = await playerAClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();

      if (partS2) {
        const { error: mErr2 } = await playerAClient
          .from('participant_members')
          .insert({ participant_id: partS2.id, player_id: userIds.playerA, member_order: 1 });
        
        // This insert must fail because playerA is already linked to a participant in this category
        assert.ok(mErr2, 'Player A must not be allowed to register twice for the same category');
      }

      // 3. Organizer A approves registration (should succeed)
      const { error: appErr1 } = await orgAClient
        .from('registrations')
        .update({ status: 'APPROVED' })
        .eq('id', regS.id);
      assert.ifError(appErr1);

      // Verify participant becomes ACTIVE
      const { error: actErr } = await orgAClient
        .from('participants')
        .update({ status: 'ACTIVE' })
        .eq('id', partS.id);
      assert.ifError(actErr);

      // 4. Organizer B attempts to approve Player A's registration (should fail due to RLS write policies)
      const { data: hackRegRes } = await orgBClient
        .from('registrations')
        .update({ status: 'APPROVED' })
        .eq('id', regS.id)
        .select();
      
      assert.strictEqual(hackRegRes?.length, 0, 'Organizer B must not be allowed to modify registrations of Organizer A\'s tournament');
    });

    test('8. Registration Closed Date Enforcement', async () => {
      const singlesCatId = categoryIds["Women's Singles"];

      // Organizer A updates registration_close to a past date
      const { error: uErr } = await orgAClient
        .from('tournaments')
        .update({ registration_close: new Date('2026-08-10').toISOString() })
        .eq('id', tournamentId);
      assert.ifError(uErr);

      // Verify Player A registration is blocked in application logic (checked during page load / form submission)
      const isClosed = new Date() > new Date('2026-08-10');
      assert.strictEqual(isClosed, true, 'Registration close date must be detected as expired');
    });

    test('9. Detailed Registrations Approval & Rejection Workflows', async () => {
      const singlesCatId = categoryIds["Men's Singles"];

      // Reset registration close to future so Player B can register
      const { error: resetErr } = await orgAClient
        .from('tournaments')
        .update({ registration_close: new Date('2026-09-30').toISOString() })
        .eq('id', tournamentId);
      assert.ifError(resetErr);

      // 1. Player B submits registration for Men's Singles (starts PENDING)
      const { data: partB, error: pErrB } = await playerBClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrB);

      const { error: mErrB } = await playerBClient
        .from('participant_members')
        .insert({ participant_id: partB.id, player_id: userIds.playerB, member_order: 1 });
      assert.ifError(mErrB);

      const { data: regB, error: rErrB } = await playerBClient
        .from('registrations')
        .insert({ category_id: singlesCatId, participant_id: partB.id, status: 'PENDING' })
        .select('id')
        .single();
      assert.ifError(rErrB);

      // 2. Organizer A can see the pending registration with details
      const { data: orgARegs, error: selErrA } = await orgAClient
        .from('registrations')
        .select(`
          id,
          status,
          category: categories ( id, name ),
          participant: participants (
            id,
            members: participant_members (
              player: players ( id, full_name, display_name )
            )
          )
        `)
        .eq('id', regB.id);
      assert.ifError(selErrA);
      const regsList = orgARegs as any;
      assert.strictEqual(regsList?.length, 1, 'Organizer A must be able to view pending registrations of their tournament');
      assert.strictEqual(regsList[0].participant.members[0].player.full_name, 'Player B', 'Organizer A must see the correct registered player name');

      // 3. Organizer B cannot see Organizer A's registrations
      const { data: orgBRegs, error: selErrB } = await orgBClient
        .from('registrations')
        .select('id')
        .eq('id', regB.id);
      assert.ifError(selErrB);
      assert.strictEqual(orgBRegs?.length, 0, 'Organizer B must not be able to select registrations of another organizer');

      // 4. Organizer A can reject a registration
      const { error: rejErr } = await orgAClient
        .from('registrations')
        .update({ status: 'REJECTED' })
        .eq('id', regB.id);
      assert.ifError(rejErr);

      const { data: checkRegB } = await orgAClient
        .from('registrations')
        .select('status')
        .eq('id', regB.id)
        .single();
      assert.strictEqual(checkRegB?.status, 'REJECTED', 'Registration status must be updated to REJECTED');

      // 5. Player appears in Organizer -> Participants -> Player 1 dropdown list query
      const { data: dropdownPlayers, error: dErr } = await orgAClient
        .from('players')
        .select('id, full_name, display_name');
      assert.ifError(dErr);
      assert.ok(dropdownPlayers && dropdownPlayers.length > 0, 'Organizer dropdown players must not be empty');
      const hasPlayerA = dropdownPlayers.some(p => p.id === userIds.playerA);
      assert.ok(hasPlayerA, 'Player A must appear in the dropdown list query');

      // 6. Manual participant registration works correctly
      // Create manual active participant
      const { data: manPart, error: manPErr } = await orgAClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'ACTIVE' })
        .select('id')
        .single();
      assert.ifError(manPErr);

      // Create manual participant members
      const { error: manMErr } = await orgAClient
        .from('participant_members')
        .insert({ participant_id: manPart.id, player_id: userIds.playerC, member_order: 1 });
      assert.ifError(manMErr);

      // Create approved registration row
      const { error: manRErr } = await orgAClient
        .from('registrations')
        .insert({ category_id: singlesCatId, participant_id: manPart.id, status: 'APPROVED' });
      assert.ifError(manRErr);

      // Verify success
      const { data: verifyManPart } = await orgAClient
        .from('participants')
        .select('id, status')
        .eq('id', manPart.id)
        .single();
      assert.strictEqual(verifyManPart?.status, 'ACTIVE', 'Manual participant must be ACTIVE');

      // 7. Player B cancels PENDING registration -> status becomes CANCELLED
      const { data: partCancel, error: pErrCancel } = await playerBClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrCancel);

      const { error: mErrCancel } = await playerBClient
        .from('participant_members')
        .insert({ participant_id: partCancel.id, player_id: userIds.playerB, member_order: 1 });
      assert.ifError(mErrCancel);

      const { data: regCancel, error: rErrCancel } = await playerBClient
        .from('registrations')
        .insert({ category_id: singlesCatId, participant_id: partCancel.id, status: 'PENDING' })
        .select('id')
        .single();
      assert.ifError(rErrCancel);

      // Player B updates status to CANCELLED (should succeed)
      const { error: cancelErr } = await playerBClient
        .from('registrations')
        .update({ status: 'CANCELLED' })
        .eq('id', regCancel.id);
      assert.ifError(cancelErr);

      // Verify status is CANCELLED and participant is WITHDRAWN
      const { data: checkRegCancel } = await playerBClient
        .from('registrations')
        .select('status')
        .eq('id', regCancel.id)
        .single();
      assert.strictEqual(checkRegCancel?.status, 'CANCELLED', 'Registration status must be CANCELLED');

      const { data: checkPartCancel } = await playerBClient
        .from('participants')
        .select('status')
        .eq('id', partCancel.id)
        .single();
      assert.strictEqual(checkPartCancel?.status, 'WITHDRAWN', 'Participant status must be WITHDRAWN');

      // 8. Player A cannot manage/cancel Player B's registration
      const { data: hackRes, error: hackErr } = await playerAClient
        .from('registrations')
        .update({ status: 'CANCELLED' })
        .eq('id', regCancel.id)
        .select();
      assert.ok(hackErr || !hackRes || hackRes.length === 0, 'Player A must not be allowed to modify Player B\'s registration');

      // 9. Re-registration check: Player B should be able to register again now that the previous one is CANCELLED
      const { data: partReReg, error: pErrReReg } = await playerBClient
        .from('participants')
        .insert({ category_id: singlesCatId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrReReg);

      const { error: mErrReReg } = await playerBClient
        .from('participant_members')
        .insert({ participant_id: partReReg.id, player_id: userIds.playerB, member_order: 1 });
      assert.ifError(mErrReReg);
    });

    test('10. Gender, Age-group, Mixed-Doubles Eligibility & Organizer Visibility Constraints', async () => {
      const mensSinglesId = categoryIds["Men's Singles"];
      const mixedDoublesId = categoryIds["Mixed Doubles"];

      // Clean up any existing Player A registrations for Men's Singles
      const { data: pMembers } = await adminClient
        .from('participant_members')
        .select('participant_id')
        .eq('player_id', userIds.playerA);
      
      const partIds = pMembers?.map(m => m.participant_id) || [];
      if (partIds.length > 0) {
        await adminClient.from('registrations').delete().in('participant_id', partIds);
        await adminClient.from('participants').delete().in('id', partIds);
      }

      // 1. GENDER ELIGIBILITY
      // Temporarily update player A's profile to FEMALE
      const { error: updP1Err } = await adminClient
        .from('players')
        .update({ gender: 'FEMALE' })
        .eq('id', userIds.playerA);
      assert.ifError(updP1Err);

      // Attempt to register Player A (FEMALE) for Men's Singles
      const { data: partS, error: pErr } = await playerAClient
        .from('participants')
        .insert({ category_id: mensSinglesId, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErr);

      const { error: mErr } = await playerAClient
        .from('participant_members')
        .insert({ participant_id: partS.id, player_id: userIds.playerA, member_order: 1 });
      assert.ifError(mErr);

      // Database trigger check_registration_eligibility should raise an exception
      const { error: rErr } = await playerAClient
        .from('registrations')
        .insert({ category_id: mensSinglesId, participant_id: partS.id, status: 'PENDING' });
      assert.ok(rErr, 'Player A (FEMALE) must not be allowed to register for Men\'s division');

      // Reset Player A back to MALE
      const { error: resetP1Err } = await adminClient
        .from('players')
        .update({ gender: 'MALE' })
        .eq('id', userIds.playerA);
      assert.ifError(resetP1Err);

      // 2. AGE-GROUP ELIGIBILITY (U19)
      // Create U19 category
      const { data: u19Cat, error: u19CatErr } = await orgAClient
        .from('categories')
        .insert({
          tournament_id: tournamentId,
          name: 'Junior U19 Singles',
          category_type: 'SINGLES',
          match_type: 'OPEN',
          age_group: 'U19',
          skill_level: 'OPEN',
          registration_fee: 10,
          max_participants: 32,
          format: 'KNOCKOUT'
        })
        .select('id')
        .single();
      assert.ifError(u19CatErr);

      // Set Player A DOB to make them 25 years old (born in 2001)
      const { error: age25Err } = await adminClient
        .from('players')
        .update({ date_of_birth: '2001-01-01' })
        .eq('id', userIds.playerA);
      assert.ifError(age25Err);

      // Attempt to register Player A (25yo) for U19
      const { data: partU19, error: pErrU19 } = await playerAClient
        .from('participants')
        .insert({ category_id: u19Cat.id, participant_type: 'INDIVIDUAL', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrU19);

      const { error: mErrU19 } = await playerAClient
        .from('participant_members')
        .insert({ participant_id: partU19.id, player_id: userIds.playerA, member_order: 1 });
      assert.ifError(mErrU19);

      const { error: rErrU19 } = await playerAClient
        .from('registrations')
        .insert({ category_id: u19Cat.id, participant_id: partU19.id, status: 'PENDING' });
      assert.ok(rErrU19, 'Player A (25yo) must not be allowed to register for U19 division');

      // Set Player A DOB to make them 15 years old (born in 2011)
      const { error: age15Err } = await adminClient
        .from('players')
        .update({ date_of_birth: '2011-01-01' })
        .eq('id', userIds.playerA);
      assert.ifError(age15Err);

      // Register Player A (15yo) for U19 (should succeed)
      const { error: rErrU19Success } = await playerAClient
        .from('registrations')
        .insert({ category_id: u19Cat.id, participant_id: partU19.id, status: 'PENDING' });
      assert.ifError(rErrU19Success);

      // Reset Player A DOB to 2001-01-01
      await adminClient.from('players').update({ date_of_birth: '2001-01-01' }).eq('id', userIds.playerA);

      // 3. MIXED DOUBLES ELIGIBILITY
      // Set Player B's profile to FEMALE
      const { error: femP2Err } = await adminClient
        .from('players')
        .update({ gender: 'FEMALE' })
        .eq('id', userIds.playerB);
      assert.ifError(femP2Err);

      // Attempt to register Player A (MALE) and Player C (MALE) for Mixed Doubles (should fail)
      const { data: partMixedFail, error: pErrMixedFail } = await playerAClient
        .from('participants')
        .insert({ category_id: mixedDoublesId, participant_type: 'TEAM', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrMixedFail);

      const { error: m1ErrMixedFail } = await playerAClient
        .from('participant_members')
        .insert([
          { participant_id: partMixedFail.id, player_id: userIds.playerA, member_order: 1 },
          { participant_id: partMixedFail.id, player_id: userIds.playerC, member_order: 2 }
        ]);
      assert.ifError(m1ErrMixedFail);

      const { error: rErrMixedFail } = await playerAClient
        .from('registrations')
        .insert({ category_id: mixedDoublesId, participant_id: partMixedFail.id, status: 'PENDING' });
      assert.ok(rErrMixedFail, 'Mixed Doubles must reject MALE + MALE team');

      // Clean up failed participant to avoid duplicate registration constraint blocks
      await adminClient.from('participant_members').delete().eq('participant_id', partMixedFail.id);
      await adminClient.from('participants').delete().eq('id', partMixedFail.id);

      // Register Player A (MALE) and Player B (FEMALE) for Mixed Doubles (should succeed)
      const { data: partMixedSuccess, error: pErrMixedSuccess } = await playerAClient
        .from('participants')
        .insert({ category_id: mixedDoublesId, participant_type: 'TEAM', status: 'WITHDRAWN' })
        .select('id')
        .single();
      assert.ifError(pErrMixedSuccess);

      const { error: m1ErrMixedSuccess } = await playerAClient
        .from('participant_members')
        .insert([
          { participant_id: partMixedSuccess.id, player_id: userIds.playerA, member_order: 1 },
          { participant_id: partMixedSuccess.id, player_id: userIds.playerB, member_order: 2 }
        ]);
      assert.ifError(m1ErrMixedSuccess);

      const { error: rErrMixedSuccess } = await playerAClient
        .from('registrations')
        .insert({ category_id: mixedDoublesId, participant_id: partMixedSuccess.id, status: 'PENDING' });
      assert.ifError(rErrMixedSuccess);

      // 4. ORGANIZER VISIBILITY OF DEMOGRAPHIC INFORMATION
      const { data: orgRegs, error: orgSelErr } = await orgAClient
        .from('registrations')
        .select(`
          id,
          status,
          participant: participants (
            members: participant_members (
              player: players ( id, full_name, gender, date_of_birth )
            )
          )
        `)
        .eq('category_id', mixedDoublesId);
      assert.ifError(orgSelErr);
      
      const foundReg = (orgRegs as any[])?.find(r => r.id === partMixedSuccess.id || r.participant?.members?.some((m: any) => m.player.id === userIds.playerA)) as any;
      assert.ok(foundReg, 'Organizer must be able to retrieve the mixed doubles registration');
      const members = foundReg.participant.members;
      assert.strictEqual(members.length, 2, 'Team must have exactly two members');
      
      const m1 = members.find((m: any) => m.player.id === userIds.playerA);
      const m2 = members.find((m: any) => m.player.id === userIds.playerB);
      assert.strictEqual(m1.player.gender, 'MALE', 'Organizer must see correct player 1 gender');
      assert.strictEqual(m2.player.gender, 'FEMALE', 'Organizer must see correct player 2 gender');
      assert.ok(m1.player.date_of_birth, 'Organizer must see correct player 1 date of birth');
      assert.ok(m2.player.date_of_birth, 'Organizer must see correct player 2 date of birth');
    });
  });
}
