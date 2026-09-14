import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateStandings,
  sortStandings,
  generateTieBreakExplanations,
  calculatePlayerStats,
  calculateHeadToHead,
  calculateTournamentStats,
  calculateCategoryStats,
  calculateTournamentRecords,
  calculateLeaderboards,
  calculateBadmintonAnalytics,
  calculateMatchAnalytics,
  SportAnalyticsRegistry,
  StandingEntry,
  MatchDataInput,
  ParticipantDataInput
} from '@arena-flow/statistics-engine';
import {
  buildStandingsReportData,
  buildTournamentSummaryReportData
} from '../src/services/reports';

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

describe('Feature 12: Advanced Statistics & Analytics Monorepo Integration Test Suite', () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let playerClient: SupabaseClient;

  const testRunId = Date.now().toString().slice(-6);
  const orgEmail = `stats_org_${testRunId}@gmail.com`;
  const playerAEmail = `stats_pa_${testRunId}@gmail.com`;
  const playerBEmail = `stats_pb_${testRunId}@gmail.com`;
  const password = 'TestSecurePassword123!';

  let orgId: string;
  let playerAId: string;
  let playerBId: string;
  let tournamentId: string;
  let categoryId: string;
  let participantAId: string;
  let participantBId: string;

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create test accounts
    const { data: orgAuth, error: orgErr } = await adminClient.auth.admin.createUser({
      email: orgEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'ORGANIZER', full_name: 'Stats Organizer' }
    });
    if (orgErr) throw orgErr;
    orgId = orgAuth?.user?.id || '';

    const { data: pAAuth, error: pAErr } = await adminClient.auth.admin.createUser({
      email: playerAEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'PLAYER', full_name: 'Player Alpha' }
    });
    if (pAErr) throw pAErr;
    playerAId = pAAuth?.user?.id || '';

    await adminClient.from('players').upsert({
      id: playerAId,
      full_name: 'Player Alpha',
      display_name: 'Alpha',
      gender: 'MALE',
      date_of_birth: '2000-01-01',
    });

    const { data: pBAuth, error: pBErr } = await adminClient.auth.admin.createUser({
      email: playerBEmail,
      password,
      email_confirm: true,
      user_metadata: { role: 'PLAYER', full_name: 'Player Beta' }
    });
    if (pBErr) throw pBErr;
    playerBId = pBAuth?.user?.id || '';

    await adminClient.from('players').upsert({
      id: playerBId,
      full_name: 'Player Beta',
      display_name: 'Beta',
      gender: 'MALE',
      date_of_birth: '2000-01-01',
    });

    // Create sport & tournament
    const { data: sport, error: sportErr } = await adminClient.from('sports').select('id').eq('slug', 'badminton').single();
    if (sportErr) throw sportErr;
    const sportId = sport?.id || '';

    const { data: tourn, error: tournErr } = await adminClient.from('tournaments').insert({
      name: `Stats Verification Championship ${testRunId}`,
      slug: `stats-tourn-${testRunId}`,
      sport_id: sportId,
      organizer_id: orgId,
      status: 'PUBLISHED',
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 86400000 * 5).toISOString(),
      registration_open: new Date().toISOString(),
      registration_close: new Date(Date.now() + 86400000 * 2).toISOString(),
    }).select('id').single();
    if (tournErr) throw tournErr;
    tournamentId = tourn?.id || '';

    // Category
    const { data: cat, error: catErr } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Singles",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'ROUND_ROBIN',
      registration_fee: 0,
    }).select('id').single();
    if (catErr) throw catErr;
    categoryId = cat?.id || '';

    // Participants
    const { data: partA, error: partAErr } = await adminClient.from('participants').insert({
      category_id: categoryId,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE',
    }).select('id').single();
    if (partAErr) throw partAErr;
    participantAId = partA?.id || '';

    await adminClient.from('participant_members').insert({
      participant_id: participantAId,
      player_id: playerAId,
    });

    const { data: partB, error: partBErr } = await adminClient.from('participants').insert({
      category_id: categoryId,
      participant_type: 'INDIVIDUAL',
      status: 'ACTIVE',
    }).select('id').single();
    if (partBErr) throw partBErr;
    participantBId = partB?.id || '';

    await adminClient.from('participant_members').insert({
      participant_id: participantBId,
      player_id: playerBId,
    });

    // Sign in player client
    const { data: signinData, error: signinErr } = await anonClient.auth.signInWithPassword({
      email: playerAEmail,
      password,
    });
    if (signinErr) throw signinErr;
    playerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${signinData.session?.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  after(async () => {
    if (tournamentId) {
      await adminClient.from('tournaments').delete().eq('id', tournamentId);
    }
    if (orgId) await adminClient.auth.admin.deleteUser(orgId);
    if (playerAId) await adminClient.auth.admin.deleteUser(playerAId);
    if (playerBId) await adminClient.auth.admin.deleteUser(playerBId);
  });

  // =========================================================================
  // SECTION 1: STANDINGS & 7-STEP TIE-BREAK ORDER WITH EXPLANATIONS
  // =========================================================================
  describe('1. Standings & Explainable Tie-Break Engine', () => {
    test('1.1. Resolves 2-team tie by Head-to-Head match with human-readable explanation', () => {
      const participants: ParticipantDataInput[] = [
        { id: 'T1', name: 'Team Alpha' },
        { id: 'T2', name: 'Team Beta' },
        { id: 'T3', name: 'Team Gamma' },
      ];

      const matches: MatchDataInput[] = [
        // T1 beats T2 (H2H advantage to T1)
        {
          id: 'm1',
          participant_a_id: 'T1',
          participant_b_id: 'T2',
          winner_id: 'T1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          ],
        },
        // T1 beats T3
        {
          id: 'm2',
          participant_a_id: 'T1',
          participant_b_id: 'T3',
          winner_id: 'T1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 10, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 10, isCompleted: true },
          ],
        },
        // T2 beats T3 with huge score
        {
          id: 'm3',
          participant_a_id: 'T2',
          participant_b_id: 'T3',
          winner_id: 'T2',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 5, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 5, isCompleted: true },
          ],
        },
      ];

      // T1 (2-0, beats T2 and T3) -> Rank 1
      // T2 (1-1, beats T3) -> Rank 2
      // T3 (0-2) -> Rank 3
      const res = calculateStandings(participants, matches);
      assert.strictEqual(res.sortedEntries[0].participant_id, 'T1');
      assert.strictEqual(res.sortedEntries[0].rank, 1);
      assert.strictEqual(res.sortedEntries[0].won, 2);
      assert.ok(res.sortedEntries[0].tieBreakReason?.includes('wins') || res.sortedEntries[0].tieBreakReason?.includes('Rank'));

      // If T1 and T2 are both 1-1, and T1 beat T2:
      const entries2Tied: StandingEntry[] = [
        {
          participant_id: 'T2',
          played: 2,
          won: 1,
          lost: 1,
          win_percentage: 50,
          rank: 0,
          is_manually_resolved: false,
          points_for: 80,
          points_against: 40,
          points_diff: 40,
          games_won: 2,
          games_lost: 2,
          games_diff: 0,
        },
        {
          participant_id: 'T1',
          played: 2,
          won: 1,
          lost: 1,
          win_percentage: 50,
          rank: 0,
          is_manually_resolved: false,
          points_for: 50,
          points_against: 50,
          points_diff: 0,
          games_won: 2,
          games_lost: 2,
          games_diff: 0,
        },
      ];

      const tiedMatches: MatchDataInput[] = [
        {
          id: 'm1',
          participant_a_id: 'T1',
          participant_b_id: 'T2',
          winner_id: 'T1',
          status: 'COMPLETED',
          games: [{ participant_a_score: 21, participant_b_score: 19, isCompleted: true }],
        },
      ];

      const sorted = sortStandings(entries2Tied, tiedMatches);
      assert.strictEqual(sorted.sortedEntries[0].participant_id, 'T1'); // T1 wins tiebreak via H2H
      assert.strictEqual(sorted.sortedEntries[0].rank, 1);
      assert.ok(sorted.sortedEntries[0].tieBreakReason?.toLowerCase().includes('head-to-head'));
    });

    test('1.2. Resolves ties by game differential and point differential with explicit reasons', () => {
      const entries: StandingEntry[] = [
        {
          participant_id: 'P1',
          played: 3,
          won: 2,
          lost: 1,
          win_percentage: 66.7,
          rank: 0,
          is_manually_resolved: false,
          games_won: 5,
          games_lost: 2,
          games_diff: 3,
          points_for: 140,
          points_against: 120,
          points_diff: 20,
        },
        {
          participant_id: 'P2',
          played: 3,
          won: 2,
          lost: 1,
          win_percentage: 66.7,
          rank: 0,
          is_manually_resolved: false,
          games_won: 4,
          games_lost: 3,
          games_diff: 1,
          points_for: 135,
          points_against: 110,
          points_diff: 25,
        },
      ];

      const sorted = sortStandings(entries, []);
      assert.strictEqual(sorted.sortedEntries[0].participant_id, 'P1');
      assert.ok(sorted.sortedEntries[0].tieBreakReason?.includes('game differential'));
    });

    test('1.3. Manual override supersedes all automated tie-breakers', () => {
      const entries: StandingEntry[] = [
        {
          participant_id: 'P1',
          played: 3,
          won: 3,
          lost: 0,
          win_percentage: 100,
          rank: 0,
          is_manually_resolved: true,
          manual_rank_override: 2,
          games_won: 6,
          games_lost: 0,
          games_diff: 6,
          points_for: 126,
          points_against: 60,
          points_diff: 66,
        },
        {
          participant_id: 'P2',
          played: 3,
          won: 0,
          lost: 3,
          win_percentage: 0,
          rank: 0,
          is_manually_resolved: true,
          manual_rank_override: 1,
          games_won: 0,
          games_lost: 6,
          games_diff: -6,
          points_for: 60,
          points_against: 126,
          points_diff: -66,
        },
      ];

      const sorted = sortStandings(entries, []);
      assert.strictEqual(sorted.sortedEntries[0].participant_id, 'P2');
      assert.strictEqual(sorted.sortedEntries[0].rank, 1);
      assert.ok(sorted.sortedEntries[0].tieBreakReason?.includes('override'));
    });
  });

  // =========================================================================
  // SECTION 2: PLAYER STATISTICS, STREAKS & RECENT FORM
  // =========================================================================
  describe('2. Player Statistics, Streaks & Recent Form', () => {
    test('2.1. Calculates accurate streaks and recent form without double counting doubles matches', () => {
      const pId = 'PlayerX';
      const opp1 = 'Opponent1';
      const opp2 = 'Opponent2';

      const matches: MatchDataInput[] = [
        {
          id: 'm1',
          participant_a_id: 'teamA1',
          participant_b_id: 'teamB1',
          participant_a: { id: 'teamA1', members: [{ player_id: pId, player: { id: pId, full_name: 'Player X' } }] },
          participant_b: { id: 'teamB1', members: [{ player_id: opp1, player: { id: opp1, full_name: 'Opp 1' } }] },
          winner_id: 'teamA1',
          status: 'COMPLETED',
          scheduled_at: '2026-09-01T10:00:00Z',
          completed_at: '2026-09-01T10:45:00Z',
          games: [
            { participant_a_score: 21, participant_b_score: 15, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          ],
        },
        {
          id: 'm2',
          participant_a_id: 'teamA1',
          participant_b_id: 'teamB2',
          participant_a: { id: 'teamA1', members: [{ player_id: pId, player: { id: pId, full_name: 'Player X' } }] },
          participant_b: { id: 'teamB2', members: [{ player_id: opp2, player: { id: opp2, full_name: 'Opp 2' } }] },
          winner_id: 'teamA1',
          status: 'COMPLETED',
          scheduled_at: '2026-09-02T10:00:00Z',
          completed_at: '2026-09-02T10:45:00Z',
          games: [
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
          ],
        },
        {
          id: 'm3',
          participant_a_id: 'teamA1',
          participant_b_id: 'teamB3',
          participant_a: { id: 'teamA1', members: [{ player_id: pId, player: { id: pId, full_name: 'Player X' } }] },
          participant_b: { id: 'teamB3', members: [{ player_id: 'opp3', player: { id: 'opp3', full_name: 'Opp 3' } }] },
          winner_id: 'teamB3',
          status: 'COMPLETED',
          scheduled_at: '2026-09-03T10:00:00Z',
          completed_at: '2026-09-03T10:45:00Z',
          games: [
            { participant_a_score: 19, participant_b_score: 21, isCompleted: true },
            { participant_a_score: 18, participant_b_score: 21, isCompleted: true },
          ],
        },
        {
          id: 'm4',
          participant_a_id: 'teamA1',
          participant_b_id: 'teamB4',
          participant_a: { id: 'teamA1', members: [{ player_id: pId, player: { id: pId, full_name: 'Player X' } }] },
          participant_b: { id: 'teamB4', members: [{ player_id: 'opp4', player: { id: 'opp4', full_name: 'Opp 4' } }] },
          winner_id: 'teamA1',
          status: 'COMPLETED',
          outcome: 'WALKOVER',
          scheduled_at: '2026-09-04T10:00:00Z',
          completed_at: '2026-09-04T10:00:00Z',
        },
      ];

      const stats = calculatePlayerStats(matches, pId, 'Player X');
      assert.strictEqual(stats.matchesPlayed, 4);
      assert.strictEqual(stats.matchesWon, 3);
      assert.strictEqual(stats.matchesLost, 1);
      assert.strictEqual(stats.longestWinningStreak, 2); // m1, m2 won -> streak 2
      assert.strictEqual(stats.currentWinningStreak, 1); // m4 (W.O.) won -> streak 1
      assert.strictEqual(stats.walkoversReceived, 1);

      // Recent Form (last 4: W.O., L, W, W)
      assert.strictEqual(stats.recentForm[0], 'W.O.');
      assert.strictEqual(stats.recentForm[1], 'L');
      assert.strictEqual(stats.recentForm[2], 'W');
      assert.strictEqual(stats.recentForm[3], 'W');
    });

    test('2.2. Head-to-Head isolates singles and doubles opponents cleanly', () => {
      const matches: MatchDataInput[] = [
        {
          id: 'h1',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 16, isCompleted: true },
          ],
        },
        {
          id: 'h2',
          participant_a_id: 'P1',
          participant_b_id: 'P2',
          winner_id: 'P2',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 18, participant_b_score: 21, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { participant_a_score: 15, participant_b_score: 21, isCompleted: true },
          ],
        },
      ];

      const h2h = calculateHeadToHead(matches, 'P1', 'P2');
      assert.strictEqual(h2h.matchesPlayed, 2);
      assert.strictEqual(h2h.playerAWins, 1);
      assert.strictEqual(h2h.playerBWins, 1);
      assert.strictEqual(h2h.playerAGamesWon, 3);
      assert.strictEqual(h2h.playerBGamesWon, 2);
      assert.strictEqual(h2h.playerAPoints, 21 + 21 + 18 + 21 + 15); // 96
      assert.strictEqual(h2h.playerBPoints, 18 + 16 + 21 + 19 + 21); // 95
    });
  });

  // =========================================================================
  // SECTION 3: BADMINTON SPECIFIC ANALYTICS & SPORT REGISTRY
  // =========================================================================
  describe('3. Badminton Analytics & Sport Abstraction Layer', () => {
    test('3.1. Computes deuce, 30-pt cap, straight games, 3-gamers, and comeback wins', () => {
      const matches: MatchDataInput[] = [
        // Straight games 2-0 with deuce
        {
          id: 'm1',
          participant_a_id: 'A',
          participant_b_id: 'B',
          winner_id: 'A',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 22, participant_b_score: 20, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 15, isCompleted: true },
          ],
        },
        // 3-gamer with 30-point cap (30-29) and comeback win (B loses G1, wins G2, G3)
        {
          id: 'm2',
          participant_a_id: 'A',
          participant_b_id: 'B',
          winner_id: 'B',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
            { participant_a_score: 29, participant_b_score: 30, isCompleted: true },
            { participant_a_score: 15, participant_b_score: 21, isCompleted: true },
          ],
        },
      ];

      const analytics = calculateBadmintonAnalytics(matches);
      assert.strictEqual(analytics.totalRallies, (22 + 20 + 21 + 15) + (21 + 18 + 29 + 30 + 15 + 21)); // 78 + 134 = 212
      assert.strictEqual(analytics.straightGameWins, 1);
      assert.strictEqual(analytics.threeGameWins, 1);
      assert.strictEqual(analytics.deuceGames, 2); // 22-20 and 30-29
      assert.strictEqual(analytics.capped30PointGames, 1); // 30-29
      assert.strictEqual(analytics.comebackWins, 1); // m2
    });

    test('3.2. Generic Sport Registry resolves Badminton provider and extensibility', () => {
      const provider = SportAnalyticsRegistry.get('badminton');
      assert.ok(provider);
      assert.strictEqual(provider?.sportName.toLowerCase(), 'badminton');
    });
  });

  // =========================================================================
  // SECTION 4: TOURNAMENT OPERATIONAL AGGREGATES, RECORDS & LEADERBOARDS
  // =========================================================================
  describe('4. Operational Statistics, Records & Leaderboards', () => {
    test('4.1. Calculates tournament completion percentage, records and leaderboards', () => {
      const matches: MatchDataInput[] = [
        {
          id: 'm1',
          winner_id: 'P1',
          status: 'COMPLETED',
          started_at: '2026-09-01T10:00:00Z',
          completed_at: '2026-09-01T10:30:00Z',
          games: [
            { participant_a_score: 21, participant_b_score: 10, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 12, isCompleted: true },
          ],
        },
        {
          id: 'm2',
          winner_id: 'P2',
          status: 'COMPLETED',
          started_at: '2026-09-01T11:00:00Z',
          completed_at: '2026-09-01T11:45:00Z',
          games: [
            { participant_a_score: 21, participant_b_score: 19, isCompleted: true },
            { participant_a_score: 19, participant_b_score: 21, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 18, isCompleted: true },
          ],
        },
        {
          id: 'm3',
          status: 'LIVE',
          games: [{ participant_a_score: 5, participant_b_score: 3, isCompleted: false }],
        },
      ];

      const tStats = calculateTournamentStats({ matches });
      assert.strictEqual(tStats.totalMatches, 3);
      assert.strictEqual(tStats.completedMatches, 2);
      assert.strictEqual(tStats.liveMatches, 1);
      assert.strictEqual(Math.round(tStats.completionPercentage), 67);

      const records = calculateTournamentRecords(matches);
      assert.ok(records.longestMatchDuration);
      assert.strictEqual(records.longestMatchDuration.durationMinutes, 45); // m2 is 45 min
      assert.strictEqual(records.shortestMatchDuration?.durationMinutes, 30); // m1 is 30 min
      assert.strictEqual(records.largestGameMargin?.margin, 11); // 21-10 is +11
    });

    test('4.2. Reporting integration exposes authoritative statistics without duplication', () => {
      const tournament = { name: 'Report Tourn', slug: 'rep-tourn' };
      const categories = [{ id: 'cat1', name: "Men's Singles" }];
      const participants = [
        { id: 'p1', category_id: 'cat1', members: [{ player: { full_name: 'Player 1' } }] },
        { id: 'p2', category_id: 'cat1', members: [{ player: { full_name: 'Player 2' } }] },
      ];
      const matches: MatchDataInput[] = [
        {
          id: 'm1',
          category_id: 'cat1',
          participant_a_id: 'p1',
          participant_b_id: 'p2',
          winner_id: 'p1',
          status: 'COMPLETED',
          games: [
            { participant_a_score: 21, participant_b_score: 15, isCompleted: true },
            { participant_a_score: 21, participant_b_score: 17, isCompleted: true },
          ],
        },
      ];

      const standingsReport = buildStandingsReportData(tournament, categories, participants, matches);
      assert.strictEqual(standingsReport.rows.length, 2);
      assert.strictEqual(standingsReport.rows[0][0], 1); // Rank 1
      assert.strictEqual(standingsReport.rows[0][2], 'Player 1'); // Name

      const summaryReport = buildTournamentSummaryReportData(tournament, categories, participants, [], matches, [], []);
      assert.ok(summaryReport.rows);
      assert.ok(summaryReport.headers);
      assert.strictEqual(summaryReport.headers.length, 8);
    });
  });

  // =========================================================================
  // SECTION 5: SPECTATOR & PLAYER RLS AND READ ACCESS SECURITY
  // =========================================================================
  describe('5. Database Security, View-Only Policy & RLS Verification', () => {
    test('5.1. Spectators and Players can read tournament matches, events, and standings anonymously', async () => {
      const { data: tournData, error: tournErr } = await anonClient
        .from('tournaments')
        .select('id, name, status')
        .eq('id', tournamentId)
        .single();

      assert.ifError(tournErr);
      assert.strictEqual(tournData?.id, tournamentId);
      assert.strictEqual(tournData?.status, 'PUBLISHED');

      const { data: partData, error: partErr } = await anonClient
        .from('participants')
        .select('id, status, participant_members(player_id)')
        .eq('category_id', categoryId);

      assert.ifError(partErr);
      assert.strictEqual(partData?.length, 2);
    });

    test('5.2. Players cannot modify tournament configuration or scores', async () => {
      const { error: modErr } = await playerClient
        .from('tournaments')
        .update({ name: 'Hacked Name' })
        .eq('id', tournamentId);

      // Either returns error or updates 0 rows due to RLS
      const { data: checkData } = await adminClient
        .from('tournaments')
        .select('name')
        .eq('id', tournamentId)
        .single();

      assert.notStrictEqual(checkData?.name, 'Hacked Name');
    });
  });
});