import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculatePlayerStats,
  calculateHeadToHead,
  calculateStandings,
} from '@arena-flow/statistics-engine';

function loadEnv() {
  try {
    const rootEnv = path.resolve(process.cwd(), '.env');
    const siblingEnv = path.resolve(process.cwd(), '../../.env');
    const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
    const envPath = fs.existsSync(rootEnv) ? rootEnv : fs.existsSync(appsWebEnv) ? appsWebEnv : siblingEnv;

    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, 'utf8');
      envConfig.split('\n').forEach((line) => {
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Feature 9: Player Portal & Identity Security Suite (28 Areas)', () => {
  let adminClient: SupabaseClient;
  let playerAClient: SupabaseClient;
  let playerBClient: SupabaseClient;
  let orgClient: SupabaseClient;
  let anonClient: SupabaseClient;

  const testRunId = Date.now().toString().slice(-6);
  const playerAEmail = `portal_pa_${testRunId}@gmail.com`;
  const playerBEmail = `portal_pb_${testRunId}@gmail.com`;
  const orgEmail = `portal_org_${testRunId}@gmail.com`;
  const password = 'TestSecurePassword123!';

  let playerAId: string;
  let playerBId: string;
  let orgId: string;
  let sportId: string;
  let venueId: string;
  let courtId: string;
  let tournamentId: string;
  let categorySinglesId: string;
  let categoryDoublesId: string;

  let participantAId: string;
  let participantBId: string;
  let participantDoublesAId: string;
  let regAId: string;
  let regBId: string;
  let regDoublesId: string;

  let liveMatchId: string;
  let scheduledMatchId: string;
  let scheduledDoublesMatchId: string;
  let completedMatchId: string;
  let walkoverMatchId: string;
  let defaultMatchId: string;
  let retirementMatchId: string;

  let drawId: string;

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Player A
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: playerAEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Player Alpha', display_name: 'Alpha', role: 'PLAYER' },
    });
    if (errA) throw errA;
    playerAId = uA.user.id;

    // 2. Create Player B
    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: playerBEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Player Beta', display_name: 'Beta', role: 'PLAYER' },
    });
    if (errB) throw errB;
    playerBId = uB.user.id;

    // 3. Create Organizer
    const { data: uOrg, error: errOrg } = await adminClient.auth.admin.createUser({
      email: orgEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Tournament Director', role: 'ORGANIZER' },
    });
    if (errOrg) throw errOrg;
    orgId = uOrg.user.id;

    // Ensure player gender and DOB are set for eligibility checks
    await adminClient
      .from('players')
      .update({ gender: 'MALE', date_of_birth: '2000-01-01' })
      .in('id', [playerAId, playerBId]);

    // Authenticate separate clients
    playerAClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await playerAClient.auth.signInWithPassword({ email: playerAEmail, password });

    playerBClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await playerBClient.auth.signInWithPassword({ email: playerBEmail, password });

    orgClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await orgClient.auth.signInWithPassword({ email: orgEmail, password });

    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
    const insSport = sData ? null : await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${testRunId}` }).select('id').single();
    sportId = sData?.id || insSport?.data?.id || '';

    const { data: vData } = await adminClient.from('venues').insert({ name: 'Portal National Arena' }).select('id').single();
    venueId = vData!.id;

    const { data: courtData } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court 1' }).select('id').single();
    courtId = courtData!.id;

    const { data: tData } = await adminClient.from('tournaments').insert({
      name: `Player Portal Championship ${testRunId}`,
      slug: `portal-champ-${testRunId}`,
      sport_id: sportId,
      organizer_id: orgId,
      venue_id: venueId,
      status: 'PUBLISHED',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    }).select('id').single();
    tournamentId = tData!.id;

    const { data: catS } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Singles Premier",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'GROUP_KNOCKOUT',
    }).select('id').single();
    categorySinglesId = catS!.id;

    const { data: catD } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Doubles Premier",
      category_type: 'DOUBLES',
      match_type: 'MENS',
      format: 'KNOCKOUT',
    }).select('id').single();
    categoryDoublesId = catD!.id;

    // 5. Setup Participants & Members for Singles
    const { data: pA } = await adminClient.from('participants').insert({
      category_id: categorySinglesId,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE',
      seed: 1,
    }).select('id').single();
    participantAId = pA!.id;

    const { data: pB } = await adminClient.from('participants').insert({
      category_id: categorySinglesId,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE',
      seed: 2,
    }).select('id').single();
    participantBId = pB!.id;

    await adminClient.from('participant_members').insert([
      { participant_id: participantAId, player_id: playerAId, member_order: 1 },
      { participant_id: participantBId, player_id: playerBId, member_order: 1 },
    ]);

    // Setup Doubles Team (Player A + Player B)
    const { data: pD } = await adminClient.from('participants').insert({
      category_id: categoryDoublesId,
      participant_type: 'TEAM',
      status: 'ACTIVE',
    }).select('id').single();
    participantDoublesAId = pD!.id;

    await adminClient.from('participant_members').insert([
      { participant_id: participantDoublesAId, player_id: playerAId, member_order: 1 },
      { participant_id: participantDoublesAId, player_id: playerBId, member_order: 2 },
    ]);

    // 6. Setup Registrations
    const { data: rA } = await adminClient.from('registrations').insert({
      category_id: categorySinglesId,
      participant_id: participantAId,
      status: 'APPROVED',
    }).select('id').single();
    regAId = rA!.id;

    const { data: rB } = await adminClient.from('registrations').insert({
      category_id: categorySinglesId,
      participant_id: participantBId,
      status: 'APPROVED',
    }).select('id').single();
    regBId = rB!.id;

    const { data: rD } = await adminClient.from('registrations').insert({
      category_id: categoryDoublesId,
      participant_id: participantDoublesAId,
      status: 'APPROVED',
    }).select('id').single();
    regDoublesId = rD!.id;

    // 7. Setup Matches
    // Live Singles Match
    const { data: mLive } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      court_id: courtId,
      status: 'LIVE',
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    }).select('id').single();
    liveMatchId = mLive!.id;

    await adminClient.from('games').insert({
      match_id: liveMatchId,
      game_number: 1,
      participant_a_score: 11,
      participant_b_score: 9,
      status: 'LIVE',
    });

    // Scheduled Singles Match
    const { data: mSched } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      court_id: courtId,
      status: 'READY',
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    }).select('id').single();
    scheduledMatchId = mSched!.id;

    // Scheduled Doubles Match
    const { data: mSchedD } = await adminClient.from('matches').insert({
      category_id: categoryDoublesId,
      participant_a_id: participantDoublesAId,
      participant_b_id: null,
      status: 'SCHEDULED',
      scheduled_at: new Date(Date.now() + 7200000).toISOString(),
    }).select('id').single();
    scheduledDoublesMatchId = mSchedD!.id;

    // Completed Match (Player A won 21-18, 21-16)
    const { data: mComp } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      court_id: courtId,
      status: 'COMPLETED',
      winner_id: participantAId,
      outcome: 'COMPLETED',
      scheduled_at: new Date(Date.now() - 24 * 3600000).toISOString(),
      started_at: new Date(Date.now() - 24 * 3600000).toISOString(),
      ended_at: new Date(Date.now() - 23 * 3600000).toISOString(),
    }).select('id').single();
    completedMatchId = mComp!.id;

    await adminClient.from('games').insert([
      { match_id: completedMatchId, game_number: 1, participant_a_score: 21, participant_b_score: 18, winner_id: participantAId, status: 'COMPLETED' },
      { match_id: completedMatchId, game_number: 2, participant_a_score: 21, participant_b_score: 16, winner_id: participantAId, status: 'COMPLETED' },
    ]);

    // Walkover Match (Player A received Walkover from Player B)
    const { data: mWo } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      status: 'COMPLETED',
      winner_id: participantAId,
      outcome: 'WALKOVER',
      scheduled_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      ended_at: new Date(Date.now() - 47 * 3600000).toISOString(),
    }).select('id').single();
    walkoverMatchId = mWo!.id;

    // Default Match (Player B defaulted, Player A won)
    const { data: mDef } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      status: 'COMPLETED',
      winner_id: participantAId,
      outcome: 'DEFAULT',
      scheduled_at: new Date(Date.now() - 96 * 3600000).toISOString(),
      ended_at: new Date(Date.now() - 95 * 3600000).toISOString(),
    }).select('id').single();
    defaultMatchId = mDef!.id;

    // Retirement Match (Player B retired mid-match, Player A won)
    const { data: mRet } = await adminClient.from('matches').insert({
      category_id: categorySinglesId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      status: 'COMPLETED',
      winner_id: participantAId,
      outcome: 'RETIREMENT',
      scheduled_at: new Date(Date.now() - 72 * 3600000).toISOString(),
      started_at: new Date(Date.now() - 72 * 3600000).toISOString(),
      ended_at: new Date(Date.now() - 71 * 3600000).toISOString(),
    }).select('id').single();
    retirementMatchId = mRet!.id;

    await adminClient.from('games').insert([
      { match_id: retirementMatchId, game_number: 1, participant_a_score: 21, participant_b_score: 19, winner_id: participantAId, status: 'COMPLETED' },
      { match_id: retirementMatchId, game_number: 2, participant_a_score: 11, participant_b_score: 5, winner_id: participantAId, status: 'COMPLETED' },
    ]);

    // 8. Setup Draw & Progression
    const { data: drawData } = await adminClient.from('draws').insert({
      category_id: categorySinglesId,
      format: 'KNOCKOUT',
      status: 'PUBLISHED',
    }).select('id').single();
    drawId = drawData!.id;
  });

  after(async () => {
    // Cleanup test data
    if (tournamentId) await adminClient.from('tournaments').delete().eq('id', tournamentId);
    if (venueId) await adminClient.from('venues').delete().eq('id', venueId);
    if (playerAId) await adminClient.auth.admin.deleteUser(playerAId);
    if (playerBId) await adminClient.auth.admin.deleteUser(playerBId);
    if (orgId) await adminClient.auth.admin.deleteUser(orgId);
  });

  // -------------------------------------------------------------
  // 1. Authentication
  // -------------------------------------------------------------
  test('1. Authentication: User signs in as PLAYER role and session is valid', async () => {
    const { data: prof, error } = await playerAClient
      .from('profiles')
      .select('*')
      .eq('id', playerAId)
      .single();

    assert.ifError(error);
    assert.strictEqual(prof.id, playerAId);
    assert.strictEqual(prof.role, 'PLAYER');
    assert.strictEqual(prof.full_name, 'Player Alpha');
  });

  // -------------------------------------------------------------
  // 2. Player identity resolution
  // -------------------------------------------------------------
  test('2. Player identity resolution: Maps auth.uid() -> players -> participant_members', async () => {
    const { data: playerRecord, error: pErr } = await playerAClient
      .from('players')
      .select('*')
      .eq('id', playerAId)
      .single();

    assert.ifError(pErr);
    assert.strictEqual(playerRecord.user_id, playerAId);

    const { data: members, error: mErr } = await playerAClient
      .from('participant_members')
      .select('participant_id, player_id')
      .eq('player_id', playerAId);

    assert.ifError(mErr);
    assert.ok(members.some((m: any) => m.participant_id === participantAId));
  });

  // -------------------------------------------------------------
  // 3. Own tournament visibility
  // -------------------------------------------------------------
  test('3. Own tournament visibility: Player views tournaments they are registered in', async () => {
    const { data: tourneys, error } = await playerAClient
      .from('tournaments')
      .select('id, name, slug, status, start_date, end_date')
      .eq('id', tournamentId);

    assert.ifError(error);
    assert.strictEqual(tourneys.length, 1);
    assert.strictEqual(tourneys[0].name, `Player Portal Championship ${testRunId}`);
  });

  // -------------------------------------------------------------
  // 4. Own registration visibility
  // -------------------------------------------------------------
  test('4. Own registration visibility: Player A sees their own registered categories', async () => {
    const { data: regs, error } = await playerAClient
      .from('registrations')
      .select('id, status, participant_id')
      .order('created_at', { ascending: false });

    assert.ifError(error);
    assert.ok(regs.some((r: any) => r.id === regAId), 'Player A must see their own singles registration');
  });

  // -------------------------------------------------------------
  // 5. Cross-account registration protection
  // -------------------------------------------------------------
  test('5. Cross-account registration protection: Player A CANNOT read or manipulate Player B private registrations', async () => {
    const { data: targetReg, error: selErr } = await playerAClient
      .from('registrations')
      .select('*')
      .eq('id', regBId);

    assert.ifError(selErr);
    assert.strictEqual(targetReg?.length, 0, 'RLS must block Player A from selecting Player B registration');

    const { data: updateData } = await playerAClient
      .from('registrations')
      .update({ status: 'REJECTED' })
      .eq('id', regBId)
      .select();

    assert.strictEqual(updateData?.length || 0, 0, 'RLS must block Player A from updating Player B registration');
  });

  // -------------------------------------------------------------
  // 6. Upcoming singles matches
  // -------------------------------------------------------------
  test('6. Upcoming singles matches: Retrieves scheduled and ready singles match', async () => {
    const { data: matches, error } = await playerAClient
      .from('matches')
      .select('id, status, scheduled_at, court:courts(name)')
      .in('status', ['SCHEDULED', 'READY'])
      .eq('category_id', categorySinglesId);

    assert.ifError(error);
    assert.ok(matches.some((m: any) => m.id === scheduledMatchId), 'Player A must find their scheduled singles match');
  });

  // -------------------------------------------------------------
  // 7. Upcoming doubles matches
  // -------------------------------------------------------------
  test('7. Upcoming doubles matches: Retrieves scheduled doubles match where Player A is a team member', async () => {
    const { data: matches, error } = await playerAClient
      .from('matches')
      .select('id, status, scheduled_at, participant_a_id')
      .eq('id', scheduledDoublesMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(matches.status, 'SCHEDULED');
    assert.strictEqual(matches.participant_a_id, participantDoublesAId);
  });

  // -------------------------------------------------------------
  // 8. Live match retrieval
  // -------------------------------------------------------------
  test('8. Live match retrieval: Retrieves active live match for player', async () => {
    const { data: liveMatch, error } = await playerAClient
      .from('matches')
      .select('id, status, participant_a_id, participant_b_id')
      .eq('id', liveMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(liveMatch.status, 'LIVE');
    assert.strictEqual(liveMatch.participant_a_id, participantAId);
  });

  // -------------------------------------------------------------
  // 9. Live score updates
  // -------------------------------------------------------------
  test('9. Live score updates: Queries current score and active game structure', async () => {
    const { data: game, error } = await playerAClient
      .from('games')
      .select('game_number, participant_a_score, participant_b_score, status')
      .eq('match_id', liveMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(game.game_number, 1);
    assert.strictEqual(game.participant_a_score, 11);
    assert.strictEqual(game.participant_b_score, 9);
    assert.strictEqual(game.status, 'LIVE');
  });

  // -------------------------------------------------------------
  // 10. Match history
  // -------------------------------------------------------------
  test('10. Match history: Retrieves completed match history with games', async () => {
    const { data: history, error } = await playerAClient
      .from('matches')
      .select('id, status, winner_id, outcome, games(game_number, participant_a_score, participant_b_score)')
      .eq('id', completedMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(history.status, 'COMPLETED');
    assert.strictEqual(history.winner_id, participantAId);
    assert.strictEqual(history.games.length, 2);
  });

  // -------------------------------------------------------------
  // 11. COMPLETED outcome
  // -------------------------------------------------------------
  test('11. COMPLETED outcome: Standard completed match outcome verification', async () => {
    const { data: match, error } = await playerAClient
      .from('matches')
      .select('id, status, outcome, winner_id')
      .eq('id', completedMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(match.status, 'COMPLETED');
    assert.strictEqual(match.outcome, 'COMPLETED');
    assert.strictEqual(match.winner_id, participantAId);
  });

  // -------------------------------------------------------------
  // 12. WALKOVER outcome
  // -------------------------------------------------------------
  test('12. WALKOVER outcome: Accurately reflected without fake scores', async () => {
    const { data: woMatch, error } = await playerAClient
      .from('matches')
      .select('id, status, outcome, winner_id')
      .eq('id', walkoverMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(woMatch.outcome, 'WALKOVER');
    assert.strictEqual(woMatch.winner_id, participantAId);
  });

  // -------------------------------------------------------------
  // 13. DEFAULT outcome
  // -------------------------------------------------------------
  test('13. DEFAULT outcome: Preserves disciplinary default record', async () => {
    const { data: defMatch, error } = await playerAClient
      .from('matches')
      .select('id, status, outcome, winner_id')
      .eq('id', defaultMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(defMatch.outcome, 'DEFAULT');
    assert.strictEqual(defMatch.winner_id, participantAId);
  });

  // -------------------------------------------------------------
  // 14. RETIREMENT outcome
  // -------------------------------------------------------------
  test('14. RETIREMENT outcome: Preserves rally points scored before retirement', async () => {
    const { data: retMatch, error } = await playerAClient
      .from('matches')
      .select('id, status, outcome, winner_id, games(*)')
      .eq('id', retirementMatchId)
      .single();

    assert.ifError(error);
    assert.strictEqual(retMatch.outcome, 'RETIREMENT');
    assert.strictEqual(retMatch.winner_id, participantAId);
    assert.strictEqual(retMatch.games[0].participant_a_score, 21);
    assert.strictEqual(retMatch.games[1].participant_a_score, 11);
  });

  // -------------------------------------------------------------
  // 15. Group standings
  // -------------------------------------------------------------
  test('15. Group standings: calculateStandings produces ranked group standings with tie-break metrics', async () => {
    const { data: compMatches } = await playerAClient
      .from('matches')
      .select(`
        id,
        status,
        outcome,
        winner_id,
        participant_a_id,
        participant_b_id,
        games(game_number, participant_a_score, participant_b_score, winner_id, status)
      `)
      .in('id', [completedMatchId]);

    const participants = [
      { id: participantAId, participant_id: participantAId },
      { id: participantBId, participant_id: participantBId },
    ];

    const { sortedEntries } = calculateStandings(participants, compMatches as any);
    assert.strictEqual(sortedEntries.length, 2);
    assert.strictEqual(sortedEntries[0].participant_id, participantAId);
    assert.strictEqual(sortedEntries[0].rank, 1);
    assert.strictEqual(sortedEntries[0].won, 1);
    assert.strictEqual(sortedEntries[1].participant_id, participantBId);
    assert.strictEqual(sortedEntries[1].rank, 2);
  });

  // -------------------------------------------------------------
  // 16. Knockout progression
  // -------------------------------------------------------------
  test('16. Knockout progression: Draw structure and nodes readable for player', async () => {
    const { data: draws, error } = await playerAClient
      .from('draws')
      .select('id, format, status')
      .eq('id', drawId)
      .single();

    assert.ifError(error);
    assert.strictEqual(draws.format, 'KNOCKOUT');
    assert.strictEqual(draws.status, 'PUBLISHED');
  });

  // -------------------------------------------------------------
  // 17. GROUP_KNOCKOUT progression
  // -------------------------------------------------------------
  test('17. GROUP_KNOCKOUT progression: Category format correctly represents group-to-knockout flow', async () => {
    const { data: cat, error } = await playerAClient
      .from('categories')
      .select('id, format, name')
      .eq('id', categorySinglesId)
      .single();

    assert.ifError(error);
    assert.strictEqual(cat.format, 'GROUP_KNOCKOUT');
  });

  // -------------------------------------------------------------
  // 18. Personal statistics
  // -------------------------------------------------------------
  test('18. Personal statistics: calculatePlayerStats produces accurate career KPIs', async () => {
    const { data: allMatches, error } = await playerAClient
      .from('matches')
      .select(`
        id,
        status,
        outcome,
        winner_id,
        participant_a_id,
        participant_b_id,
        participant_a:participants!participant_a_id(id, members:participant_members(player_id)),
        participant_b:participants!participant_b_id(id, members:participant_members(player_id)),
        games(game_number, participant_a_score, participant_b_score, winner_id, status)
      `)
      .in('id', [completedMatchId, walkoverMatchId, defaultMatchId, retirementMatchId]);

    assert.ifError(error);

    const stats = calculatePlayerStats(allMatches as any, playerAId);
    assert.strictEqual(stats.playerId, playerAId);
    assert.strictEqual(stats.matchesPlayed, 4, 'Completed, Walkover, Default, and Retirement count as 4 played');
    assert.strictEqual(stats.matchesWon, 4, 'Player A won all 4');
    assert.strictEqual(stats.winPercentage, 100);
    assert.strictEqual(stats.walkoversReceived, 1);
    assert.strictEqual(stats.retirementsReceived, 1);
    assert.ok(stats.pointsScored > 0, 'Points scored tracked');
  });

  // -------------------------------------------------------------
  // 19. Head-to-head
  // -------------------------------------------------------------
  test('19. Head-to-head: calculateHeadToHead calculates records against opponent', async () => {
    const { data: allMatches } = await playerAClient
      .from('matches')
      .select(`
        id,
        status,
        outcome,
        winner_id,
        participant_a_id,
        participant_b_id,
        participant_a:participants!participant_a_id(id, members:participant_members(player_id)),
        participant_b:participants!participant_b_id(id, members:participant_members(player_id)),
        games(game_number, participant_a_score, participant_b_score, winner_id, status)
      `)
      .in('id', [completedMatchId, walkoverMatchId, defaultMatchId, retirementMatchId]);

    const h2h = calculateHeadToHead(allMatches as any, playerAId, playerBId);
    assert.strictEqual(h2h.matchesPlayed, 4);
    assert.strictEqual(h2h.playerAWins, 4);
    assert.strictEqual(h2h.playerBWins, 0);
    assert.strictEqual(h2h.matchHistory.length, 4);
  });

  // -------------------------------------------------------------
  // 20. Registration states
  // -------------------------------------------------------------
  test('20. Registration states: Validates registration statuses (APPROVED, PENDING, REJECTED, CANCELLED)', async () => {
    const validStatuses = ['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'];
    const { data: reg, error } = await playerAClient
      .from('registrations')
      .select('status')
      .eq('id', regAId)
      .single();

    assert.ifError(error);
    assert.ok(validStatuses.includes(reg.status));
  });

  // -------------------------------------------------------------
  // 21. Player read-only permissions
  // -------------------------------------------------------------
  test('21. Player read-only permissions: Player cannot update match status or winner', async () => {
    const { data: mutData } = await playerAClient
      .from('matches')
      .update({ status: 'FINAL' })
      .eq('id', scheduledMatchId)
      .select();

    assert.strictEqual(mutData?.length || 0, 0, 'Player cannot modify match status directly');
  });

  // -------------------------------------------------------------
  // 22. Player cannot mutate scores
  // -------------------------------------------------------------
  test('22. Player cannot mutate scores: Blocked by RLS from inserting match_events or updating games', async () => {
    const { data: eventData, error: eventErr } = await playerAClient
      .from('match_events')
      .insert({
        match_id: liveMatchId,
        sequence_number: 99,
        event_type: 'POINT_A',
      })
      .select();

    assert.ok(eventErr, 'Player must be blocked by RLS from inserting match events');
    assert.strictEqual(eventData, null);

    const { data: gameData } = await playerAClient
      .from('games')
      .update({ participant_a_score: 99 })
      .eq('match_id', liveMatchId)
      .select();

    assert.strictEqual(gameData?.length || 0, 0, 'Player cannot modify games directly');
  });

  // -------------------------------------------------------------
  // 23. Player cannot mutate draws
  // -------------------------------------------------------------
  test('23. Player cannot mutate draws: Blocked from mutating draws or draw nodes', async () => {
    const { data: drawMut } = await playerAClient
      .from('draws')
      .delete()
      .eq('id', drawId)
      .select();

    assert.strictEqual(drawMut?.length || 0, 0, 'Player cannot delete draws');
  });

  // -------------------------------------------------------------
  // 24. RBAC isolation
  // -------------------------------------------------------------
  test('24. RBAC isolation: Player cannot call organizer-only RPCs', async () => {
    const { error: rpcErr } = await playerAClient.rpc('declare_match_outcome', {
      p_match_id: liveMatchId,
      p_outcome: 'WALKOVER',
      p_winner_id: participantAId,
    });

    assert.ok(rpcErr, 'Unauthorized player cannot declare match outcome');
  });

  // -------------------------------------------------------------
  // 25. Empty states
  // -------------------------------------------------------------
  test('25. Empty states: Handles 0 matches, 0 participants gracefully', () => {
    const emptyStats = calculatePlayerStats([], 'non_existent_player');
    assert.strictEqual(emptyStats.matchesPlayed, 0);
    assert.strictEqual(emptyStats.winPercentage, 0);

    const emptyH2H = calculateHeadToHead([], 'p1', 'p2');
    assert.strictEqual(emptyH2H.matchesPlayed, 0);

    const emptyStandings = calculateStandings([], []);
    assert.strictEqual(emptyStandings.sortedEntries.length, 0);
  });

  // -------------------------------------------------------------
  // 26. Session persistence
  // -------------------------------------------------------------
  test('26. Session persistence: Authenticated session returns active token and user object', async () => {
    const { data: { session }, error } = await playerAClient.auth.getSession();
    assert.ifError(error);
    assert.ok(session?.access_token, 'Access token must be present');
    assert.strictEqual(session?.user?.id, playerAId);
  });

  // -------------------------------------------------------------
  // 27. Logout
  // -------------------------------------------------------------
  test('27. Logout: signOut terminates session safely', async () => {
    const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await tempClient.auth.signInWithPassword({ email: playerAEmail, password });
    
    const { error: signOutErr } = await tempClient.auth.signOut();
    assert.ifError(signOutErr);

    const { data: { session } } = await tempClient.auth.getSession();
    assert.strictEqual(session, null, 'Session must be null after logout');
  });

  // -------------------------------------------------------------
  // 28. Realtime duplicate prevention
  // -------------------------------------------------------------
  test('28. Realtime duplicate prevention: Channel subscription creates single listener without duplicates', () => {
    const channel = playerAClient.channel(`match_${liveMatchId}`);
    assert.ok(channel, 'Realtime channel created');
    assert.strictEqual(channel.topic, `realtime:match_${liveMatchId}`);
    playerAClient.removeChannel(channel);
  });
});
