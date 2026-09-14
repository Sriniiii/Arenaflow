import { chromium } from 'playwright';

async function diagnoseAuth() {
  console.log('=== REAL BROWSER AUTHENTICATION DIAGNOSTIC ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLogs: string[] = [];
  const networkEvents: string[] = [];

  page.on('console', (msg) => {
    const entry = `[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleLogs.push(entry);
    console.log(entry);
  });

  page.on('pageerror', (err) => {
    const entry = `[PAGE ERROR] ${err.message}`;
    consoleLogs.push(entry);
    console.log(entry);
  });

  page.on('request', (req) => {
    // Filter out static chunks to focus on auth & API calls
    const url = req.url();
    if (!url.includes('/_next/static/')) {
      const entry = `[REQUEST] ${req.method()} ${url}`;
      networkEvents.push(entry);
      console.log(entry);
    }
  });

  page.on('requestfailed', (req) => {
    const entry = `[REQUEST FAILED] ${req.method()} ${req.url()} - Error: ${req.failure()?.errorText}`;
    networkEvents.push(entry);
    console.log(entry);
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/_next/static/')) {
      let bodySnippet = '';
      try {
        const text = await res.text();
        bodySnippet = text.length > 300 ? text.substring(0, 300) + '...' : text;
      } catch (e) {
        bodySnippet = '(could not read body)';
      }
      const entry = `[RESPONSE] ${res.status()} ${url} -> ${bodySnippet}`;
      networkEvents.push(entry);
      console.log(entry);
    }
  });

  console.log('Step 1: Navigating to http://localhost:3000/auth/login...');
  const navResponse = await page.goto('http://localhost:3000/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`Page navigation status: ${navResponse?.status()}`);

  const headingText = await page.locator('h1').textContent();
  console.log(`Page H1 text: "${headingText}"`);

  const emailInputVisible = await page.locator('#email-input').isVisible();
  const passwordInputVisible = await page.locator('#password-input').isVisible();
  const submitBtnVisible = await page.locator('button[type="submit"]').isVisible();
  console.log(`Form elements visible: Email=${emailInputVisible}, Password=${passwordInputVisible}, Submit=${submitBtnVisible}`);

  console.log('\nStep 2: Entering credentials...');
  await page.fill('#email-input', 'sriniwasp36@gmail.com');
  await page.fill('#password-input', 'TestSecurePassword123!');

  console.log('\nStep 3: Clicking Sign In button...');
  await page.click('button[type="submit"]');

  console.log('\nStep 4: Waiting for network response and navigation (up to 15s)...');
  try {
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('SUCCESS: Navigation to /dashboard completed!');
  } catch (err: any) {
    console.log(`Navigation to /dashboard did not occur within timeout. Current URL: ${page.url()}`);
  }

  // Check alert or error banner on the page
  const alertText = await page.locator('[role="alert"]').textContent().catch(() => null);
  console.log(`Rendered alert on page: "${alertText || 'none'}"`);

  console.log('\n=== DIAGNOSTIC SUMMARY ===');
  console.log('Final Page URL:', page.url());
  console.log('Total Console Messages:', consoleLogs.length);
  console.log('Total Network Events (non-static):', networkEvents.length);

  await browser.close();
}

diagnoseAuth().catch((err) => {
  console.error('Diagnostic execution error:', err);
  process.exit(1);
});
