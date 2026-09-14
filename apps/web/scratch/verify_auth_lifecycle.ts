import { chromium } from 'playwright';
import assert from 'node:assert';

async function verifyFullAuthLifecycle() {
  console.log('================================================================');
  console.log('  ARENAFLOW — COMPLETE AUTHENTICATION LIFECYCLE VERIFICATION');
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Track console errors
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.error('[PAGE ERROR]', err.message);
  });

  // Step A: Open /auth/login
  console.log('Step A: Opening http://localhost:3000/auth/login...');
  await page.goto('http://localhost:3000/auth/login', { waitUntil: 'networkidle' });
  const pageTitle = await page.locator('h1').textContent();
  assert.ok(pageTitle?.includes('Sign In to ArenaFlow'), 'Login header must render');
  console.log('  ✓ Login page loaded successfully');

  // Step B: Enter valid credentials
  console.log('Step B: Entering valid organizer credentials (sriniwasp36@gmail.com)...');
  await page.fill('#email-input', 'sriniwasp36@gmail.com');
  await page.fill('#password-input', 'TestSecurePassword123!');
  console.log('  ✓ Credentials populated');

  // Step C: Click Sign In
  console.log('Step C: Clicking Sign In button...');
  await page.click('button[type="submit"]');

  // Step D & E: Confirm URL becomes /dashboard and NO "Failed to fetch"
  console.log('Step D & E: Waiting for redirect to /dashboard...');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  const currentUrl = page.url();
  assert.ok(currentUrl.includes('/dashboard'), `Expected /dashboard, got ${currentUrl}`);
  
  const alertText = await page.locator('[role="alert"]').textContent().catch(() => null);
  assert.ok(!alertText?.includes('Failed to fetch'), 'Must not display "Failed to fetch" error');
  console.log('  ✓ Authenticated and successfully redirected to /dashboard (no errors)');

  // Step F: Confirm the dashboard actually loads content
  console.log('Step F: Verifying dashboard content...');
  await page.waitForSelector('text=Tournament Operations Center', { timeout: 10000 });
  const dashboardText = await page.textContent('body');
  assert.ok(dashboardText?.includes('Total Tournaments') || dashboardText?.includes('Published / Live'), 'Operational stats must be visible');
  console.log('  ✓ Dashboard loaded with operational metrics');

  // Step G: Refresh /dashboard and confirm session persistence
  console.log('Step G: Refreshing /dashboard to test session persistence...');
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok(page.url().includes('/dashboard'), 'Must remain on /dashboard after reload');
  await page.waitForSelector('text=Tournament Operations Center', { timeout: 10000 });
  console.log('  ✓ Session persists after full page refresh (no redirection to login, no session loss)');

  // Step H: Sign out
  console.log('Step H: Signing out...');
  const signOutBtn = page.locator('button:has-text("Sign Out")').first();
  assert.ok(await signOutBtn.isVisible(), 'Sign Out button must be visible in navigation');
  await signOutBtn.click();
  await page.waitForTimeout(2000);
  console.log('  ✓ Sign out executed cleanly');

  // Step I: Confirm protected route (/dashboard) is no longer accessible
  console.log('Step I: Navigating back to protected /dashboard...');
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const postLogoutUrl = page.url();
  assert.ok(postLogoutUrl.includes('/auth/login'), `Expected redirect to /auth/login, got ${postLogoutUrl}`);
  console.log('  ✓ Protected route /dashboard strictly denied and redirected to /auth/login');

  assert.strictEqual(pageErrors.length, 0, 'No uncaught page errors allowed');

  await browser.close();

  console.log('\n================================================================');
  console.log('  AUTHENTICATION LIFECYCLE: 100% PASS ACROSS ALL CRITERIA');
  console.log('================================================================\n');
}

verifyFullAuthLifecycle().catch((err) => {
  console.error('Lifecycle verification failure:', err);
  process.exit(1);
});
