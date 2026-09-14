import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres.qoccbcczccnbjznnnmgf:fbW5943ZkfSmy7C@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log("Connecting to pooler on port 6543...");
    await client.connect();
    console.log("Connected successfully!");
    const res = await client.query("SELECT now();");
    console.log("Time from DB:", res.rows[0]);
  } catch (err: any) {
    console.error("Connection failed:", err.message);
  } finally {
    await client.end();
  }
}

main();
