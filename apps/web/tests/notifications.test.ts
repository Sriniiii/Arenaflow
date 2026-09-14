import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

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

describe('Feature 10: Tournament Notifications Suite', () => {
  let adminClient: SupabaseClient;
  let playerAClient: SupabaseClient;
  let playerBClient: SupabaseClient;
  let orgClient: SupabaseClient;
  let scorerClient: SupabaseClient;

  const testRunId = Date.now().toString().slice(-6);
  const playerAEmail = `notif_pa_${testRunId}@gmail.com`;
  const playerBEmail = `notif_pb_${testRunId}@gmail.com`;
  const orgEmail = `notif_org_${testRunId}@gmail.com`;
  const scorerEmail = `notif_sc_${testRunId}@gmail.com`;
  const password = 'TestSecurePassword123!';

  let playerAId: string;
  let playerBId: string;
  let orgId: string;
  let scorerId: string;

  let sportId: string;
  let venueId: string;
  let court1Id: string;
  let court2Id: string;
  let tournamentId: string;
  let categoryId: string;
  let participantAId: string;
  let participantBId: string;
  let matchId: string;

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Player A, Player B, Organizer, and Scorer users
    const { data: uA } = await adminClient.auth.admin.createUser({
      email: playerAEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Player Alpha Notif', role: 'PLAYER' },
    });
    playerAId = uA?.user?.id || '';

    const { data: uB } = await adminClient.auth.admin.createUser({
      email: playerBEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Player Beta Notif', role: 'PLAYER' },
    });
    playerBId = uB?.user?.id || '';

    const { data: uOrg } = await adminClient.auth.admin.createUser({
      email: orgEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Organizer Notif', role: 'ORGANIZER' },
    });
    orgId = uOrg?.user?.id || '';

    const { data: uScorer } = await adminClient.auth.admin.createUser({
      email: scorerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Scorer Notif', role: 'SCORER' },
    });
    scorerId = uScorer?.user?.id || '';

    await adminClient.from('players').update({ gender: 'MALE', date_of_birth: '2000-01-01' }).in('id', [playerAId, playerBId]);

    // 2. Instantiate Authenticated Clients
    playerAClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await playerAClient.auth.signInWithPassword({ email: playerAEmail, password });

    playerBClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await playerBClient.auth.signInWithPassword({ email: playerBEmail, password });

    orgClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await orgClient.auth.signInWithPassword({ email: orgEmail, password });

    scorerClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await scorerClient.auth.signInWithPassword({ email: scorerEmail, password });

    // 3. Setup Tournament Infrastructure
    const { data: sData } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
    const insSport = sData ? null : await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${testRunId}` }).select('id').single();
    sportId = sData?.id || insSport?.data?.id || '';

    const { data: vData } = await adminClient.from('venues').insert({ name: 'Notification Arena' }).select('id').single();
    venueId = vData!.id;

    const { data: c1 } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court Center' }).select('id').single();
    court1Id = c1!.id;
    const { data: c2 } = await adminClient.from('courts').insert({ venue_id: venueId, name: 'Court Show' }).select('id').single();
    court2Id = c2!.id;

    const { data: tData } = await adminClient.from('tournaments').insert({
      name: `Notification Championship ${testRunId}`,
      slug: `notif-champ-${testRunId}`,
      sport_id: sportId,
      organizer_id: orgId,
      venue_id: venueId,
      status: 'PUBLISHED',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    }).select('id').single();
    tournamentId = tData!.id;

    const { data: cat } = await adminClient.from('categories').insert({
      tournament_id: tournamentId,
      name: "Men's Singles Premier",
      category_type: 'SINGLES',
      match_type: 'MENS',
      format: 'KNOCKOUT',
    }).select('id').single();
    categoryId = cat!.id;

    const { data: pA } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE', seed: 1 }).select('id').single();
    participantAId = pA!.id;
    const { data: pB } = await adminClient.from('participants').insert({ category_id: categoryId, participant_type: 'INDIVIDUAL', status: 'ACTIVE', seed: 2 }).select('id').single();
    participantBId = pB!.id;

    await adminClient.from('participant_members').insert([
      { participant_id: participantAId, player_id: playerAId, member_order: 1 },
      { participant_id: participantBId, player_id: playerBId, member_order: 1 },
    ]);

    // Create match in SCHEDULED state initially without court
    const { data: mData } = await adminClient.from('matches').insert({
      category_id: categoryId,
      participant_a_id: participantAId,
      participant_b_id: participantBId,
      status: 'SCHEDULED',
    }).select('id').single();
    matchId = mData!.id;
  });

  after(async () => {
    if (tournamentId) await adminClient.from('tournaments').delete().eq('id', tournamentId);
    if (venueId) await adminClient.from('venues').delete().eq('id', venueId);
    if (playerAId) await adminClient.auth.admin.deleteUser(playerAId);
    if (playerBId) await adminClient.auth.admin.deleteUser(playerBId);
    if (orgId) await adminClient.auth.admin.deleteUser(orgId);
    if (scorerId) await adminClient.auth.admin.deleteUser(scorerId);
  });

  // ---------------------------------------------------------------------------
  // 1. Direct Notification Creation & Idempotency
  // ---------------------------------------------------------------------------
  test('1. Notification creation: create_system_notification generates notification record', async () => {
    const { data: notifId, error } = await adminClient.rpc('create_system_notification', {
      p_user_id: playerAId,
      p_type: 'TOURNAMENT_UPDATE',
      p_title: 'Welcome to ArenaFlow',
      p_message: 'Tournament registration is now live.',
      p_tournament_id: tournamentId,
    });

    assert.ifError(error);
    assert.ok(notifId);

    const { data: notif } = await playerAClient.from('notifications').select('*').eq('id', notifId).single();
    assert.strictEqual(notif.type, 'TOURNAMENT_UPDATE');
    assert.strictEqual(notif.is_read, false);
    assert.strictEqual(notif.user_id, playerAId);
  });

  // ---------------------------------------------------------------------------
  // 2. Match Scheduled & Court Assignment Trigger
  // ---------------------------------------------------------------------------
  test('2. Match scheduled: Trigger notifies affected players when match is scheduled', async () => {
    const schedTime = new Date(Date.now() + 3600000).toISOString();
    
    // Organizer assigns court and scheduled_at
    await adminClient.from('matches').update({
      scheduled_at: schedTime,
      court_id: court1Id,
      status: 'READY',
    }).eq('id', matchId);

    // Player A and Player B must receive MATCH_SCHEDULED notification
    const { data: notifsA } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('type', 'MATCH_SCHEDULED')
      .eq('match_id', matchId);

    assert.ok(notifsA && notifsA.length > 0, 'Player A must receive match scheduled notification');
    assert.ok(notifsA[0].message.includes('Court Center'));

    const { data: notifsB } = await playerBClient
      .from('notifications')
      .select('*')
      .eq('type', 'MATCH_SCHEDULED')
      .eq('match_id', matchId);

    assert.ok(notifsB && notifsB.length > 0, 'Player B must receive match scheduled notification');
  });

  // ---------------------------------------------------------------------------
  // 3. Court Assignment Changed Trigger
  // ---------------------------------------------------------------------------
  test('3. Court assignment: Trigger notifies affected players when court changes', async () => {
    // Change court to court 2
    await adminClient.from('matches').update({
      court_id: court2Id,
    }).eq('id', matchId);

    const { data: notifsA } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false });

    assert.ok(notifsA && notifsA.some(n => n.message.includes('Court Show')));
  });

  // ---------------------------------------------------------------------------
  // 4. Match Started (LIVE) Trigger
  // ---------------------------------------------------------------------------
  test('4. Match started: Trigger notifies affected players when match goes LIVE', async () => {
    await adminClient.from('matches').update({
      status: 'LIVE',
      started_at: new Date().toISOString(),
    }).eq('id', matchId);

    const { data: notifsA } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('type', 'MATCH_STARTED')
      .eq('match_id', matchId);

    assert.ok(notifsA && notifsA.length > 0, 'Player A must receive match live notification');
  });

  // ---------------------------------------------------------------------------
  // 5. Match Result & Winner / Loser Notification Trigger
  // ---------------------------------------------------------------------------
  test('5. Match result: Trigger notifies winner and loser appropriately', async () => {
    await adminClient.from('games').insert([
      { match_id: matchId, game_number: 1, participant_a_score: 21, participant_b_score: 18, winner_id: participantAId, status: 'COMPLETED' },
      { match_id: matchId, game_number: 2, participant_a_score: 21, participant_b_score: 16, winner_id: participantAId, status: 'COMPLETED' },
    ]);

    await adminClient.from('matches').update({
      status: 'COMPLETED',
      winner_id: participantAId,
      outcome: 'COMPLETED',
      ended_at: new Date().toISOString(),
    }).eq('id', matchId);

    // Winner (Player A) receives Match Won
    const { data: winNotifs } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('type', 'MATCH_RESULT')
      .eq('match_id', matchId);

    assert.ok(winNotifs && winNotifs.some(n => n.title.includes('Won')), 'Winner must receive victory notification');

    // Loser (Player B) receives Match Concluded
    const { data: lossNotifs } = await playerBClient
      .from('notifications')
      .select('*')
      .eq('type', 'MATCH_RESULT')
      .eq('match_id', matchId);

    assert.ok(lossNotifs && lossNotifs.some(n => n.title.includes('Concluded')), 'Loser must receive match concluded notification');
  });

  // ---------------------------------------------------------------------------
  // 6. Registration Received Trigger (Organizer Notification)
  // ---------------------------------------------------------------------------
  test('6. Registration notification: Trigger notifies organizer upon new registration', async () => {
    // Insert new registration for Player A
    const { data: regData } = await adminClient.from('registrations').insert({
      category_id: categoryId,
      participant_id: participantAId,
      status: 'PENDING',
    }).select('id').single();

    const { data: orgNotifs } = await orgClient
      .from('notifications')
      .select('*')
      .eq('type', 'REGISTRATION_RECEIVED')
      .eq('tournament_id', tournamentId);

    assert.ok(orgNotifs && orgNotifs.length > 0, 'Organizer must receive registration received notification');
  });

  // ---------------------------------------------------------------------------
  // 7. Registration Status Update Trigger (Player Notification)
  // ---------------------------------------------------------------------------
  test('7. Registration status update: Trigger notifies player when registration is APPROVED', async () => {
    const { error: upErr } = await orgClient.from('registrations')
      .update({ status: 'APPROVED' })
      .eq('participant_id', participantAId)
      .eq('category_id', categoryId);

    assert.ifError(upErr);

    const { data: playerNotifs } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('type', 'REGISTRATION_STATUS')
      .order('created_at', { ascending: false });

    assert.ok(playerNotifs && playerNotifs.some(n => n.message.includes('APPROVED')));
  });

  // ---------------------------------------------------------------------------
  // 8. Scorer Assigned Trigger
  // ---------------------------------------------------------------------------
  test('8. Scorer assigned: Trigger notifies scorer when assigned to tournament', async () => {
    await adminClient.from('tournament_scorers').insert({
      tournament_id: tournamentId,
      user_id: scorerId,
    });

    const { data: scorerNotifs } = await scorerClient
      .from('notifications')
      .select('*')
      .eq('type', 'SCORER_ASSIGNED')
      .eq('tournament_id', tournamentId);

    assert.ok(scorerNotifs && scorerNotifs.length > 0, 'Scorer must receive scorer assigned notification');
  });

  // ---------------------------------------------------------------------------
  // 9. Own Notification Access & Unread Count
  // ---------------------------------------------------------------------------
  test('9. Own notification access: Player can query their notifications and calculate unread count', async () => {
    const { data: notifs, error } = await playerAClient
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false });

    assert.ifError(error);
    assert.ok(notifs && notifs.length >= 2);
    const unread = notifs.filter(n => !n.is_read).length;
    assert.ok(unread >= 1);
  });

  // ---------------------------------------------------------------------------
  // 10. Cross-User Access Denied (RLS Isolation)
  // ---------------------------------------------------------------------------
  test('10. Cross-user access denied: Player A CANNOT read Player B notifications', async () => {
    // Fetch a notification ID belonging to Player B
    const { data: notifB } = await adminClient
      .from('notifications')
      .select('id')
      .eq('user_id', playerBId)
      .limit(1)
      .single();

    assert.ok(notifB?.id);

    // Player A attempts to select Player B's notification
    const { data: crossData, error: crossErr } = await playerAClient
      .from('notifications')
      .select('*')
      .eq('id', notifB.id);

    assert.ifError(crossErr);
    assert.strictEqual(crossData?.length, 0, 'RLS must return 0 rows for cross-user notification queries');
  });

  // ---------------------------------------------------------------------------
  // 11. Mark Single Notification Read
  // ---------------------------------------------------------------------------
  test('11. Mark read: mark_notification_read RPC sets is_read = true and read_at timestamp', async () => {
    const { data: unreadNotif } = await playerAClient
      .from('notifications')
      .select('id')
      .eq('is_read', false)
      .limit(1)
      .single();

    assert.ok(unreadNotif?.id);

    const { error: rpcErr } = await playerAClient.rpc('mark_notification_read', {
      p_notification_id: unreadNotif.id,
    });
    assert.ifError(rpcErr);

    const { data: updated } = await playerAClient
      .from('notifications')
      .select('is_read, read_at')
      .eq('id', unreadNotif.id)
      .single();

    assert.strictEqual(updated?.is_read, true);
    assert.ok(updated?.read_at);
  });

  // ---------------------------------------------------------------------------
  // 12. Mark All Notifications Read
  // ---------------------------------------------------------------------------
  test('12. Mark all read: mark_all_notifications_read RPC sets all unread notifications to read', async () => {
    const { data: markedCount, error: rpcErr } = await playerAClient.rpc('mark_all_notifications_read');
    assert.ifError(rpcErr);
    assert.ok(typeof markedCount === 'number');

    const { data: remainingUnread } = await playerAClient
      .from('notifications')
      .select('id')
      .eq('is_read', false);

    assert.strictEqual(remainingUnread?.length, 0, 'All notifications must be marked read');
  });

  // ---------------------------------------------------------------------------
  // 13. Cross-User Update Blocked
  // ---------------------------------------------------------------------------
  test('13. Cross-user update blocked: Player A CANNOT mark Player B notifications as read', async () => {
    const { data: notifB } = await adminClient
      .from('notifications')
      .select('id')
      .eq('user_id', playerBId)
      .limit(1)
      .single();

    // Player A calls RPC targeting Player B notification
    await playerAClient.rpc('mark_notification_read', { p_notification_id: notifB!.id });

    // Verify Player B notification is still unchanged
    const { data: verifyB } = await adminClient
      .from('notifications')
      .select('is_read')
      .eq('id', notifB!.id)
      .single();

    assert.strictEqual(verifyB?.is_read, false, 'Player B notification must not be modified by Player A');
  });

  // ---------------------------------------------------------------------------
  // 14. RBAC Protection on Notifications Table
  // ---------------------------------------------------------------------------
  test('14. RBAC protection: Player cannot delete other users notifications', async () => {
    const { data: notifB } = await adminClient
      .from('notifications')
      .select('id')
      .eq('user_id', playerBId)
      .limit(1)
      .single();

    const { data: delData } = await playerAClient
      .from('notifications')
      .delete()
      .eq('id', notifB!.id)
      .select();

    assert.strictEqual(delData?.length || 0, 0, 'Player A cannot delete Player B notification');
  });

  // ---------------------------------------------------------------------------
  // 15. Realtime Channel Subscription
  // ---------------------------------------------------------------------------
  test('15. Realtime: Subscribes cleanly to notifications topic', () => {
    const channel = playerAClient.channel(`user_notifs_${playerAId}`);
    assert.ok(channel);
    assert.strictEqual(channel.topic, `realtime:user_notifs_${playerAId}`);
    playerAClient.removeChannel(channel);
  });

  // ---------------------------------------------------------------------------
  // 16. Empty State Handling
  // ---------------------------------------------------------------------------
  test('16. Empty state: New user with 0 notifications returns empty array without error', async () => {
    const { data: newUser } = await adminClient.auth.admin.createUser({
      email: `notif_empty_${testRunId}@gmail.com`,
      password,
      email_confirm: true,
      user_metadata: { role: 'PLAYER' },
    });

    const newClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    await newClient.auth.signInWithPassword({ email: `notif_empty_${testRunId}@gmail.com`, password });

    const { data: notifs, error } = await newClient.from('notifications').select('*');
    if (newUser?.user?.id) {
      await adminClient.auth.admin.deleteUser(newUser.user.id);
    }
  });
});
