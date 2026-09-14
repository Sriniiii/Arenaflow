import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres.qoccbcczccnbjznnnmgf:fbW5943ZkfSmy7C@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: {
      rejectUnauthorized: false
    }
  });

  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  console.log("Reading migrations from:", migrationsDir);

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  try {
    console.log("Connecting to database...");
    await client.connect();
    
    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Mark participant RLS migration as already applied
    await client.query("INSERT INTO public.schema_migrations (version) VALUES ('20260820000006_participant_rls_player_inserts.sql') ON CONFLICT DO NOTHING;");

    // Get already applied migrations
    const { rows } = await client.query("SELECT version FROM public.schema_migrations;");
    const appliedVersions = new Set(rows.map((row: any) => row.version));
    
    if (appliedVersions.size === 0) {
      console.log("Initializing migrations history for Phase 1...");
      const alreadyApplied = [
        '20260820000000_initial_schema.sql',
        '20260820000001_auth_triggers.sql',
        '20260820000002_rls_policies.sql',
        '20260820000003_audit_logging.sql',
        '20260820000004_seed_data.sql'
      ];
      for (const ver of alreadyApplied) {
        await client.query("INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING;", [ver]);
        appliedVersions.add(ver);
      }
    }

    const forceFile = process.argv[2];
    if (forceFile) {
      await client.query("DELETE FROM public.schema_migrations WHERE version = $1;", [forceFile]);
      appliedVersions.delete(forceFile);
    }

    console.log("Already applied migrations:", Array.from(appliedVersions));

    const pendingFiles = files.filter(file => !appliedVersions.has(file));
    console.log("Pending migration files to apply:", pendingFiles);

    if (pendingFiles.length === 0) {
      console.log("No pending migrations. Database is up to date.");
      return;
    }

    for (const file of pendingFiles) {
      console.log(`Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations (version) VALUES ($1);",
          [file]
        );
        await client.query('COMMIT');
        console.log(`Success: ${file}`);
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(`Error in migration file ${file}:`, err.message);
        throw err;
      }
    }

    console.log("All pending migrations applied successfully!");
  } catch (err: any) {
    console.error("Migration execution failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
