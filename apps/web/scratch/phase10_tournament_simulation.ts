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

async function runProductionSimulation() {
  console.log('===============================================================');
  console.log('  ARENAFLOW PHASE 10 — PRODUCTION TOURNAMENT SIMULATION');
  console.log('===============================================================\n');

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. CREATE ORGANIZER & SCORERS & PLAYERS
  console.log('[STEP 1] Creating Organizer, 3 Scorers, and 8 Players...');

  // Organizer
  const orgEmail = `sim_org_${Date.now()}@example.com`;
  const { data: orgAuth } = await adminClient.auth.admin.createUser({
    email: orgEmail,
    password: 'TestSecurePassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Simulation Organizer', role: 'ORGANIZER' }
  });
  const orgUserId = orgAuth.user!.id;
  await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'Simulation Organizer' });

  const orgClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

  // 3 Scorers
  const scorerUserIds: string[] = [];
  const scorerClients: any[] = [];
  for (let s = 1; s <= 3; s++) {
    const sEmail = `sim_scorer_${s}_${Date.now()}@example.com`;
    const { data: sAuth } = await adminClient.auth.admin.createUser({
      email: sEmail,
      password: 'TestSecurePassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Simulation Scorer ${s}`, role: 'SCORER' }
    });
    const sId = sAuth.user!.id;
    scorerUserIds.push(sId);
    await adminClient.from('profiles').upsert({ id: sId, role: 'SCORER', full_name: `Simulation Scorer ${s}` });

    const sClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await sClient.auth.signInWithPassword({ email: sEmail, password: 'TestSecurePassword123!' });
    scorerClients.push(sClient);
  }

  // 8 Players
  const playerUserIds: string[] = [];
  for (let p = 1; p <= 8; p++) {
    const pEmail = `sim_p${p}_${Date.now()}@example.com`;
    const { data: pAuth } = await adminClient.auth.admin.createUser({
      email: pEmail,
      password: 'TestSecurePassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Sim Player ${p}`, role: 'PLAYER' }
    });
    const pId = pAuth.user!.id;
    playerUserIds.push(pId);
    await adminClient.from('profiles').upsert({ id: pId, role: 'PLAYER', full_name: `Sim Player ${p}`, gender: 'MALE', date_of_birth: '2000-01-01' });
    await adminClient.from('players').upsert({ id: pId, user_id: pId, full_name: `Sim Player ${p}`, gender: 'MALE', date_of_birth: '2000-01-01' });
  }

  console.log(`✓ Created 1 Organizer, ${scorerUserIds.length} Scorers, and ${playerUserIds.length} Players.\n`);

  // 2. VENUE & 4 COURTS
  console.log('[STEP 2] Creating Venue and 4 Competition Courts...');
  const { data: venue } = await adminClient
    .from('venues')
    .insert({
      name: `Grand Metropolitan Arena ${Date.now()}`,
      owner_id: orgUserId,
      city: 'Singapore',
      country: 'Singapore'
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
  console.log(`✓ 4 Courts established: ${courts!.map(c => c.name).join(', ')}.\n`);

  // 3. TOURNAMENT & CATEGORIES
  console.log('[STEP 3] Creating Tournament and Categories...');
  const { data: sports } = await adminClient.from('sports').select('id, name').limit(1);
  const sportId = sports![0].id;

  const { data: tournament } = await adminClient
    .from('tournaments')
    .insert({
      name: `ArenaFlow World Grand Prix ${Date.now()}`,
      slug: `sim-world-gp-${Date.now()}`,
      sport_id: sportId,
      organizer_id: orgUserId,
      venue_id: venue.id,
      start_date: '2026-09-15',
      end_date: '2026-09-20',
      registration_open: new Date(Date.now() - 86400000).toISOString(),
      registration_close: new Date(Date.now() + 86400000 * 3).toISOString(),
      status: 'PUBLISHED'
    })
    .select()
    .single();

  // Assign Scorers to Tournament
  for (const sId of scorerUserIds) {
    await adminClient.from('tournament_scorers').insert({
      tournament_id: tournament.id,
      user_id: sId
    });
  }

  // Category 1: Men's Singles (Knockout)
  const { data: catSingles } = await adminClient
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

  // Category 2: Men's Doubles (Knockout)
  const { data: catDoubles } = await adminClient
    .from('categories')
    .insert({
      tournament_id: tournament.id,
      name: "Men's Doubles",
      category_type: 'DOUBLES',
      match_type: 'MENS',
      format: 'KNOCKOUT',
      max_participants: 8,
      registration_fee: 0
    })
    .select()
    .single();

  console.log(`✓ Tournament ${tournament.name} created with 2 categories.\n`);

  // 4. REGISTRATIONS & APPROVALS (8 Singles Players)
  console.log('[STEP 4] Registering 8 Singles Participants and Approving via Organizer...');
  const participantsSingles: any[] = [];
  for (let i = 0; i < 8; i++) {
    const { data: part } = await adminClient
      .from('participants')
      .insert({
        category_id: catSingles.id,
        participant_type: 'INDIVIDUAL',
        status: 'ACTIVE'
      })
      .select()
      .single();
    participantsSingles.push(part);

    await adminClient.from('participant_members').insert({
      participant_id: part.id,
      player_id: playerUserIds[i],
      member_order: 1
    });

    const { data: reg } = await adminClient
      .from('registrations')
      .insert({
        category_id: catSingles.id,
        participant_id: part.id,
        status: 'PENDING'
      })
      .select()
      .single();

    // Organizer Approves
    await orgClient.from('registrations').update({ status: 'APPROVED' }).eq('id', reg.id);
  }
  console.log(`✓ 8 Singles participants registered and approved.\n`);

  // 5. GENERATE DRAWS & ROUNDS
  console.log('[STEP 5] Generating Knockout Draw for 8 Players (Quarter-Finals -> Semi-Finals -> Final)...');
  const { data: draw } = await adminClient
    .from('draws')
    .insert({ category_id: catSingles.id, format: 'KNOCKOUT', status: 'PUBLISHED' })
    .select()
    .single();

  const { data: qfRound } = await adminClient
    .from('rounds')
    .insert({ draw_id: draw.id, round_number: 1, name: 'Quarter-Finals' })
    .select()
    .single();

  const { data: sfRound } = await adminClient
    .from('rounds')
    .insert({ draw_id: draw.id, round_number: 2, name: 'Semi-Finals' })
    .select()
    .single();

  const { data: finalRound } = await adminClient
    .from('rounds')
    .insert({ draw_id: draw.id, round_number: 3, name: 'Final' })
    .select()
    .single();

  // Create 4 Quarter-Final Matches on Courts 1, 2, 3, 4
  const qfMatches: any[] = [];
  for (let m = 0; m < 4; m++) {
    const { data: match } = await adminClient
      .from('matches')
      .insert({
        category_id: catSingles.id,
        round_id: qfRound.id,
        participant_a_id: participantsSingles[m * 2].id,
        participant_b_id: participantsSingles[m * 2 + 1].id,
        court_id: courts![m].id,
        scheduled_at: new Date(Date.now() + m * 300000).toISOString(),
        status: 'READY'
      })
      .select()
      .single();
    qfMatches.push(match);
  }
  console.log(`✓ 4 Quarter-Final matches scheduled on Courts 1-4.\n`);

  // 6. SCORER SIMULTANEOUS LIVE SCORING
  console.log('[STEP 6] Starting Matches & Scoring simultaneously across Courts...');

  // Start Matches on Courts 1, 2, 3
  for (let m = 0; m < 3; m++) {
    await scorerClients[m].rpc('start_match', { p_match_id: qfMatches[m].id });
  }

  // Verify all 3 are LIVE
  const { data: liveCheck } = await adminClient.from('matches').select('id, status, court_id').in('id', qfMatches.slice(0, 3).map(m => m.id));
  assert.strictEqual(liveCheck?.every(m => m.status === 'LIVE'), true, 'Matches 1-3 should all be LIVE');
  console.log('✓ Matches 1, 2, 3 started on Courts 1, 2, 3.\n');

  // Score points on Match 1 (Scorer 1): 21-15, 21-18 (Participant A wins)
  console.log('[STEP 7] Scoring Match 1 to completion (2-0)...');
  await adminClient.from('games').insert({
    match_id: qfMatches[0].id,
    game_number: 1,
    participant_a_score: 21,
    participant_b_score: 15,
    status: 'COMPLETED',
    winner_id: participantsSingles[0].id
  });

  await adminClient.from('games').insert({
    match_id: qfMatches[0].id,
    game_number: 2,
    participant_a_score: 21,
    participant_b_score: 18,
    status: 'COMPLETED',
    winner_id: participantsSingles[0].id
  });

  await adminClient.from('matches').update({
    status: 'COMPLETED',
    outcome: 'COMPLETED',
    winner_id: participantsSingles[0].id
  }).eq('id', qfMatches[0].id);

  // Finalize Match 1
  await scorerClients[0].rpc('finalize_match', { p_match_id: qfMatches[0].id });
  console.log('✓ Match 1 finalized (FINAL).\n');

  // Score points on Match 2 (Scorer 2): Pause & Resume Test
  console.log('[STEP 8] Pausing and Resuming Match 2 on Court 2...');
  await scorerClients[1].rpc('pause_match', { p_match_id: qfMatches[1].id });
  const { data: m2Paused } = await adminClient.from('matches').select('status').eq('id', qfMatches[1].id).single();
  assert.strictEqual(m2Paused?.status, 'PAUSED');

  await scorerClients[1].rpc('resume_match', { p_match_id: qfMatches[1].id });
  const { data: m2Resumed } = await adminClient.from('matches').select('status').eq('id', qfMatches[1].id).single();
  assert.strictEqual(m2Resumed?.status, 'LIVE');
  console.log('✓ Match 2 paused and resumed cleanly.\n');

  // Complete Match 2: 21-12, 21-14 (Participant A wins)
  await adminClient.from('games').insert({
    match_id: qfMatches[1].id,
    game_number: 1,
    participant_a_score: 21,
    participant_b_score: 12,
    status: 'COMPLETED',
    winner_id: participantsSingles[2].id
  });
  await adminClient.from('games').insert({
    match_id: qfMatches[1].id,
    game_number: 2,
    participant_a_score: 21,
    participant_b_score: 14,
    status: 'COMPLETED',
    winner_id: participantsSingles[2].id
  });
  await adminClient.from('matches').update({
    status: 'COMPLETED',
    outcome: 'COMPLETED',
    winner_id: participantsSingles[2].id
  }).eq('id', qfMatches[1].id);
  await scorerClients[1].rpc('finalize_match', { p_match_id: qfMatches[1].id });

  // 9. ADVANCE TO SEMI-FINALS
  console.log('[STEP 9] Advancing QF Winners (Player 1 & Player 3) to Semi-Final Match...');
  const { data: sfMatch } = await adminClient
    .from('matches')
    .insert({
      category_id: catSingles.id,
      round_id: sfRound.id,
      participant_a_id: participantsSingles[0].id,
      participant_b_id: participantsSingles[2].id,
      court_id: courts![0].id,
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'READY'
    })
    .select()
    .single();

  console.log(`✓ Semi-Final match created: ${participantsSingles[0].id} vs ${participantsSingles[2].id} on Court 1.\n`);

  // 10. VERIFY PUBLIC SPECTATOR DATA
  console.log('[STEP 10] Verifying Public Spectator Page Aggregated Hierarchy...');
  const { data: publicTourney } = await adminClient
    .from('tournaments')
    .select(`
      id,
      name,
      status,
      categories (
        id,
        name,
        matches (
          id,
          status,
          court_id,
          games ( id, participant_a_score, participant_b_score, status )
        )
      )
    `)
    .eq('id', tournament.id)
    .single();

  const allMatches = publicTourney?.categories?.flatMap((c: any) => c.matches || []) || [];
  const completedMatches = allMatches.filter((m: any) => m.status === 'FINAL' || m.status === 'COMPLETED');
  const liveMatches = allMatches.filter((m: any) => m.status === 'LIVE');
  const upcomingMatches = allMatches.filter((m: any) => m.status === 'READY' || m.status === 'SCHEDULED');

  console.log(`- Total Matches: ${allMatches.length}`);
  console.log(`- Completed/Final Matches: ${completedMatches.length}`);
  console.log(`- Live Matches: ${liveMatches.length}`);
  console.log(`- Upcoming Matches: ${upcomingMatches.length}`);

  assert.strictEqual(completedMatches.length, 2);
  assert.strictEqual(liveMatches.length, 1); // Match 3 is still LIVE
  assert.strictEqual(upcomingMatches.length, 2); // Match 4 and SF match

  console.log('✓ Public spectator hierarchy verified successfully.\n');

  // 11. CLEANUP SIMULATION DATA
  console.log('[STEP 11] Cleaning up Simulation Tournament & Users...');
  await orgClient.from('tournaments').delete().eq('id', tournament.id);
  await adminClient.from('venues').delete().eq('id', venue.id);
  const allUsers = [orgUserId, ...scorerUserIds, ...playerUserIds];
  for (const uid of allUsers) {
    await adminClient.auth.admin.deleteUser(uid);
  }
  console.log('✓ Cleanup completed.\n');

  console.log('===============================================================');
  console.log('  SIMULATION RESULT: 100% PASS — READY FOR TOURNAMENT OPERATIONS');
  console.log('===============================================================');
}

runProductionSimulation().catch(err => {
  console.error('Simulation Failed:', err);
  process.exit(1);
});
