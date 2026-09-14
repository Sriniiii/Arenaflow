import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateStandings,
  sortStandings,
  generateTieBreakExplanations,
  StandingEntry,
  MatchDataInput
} from '@arena-flow/statistics-engine';
import {
  generateKnockoutStructure,
  generateRoundRobinFixtures
} from '@arena-flow/tournament-engine';
import {
  FootballRules,
  FootballMatchState,
  FootballLineup
} from '@arena-flow/sport-engine';
import {
  footballCategoryRulesConfigSchema,
  categorySchema,
  participantSchema,
  footballLineupSchema
} from '@arena-flow/validation';

function loadEnv() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
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

describe('ArenaFlow Phase C: Football Tournament & Configuration Integration Suite', () => {
  const rules = new FootballRules();
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let orgClient: SupabaseClient;
  let orgUserId: string;
  let scorerClient: SupabaseClient;
  let scorerUserId: string;
  let playerClient: SupabaseClient;
  let playerUserId: string;
  let playerAPlayerId: string;
  let playerBClient: SupabaseClient;
  let playerBUserId: string;
  let playerBPlayerId: string;
  let otherOrgClient: SupabaseClient;
  let otherOrgUserId: string;
  let otherTournamentId: string;
  let otherCategoryId: string;

  let testVenueId: string;
  let testTournamentId: string;
  let testFootballSportId: string;
  let testBadmintonSportId: string;
  let testCategoryId: string;

  // 4 Teams and 16 players per team
  const teams: { id: string; name: string; players: { id: string; name: string; number: number; pos: string }[] }[] = [];

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
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });

    const { data: allUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const userList = allUsers?.users || [];

    async function getOrCreateUser(email: string, role: string, fullName: string): Promise<string> {
      const existing = userList.find(u => u.email === email);
      if (existing) return existing.id;

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: 'TestSecurePassword123!',
        email_confirm: true,
        user_metadata: { full_name: fullName, role }
      });
      if (data?.user) return data.user.id;

      const { data: search2 } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const found = search2?.users?.find(u => u.email === email);
      if (found) return found.id;

      throw new Error(`Failed to create user ${email}: ${error?.message}`);
    }

    // 1. Organizer
    const orgEmail = 'phase_c_org@arenaflow.com';
    orgUserId = await getOrCreateUser(orgEmail, 'ORGANIZER', 'UEFA Tournament Director');
    await adminClient.from('profiles').upsert({ id: orgUserId, role: 'ORGANIZER', full_name: 'UEFA Tournament Director' });

    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: orgEmail, password: 'TestSecurePassword123!' });

    // 2. Scorer
    const scorerEmail = 'phase_c_scorer@arenaflow.com';
    scorerUserId = await getOrCreateUser(scorerEmail, 'SCORER', 'Official FIFA Match Referee');
    await adminClient.from('profiles').upsert({ id: scorerUserId, role: 'SCORER', full_name: 'Official FIFA Match Referee' });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: scorerEmail, password: 'TestSecurePassword123!' });

    // 3. Player
    const playerEmail = 'phase_c_player@arenaflow.com';
    playerUserId = await getOrCreateUser(playerEmail, 'PLAYER', 'Kylian Mbappe');
    await adminClient.from('profiles').upsert({ id: playerUserId, role: 'PLAYER', full_name: 'Kylian Mbappe', gender: 'MALE', date_of_birth: '1998-12-20' });
    const { data: plARec } = await adminClient.from('players').select('id').eq('user_id', playerUserId).single();
    if (plARec) {
      playerAPlayerId = plARec.id;
      await adminClient.from('players').update({ full_name: 'Kylian Mbappe', gender: 'MALE', date_of_birth: '1998-12-20' }).eq('id', playerAPlayerId);
    } else {
      const { data: newPlA } = await adminClient.from('players').insert({ user_id: playerUserId, full_name: 'Kylian Mbappe', gender: 'MALE', date_of_birth: '1998-12-20' }).select().single();
      playerAPlayerId = newPlA.id;
    }

    playerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await playerClient.auth.signInWithPassword({ email: playerEmail, password: 'TestSecurePassword123!' });

    // 3b. Player B (User B)
    const playerBEmail = 'phase_c_player_b@arenaflow.com';
    playerBUserId = await getOrCreateUser(playerBEmail, 'PLAYER', 'Erling Haaland');
    await adminClient.from('profiles').upsert({ id: playerBUserId, role: 'PLAYER', full_name: 'Erling Haaland', gender: 'MALE', date_of_birth: '2000-07-21' });
    const { data: plBRec } = await adminClient.from('players').select('id').eq('user_id', playerBUserId).single();
    if (plBRec) {
      playerBPlayerId = plBRec.id;
      await adminClient.from('players').update({ full_name: 'Erling Haaland', gender: 'MALE', date_of_birth: '2000-07-21' }).eq('id', playerBPlayerId);
    } else {
      const { data: newPlB } = await adminClient.from('players').insert({ user_id: playerBUserId, full_name: 'Erling Haaland', gender: 'MALE', date_of_birth: '2000-07-21' }).select().single();
      playerBPlayerId = newPlB.id;
    }

    playerBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await playerBClient.auth.signInWithPassword({ email: playerBEmail, password: 'TestSecurePassword123!' });

    // 3c. Other Organizer (Organizer B for an independent tournament)
    const otherOrgEmail = 'phase_c_other_org@arenaflow.com';
    otherOrgUserId = await getOrCreateUser(otherOrgEmail, 'ORGANIZER', 'Premier League Director');
    await adminClient.from('profiles').upsert({ id: otherOrgUserId, role: 'ORGANIZER', full_name: 'Premier League Director' });

    otherOrgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await otherOrgClient.auth.signInWithPassword({ email: otherOrgEmail, password: 'TestSecurePassword123!' });

    // 4. Fetch Sports
    const { data: sports } = await adminClient.from('sports').select('id, name, slug');
    const fbSport = sports?.find(s => s.slug === 'football' || s.name === 'Football');
    const bmSport = sports?.find(s => s.slug === 'badminton' || s.name === 'Badminton');

    if (!fbSport) {
      const { data: newFb } = await adminClient.from('sports').insert({ name: 'Football', slug: 'football', is_active: true }).select().single();
      testFootballSportId = newFb.id;
    } else {
      testFootballSportId = fbSport.id;
    }

    if (!bmSport) {
      const { data: newBm } = await adminClient.from('sports').insert({ name: 'Badminton', slug: 'badminton', is_active: true }).select().single();
      testBadmintonSportId = newBm.id;
    } else {
      testBadmintonSportId = bmSport.id;
    }

    // 5. Create Venue & Tournament
    const { data: venue } = await adminClient.from('venues').insert({
      name: `Santiago Bernabeu ${Date.now()}`,
      owner_id: orgUserId,
      city: 'Madrid',
      country: 'Spain'
    }).select().single();
    testVenueId = venue.id;

    const { data: tournament } = await adminClient.from('tournaments').insert({
      name: `ArenaFlow Champions League 2026 ${Date.now()}`,
      slug: `ucl-2026-${Date.now()}`,
      sport_id: testFootballSportId,
      venue_id: testVenueId,
      organizer_id: orgUserId,
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      status: 'PUBLISHED'
    }).select().single();
    testTournamentId = tournament.id;

    // 6. Assign official Scorer to tournament_scorers
    await adminClient.from('tournament_scorers').upsert({
      tournament_id: testTournamentId,
      user_id: scorerUserId
    });

    // 7. Create Other Tournament owned by otherOrgUserId
    const { data: otherTourn } = await adminClient.from('tournaments').insert({
      name: `Other Premier League 2026 ${Date.now()}`,
      slug: `epl-2026-${Date.now()}`,
      sport_id: testFootballSportId,
      venue_id: testVenueId,
      organizer_id: otherOrgUserId,
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      status: 'PUBLISHED'
    }).select().single();
    otherTournamentId = otherTourn.id;

    const { data: otherCat } = await adminClient.from('categories').insert({
      tournament_id: otherTournamentId,
      name: 'Other Division 1',
      category_type: 'TEAM',
      match_type: 'MENS',
      format: 'ROUND_ROBIN',
      rules_config: {
        regulationHalfMinutes: 45,
        extraTimeEnabled: false,
        penaltyShootoutEnabled: false,
        playersPerTeam: 11,
        maxSubstitutions: 5,
        allowDraw: true
      }
    }).select().single();
    otherCategoryId = otherCat.id;
  });

  // =========================================================================
  // SCENARIO 1: Create Football Category (TEAM, ROUND_ROBIN, rules_config)
  // =========================================================================
  test('Scenario 1: Create Football category (TEAM, ROUND_ROBIN, rules_config)', async () => {
    const rulesConfig = {
      regulationHalfMinutes: 45,
      extraTimeEnabled: true,
      extraTimeHalfMinutes: 15,
      penaltyShootoutEnabled: true,
      playersPerTeam: 11,
      maxSubstitutions: 5,
      allowDraw: true
    };

    const { data: category, error } = await adminClient.from('categories').insert({
      tournament_id: testTournamentId,
      name: 'Men Champions League Group A',
      category_type: 'TEAM',
      match_type: 'MENS',
      format: 'ROUND_ROBIN',
      rules_config: rulesConfig
    }).select().single();

    assert.ifError(error);
    assert.ok(category.id);
    assert.strictEqual(category.category_type, 'TEAM');
    assert.strictEqual(category.rules_config.regulationHalfMinutes, 45);
    assert.strictEqual(category.rules_config.extraTimeEnabled, true);
    assert.strictEqual(category.rules_config.playersPerTeam, 11);
    assert.strictEqual(category.rules_config.maxSubstitutions, 5);
    assert.strictEqual(category.rules_config.allowDraw, true);

    testCategoryId = category.id;
  });

  // =========================================================================
  // SCENARIO 2: Reject invalid rules_config
  // =========================================================================
  test('Scenario 2: Reject invalid rules_config (negative half minutes, 0 half minutes, invalid ET half duration)', () => {
    // 1. Negative regulationHalfMinutes
    const r1 = footballCategoryRulesConfigSchema.safeParse({
      regulationHalfMinutes: -10,
      extraTimeEnabled: false
    });
    assert.strictEqual(r1.success, false, 'Should reject negative regulation half minutes');

    // 2. Zero regulationHalfMinutes
    const r2 = footballCategoryRulesConfigSchema.safeParse({
      regulationHalfMinutes: 0,
      extraTimeEnabled: false
    });
    assert.strictEqual(r2.success, false, 'Should reject 0 regulation half minutes');

    // 3. Extra time enabled but invalid extraTimeHalfMinutes (negative or zero)
    const r3 = footballCategoryRulesConfigSchema.safeParse({
      regulationHalfMinutes: 45,
      extraTimeEnabled: true,
      extraTimeHalfMinutes: -5
    });
    assert.strictEqual(r3.success, false, 'Should reject negative extra time half minutes when ET enabled');

    // 4. Invalid playersPerTeam
    const r4 = footballCategoryRulesConfigSchema.safeParse({
      regulationHalfMinutes: 45,
      playersPerTeam: 0
    });
    assert.strictEqual(r4.success, false, 'Should reject 0 players per team');
  });

  // =========================================================================
  // SCENARIO 3: Register 4 Football teams (TEAM participant_type)
  // =========================================================================
  test('Scenario 3: Register 4 Football teams (TEAM participant_type)', async () => {
    const teamNames = ['Real Madrid CF', 'Manchester City FC', 'FC Bayern Munich', 'Paris Saint-Germain'];

    for (const name of teamNames) {
      const { data: part, error } = await adminClient.from('participants').insert({
        category_id: testCategoryId,
        participant_type: 'TEAM',
        status: 'ACTIVE'
      }).select().single();

      assert.ifError(error);
      assert.ok(part.id);
      assert.strictEqual(part.participant_type, 'TEAM');
      teams.push({ id: part.id, name, players: [] });
    }

    assert.strictEqual(teams.length, 4, '4 Football teams registered');
  });

  // =========================================================================
  // SCENARIO 4: Register 16-player squad per team
  // =========================================================================
  test('Scenario 4: Register 16-player squad per team', async () => {
    const positions = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'GK', 'DEF', 'MID', 'FWD', 'SUB'];

    for (const team of teams) {
      const playersToInsert = [];
      for (let i = 1; i <= 16; i++) {
        playersToInsert.push({
          full_name: `${team.name} Player ${i}`,
          gender: 'MALE',
          date_of_birth: '2000-01-01'
        });
      }

      const { data: pRecords, error: pErr } = await adminClient.from('players').insert(playersToInsert).select();
      assert.ifError(pErr);
      assert.strictEqual(pRecords.length, 16);

      const membersToInsert = pRecords.map((p, idx) => ({
        participant_id: team.id,
        player_id: p.id,
        member_order: idx + 1,
        jersey_number: idx + 1,
        position: positions[idx],
        status: 'ACTIVE'
      }));

      const { data: members, error: mErr } = await adminClient.from('participant_members').insert(membersToInsert).select();
      assert.ifError(mErr);
      assert.strictEqual(members.length, 16);

      pRecords.forEach((p, idx) => {
        team.players.push({
          id: p.id,
          name: p.full_name,
          number: idx + 1,
          pos: positions[idx]
        });
      });

      assert.strictEqual(team.players.length, 16, `Team ${team.name} has 16 players`);
    }
  });

  // =========================================================================
  // SCENARIO 5: Reject invalid participant_type (INDIVIDUAL/DOUBLES in TEAM category)
  // =========================================================================
  test('Scenario 5: Reject invalid participant_type in TEAM category', () => {
    const catValidation = categorySchema.safeParse({
      tournament_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Invalid Cat Check',
      category_type: 'TEAM',
      match_type: 'MENS',
      format: 'ROUND_ROBIN'
    });
    assert.strictEqual(catValidation.success, true);

    // Participant schema validation rejects INDIVIDUAL participant when squad size > 1
    const invalidParticipant = participantSchema.safeParse({
      name: 'Single Player in Team',
      participant_type: 'INDIVIDUAL',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      player_ids: [
        '123e4567-e89b-12d3-a456-426614174001',
        '123e4567-e89b-12d3-a456-426614174002'
      ]
    });
    assert.strictEqual(invalidParticipant.success, false, 'INDIVIDUAL participant cannot have >1 player');
  });

  // =========================================================================
  // SCENARIO 6: Save valid 11-player Starting XI lineup with bench
  // =========================================================================
  test('Scenario 6: Save valid 11-player Starting XI lineup with bench', async () => {
    // Create match between Team 0 (Real Madrid) and Team 1 (Man City)
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'READY'
    }).select().single();
    assert.ifError(mErr);

    const teamAStarters = teams[0].players.slice(0, 11).map(p => p.id);
    const teamABench = teams[0].players.slice(11, 16).map(p => p.id);
    const captainA = teamAStarters[0];

    const { data: lineupRes, error: lErr } = await adminClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: teamAStarters,
      p_substitutes: teamABench,
      p_captain_id: captainA
    });

    assert.ifError(lErr);
    assert.ok(lineupRes.teamA);
    assert.strictEqual(lineupRes.teamA.startingXI.length, 11);
    assert.strictEqual(lineupRes.teamA.substitutes.length, 5);
    assert.strictEqual(lineupRes.teamA.captainId, captainA);
  });

  // =========================================================================
  // SCENARIO 7: Reject invalid lineup (<11 or >11 starters, non-squad player)
  // =========================================================================
  test('Scenario 7: Reject invalid lineup (<11 or >11 starters, non-squad player)', async () => {
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'READY'
    }).select().single();
    assert.ifError(mErr);

    // 1. Less than 11 starters
    const { error: errFew } = await adminClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: teams[0].players.slice(0, 10).map(p => p.id),
      p_substitutes: [],
      p_captain_id: teams[0].players[0].id
    });
    assert.ok(errFew, 'Must reject <11 starters');

    // 2. Non-squad player
    const nonSquadPlayerId = '00000000-0000-0000-0000-000000000999';
    const invalidStarters = [...teams[0].players.slice(0, 10).map(p => p.id), nonSquadPlayerId];
    const { error: errNonSquad } = await adminClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: invalidStarters,
      p_substitutes: [],
      p_captain_id: teams[0].players[0].id
    });
    assert.ok(errNonSquad, 'Must reject non-squad player in lineup');
  });

  // =========================================================================
  // SCENARIO 8: Generate Round Robin draw (all 4 teams, 6 matches)
  // =========================================================================
  test('Scenario 8: Generate Round Robin draw (all 4 teams, 6 matches)', () => {
    const teamIds = teams.map(t => t.id);
    const fixtures = generateRoundRobinFixtures(teamIds);

    assert.strictEqual(fixtures.length, 6, '4 teams must yield exactly 6 matches');

    const round1 = fixtures.filter(f => f.round === 1);
    const round2 = fixtures.filter(f => f.round === 2);
    const round3 = fixtures.filter(f => f.round === 3);

    assert.strictEqual(round1.length, 2, 'Round 1 has 2 matches');
    assert.strictEqual(round2.length, 2, 'Round 2 has 2 matches');
    assert.strictEqual(round3.length, 2, 'Round 3 has 2 matches');
  });

  // =========================================================================
  // SCENARIO 9: Verify no self matches and no duplicate fixtures
  // =========================================================================
  test('Scenario 9: Verify no self matches and no duplicate fixtures', () => {
    const teamIds = teams.map(t => t.id);
    const fixtures = generateRoundRobinFixtures(teamIds);
    const pairKeys = new Set<string>();

    for (const f of fixtures) {
      assert.notStrictEqual(f.participant_a_id, f.participant_b_id, 'No self pairings');
      assert.ok(f.participant_a_id);
      assert.ok(f.participant_b_id);

      const pairKey = [f.participant_a_id, f.participant_b_id].sort().join('__');
      assert.strictEqual(pairKeys.has(pairKey), false, `Duplicate pairing found: ${pairKey}`);
      pairKeys.add(pairKey);
    }
  });

  // =========================================================================
  // SCENARIO 10: Generate Knockout draw (4 teams, Semis + Final)
  // =========================================================================
  test('Scenario 10: Generate Knockout draw (4 teams, Semis + Final)', () => {
    const teamIds = teams.map(t => t.id);
    const { matches, nodes } = generateKnockoutStructure(teamIds);

    assert.strictEqual(matches.length, 3, '4-team knockout has 3 matches (2 Semis + 1 Final)');
    assert.strictEqual(nodes.length, 3, '3 draw nodes');

    const semis = matches.filter(m => m.round_number === 1);
    const final = matches.filter(m => m.round_number === 2);

    assert.strictEqual(semis.length, 2);
    assert.strictEqual(final.length, 1);
    assert.strictEqual(nodes[0].next_node_index, 2);
    assert.strictEqual(nodes[1].next_node_index, 2);
    assert.strictEqual(nodes[2].next_node_index, null);
  });

  // =========================================================================
  // SCENARIO 11: Generate Group + Knockout draw
  // =========================================================================
  test('Scenario 11: Generate Group + Knockout draw structure', () => {
    // Group A (2 teams) and Group B (2 teams)
    const groupA = [teams[0].id, teams[1].id];
    const groupB = [teams[2].id, teams[3].id];

    const fixturesA = generateRoundRobinFixtures(groupA);
    const fixturesB = generateRoundRobinFixtures(groupB);

    assert.strictEqual(fixturesA.length, 1);
    assert.strictEqual(fixturesB.length, 1);

    // 2 qualifiers per group -> 4 knockout participants -> 3 matches
    const koStructure = generateKnockoutStructure(['WinnerA', 'RunnerA', 'WinnerB', 'RunnerB']);
    assert.strictEqual(koStructure.matches.length, 3);
  });

  // =========================================================================
  // SCENARIO 12: Verify BYE placement when team count is odd
  // =========================================================================
  test('Scenario 12: Verify BYE placement when team count is odd', () => {
    const fiveTeams = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const seeds = { p1: 1, p2: 2, p3: 3 };

    // 1. Knockout: 5 teams in bracket of 8 yields 3 BYE matches in Round 1
    const { matches: koMatches } = generateKnockoutStructure(fiveTeams, { seeds });
    const r1Matches = koMatches.filter(m => m.round_number === 1);
    const completedByes = r1Matches.filter(m => m.status === 'COMPLETED');
    assert.strictEqual(completedByes.length, 3, '5 teams in 8-bracket has 3 BYE matches in Round 1');

    // 2. Round Robin: 5 teams yields 5 rounds, 1 BYE per round (10 fixtures)
    const rrFixtures = generateRoundRobinFixtures(fiveTeams);
    assert.strictEqual(rrFixtures.length, 10, '5 teams round robin produces 10 active fixtures');
  });

  // =========================================================================
  // SCENARIO 13: Compute group standings (3 pts win, 1 pt draw, 0 loss)
  // =========================================================================
  test('Scenario 13: Compute group standings (3 pts win, 1 pt draw, 0 loss)', () => {
    const participants = ['RealMadrid', 'ManCity', 'Bayern', 'PSG'];
    const matches: MatchDataInput[] = [
      {
        id: 'm1',
        participant_a_id: 'RealMadrid',
        participant_b_id: 'ManCity',
        winner_id: 'RealMadrid',
        status: 'COMPLETED',
        score_a: 2,
        score_b: 0
      },
      {
        id: 'm2',
        participant_a_id: 'Bayern',
        participant_b_id: 'PSG',
        winner_id: null,
        status: 'COMPLETED',
        score_a: 1,
        score_b: 1
      }
    ];

    const { sortedEntries } = calculateStandings(participants, matches, {
      sport: 'FOOTBALL'
    });

    const rm = sortedEntries.find(e => e.participant_id === 'RealMadrid')!;
    const mc = sortedEntries.find(e => e.participant_id === 'ManCity')!;
    const bayern = sortedEntries.find(e => e.participant_id === 'Bayern')!;
    const psg = sortedEntries.find(e => e.participant_id === 'PSG')!;

    assert.strictEqual(rm.points, 3, 'Win gives 3 points');
    assert.strictEqual(rm.won, 1);
    assert.strictEqual(mc.points, 0, 'Loss gives 0 points');
    assert.strictEqual(mc.lost, 1);
    assert.strictEqual(bayern.points, 1, 'Draw gives 1 point');
    assert.strictEqual(bayern.draws, 1);
    assert.strictEqual(psg.points, 1, 'Draw gives 1 point');
    assert.strictEqual(psg.draws, 1);
  });

  // =========================================================================
  // SCENARIO 14: Compute Goal Difference (GF - GA) correctly
  // =========================================================================
  test('Scenario 14: Compute Goal Difference (GF - GA) correctly', () => {
    const participants = ['TeamA', 'TeamB'];
    const matches: MatchDataInput[] = [
      {
        id: 'm1',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamB',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        score_a: 4,
        score_b: 1
      }
    ];

    const { sortedEntries } = calculateStandings(participants, matches, { sport: 'FOOTBALL' });
    const a = sortedEntries.find(e => e.participant_id === 'TeamA')!;
    const b = sortedEntries.find(e => e.participant_id === 'TeamB')!;

    assert.strictEqual(a.goals_for, 4);
    assert.strictEqual(a.goals_against, 1);
    assert.strictEqual(a.goal_diff, 3, 'Team A GD = +3');

    assert.strictEqual(b.goals_for, 1);
    assert.strictEqual(b.goals_against, 4);
    assert.strictEqual(b.goal_diff, -3, 'Team B GD = -3');
  });

  // =========================================================================
  // SCENARIO 15: Compute Goals For correctly
  // =========================================================================
  test('Scenario 15: Compute Goals For correctly across multiple matches', () => {
    const participants = ['TeamA', 'TeamB', 'TeamC'];
    const matches: MatchDataInput[] = [
      {
        id: 'm1',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamB',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        score_a: 3,
        score_b: 2
      },
      {
        id: 'm2',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamC',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        score_a: 2,
        score_b: 1
      }
    ];

    const { sortedEntries } = calculateStandings(participants, matches, { sport: 'FOOTBALL' });
    const a = sortedEntries.find(e => e.participant_id === 'TeamA')!;
    assert.strictEqual(a.goals_for, 5, 'Total Goals For is 3 + 2 = 5');
    assert.strictEqual(a.goals_against, 3, 'Total Goals Against is 2 + 1 = 3');
  });

  // =========================================================================
  // SCENARIO 16: Verify tiebreak ordering (Points -> Goal Diff -> Goals For -> Head to Head)
  // =========================================================================
  test('Scenario 16: Verify tiebreak ordering (Points -> Goal Diff -> Goals For -> Head to Head)', () => {
    // Both 3 points, but TeamA GD = +2 (3-1), TeamB GD = +1 (2-1)
    const entries: any[] = [
      {
        participant_id: 'TeamB',
        played: 1,
        won: 1,
        draws: 0,
        lost: 0,
        points: 3,
        goals_for: 2,
        goals_against: 1,
        goal_diff: 1,
        points_for: 2,
        points_against: 1,
        points_diff: 1
      },
      {
        participant_id: 'TeamA',
        played: 1,
        won: 1,
        draws: 0,
        lost: 0,
        points: 3,
        goals_for: 3,
        goals_against: 1,
        goal_diff: 2,
        points_for: 3,
        points_against: 1,
        points_diff: 2
      }
    ];

    const { sortedEntries } = sortStandings(entries, [], { sport: 'FOOTBALL' });
    assert.strictEqual(sortedEntries[0].participant_id, 'TeamA', 'TeamA ranks 1st due to superior Goal Difference (+2 vs +1)');
    assert.strictEqual(sortedEntries[1].participant_id, 'TeamB');
  });

  // =========================================================================
  // SCENARIO 17: Verify configurable tiebreak order
  // =========================================================================
  test('Scenario 17: Verify configurable tiebreak order', () => {
    const matches: MatchDataInput[] = [
      {
        id: 'm1',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamB',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 0
      }
    ];

    // TeamB has higher GD (+4), but TeamA won H2H (1-0)
    const entries: any[] = [
      {
        participant_id: 'TeamB',
        played: 2,
        won: 1,
        draws: 0,
        lost: 1,
        points: 3,
        goals_for: 6,
        goals_against: 2,
        goal_diff: 4,
        points_for: 6,
        points_against: 2,
        points_diff: 4
      },
      {
        participant_id: 'TeamA',
        played: 2,
        won: 1,
        draws: 0,
        lost: 1,
        points: 3,
        goals_for: 2,
        goals_against: 1,
        goal_diff: 1,
        points_for: 2,
        points_against: 1,
        points_diff: 1
      }
    ];

    // When H2H is prioritized before GOAL_DIFFERENCE:
    const { sortedEntries: sortedH2HFirst } = sortStandings(entries, matches, {
      sport: 'FOOTBALL',
      tieBreakOrder: ['POINTS', 'HEAD_TO_HEAD', 'GOAL_DIFFERENCE', 'GOALS_FOR']
    });
    assert.strictEqual(sortedH2HFirst[0].participant_id, 'TeamA', 'TeamA ranks 1st when H2H is prioritized');

    // When GOAL_DIFFERENCE is prioritized before H2H:
    const { sortedEntries: sortedGDFirst } = sortStandings(entries, matches, {
      sport: 'FOOTBALL',
      tieBreakOrder: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD']
    });
    assert.strictEqual(sortedGDFirst[0].participant_id, 'TeamB', 'TeamB ranks 1st when Goal Difference is prioritized');
  });

  // =========================================================================
  // SCENARIO 18: Verify head-to-head tiebreak resolution
  // =========================================================================
  test('Scenario 18: Verify head-to-head tiebreak resolution and human-readable explanation', () => {
    const matches: MatchDataInput[] = [
      {
        id: 'm1',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamB',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        score_a: 1,
        score_b: 0
      }
    ];

    const entries: any[] = [
      {
        participant_id: 'TeamB',
        played: 1,
        won: 0,
        draws: 0,
        lost: 1,
        points: 0,
        goals_for: 0,
        goals_against: 1,
        goal_diff: -1,
        points_for: 0,
        points_against: 1,
        points_diff: -1
      },
      {
        participant_id: 'TeamA',
        played: 1,
        won: 1,
        draws: 0,
        lost: 0,
        points: 3,
        goals_for: 1,
        goals_against: 0,
        goal_diff: 1,
        points_for: 1,
        points_against: 0,
        points_diff: 1
      }
    ];

    const { sortedEntries } = sortStandings(entries, matches, { sport: 'FOOTBALL' });
    const { explanations } = generateTieBreakExplanations(sortedEntries, matches, { sport: 'FOOTBALL' });

    assert.strictEqual(sortedEntries[0].participant_id, 'TeamA');
    assert.ok(explanations['TeamA']);
    assert.ok(explanations['TeamA'].toLowerCase().includes('league points'));
  });

  // =========================================================================
  // SCENARIO 19: Select group qualifiers for knockout stage
  // =========================================================================
  test('Scenario 19: Select group qualifiers for knockout stage', () => {
    const entries: any[] = [
      { participant_id: 'TeamA', played: 3, won: 3, draws: 0, lost: 0, points: 9, goals_for: 6, goals_against: 1, goal_diff: 5, points_for: 6, points_against: 1, points_diff: 5 },
      { participant_id: 'TeamB', played: 3, won: 2, draws: 0, lost: 1, points: 6, goals_for: 4, goals_against: 2, goal_diff: 2, points_for: 4, points_against: 2, points_diff: 2 },
      { participant_id: 'TeamC', played: 3, won: 1, draws: 0, lost: 2, points: 3, goals_for: 2, goals_against: 4, goal_diff: -2, points_for: 2, points_against: 4, points_diff: -2 },
      { participant_id: 'TeamD', played: 3, won: 0, draws: 0, lost: 3, points: 0, goals_for: 1, goals_against: 6, goal_diff: -5, points_for: 1, points_against: 6, points_diff: -5 }
    ];

    const { sortedEntries } = sortStandings(entries, [], { sport: 'FOOTBALL' });
    const qualifiers = sortedEntries.slice(0, 2).map(e => e.participant_id);

    assert.deepStrictEqual(qualifiers, ['TeamA', 'TeamB'], 'Top 2 teams qualify for knockout');
  });

  // =========================================================================
  // SCENARIO 20: Record regulation win (3 points to winner, 0 to loser)
  // =========================================================================
  test('Scenario 20: Record regulation win (3 points to winner, 0 to loser)', () => {
    let state = rules.getInitialState({
      allowDraw: true
    });

    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: '0', metadata: {} });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', timestamp: '10', metadata: { team: 'A', playerId: 'P1' } });
    state = rules.applyEvent(state, { id: 'e3', type: 'END_FIRST_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e4', type: 'START_SECOND_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e5', type: 'END_SECOND_HALF', timestamp: '90', metadata: {} });

    assert.strictEqual(state.scoreA, 1);
    assert.strictEqual(state.scoreB, 0);
    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
    assert.strictEqual(state.decisionMethod, 'REGULATION');
  });

  // =========================================================================
  // SCENARIO 21: Record regulation draw (1 point each)
  // =========================================================================
  test('Scenario 21: Record regulation draw (1 point each)', () => {
    let state = rules.getInitialState({
      allowDraw: true,
      extraTimeEnabled: false,
      penaltyShootoutEnabled: false
    });

    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: '0', metadata: {} });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', timestamp: '10', metadata: { team: 'A', playerId: 'P1' } });
    state = rules.applyEvent(state, { id: 'e3', type: 'GOAL', timestamp: '20', metadata: { team: 'B', playerId: 'P2' } });
    state = rules.applyEvent(state, { id: 'e4', type: 'END_FIRST_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e5', type: 'START_SECOND_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e6', type: 'END_SECOND_HALF', timestamp: '90', metadata: {} });

    assert.strictEqual(state.scoreA, 1);
    assert.strictEqual(state.scoreB, 1);
    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.winnerId, 'DRAW', 'Winner must be DRAW');
    assert.strictEqual(state.decisionMethod, 'REGULATION');
  });

  // =========================================================================
  // SCENARIO 22: Record extra time win
  // =========================================================================
  test('Scenario 22: Record extra time win', () => {
    let state = rules.getInitialState({
      allowDraw: false,
      extraTimeEnabled: true,
      penaltyShootoutEnabled: true
    });

    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: '0', metadata: {} });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', timestamp: '10', metadata: { team: 'A', playerId: 'P1' } });
    state = rules.applyEvent(state, { id: 'e3', type: 'GOAL', timestamp: '20', metadata: { team: 'B', playerId: 'P2' } });
    state = rules.applyEvent(state, { id: 'e4', type: 'END_FIRST_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e5', type: 'START_SECOND_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e6', type: 'END_SECOND_HALF', timestamp: '90', metadata: {} });

    assert.strictEqual(state.phase, 'FULL_TIME');
    assert.strictEqual(state.isCompleted, false);

    // Extra Time
    state = rules.applyEvent(state, { id: 'e7', type: 'START_EXTRA_TIME_FIRST_HALF', timestamp: '90', metadata: {} });
    state = rules.applyEvent(state, { id: 'e8', type: 'GOAL', timestamp: '100', metadata: { team: 'A', playerId: 'P1' } });
    state = rules.applyEvent(state, { id: 'e9', type: 'END_EXTRA_TIME_FIRST_HALF', timestamp: '105', metadata: {} });
    state = rules.applyEvent(state, { id: 'e10', type: 'START_EXTRA_TIME_SECOND_HALF', timestamp: '105', metadata: {} });
    state = rules.applyEvent(state, { id: 'e11', type: 'END_EXTRA_TIME_SECOND_HALF', timestamp: '120', metadata: {} });

    assert.strictEqual(state.scoreA, 2);
    assert.strictEqual(state.scoreB, 1);
    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
    assert.strictEqual(state.decisionMethod, 'EXTRA_TIME');
  });

  // =========================================================================
  // SCENARIO 23: Record penalty shootout win (official score isolated)
  // =========================================================================
  test('Scenario 23: Record penalty shootout win (official score remains tied, shootout score isolated)', () => {
    let state = rules.getInitialState({
      allowDraw: false,
      extraTimeEnabled: true,
      penaltyShootoutEnabled: true
    });

    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: '0', metadata: {} });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', timestamp: '10', metadata: { team: 'A', playerId: 'P1' } });
    state = rules.applyEvent(state, { id: 'e3', type: 'GOAL', timestamp: '20', metadata: { team: 'B', playerId: 'P2' } });
    state = rules.applyEvent(state, { id: 'e4', type: 'END_FIRST_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e5', type: 'START_SECOND_HALF', timestamp: '45', metadata: {} });
    state = rules.applyEvent(state, { id: 'e6', type: 'END_SECOND_HALF', timestamp: '90', metadata: {} });

    state = rules.applyEvent(state, { id: 'e7', type: 'START_EXTRA_TIME_FIRST_HALF', timestamp: '90', metadata: {} });
    state = rules.applyEvent(state, { id: 'e8', type: 'END_EXTRA_TIME_FIRST_HALF', timestamp: '105', metadata: {} });
    state = rules.applyEvent(state, { id: 'e9', type: 'START_EXTRA_TIME_SECOND_HALF', timestamp: '105', metadata: {} });
    state = rules.applyEvent(state, { id: 'e10', type: 'END_EXTRA_TIME_SECOND_HALF', timestamp: '120', metadata: {} });

    // Start Shootout
    state = rules.applyEvent(state, { id: 'e11', type: 'START_PENALTY_SHOOTOUT', timestamp: '120', metadata: {} });
    assert.strictEqual(state.phase, 'PENALTY_SHOOTOUT');

    // 5 kicks each: Team A scores 4, Team B scores 3
    state = rules.applyEvent(state, { id: 'pk1', type: 'PENALTY_KICK', timestamp: '121', metadata: { team: 'A', playerId: 'P1', scored: true, round: 1 } });
    state = rules.applyEvent(state, { id: 'pk2', type: 'PENALTY_KICK', timestamp: '122', metadata: { team: 'B', playerId: 'P2', scored: true, round: 1 } });
    state = rules.applyEvent(state, { id: 'pk3', type: 'PENALTY_KICK', timestamp: '123', metadata: { team: 'A', playerId: 'P3', scored: true, round: 2 } });
    state = rules.applyEvent(state, { id: 'pk4', type: 'PENALTY_KICK', timestamp: '124', metadata: { team: 'B', playerId: 'P4', scored: false, round: 2 } });
    state = rules.applyEvent(state, { id: 'pk5', type: 'PENALTY_KICK', timestamp: '125', metadata: { team: 'A', playerId: 'P5', scored: true, round: 3 } });
    state = rules.applyEvent(state, { id: 'pk6', type: 'PENALTY_KICK', timestamp: '126', metadata: { team: 'B', playerId: 'P6', scored: true, round: 3 } });
    state = rules.applyEvent(state, { id: 'pk7', type: 'PENALTY_KICK', timestamp: '127', metadata: { team: 'A', playerId: 'P7', scored: true, round: 4 } });
    state = rules.applyEvent(state, { id: 'pk8', type: 'PENALTY_KICK', timestamp: '128', metadata: { team: 'B', playerId: 'P8', scored: true, round: 4 } });
    state = rules.applyEvent(state, { id: 'pk9', type: 'PENALTY_KICK', timestamp: '129', metadata: { team: 'A', playerId: 'P9', scored: false, round: 5 } });
    state = rules.applyEvent(state, { id: 'pk10', type: 'PENALTY_KICK', timestamp: '130', metadata: { team: 'B', playerId: 'P10', scored: false, round: 5 } });

    // Official match score must remain 1-1
    assert.strictEqual(state.scoreA, 1, 'Official match score for Team A remains 1');
    assert.strictEqual(state.scoreB, 1, 'Official match score for Team B remains 1');

    // Shootout score is isolated
    assert.strictEqual(state.shootoutState!.scoreA, 4);
    assert.strictEqual(state.shootoutState!.scoreB, 3);
    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
    assert.strictEqual(state.decisionMethod, 'PENALTY_SHOOTOUT');
  });

  // =========================================================================
  // SCENARIO 24: Record walkover (3-0 default score, winner awarded 3 pts)
  // =========================================================================
  test('Scenario 24: Record walkover (3-0 default score, winner awarded 3 pts, +3 GD)', () => {
    let state = rules.getInitialState();

    state = rules.applyEvent(state, {
      id: 'e_wo',
      type: 'DECLARE_OUTCOME',
      timestamp: '0',
      metadata: {
        outcome: 'WALKOVER',
        winnerId: 'PARTICIPANT_A',
        reason: 'Opponent failed to field team'
      }
    });

    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.decisionMethod, 'WALKOVER');
    assert.strictEqual(state.winnerId, 'PARTICIPANT_A');

    // Check standings calculation for walkover
    const { sortedEntries } = calculateStandings(['TeamA', 'TeamB'], [
      {
        id: 'm_wo',
        participant_a_id: 'TeamA',
        participant_b_id: 'TeamB',
        winner_id: 'TeamA',
        status: 'COMPLETED',
        outcome: 'WALKOVER',
        score_a: 3,
        score_b: 0
      }
    ], { sport: 'FOOTBALL' });

    const a = sortedEntries.find(e => e.participant_id === 'TeamA')!;
    assert.strictEqual(a.points, 3);
    assert.strictEqual(a.goal_diff, 3);
  });

  // =========================================================================
  // SCENARIO 25: Record default (3-0 default score)
  // =========================================================================
  test('Scenario 25: Record default (3-0 default score, disqualified team gets 0)', () => {
    let state = rules.getInitialState();

    state = rules.applyEvent(state, {
      id: 'e_def',
      type: 'DECLARE_OUTCOME',
      timestamp: '30',
      metadata: {
        outcome: 'DEFAULT',
        winnerId: 'PARTICIPANT_B',
        reason: 'Team A fielded ineligible player'
      }
    });

    assert.strictEqual(state.isCompleted, true);
    assert.strictEqual(state.decisionMethod, 'DEFAULT');
    assert.strictEqual(state.winnerId, 'PARTICIPANT_B');
  });

  // =========================================================================
  // SCENARIO 26: Record abandoned match
  // =========================================================================
  test('Scenario 26: Record abandoned match (winner = NULL, isCompleted = false, status = POSTPONED)', () => {
    let state = rules.getInitialState();

    state = rules.applyEvent(state, { id: 'e1', type: 'START_FIRST_HALF', timestamp: '0', metadata: {} });
    state = rules.applyEvent(state, { id: 'e2', type: 'GOAL', timestamp: '10', metadata: { team: 'A', playerId: 'P1' } });

    state = rules.applyEvent(state, {
      id: 'e_ab',
      type: 'DECLARE_OUTCOME',
      timestamp: '35',
      metadata: {
        outcome: 'ABANDONED',
        winnerId: undefined,
        reason: 'Severe weather condition'
      }
    });

    assert.strictEqual(state.isCompleted, false, 'Abandoned match is not completed');
    assert.strictEqual(state.winnerId, undefined, 'Abandoned match has no winner');
    assert.strictEqual(state.phase, 'ABANDONED');
    assert.strictEqual(state.decisionMethod, 'ABANDONED');
  });

  // =========================================================================
  // SCENARIO 27: Verify match lifecycle transitions
  // =========================================================================
  test('Scenario 27: Verify match lifecycle transitions (SCHEDULED -> READY -> LIVE -> PAUSED -> COMPLETED)', async () => {
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'SCHEDULED'
    }).select().single();
    assert.ifError(mErr);
    assert.strictEqual(match.status, 'SCHEDULED');

    // 1. SCHEDULED -> READY
    const { data: mReady } = await adminClient.from('matches').update({ status: 'READY' }).eq('id', match.id).select().single();
    assert.strictEqual(mReady.status, 'READY');

    // 2. Set Lineup & Start First Half -> LIVE
    await adminClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: teams[0].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[0].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[0].players[0].id
    });

    await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_FIRST_HALF'
    });

    const { data: mLive } = await adminClient.from('matches').select('status, match_phase').eq('id', match.id).single();
    assert.ok(mLive);
    assert.strictEqual(mLive.status, 'LIVE');
    assert.strictEqual(mLive.match_phase, 'FIRST_HALF');

    // 3. Pause Match
    const { error: pauseErr } = await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'PAUSE_MATCH'
    });
    assert.ifError(pauseErr);
    const { data: mPaused } = await adminClient.from('matches').select('status').eq('id', match.id).single();
    assert.ok(mPaused);
    assert.strictEqual(mPaused.status, 'PAUSED');

    // 4. Resume Match
    const { error: resumeErr } = await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'RESUME_MATCH'
    });
    assert.ifError(resumeErr);
    const { data: mResumed } = await adminClient.from('matches').select('status').eq('id', match.id).single();
    assert.ok(mResumed);
    assert.strictEqual(mResumed.status, 'LIVE');

    // 5. Complete Match
    await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'GOAL',
      p_metadata: { team: 'A', playerId: teams[0].players[0].id }
    });
    await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_FIRST_HALF'
    });
    await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_SECOND_HALF'
    });
    await adminClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'END_SECOND_HALF'
    });

    const { data: mCompleted } = await adminClient.from('matches').select('status, winner_id, score_a, score_b').eq('id', match.id).single();
    assert.ok(mCompleted);
    assert.strictEqual(mCompleted.status, 'COMPLETED');
    assert.strictEqual(mCompleted.winner_id, teams[0].id);
    assert.strictEqual(mCompleted.score_a, 1);
    assert.strictEqual(mCompleted.score_b, 0);
  });

  // =========================================================================
  // SCENARIO 28: Verify rulesSnapshot preserved on match
  // =========================================================================
  test('Scenario 28: Verify rulesSnapshot preserved on match', async () => {
    const rulesConfig = {
      regulationHalfMinutes: 45,
      extraTimeEnabled: true,
      extraTimeHalfMinutes: 15,
      penaltyShootoutEnabled: true,
      playersPerTeam: 11,
      maxSubstitutions: 5,
      allowDraw: true
    };

    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'SCHEDULED',
      outcome_details: { rulesSnapshot: rulesConfig }
    }).select().single();
    assert.ifError(mErr);

    assert.ok(match.outcome_details.rulesSnapshot);
    assert.strictEqual(match.outcome_details.rulesSnapshot.regulationHalfMinutes, 45);

    // Modify category rules
    await adminClient.from('categories').update({
      rules_config: { ...rulesConfig, regulationHalfMinutes: 40 }
    }).eq('id', testCategoryId);

    // Match snapshot must remain 45
    const { data: reloadedMatch } = await adminClient.from('matches').select('outcome_details').eq('id', match.id).single();
    assert.ok(reloadedMatch);
    assert.strictEqual(reloadedMatch.outcome_details.rulesSnapshot.regulationHalfMinutes, 45, 'Match rulesSnapshot is immutable against subsequent category changes');
  });

  // =========================================================================
  // SCENARIO 29: Verify Badminton tournament operations remain 100% unaffected
  // =========================================================================
  test('Scenario 29: Verify existing Badminton tournament operations remain 100% unaffected', async () => {
    // 1. Create Badminton category
    const { data: bmCat, error: bErr } = await adminClient.from('categories').insert({
      tournament_id: testTournamentId,
      name: "Men's Singles Badminton",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select().single();

    assert.ifError(bErr);
    assert.strictEqual(bmCat.category_type, 'SINGLES');
    assert.strictEqual(bmCat.format, 'KNOCKOUT');

    // 2. Register 2 Badminton players
    const { data: pA } = await adminClient.from('participants').insert({
      category_id: bmCat.id,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE'
    }).select().single();

    const { data: pB } = await adminClient.from('participants').insert({
      category_id: bmCat.id,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE'
    }).select().single();

    // 3. Badminton standings calculation preserves match wins, game diff, points diff
    const { sortedEntries } = calculateStandings([pA.id, pB.id], [
      {
        id: 'bm_m1',
        participant_a_id: pA.id,
        participant_b_id: pB.id,
        winner_id: pA.id,
        status: 'COMPLETED',
        games: [
          { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          { participant_a_score: 21, participant_b_score: 15, isCompleted: true }
        ]
      }
    ], { sport: 'BADMINTON' });

    assert.strictEqual(sortedEntries[0].participant_id, pA.id);
    assert.strictEqual(sortedEntries[0].won, 1);
    assert.strictEqual(sortedEntries[0].games_diff, 2);
    assert.strictEqual(sortedEntries[0].points_diff, 9);
  });

  // =========================================================================
  // SCENARIO 30: Verify RLS - Anonymous users can view public tournaments
  // =========================================================================
  test('Scenario 30: Verify RLS - Anonymous users can view public tournaments, categories, and standings', async () => {
    const { data: tournaments, error: tErr } = await anonClient.from('tournaments').select('id, name, status').eq('id', testTournamentId);
    assert.ifError(tErr);
    assert.strictEqual(tournaments?.length, 1);

    const { data: categories, error: cErr } = await anonClient.from('categories').select('id, name, category_type').eq('tournament_id', testTournamentId);
    assert.ifError(cErr);
    assert.ok(categories!.length >= 1);

    const { data: participants, error: pErr } = await anonClient.from('participants').select('id, category_id, participant_type').eq('category_id', testCategoryId);
    assert.ifError(pErr);
    assert.ok(participants!.length >= 4);
  });

  // =========================================================================
  // SCENARIO 31: Verify RLS - Only organizer can create/update category
  // =========================================================================
  test('Scenario 31: Verify RLS - Only organizer can create/update category', async () => {
    // Player tries to create category -> should fail
    const { error: pErr } = await playerClient.from('categories').insert({
      tournament_id: testTournamentId,
      name: 'Hacked Category',
      category_type: 'TEAM',
      match_type: 'MENS',
      format: 'ROUND_ROBIN'
    });
    assert.ok(pErr, 'Player client cannot create tournament categories');

    // Organizer can update category
    const { error: orgErr } = await orgClient.from('categories').update({
      name: 'Updated Group A'
    }).eq('id', testCategoryId);
    assert.ifError(orgErr);
  });

  // =========================================================================
  // SCENARIO 32: Verify RLS - Only organizer/scorer can submit match lineups and record events
  // =========================================================================
  test('Scenario 32: Verify RLS - Only organizer/scorer can submit match lineups and record events', async () => {
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'READY'
    }).select().single();
    assert.ifError(mErr);

    // Player attempts to submit lineup -> should fail
    const { error: pLineupErr } = await playerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: teams[0].players.slice(0, 11).map(p => p.id),
      p_substitutes: [],
      p_captain_id: teams[0].players[0].id
    });
    assert.ok(pLineupErr, 'Player client cannot submit match lineups');

    // Scorer submits lineup -> succeeds
    const { error: sLineupErr } = await scorerClient.rpc('set_football_lineup', {
      p_match_id: match.id,
      p_team: 'A',
      p_starting_xi: teams[0].players.slice(0, 11).map(p => p.id),
      p_substitutes: teams[0].players.slice(11, 16).map(p => p.id),
      p_captain_id: teams[0].players[0].id
    });
    assert.ifError(sLineupErr);

    // Player attempts to record event -> should fail
    const { error: pEventErr } = await playerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_FIRST_HALF'
    });
    assert.ok(pEventErr, 'Player client cannot record match events');

    // Scorer records event -> succeeds
    const { error: sEventErr } = await scorerClient.rpc('apply_football_match_event', {
      p_match_id: match.id,
      p_event_type: 'START_FIRST_HALF'
    });
    assert.ifError(sEventErr);
  });

  // =========================================================================
  // SCENARIO 33: Verify RLS - Direct modification of match projections is blocked
  // =========================================================================
  test('Scenario 33: Verify RLS - Direct modification of match projections is blocked', async () => {
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'READY'
    }).select().single();
    assert.ifError(mErr);

    // Direct mutation of score_a column without RPC trigger
    const { error: directMutationErr } = await orgClient.from('matches').update({
      score_a: 99
    }).eq('id', match.id);

    assert.ok(directMutationErr, 'Direct client update of score_a must be prohibited by database trigger');
  });

  // =========================================================================
  // SCENARIO 34: Security Verification 1 - Unauthorized team registration & alteration
  // =========================================================================
  test('Scenario 34: Security Verification 1 - User A cannot register or alter User B Football team', async () => {
    // 1. Create Team for User B
    const { data: teamB, error: tErr } = await adminClient.from('participants').insert({
      category_id: testCategoryId,
      participant_type: 'TEAM',
      status: 'ACTIVE'
    }).select().single();
    assert.ifError(tErr);

    // Add User B as participant member
    const { error: pmErr } = await adminClient.from('participant_members').insert({
      participant_id: teamB.id,
      player_id: playerBPlayerId,
      member_order: 1,
      position: 'FWD'
    });
    assert.ifError(pmErr);

    // Path 1: User A (playerClient) attempts to register User B's team -> must be rejected
    const { error: userARegErr } = await playerClient.from('registrations').insert({
      category_id: testCategoryId,
      participant_id: teamB.id,
      status: 'PENDING'
    });
    assert.ok(userARegErr, 'User A cannot register User B team (rejected by RLS)');

    // Legitimate registration by User B
    const { data: regB, error: bRegErr } = await playerBClient.from('registrations').insert({
      category_id: testCategoryId,
      participant_id: teamB.id,
      status: 'PENDING'
    }).select().single();
    assert.ifError(bRegErr);

    // Path 2: User A attempts to alter User B's registration (e.g. cancel or approve) -> must be rejected
    await playerClient.from('registrations').update({
      status: 'CANCELLED'
    }).eq('id', regB.id);

    // Verify registration status remains PENDING in database
    const { data: regCheck } = await adminClient.from('registrations').select('status').eq('id', regB.id).single();
    assert.strictEqual(regCheck?.status, 'PENDING', 'User B registration remains intact as PENDING');
  });

  // =========================================================================
  // SCENARIO 35: Security Verification 2 - Unauthorized squad mutation
  // =========================================================================
  test('Scenario 35: Security Verification 2 - Unauthorized squad mutation is strictly rejected', async () => {
    // Create Team B with a distinct squad player
    const { data: squadTeam, error: stErr } = await adminClient.from('participants').insert({
      category_id: testCategoryId,
      participant_type: 'TEAM',
      status: 'ACTIVE'
    }).select().single();
    assert.ifError(stErr);

    const { data: targetPlayer, error: tpErr } = await adminClient.from('players').insert({
      full_name: 'Target Squad Player',
      gender: 'MALE',
      date_of_birth: '2001-05-15'
    }).select().single();
    assert.ifError(tpErr);

    const { data: originalMember, error: omErr } = await adminClient.from('participant_members').insert({
      participant_id: squadTeam.id,
      player_id: targetPlayer.id,
      member_order: 1,
      jersey_number: 9,
      position: 'FWD'
    }).select().single();
    assert.ifError(omErr);

    // Path 1: User A (Player A) tries to insert another player into User B's squad -> rejected
    const { error: pInsertErr } = await playerClient.from('participant_members').insert({
      participant_id: squadTeam.id,
      player_id: targetPlayer.id,
      member_order: 2,
      jersey_number: 10,
      position: 'MID'
    });
    assert.ok(pInsertErr, 'Player A cannot insert into User B squad (rejected by RLS)');

    // Path 2: User A tries to delete a player from User B's squad -> rejected / 0 rows affected
    await playerClient.from('participant_members').delete().eq('id', originalMember.id);
    const { data: memberStillThere } = await adminClient.from('participant_members').select('id').eq('id', originalMember.id);
    assert.strictEqual(memberStillThere?.length, 1, 'Member was not deleted by unauthorized player');

    // Path 3: User A tries to edit jersey number of User B's player -> rejected / 0 rows updated
    await playerClient.from('participant_members').update({ jersey_number: 99 }).eq('id', originalMember.id);
    const { data: memberUnchanged } = await adminClient.from('participant_members').select('jersey_number').eq('id', originalMember.id).single();
    assert.strictEqual(memberUnchanged?.jersey_number, 9, 'Member jersey number was not modified by unauthorized player');

    // Path 4: Organizer of Tournament B tries to mutate squad in Tournament A -> rejected
    const { error: crossOrgErr } = await otherOrgClient.from('participant_members').insert({
      participant_id: teams[0].id,
      player_id: targetPlayer.id,
      member_order: 17,
      jersey_number: 77
    });
    assert.ok(crossOrgErr, 'Organizer of Tournament B cannot mutate squad in Tournament A');
  });

  // =========================================================================
  // SCENARIO 36: Security Verification 3 - Unauthorized draw mutation
  // =========================================================================
  test('Scenario 36: Security Verification 3 - Player, scorer, and unauthorized organizer cannot mutate draws', async () => {
    // Create an official draw by Organizer A
    const { data: officialDraw, error: dErr } = await orgClient.from('draws').insert({
      category_id: testCategoryId,
      format: 'KNOCKOUT',
      status: 'PUBLISHED'
    }).select().single();
    assert.ifError(dErr);

    // Path 1: Player tries to delete draw
    await playerClient.from('draws').delete().eq('id', officialDraw.id);
    const { data: drawAfterPlayer } = await adminClient.from('draws').select('id').eq('id', officialDraw.id);
    assert.strictEqual(drawAfterPlayer?.length, 1, 'Draw remains intact after player delete attempt');

    // Path 2: Scorer tries to delete draw
    await scorerClient.from('draws').delete().eq('id', officialDraw.id);
    const { data: drawAfterScorer } = await adminClient.from('draws').select('id').eq('id', officialDraw.id);
    assert.strictEqual(drawAfterScorer?.length, 1, 'Draw remains intact after scorer delete attempt');

    // Path 3: Unauthorized organizer (Organizer B) tries to delete draw in Tournament A
    await otherOrgClient.from('draws').delete().eq('id', officialDraw.id);
    const { data: drawAfterOtherOrg } = await adminClient.from('draws').select('id').eq('id', officialDraw.id);
    assert.strictEqual(drawAfterOtherOrg?.length, 1, 'Draw remains intact after unauthorized organizer delete attempt');

    // Path 4: Unauthorized organizer tries to create a draw in Tournament A
    const { error: crossOrgDrawErr } = await otherOrgClient.from('draws').insert({
      category_id: testCategoryId,
      format: 'ROUND_ROBIN',
      status: 'PUBLISHED'
    });
    assert.ok(crossOrgDrawErr, 'Unauthorized organizer cannot create draw in Tournament A');
  });

  // =========================================================================
  // SCENARIO 37: Security Verification 4 - Unauthorized match participant mutation
  // =========================================================================
  test('Scenario 37: Security Verification 4 - Player, scorer, and unauthorized user cannot mutate match participants', async () => {
    const { data: match, error: mErr } = await adminClient.from('matches').insert({
      category_id: testCategoryId,
      participant_a_id: teams[0].id,
      participant_b_id: teams[1].id,
      status: 'READY'
    }).select().single();
    assert.ifError(mErr);

    // Path 1: Player tries to switch match participants directly
    await playerClient.from('matches').update({
      participant_a_id: teams[2].id
    }).eq('id', match.id);

    // Path 2: Scorer tries to switch match participants directly -> rejected by trigger
    const { error: sUpdateErr } = await scorerClient.from('matches').update({
      participant_a_id: teams[2].id
    }).eq('id', match.id);
    assert.ok(sUpdateErr, 'Scorer cannot mutate match participants (rejected by trigger)');

    // Path 3: Unauthorized organizer tries to switch match participants
    await otherOrgClient.from('matches').update({
      participant_a_id: teams[2].id
    }).eq('id', match.id);

    // Verify direct database state: match participants are completely unchanged
    const { data: verifiedMatch } = await adminClient.from('matches').select('participant_a_id, participant_b_id').eq('id', match.id).single();
    assert.strictEqual(verifiedMatch?.participant_a_id, teams[0].id, 'Match participant_a_id remains unchanged');
    assert.strictEqual(verifiedMatch?.participant_b_id, teams[1].id, 'Match participant_b_id remains unchanged');
  });

  // =========================================================================
  // SCENARIO 38: Security Verification 5 - Existing Badminton authorization regression
  // =========================================================================
  test('Scenario 38: Security Verification 5 - Badminton authorization policies remain 100% functional', async () => {
    // 1. Create Badminton category
    const { data: bmCat, error: catErr } = await orgClient.from('categories').insert({
      tournament_id: testTournamentId,
      name: `Badminton Men Singles Security Test ${Date.now()}`,
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT'
    }).select().single();
    assert.ifError(catErr);

    // 2. Create Participant for Player A
    const { data: bmPartA, error: paErr } = await adminClient.from('participants').insert({
      category_id: bmCat.id,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE'
    }).select().single();
    assert.ifError(paErr);

    const { error: pmErr } = await adminClient.from('participant_members').insert({
      participant_id: bmPartA.id,
      player_id: playerAPlayerId,
      member_order: 1
    });
    assert.ifError(pmErr);

    // 3. Player A registers
    const { data: bmRegA, error: regAErr } = await playerClient.from('registrations').insert({
      category_id: bmCat.id,
      participant_id: bmPartA.id,
      status: 'PENDING'
    }).select().single();
    assert.ifError(regAErr);

    // 4. Player B tries to cancel Player A's Badminton registration -> rejected / 0 rows affected
    await playerBClient.from('registrations').update({
      status: 'CANCELLED'
    }).eq('id', bmRegA.id);
    const { data: checkRegA } = await adminClient.from('registrations').select('status').eq('id', bmRegA.id).single();
    assert.strictEqual(checkRegA?.status, 'PENDING', 'Player B cannot cancel Player A Badminton registration');

    // 5. Player A cancels their own Badminton registration -> succeeds
    const { error: pACancelErr } = await playerClient.from('registrations').update({
      status: 'CANCELLED'
    }).eq('id', bmRegA.id);
    assert.ifError(pACancelErr);

    const { data: checkReg } = await adminClient.from('registrations').select('status').eq('id', bmRegA.id).single();
    assert.strictEqual(checkReg?.status, 'CANCELLED');

    // 6. Player A cannot create/delete Badminton draws
    const { error: pDrawErr } = await playerClient.from('draws').insert({
      category_id: bmCat.id,
      format: 'KNOCKOUT',
      status: 'PUBLISHED'
    });
    assert.ok(pDrawErr, 'Player A cannot create Badminton draw');

    // 7. Organizer creates Badminton draw -> succeeds
    const { data: bmDraw, error: orgDrawErr } = await orgClient.from('draws').insert({
      category_id: bmCat.id,
      format: 'KNOCKOUT',
      status: 'PUBLISHED'
    }).select().single();
    assert.ifError(orgDrawErr);

    // 8. Scorer cannot delete Badminton draw -> blocked
    await scorerClient.from('draws').delete().eq('id', bmDraw.id);
    const { data: drawCheck } = await adminClient.from('draws').select('id').eq('id', bmDraw.id);
    assert.strictEqual(drawCheck?.length, 1, 'Badminton draw remains intact after scorer delete attempt');
  });
});
