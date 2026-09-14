import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
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
}
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function verify() {
  console.log('Testing Export API Endpoints...');
  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  const { data: tournaments } = await admin.from('tournaments').select('*').limit(5);
  if (!tournaments || tournaments.length === 0) {
    console.log('No tournaments found in database');
    return;
  }

  const tourney = tournaments[0];
  console.log(`Selected Tournament: ${tourney.name} (slug: ${tourney.slug})`);

  const slug = tourney.slug || tourney.id;
  const baseUrl = `http://localhost:3000/api/tournaments/${slug}/export`;

  const tests = [
    { type: 'results', format: 'csv' },
    { type: 'results', format: 'xlsx' },
    { type: 'results', format: 'pdf' },
    { type: 'standings', format: 'csv' },
    { type: 'standings', format: 'xlsx' },
    { type: 'standings', format: 'pdf' },
    { type: 'schedule', format: 'csv' },
    { type: 'schedule', format: 'xlsx' },
    { type: 'schedule', format: 'pdf' },
    { type: 'draw', format: 'csv' },
    { type: 'draw', format: 'xlsx' },
    { type: 'draw', format: 'pdf' }
  ];

  for (const t of tests) {
    const query = new URLSearchParams({
      type: t.type,
      format: t.format
    });
    const url = `${baseUrl}?${query.toString()}`;
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    console.log(`[HTTP ${res.status}] ${t.type.padEnd(12)} (${t.format.padEnd(4)}) -> Size: ${String(buffer.byteLength).padStart(6)} bytes | Content-Type: ${res.headers.get('content-type')} | Disposition: ${res.headers.get('content-disposition')}`);
  }
}

verify();
