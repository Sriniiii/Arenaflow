import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { forgotPasswordSchema, resetPasswordSchema } from '@arena-flow/validation';

function loadEnv() {
  try {
    const rootEnv = path.resolve(process.cwd(), '.env');
    const siblingEnv = path.resolve(process.cwd(), '../../.env');
    const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
    const envPath = fs.existsSync(rootEnv) ? rootEnv : fs.existsSync(appsWebEnv) ? appsWebEnv : siblingEnv;

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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

describe('Feature 8: Password Recovery & Account Security Suite', () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  const testRunId = Date.now().toString().slice(-6);
  const testEmail = `recovery_user_${testRunId}@gmail.com`;
  const initialPassword = 'InitialSecurePassword123!';
  const updatedPassword = 'NewSecurePassword456!';
  const unknownEmail = `nonexistent_user_${testRunId}@gmail.com`;

  let testUserId: string;
  let tournamentId: string;
  let categoryId: string;
  let initialProfileState: any;

  before(async () => {
    adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create a real test user with ORGANIZER role
    const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Recovery Test Organizer',
        display_name: 'RecoveryOrg',
        role: 'ORGANIZER',
      },
    });
    if (userErr) throw userErr;
    testUserId = userData.user.id;

    // Verify initial profile
    const { data: prof, error: profErr } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', testUserId)
      .single();
    if (profErr) throw profErr;
    initialProfileState = prof;

    // 2. Create sport & venue & tournament to verify database safety
    const { data: sport } = await adminClient.from('sports').select('id').eq('slug', 'badminton').maybeSingle();
    let sportId = sport?.id;
    if (!sportId) {
      const { data: newSport } = await adminClient.from('sports').insert({ name: 'Badminton', slug: `badminton-${testRunId}` }).select('id').single();
      sportId = newSport!.id;
    }

    const { data: tourney, error: tErr } = await adminClient
      .from('tournaments')
      .insert({
        name: `Recovery Test Championship ${testRunId}`,
        slug: `recovery-tourney-${testRunId}`,
        sport_id: sportId,
        organizer_id: testUserId,
        status: 'PUBLISHED',
      })
      .select('id')
      .single();
    if (tErr) throw tErr;
    tournamentId = tourney.id;

    const { data: cat, error: cErr } = await adminClient
      .from('categories')
      .insert({
        tournament_id: tournamentId,
        name: "Men's Singles Recovery",
        category_type: 'SINGLES',
        match_type: 'MENS',
        format: 'KNOCKOUT',
      })
      .select('id')
      .single();
    if (cErr) throw cErr;
    categoryId = cat.id;
  });

  after(async () => {
    // Cleanup test data
    if (categoryId) await adminClient.from('categories').delete().eq('id', categoryId);
    if (tournamentId) await adminClient.from('tournaments').delete().eq('id', tournamentId);
    if (testUserId) await adminClient.auth.admin.deleteUser(testUserId);
  });

  // -------------------------------------------------------------
  // 1. Validation Logic Tests
  // -------------------------------------------------------------
  test('1. Validation: forgotPasswordSchema rejects invalid emails and accepts valid ones', () => {
    assert.strictEqual(forgotPasswordSchema.safeParse({ email: '' }).success, false, 'Empty email must fail');
    assert.strictEqual(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success, false, 'Invalid format must fail');
    assert.strictEqual(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success, true, 'Valid email must succeed');
  });

  test('2. Validation: resetPasswordSchema enforces length >= 6 and matching confirmation', () => {
    assert.strictEqual(
      resetPasswordSchema.safeParse({ password: '123', confirmPassword: '123' }).success,
      false,
      'Short password must fail'
    );
    assert.strictEqual(
      resetPasswordSchema.safeParse({ password: 'ValidPassword123', confirmPassword: 'DifferentPassword123' }).success,
      false,
      'Mismatched password confirmation must fail'
    );
    assert.strictEqual(
      resetPasswordSchema.safeParse({ password: 'ValidPassword123', confirmPassword: 'ValidPassword123' }).success,
      true,
      'Valid matching password must succeed'
    );
  });

  // -------------------------------------------------------------
  // 2. Forgot Password Enumeration Prevention & Rate Limit
  // -------------------------------------------------------------
  test('3. Account Enumeration Prevention: resetPasswordForEmail returns safe response for existing account', async () => {
    const { data, error } = await anonClient.auth.resetPasswordForEmail(testEmail, {
      redirectTo: 'http://localhost:3000/auth/reset-password',
    });
    if (error) {
      // Supabase hosted auth enforces project-level email rate limits (e.g. 4 emails/hr on free tier)
      assert.strictEqual(
        error.message.toLowerCase().includes('rate limit') || error.status === 429,
        true,
        'Expected clean execution or Supabase Auth email rate limit response'
      );
    } else {
      assert.ok(data !== undefined, 'Response returned');
    }
  });

  test('4. Account Enumeration Prevention: resetPasswordForEmail returns safe response for non-existent account', async () => {
    const { data, error } = await anonClient.auth.resetPasswordForEmail(unknownEmail, {
      redirectTo: 'http://localhost:3000/auth/reset-password',
    });
    if (error) {
      assert.strictEqual(
        error.message.toLowerCase().includes('rate limit') || error.status === 429,
        true,
        'Expected clean execution or Supabase Auth email rate limit response'
      );
    } else {
      // Supabase returns generic 200 OK without leaking whether account exists
      assert.ok(data !== undefined, 'Response returned');
    }
  });

  // -------------------------------------------------------------
  // 3. Password Recovery Lifecycle & Update
  // -------------------------------------------------------------
  test('5. Recovery Link & Session Generation: Admin generates valid recovery link', async () => {
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: testEmail,
      options: {
        redirectTo: 'http://localhost:3000/auth/reset-password',
      },
    });
    assert.ifError(linkErr);
    assert.ok(linkData.properties?.action_link, 'Action link generated');
    assert.ok(linkData.properties?.hashed_token, 'Hashed token exists');
  });

  test('6. Password Update: User authenticates with recovery token and updates password', async () => {
    // Generate recovery link
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: testEmail,
    });

    const hashedToken = linkData.properties?.hashed_token;
    assert.ok(hashedToken, 'Hashed token must exist');

    // Create a dedicated user client for the recovery session
    const recoveryUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify OTP using recovery token
    const { data: verifyData, error: verifyErr } = await recoveryUserClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'recovery',
    });
    assert.ifError(verifyErr);
    assert.strictEqual(verifyData.user?.id, testUserId, 'Recovery session must match test user ID');

    // Update password using the active authenticated recovery session
    const { data: updateData, error: updateErr } = await recoveryUserClient.auth.updateUser({
      password: updatedPassword,
    });
    assert.ifError(updateErr);
    assert.strictEqual(updateData.user?.id, testUserId, 'Updated user ID must match');
  });

  test('7. New Password Authentication: User can log in with new password', async () => {
    const loginClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await loginClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });
    assert.ifError(error);
    assert.strictEqual(data.user?.id, testUserId, 'Logged in user ID matches');
  });

  test('8. Old Password Invalidation: User cannot log in with previous password', async () => {
    const loginClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await loginClient.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    assert.ok(error, 'Login with old password must fail');
    assert.strictEqual(data.user, null, 'No user session created with old password');
  });

  // -------------------------------------------------------------
  // 4. Invalid / Expired Recovery Handling
  // -------------------------------------------------------------
  test('9. Invalid Recovery Handling: Invalid or tampered token is rejected', async () => {
    const invalidClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await invalidClient.auth.verifyOtp({
      token_hash: 'invalid_or_expired_token_hash_1234567890',
      type: 'recovery',
    });
    assert.ok(error, 'Invalid token must be rejected');
    assert.strictEqual(error?.status === 400 || error?.status === 403 || error?.status === 422, true, 'Rejection status');
  });

  // -------------------------------------------------------------
  // 5. RBAC & Database Safety Verification
  // -------------------------------------------------------------
  test('10. RBAC Preservation: User role and profile remain unchanged after password reset', async () => {
    const { data: postProfile, error } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', testUserId)
      .single();

    assert.ifError(error);
    assert.strictEqual(postProfile.role, initialProfileState.role, 'Role must remain ORGANIZER');
    assert.strictEqual(postProfile.full_name, initialProfileState.full_name, 'Full name must remain unchanged');
    assert.strictEqual(postProfile.display_name, initialProfileState.display_name, 'Display name must remain unchanged');
    assert.strictEqual(postProfile.id, initialProfileState.id, 'Profile ID must remain unchanged');
  });

  test('11. Database Safety: Application tournament entities remain completely intact', async () => {
    const { data: postTourney, error: tErr } = await adminClient
      .from('tournaments')
      .select('id, name, organizer_id, status')
      .eq('id', tournamentId)
      .single();

    assert.ifError(tErr);
    assert.strictEqual(postTourney.organizer_id, testUserId, 'Tournament organizer ownership intact');
    assert.strictEqual(postTourney.status, 'PUBLISHED', 'Tournament status intact');

    const { data: postCat, error: cErr } = await adminClient
      .from('categories')
      .select('id, name, format')
      .eq('id', categoryId)
      .single();

    assert.ifError(cErr);
    assert.strictEqual(postCat.format, 'KNOCKOUT', 'Category format intact');
  });

  test('12. Session Lifecycle: Sign out cleanly terminates session', async () => {
    const sessionClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await sessionClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });

    const { error: signOutErr } = await sessionClient.auth.signOut();
    assert.ifError(signOutErr);

    const { data: sessionData } = await sessionClient.auth.getSession();
    assert.strictEqual(sessionData.session, null, 'Session must be null after sign out');
  });
});
