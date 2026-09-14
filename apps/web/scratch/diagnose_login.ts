import { chromium } from 'playwright';

async function diagnoseLogin() {
  console.log('--- DIAGNOSING LOGIN AT http://localhost:3000/auth/login ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log all network requests
  page.on('request', (req) => {
    console.log(`[REQUEST] ${req.method()} ${req.url()}`);
  });

  page.on('requestfailed', (req) => {
    console.log(`[REQUEST FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  page.on('response', (res) => {
    console.log(`[RESPONSE] ${res.status()} ${res.url()}`);
  });

  page.on('console', (msg) => {
    console.log(`[BROWSER CONSOLE ${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  console.log('1. Navigating to http://localhost:3000/auth/login...');
  await page.goto('http://localhost:3000/auth/login', { waitUntil: 'networkidle' });

  // Evaluate Supabase client in browser context
  const clientEnv = await page.evaluate(() => {
    return {
      // @ts-ignore
      hasSupabase: typeof window !== 'undefined',
      origin: window.location.origin,
    };
  });
  console.log('Browser client environment:', clientEnv);

  console.log('2. Entering credentials...');
  await page.fill('#email-input', 'sriniwasp36@gmail.com');
  await page.fill('#password-input', 'TestSecurePassword123!');

  console.log('3. Clicking Sign In button...');
  await page.click('button[type="submit"]');

  // Wait 3 seconds to observe all network requests and UI changes
  await page.waitForTimeout(3000);

  const errorAlert = await page.locator('[role="alert"]').textContent().catch(() => null);
  console.log('Rendered alert message on page:', errorAlert);

  console.log('Current Page URL:', page.url());

  await browser.close();
}

diagnoseLogin().catch(console.error);
