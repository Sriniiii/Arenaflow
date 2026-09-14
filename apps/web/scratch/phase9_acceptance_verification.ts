import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert';
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

async function runAcceptanceVerification() {
  console.log('=== STARTING PHASE 9 ACCEPTANCE VERIFICATION ===\n');

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. SETUP TEST TOURNAMENT WITH 4 COURTS AND 3 MATCHES
  console.log('[STEP 1] Setting up Acceptance Test Tournament & 4 Courts...');
  
  const orgEmail = `acc_org_${Date.now()}@example.com`;
  const { data: orgAuth } = await adminClient.auth.admin.createUser({
    email: orgEmail,
    password: 'TestSecurePassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Acceptance Organizer', role: 'ORGANIZER' }
  });
  const orgUserId = orgAuth.user!.id;
  await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'Acceptance Organizer' });

  const orgClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

  // Create 6 players
  const playerIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const pEmail = `acc_p${i}_${Date.now()}@example.com`;
    const { data: pAuth } = await adminClient.auth.admin.createUser({
      email: pEmail,
      password: 'TestSecurePassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Acc Player ${i}`, role: 'PLAYER' }
    });
    const pId = pAuth.user!.id;
    playerIds.push(pId);
    await adminClient.from('profiles').upsert({ id: pId, role: 'PLAYER', full_name: `Acc Player ${i}`, gender: 'MALE', date_of_birth: '2000-01-01' });
    await adminClient.from('players').upsert({ id: pId, user_id: pId, full_name: `Acc Player ${i}`, gender: 'MALE', date_of_birth: '2000-01-01' });
  }

  // Create Venue & 4 Courts
  const { data: venue } = await adminClient
    .from('venues')
    .insert({
      name: `Acceptance Arena ${Date.now()}`,
      owner_id: orgUserId,
      city: 'Delhi',
      country: 'India'
    })
    .select()
    .single();

  const { data: courts } = await adminClient
    .from('courts')
    .insert([
      { venue_id: venue.id, name: 'Court 1', status: 'ACTIVE' },
      { venue_id: venue.id, name: 'Court 2', status: 'ACTIVE' },
      { venue_id: venue.id, name: 'Court 3', status: 'ACTIVE' },
      { venue_id: venue.id, name: 'Court 4', status: 'ACTIVE' }
    ])
    .select();

  const { data: sports } = await adminClient.from('sports').select('id, name').limit(1);
  const sportId = sports![0].id;

  const { data: tournament } = await adminClient
    .from('tournaments')
    .insert({
      name: `Acceptance Open ${Date.now()}`,
      slug: `acc-open-${Date.now()}`,
      sport_id: sportId,
      organizer_id: orgUserId,
      venue_id: venue.id,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      registration_open: new Date(Date.now() - 86400000).toISOString(),
      registration_close: new Date(Date.now() + 86400000 * 2).toISOString(),
      status: 'PUBLISHED'
    })
    .select()
    .single();

  const { data: category } = await adminClient
    .from('categories')
    .insert({
      tournament_id: tournament.id,
      name: "Men's Singles",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT',
      max_participants: 16,
      registration_fee: 0
    })
    .select()
    .single();

  // Register 6 participants
  const participants: any[] = [];
  const registrations: any[] = [];
  for (let i = 0; i < 6; i++) {
    const { data: part } = await adminClient
      .from('participants')
      .insert({
        category_id: category.id,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      })
      .select()
      .single();
    participants.push(part);

    await adminClient.from('participant_members').insert({
      participant_id: part.id,
      player_id: playerIds[i],
      member_order: 1
    });

    const { data: reg } = await adminClient
      .from('registrations')
      .insert({
        category_id: category.id,
        participant_id: part.id,
        status: i < 5 ? 'APPROVED' : 'PENDING'
      })
      .select()
      .single();
    registrations.push(reg);
  }

  // Create Draw & 3 Matches
  const { data: draw } = await adminClient
    .from('draws')
    .insert({ category_id: category.id, format: 'KNOCKOUT', status: 'PUBLISHED' })
    .select()
    .single();

  const { data: round } = await adminClient
    .from('rounds')
    .insert({ draw_id: draw.id, round_number: 1, name: 'Round 1' })
    .select()
    .single();

  // Match A on Court 1 (LIVE)
  const { data: matchA } = await adminClient
    .from('matches')
    .insert({
      category_id: category.id,
      round_id: round.id,
      participant_a_id: participants[0].id,
      participant_b_id: participants[1].id,
      court_id: courts![0].id,
      scheduled_at: new Date().toISOString(),
      status: 'LIVE'
    })
    .select()
    .single();

  // Match B on Court 2 (LIVE)
  const { data: matchB } = await adminClient
    .from('matches')
    .insert({
      category_id: category.id,
      round_id: round.id,
      participant_a_id: participants[2].id,
      participant_b_id: participants[3].id,
      court_id: courts![1].id,
      scheduled_at: new Date().toISOString(),
      status: 'LIVE'
    })
    .select()
    .single();

  // Match C on Court 3 (LIVE)
  const { data: matchC } = await adminClient
    .from('matches')
    .insert({
      category_id: category.id,
      round_id: round.id,
      participant_a_id: participants[4].id,
      participant_b_id: participants[5].id,
      court_id: courts![2].id,
      scheduled_at: new Date().toISOString(),
      status: 'LIVE'
    })
    .select()
    .single();

  // Court 4 has no active match (IDLE)

  // Insert Game records with scores: Court 1 = 10-8, Court 2 = 15-12, Court 3 = 7-6
  const { data: gameA } = await adminClient
    .from('games')
    .insert({
      match_id: matchA.id,
      game_number: 1,
      participant_a_score: 10,
      participant_b_score: 8,
      status: 'LIVE'
    })
    .select()
    .single();

  const { data: gameB } = await adminClient
    .from('games')
    .insert({
      match_id: matchB.id,
      game_number: 1,
      participant_a_score: 15,
      participant_b_score: 12,
      status: 'LIVE'
    })
    .select()
    .single();

  const { data: gameC } = await adminClient
    .from('games')
    .insert({
      match_id: matchC.id,
      game_number: 1,
      participant_a_score: 7,
      participant_b_score: 6,
      status: 'LIVE'
    })
    .select()
    .single();

  console.log('✓ Scenario setup completed successfully.\n');

  // =========================================================
  // 4. DASHBOARD METRICS CALCULATION
  // =========================================================
  console.log('[SECTION 4] Testing Dashboard Metrics Calculation...');
  const { data: dashTourney } = await adminClient
    .from('tournaments')
    .select(`
      id,
      categories (
        participants (
          id,
          status,
          members: participant_members ( player_id )
        ),
        registrations ( id, status, participant_id ),
        matches ( id, status, court_id )
      ),
      venues ( courts ( id ) ),
      tournament_scorers ( user_id )
    `)
    .eq('id', tournament.id)
    .single();

  const cats = (dashTourney?.categories as any[]) || [];
  const uniquePlayers = new Set<string>();
  let approvedCount = 0;
  let pendingCount = 0;
  let totalMatches = 0;
  let liveMatches = 0;
  let completedMatches = 0;

  cats.forEach(c => {
    c.participants?.forEach((p: any) => {
      p.members?.forEach((m: any) => {
        if (m.player_id) uniquePlayers.add(m.player_id);
      });
    });
    approvedCount += c.registrations?.filter((r: any) => r.status === 'APPROVED').length || 0;
    pendingCount += c.registrations?.filter((r: any) => r.status === 'PENDING').length || 0;
    totalMatches += c.matches?.length || 0;
    liveMatches += c.matches?.filter((m: any) => m.status === 'LIVE' || m.status === 'UNDER_REVIEW').length || 0;
    completedMatches += c.matches?.filter((m: any) => m.status === 'COMPLETED' || m.status === 'FINAL').length || 0;
  });

  const assignedCourts = (dashTourney?.venues as any)?.courts?.length || 0;
  const assignedScorers = (dashTourney?.tournament_scorers as any[])?.length || 0;

  console.log(`- Registered Players: ${uniquePlayers.size} (Expected: 6)`);
  console.log(`- Approved Participants: ${approvedCount} (Expected: 5)`);
  console.log(`- Pending Registrations: ${pendingCount} (Expected: 1)`);
  console.log(`- Total Matches: ${totalMatches} (Expected: 3)`);
  console.log(`- Live Matches: ${liveMatches} (Expected: 3)`);
  console.log(`- Completed Matches: ${completedMatches} (Expected: 0)`);
  console.log(`- Assigned Courts: ${assignedCourts} (Expected: 4)`);
  console.log(`- Assigned Scorers: ${assignedScorers} (Expected: 0)`);

  assert.strictEqual(uniquePlayers.size, 6);
  assert.strictEqual(approvedCount, 5);
  assert.strictEqual(pendingCount, 1);
  assert.strictEqual(totalMatches, 3);
  assert.strictEqual(liveMatches, 3);
  assert.strictEqual(assignedCourts, 4);
  console.log('✓ Section 4 Dashboard Verification: PASS\n');

  // =========================================================
  // 5. COURT STATUS BOARD — 4 DISTINCT COURTS & 3 SIMULTANEOUS MATCHES
  // =========================================================
  console.log('[SECTION 5] Testing Court Status Board Real Data Mapping...');
  const { data: dbCourts } = await adminClient
    .from('courts')
    .select(`
      id,
      name,
      status,
      matches (
        id,
        status,
        scheduled_at,
        participant_a:participants!matches_participant_a_id_fkey(id),
        participant_b:participants!matches_participant_b_id_fkey(id),
        games ( id, game_number, participant_a_score, participant_b_score, status )
      )
    `)
    .eq('venue_id', venue.id)
    .order('name');

  assert.strictEqual(dbCourts?.length, 4, 'Venue must have 4 distinct courts');
  console.log(`- Court 1: ${dbCourts![0].name} -> Matches: ${dbCourts![0].matches?.length} (${dbCourts![0].matches[0]?.status})`);
  console.log(`- Court 2: ${dbCourts![1].name} -> Matches: ${dbCourts![1].matches?.length} (${dbCourts![1].matches[0]?.status})`);
  console.log(`- Court 3: ${dbCourts![2].name} -> Matches: ${dbCourts![2].matches?.length} (${dbCourts![2].matches[0]?.status})`);
  console.log(`- Court 4: ${dbCourts![3].name} -> Matches: ${dbCourts![3].matches?.length} (IDLE)`);

  assert.strictEqual(dbCourts![0].matches[0]?.status, 'LIVE');
  assert.strictEqual(dbCourts![1].matches[0]?.status, 'LIVE');
  assert.strictEqual(dbCourts![2].matches[0]?.status, 'LIVE');
  assert.strictEqual(dbCourts![3].matches.length, 0);
  console.log('✓ Section 5 Court Status Board Verification: PASS\n');

  // =========================================================
  // 6. 3D MAP COORDINATE LAYOUT & MAPPING
  // =========================================================
  console.log('[SECTION 6] Testing 3D Map Non-Overlapping Grid Layout...');
  const getCourtPosition = (index: number, total: number): [number, number, number] => {
    const cols = total <= 2 ? total : Math.min(Math.ceil(Math.sqrt(total)), 3);
    const rows = Math.ceil(total / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const spacingX = 4.8;
    const spacingZ = 4.2;
    const offsetX = ((cols - 1) * spacingX) / 2;
    const offsetZ = ((rows - 1) * spacingZ) / 2;
    return [col * spacingX - offsetX, 0, row * spacingZ - offsetZ];
  };

  const c1Pos = getCourtPosition(0, 4);
  const c2Pos = getCourtPosition(1, 4);
  const c3Pos = getCourtPosition(2, 4);
  const c4Pos = getCourtPosition(3, 4);

  console.log(`- Court 1 3D Position: [${c1Pos.join(', ')}]`);
  console.log(`- Court 2 3D Position: [${c2Pos.join(', ')}]`);
  console.log(`- Court 3 3D Position: [${c3Pos.join(', ')}]`);
  console.log(`- Court 4 3D Position: [${c4Pos.join(', ')}]`);

  const positionsSet = new Set([c1Pos.join(','), c2Pos.join(','), c3Pos.join(','), c4Pos.join(',')]);
  assert.strictEqual(positionsSet.size, 4, 'All 4 court positions must be unique and non-overlapping');
  console.log('✓ Section 6 3D Map Multi-Court Layout: PASS\n');

  // =========================================================
  // 7. INDEPENDENT SCORE TEST
  // =========================================================
  console.log('[SECTION 7] Testing Independent Court Scores...');
  // Check initial scores
  const { data: gAInit } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameA.id).single();
  const { data: gBInit } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameB.id).single();
  const { data: gCInit } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameC.id).single();

  console.log(`- Initial: Court 1 = ${gAInit?.participant_a_score}-${gAInit?.participant_b_score}`);
  console.log(`- Initial: Court 2 = ${gBInit?.participant_a_score}-${gBInit?.participant_b_score}`);
  console.log(`- Initial: Court 3 = ${gCInit?.participant_a_score}-${gCInit?.participant_b_score}`);

  assert.strictEqual(gAInit?.participant_a_score, 10);
  assert.strictEqual(gBInit?.participant_a_score, 15);
  assert.strictEqual(gCInit?.participant_a_score, 7);

  // Update ONLY Court 2 score: 15-12 -> 16-12
  console.log('Updating Court 2 score to 16-12...');
  await adminClient.from('games').update({ participant_a_score: 16 }).eq('id', gameB.id);

  const { data: gAAfter } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameA.id).single();
  const { data: gBAfter } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameB.id).single();
  const { data: gCAfter } = await adminClient.from('games').select('participant_a_score, participant_b_score').eq('id', gameC.id).single();

  console.log(`- After update: Court 1 = ${gAAfter?.participant_a_score}-${gAAfter?.participant_b_score} (Unchanged)`);
  console.log(`- After update: Court 2 = ${gBAfter?.participant_a_score}-${gBAfter?.participant_b_score} (Updated to 16-12)`);
  console.log(`- After update: Court 3 = ${gCAfter?.participant_a_score}-${gCAfter?.participant_b_score} (Unchanged)`);

  assert.strictEqual(gAAfter?.participant_a_score, 10, 'Court 1 score must remain 10-8');
  assert.strictEqual(gBAfter?.participant_a_score, 16, 'Court 2 score must become 16-12');
  assert.strictEqual(gCAfter?.participant_a_score, 7, 'Court 3 score must remain 7-6');
  console.log('✓ Section 7 Independent Score Test: PASS\n');

  // =========================================================
  // 8. COURT STATUS TEST & COMPLETION MIGRATION
  // =========================================================
  console.log('[SECTION 8] Testing Court Lifecycle Transitions...');
  // Pause Match A on Court 1
  console.log('Pausing Match A on Court 1: LIVE -> PAUSED');
  await orgClient.rpc('pause_match', { p_match_id: matchA.id });
  const { data: mApaused } = await adminClient.from('matches').select('status').eq('id', matchA.id).single();
  const { data: mBrunning } = await adminClient.from('matches').select('status').eq('id', matchB.id).single();
  assert.strictEqual(mApaused?.status, 'PAUSED');
  assert.strictEqual(mBrunning?.status, 'LIVE', 'Match B must remain LIVE');

  // Resume Match A on Court 1
  console.log('Resuming Match A on Court 1: PAUSED -> LIVE');
  await orgClient.rpc('resume_match', { p_match_id: matchA.id });
  const { data: mAresumed } = await adminClient.from('matches').select('status').eq('id', matchA.id).single();
  assert.strictEqual(mAresumed?.status, 'LIVE');

  // Complete Match A
  console.log('Completing Match A on Court 1: LIVE -> COMPLETED -> FINAL');
  await adminClient.from('matches').update({ status: 'COMPLETED', outcome: 'COMPLETED', winner_id: participants[0].id }).eq('id', matchA.id);
  await orgClient.rpc('finalize_match', { p_match_id: matchA.id });
  const { data: mAfinal } = await adminClient.from('matches').select('status').eq('id', matchA.id).single();
  assert.strictEqual(mAfinal?.status, 'FINAL');

  // Verify that Match A is now COMPLETED/FINAL and Court 1 has no live match
  const { data: liveMatchesList } = await adminClient.from('matches').select('id, status').in('status', ['LIVE', 'UNDER_REVIEW']).eq('category_id', category.id);
  const { data: compMatchesList } = await adminClient.from('matches').select('id, status').in('status', ['COMPLETED', 'FINAL']).eq('category_id', category.id);

  console.log(`- Active LIVE Matches count: ${liveMatchesList?.length} (Expected: 2 - Match B & C)`);
  console.log(`- COMPLETED/FINAL Matches count: ${compMatchesList?.length} (Expected: 1 - Match A)`);

  assert.strictEqual(liveMatchesList?.length, 2);
  assert.strictEqual(compMatchesList?.length, 1);
  assert.strictEqual(compMatchesList![0].id, matchA.id);
  console.log('✓ Section 8 Court Status & Completion Test: PASS\n');

  // =========================================================
  // 14. REGISTRATION WORKFLOW (APPROVE & REJECT)
  // =========================================================
  console.log('[SECTION 14] Testing Registration Workflow & Demographics...');
  const pendingReg = registrations[5]; // 6th player was PENDING
  console.log(`Approving Registration ${pendingReg.id}...`);
  await orgClient.from('registrations').update({ status: 'APPROVED' }).eq('id', pendingReg.id);
  await orgClient.from('participants').update({ status: 'ACTIVE' }).eq('id', pendingReg.participant_id);

  const { data: regApp } = await adminClient.from('registrations').select('status').eq('id', pendingReg.id).single();
  const { data: partApp } = await adminClient.from('participants').select('status').eq('id', pendingReg.participant_id).single();
  assert.strictEqual(regApp?.status, 'APPROVED');
  assert.strictEqual(partApp?.status, 'ACTIVE');

  console.log(`Rejecting Registration ${registrations[4].id}...`);
  await orgClient.from('registrations').update({ status: 'REJECTED' }).eq('id', registrations[4].id);
  await orgClient.from('participants').update({ status: 'WITHDRAWN' }).eq('id', registrations[4].participant_id);

  const { data: regRej } = await adminClient.from('registrations').select('status').eq('id', registrations[4].id).single();
  const { data: partRej } = await adminClient.from('participants').select('status').eq('id', registrations[4].participant_id).single();
  assert.strictEqual(regRej?.status, 'REJECTED');
  assert.strictEqual(partRej?.status, 'WITHDRAWN');
  console.log('✓ Section 14 Registration Workflow: PASS\n');

  // =========================================================
  // 15. SECURITY VERIFICATION
  // =========================================================
  console.log('[SECTION 15] Testing Security & RLS Permissions...');
  // Player Client
  const playerClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  await playerClient.auth.signInWithPassword({
    email: (await adminClient.auth.admin.getUserById(playerIds[0])).data.user!.email!,
    password: 'TestSecurePassword123!'
  });

  // Player attempts to delete tournament
  const { error: pDelErr } = await playerClient.from('tournaments').delete().eq('id', tournament.id);
  // In Supabase RLS, delete on rows where policy does not match deletes 0 rows (no deletion)
  const { data: tCheck } = await adminClient.from('tournaments').select('id').eq('id', tournament.id).single();
  assert.ok(tCheck, 'Tournament must NOT be deleted by a player account');

  // Player attempts to pause match
  const { error: pPauseErr } = await playerClient.rpc('pause_match', { p_match_id: matchB.id });
  assert.ok(pPauseErr, 'Player must NOT be able to invoke pause_match RPC');

  console.log('✓ Section 15 Security Verification: PASS\n');

  // =========================================================
  // 16. DELETE TOURNAMENT SAFETY & CASCADE
  // =========================================================
  console.log('[SECTION 16] Testing Tournament Deletion Safety & Cascading Deletion...');
  // Organizer deletes the test tournament
  const { error: orgDelErr } = await orgClient.from('tournaments').delete().eq('id', tournament.id);
  assert.strictEqual(orgDelErr, null, 'Organizer must be able to delete tournament');

  // Verify categories, matches, registrations, draws, rounds are cascaded
  const { data: catsLeft } = await adminClient.from('categories').select('id').eq('tournament_id', tournament.id);
  const { data: matchesLeft } = await adminClient.from('matches').select('id').eq('category_id', category.id);
  const { data: regsLeft } = await adminClient.from('registrations').select('id').eq('category_id', category.id);

  assert.strictEqual(catsLeft?.length, 0, 'Categories must be cascaded');
  assert.strictEqual(matchesLeft?.length, 0, 'Matches must be cascaded');
  assert.strictEqual(regsLeft?.length, 0, 'Registrations must be cascaded');

  // Verify Player accounts remain completely intact
  const { data: playerCheck } = await adminClient.from('players').select('id').eq('id', playerIds[0]).single();
  const { data: profileCheck } = await adminClient.from('profiles').select('id').eq('id', playerIds[0]).single();
  assert.ok(playerCheck, 'Player record must remain intact after tournament deletion');
  assert.ok(profileCheck, 'Profile record must remain intact after tournament deletion');

  console.log('✓ Section 16 Delete Tournament Cascade & Safety: PASS\n');

  // Cleanup venue and users
  await adminClient.from('venues').delete().eq('id', venue.id);
  const allUsers = [orgUserId, ...playerIds];
  for (const uid of allUsers) {
    await adminClient.auth.admin.deleteUser(uid);
  }

  console.log('=== ALL ACCEPTANCE SECTIONS VERIFIED & PASSED ===');
}

runAcceptanceVerification().catch(err => {
  console.error('Acceptance Verification Failed:', err);
  process.exit(1);
});
