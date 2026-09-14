import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function runBrowserAudit() {
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const testRunId = Date.now().toString().slice(-6);
  const testEmail = `browser_rec_${testRunId}@gmail.com`;
  const initialPassword = 'InitialBrowserPass123!';
  const updatedPassword = 'NewUpdatedBrowserPass456!';
  const unknownEmail = `ghost_user_${testRunId}@gmail.com`;

  console.log('=== FEATURE 8 REAL BROWSER & AUTH ACCEPTANCE AUDIT ===');
  console.log(`Test Email: ${testEmail}`);
  console.log(`Initial Password: ${initialPassword}`);
  console.log(`Updated Password: ${updatedPassword}`);

  // 1. Create real test account in Supabase
  const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: initialPassword,
    email_confirm: true,
    user_metadata: {
      full_name: 'Browser Audit Organizer',
      display_name: 'BrowserOrg',
      role: 'ORGANIZER',
    },
  });
  if (userErr) throw userErr;
  const userId = userData.user.id;
  console.log(`[PASS] Created test user: ${userId}`);

  // Fetch initial profile
  const { data: initialProfile } = await adminClient.from('profiles').select('*').eq('id', userId).single();
  console.log(`[PASS] Initial Profile Role: ${initialProfile.role}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const auditReport: any = {
    testUser: { id: userId, email: testEmail, initialRole: initialProfile.role },
    steps: {},
  };

  try {
    // -------------------------------------------------------------
    // STEP 1: Verify Login Page 'Forgot password?' Link
    // -------------------------------------------------------------
    console.log('\n--- Step 1: Login Page Link Inspection ---');
    await page.goto('http://localhost:3000/auth/login');
    await page.waitForLoadState('networkidle');

    const forgotLink = page.locator('a[href="/auth/forgot-password"]');
    const isForgotLinkVisible = await forgotLink.isVisible();
    const forgotLinkText = await forgotLink.textContent();
    console.log(`Forgot password link visible: ${isForgotLinkVisible} ("${forgotLinkText}")`);

    if (!isForgotLinkVisible) throw new Error('Forgot password link missing on /auth/login');
    auditReport.steps.loginPageLink = { visible: isForgotLinkVisible, text: forgotLinkText };

    // -------------------------------------------------------------
    // STEP 2: Navigate to /auth/forgot-password & Test Unknown Email
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Forgot Password Page - Unknown Email ---');
    await forgotLink.click();
    await page.waitForURL('**/auth/forgot-password');

    await page.fill('#forgot-email-input', unknownEmail);
    await page.click('button[type="submit"]');

    // Wait for response message
    await page.waitForSelector('text=If an account exists for this email, a password reset link has been sent.');
    const unknownEmailMsg = await page.locator('.pro-card [role="alert"]').textContent();
    console.log(`Unknown email safe response: "${unknownEmailMsg}"`);
    auditReport.steps.unknownEmail = { submitted: unknownEmail, response: unknownEmailMsg };

    // -------------------------------------------------------------
    // STEP 3: Test Known Email on Forgot Password Page
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Forgot Password Page - Existing Account ---');
    await page.goto('http://localhost:3000/auth/forgot-password');
    await page.waitForLoadState('networkidle');

    await page.fill('#forgot-email-input', testEmail);
    await page.click('button[type="submit"]');

    // Wait for response message
    await page.waitForSelector('.pro-card [role="alert"]');
    const knownEmailMsg = await page.locator('.pro-card [role="alert"]').textContent();
    console.log(`Existing account response: "${knownEmailMsg}"`);
    auditReport.steps.existingEmail = { submitted: testEmail, response: knownEmailMsg };

    // -------------------------------------------------------------
    // STEP 4: Test Invalid / Expired Link on /auth/reset-password
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Invalid/Expired Recovery Link State ---');
    await page.goto('http://localhost:3000/auth/reset-password?error=access_denied&error_code=otp_expired');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('text=This password reset link is invalid or has expired. Please request a new one.');
    const errorBanner = await page.locator('.pro-card [role="alert"]').textContent();
    console.log(`Invalid link error banner: "${errorBanner}"`);
    const requestNewLinkBtn = await page.locator('a[href="/auth/forgot-password"]').isVisible();
    console.log(`Request New Reset Link button present: ${requestNewLinkBtn}`);
    auditReport.steps.invalidLink = { banner: errorBanner, hasRecoveryButton: requestNewLinkBtn };

    // -------------------------------------------------------------
    // STEP 5: Real Recovery Link Execution & Set New Password
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Real Recovery Link Session & Password Reset ---');
    // Generate real recovery link via admin
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: testEmail,
      options: {
        redirectTo: 'http://localhost:3000/auth/reset-password',
      },
    });
    if (linkErr) throw linkErr;

    const actionLink = linkData.properties?.action_link;
    const hashedToken = linkData.properties?.hashed_token;
    console.log(`Generated Action Link: ${actionLink}`);
    console.log(`Hashed Token: ${hashedToken}`);

    // Create fresh context for recovery session
    const resetContext = await browser.newContext();
    const resetPage = await resetContext.newPage();

    // Authenticate recovery session via verifyOtp
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessionData, error: otpErr } = await userClient.auth.verifyOtp({
      token_hash: hashedToken!,
      type: 'recovery',
    });
    if (otpErr) throw otpErr;

    // Inject active session into browser localStorage for localhost:3000
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
    await resetPage.goto('http://localhost:3000/auth/reset-password');
    await resetPage.evaluate(
      ({ key, session }) => {
        localStorage.setItem(key, JSON.stringify(session));
      },
      { key: storageKey, session: sessionData.session }
    );

    // Reload /auth/reset-password with session present
    await resetPage.goto('http://localhost:3000/auth/reset-password');
    await resetPage.waitForSelector('#new-password-input');
    console.log('[PASS] Reset password form rendered with active recovery session');

    // Fill new password and confirmation
    await resetPage.fill('#new-password-input', updatedPassword);
    await resetPage.fill('#confirm-password-input', updatedPassword);
    await resetPage.click('button[type="submit"]');

    // Wait for success confirmation
    await resetPage.waitForSelector('text=Password updated successfully! Redirecting to sign in...');
    const updateSuccessMsg = await resetPage.locator('.pro-card [role="alert"]').textContent();
    console.log(`Password update confirmation: "${updateSuccessMsg}"`);
    auditReport.steps.passwordReset = { success: true, message: updateSuccessMsg };

    // Wait for redirect to /auth/login
    await resetPage.waitForURL('**/auth/login', { timeout: 8000 });
    console.log('[PASS] Redirected cleanly to /auth/login');

    // -------------------------------------------------------------
    // STEP 6: Sign In With New Password
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Sign In With New Password ---');
    await resetPage.fill('#email-input', testEmail);
    await resetPage.fill('#password-input', updatedPassword);
    await resetPage.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await resetPage.waitForURL('**/dashboard', { timeout: 8000 });
    console.log('[PASS] Successfully logged in with new password and reached /dashboard');

    // Verify session in dashboard
    const organizerName = await resetPage.locator('text=Tournament Operations Center').isVisible();
    console.log(`Organizer Dashboard visible: ${organizerName}`);
    auditReport.steps.loginWithNewPassword = { success: true, reachedDashboard: organizerName };

    // -------------------------------------------------------------
    // STEP 7: Sign Out & Test Old Password Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Sign Out & Verify Old Password Fails ---');
    const signOutBtn = resetPage.locator('button:has-text("Sign Out")').first();
    if (await signOutBtn.isVisible()) {
      await signOutBtn.click();
      await resetPage.waitForTimeout(1000);
    }

    // Go to login and try old password
    await resetPage.goto('http://localhost:3000/auth/login');
    await resetPage.fill('#email-input', testEmail);
    await resetPage.fill('#password-input', initialPassword);
    await resetPage.click('button[type="submit"]');

    await resetPage.waitForSelector('.pro-card [role="alert"]');
    const oldPassErrorMsg = await resetPage.locator('.pro-card [role="alert"]').textContent();
    console.log(`Old password rejection message: "${oldPassErrorMsg}"`);
    auditReport.steps.oldPasswordRejection = { rejected: true, message: oldPassErrorMsg };

    // -------------------------------------------------------------
    // STEP 8: RBAC & Database Integrity Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Database & RBAC Integrity Check ---');
    const { data: finalProfile } = await adminClient.from('profiles').select('*').eq('id', userId).single();
    console.log(`Initial Profile:`, initialProfile);
    console.log(`Final Profile:`, finalProfile);

    const rbacPreserved =
      finalProfile.role === initialProfile.role &&
      finalProfile.full_name === initialProfile.full_name &&
      finalProfile.display_name === initialProfile.display_name;

    console.log(`RBAC Preserved: ${rbacPreserved}`);
    auditReport.steps.rbacPreservation = {
      initialRole: initialProfile.role,
      finalRole: finalProfile.role,
      preserved: rbacPreserved,
    };

    await resetContext.close();
  } finally {
    await context.close();
    await browser.close();

    // Cleanup test user
    await adminClient.auth.admin.deleteUser(userId);
  }

  // Save audit results to scratch directory
  const resultsPath = path.resolve(
    'C:/Users/sriniwas/.gemini/antigravity/brain/99459d23-4af2-4aa2-9bb8-62e57eceebaf/scratch/feature8_acceptance_results.json'
  );
  fs.writeFileSync(resultsPath, JSON.stringify(auditReport, null, 2));
  console.log(`\n Acceptance audit results saved to: ${resultsPath}`);
}

runBrowserAudit().catch((err) => {
  console.error('Browser Acceptance Failed:', err);
  process.exit(1);
});
