import { chromium } from 'playwright';

async function checkBrowserClient() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/auth/login', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    // @ts-ignore
    const win = window as any;
    return {
      envUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasEnvUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      origin: window.location.origin
    };
  });

  console.log('Browser evaluation result:', result);
  await browser.close();
}

checkBrowserClient().catch(console.error);
