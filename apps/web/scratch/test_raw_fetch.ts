import * as fs from 'fs';
import * as path from 'path';

async function testRawAuth() {
  const url = "https://qoccbcczccnbjznnnmgf.supabase.co/auth/v1/token?grant_type=password";
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvY2NiY2N6Y2NuYmp6bm5ubWdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDQzNTksImV4cCI6MjEwMjc4MDM1OX0.xsM_c5tJvwy7RucSDOjsY9nwWatK7tNPzgDuiJ0czNA";
  
  console.log(`Sending direct fetch to ${url}...`);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "sriniwasp36@gmail.com",
        password: "TestSecurePassword123!"
      })
    });
    const elapsed = Date.now() - start;
    console.log(`Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    const data = await res.json();
    console.log("Response data keys:", Object.keys(data));
    if (data.access_token) {
      console.log("SUCCESS: Received access_token! User ID:", data.user?.id);
    } else {
      console.log("Error response:", data);
    }
  } catch (err: any) {
    const elapsed = Date.now() - start;
    console.error(`Fetch failed after ${elapsed}ms:`, err);
  }
}

testRawAuth();
