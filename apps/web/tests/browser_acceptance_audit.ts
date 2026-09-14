import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const rootEnv = path.resolve(process.cwd(), '.env');
  const appsWebEnv = path.resolve(process.cwd(), 'apps/web/.env');
  const envPath = fs.existsSync(rootEnv) ? rootEnv : appsWebEnv;
  
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== ENVIRONMENT CHECK ===');
  console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

  const { data: tourneys, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, slug, organizer_id, status')
    .order('created_at', { ascending: false });

  if (tErr) console.error('Tournaments fetch error:', tErr);
  else console.log('Tournaments in DB:', tourneys);

  const { data: users } = await supabase.auth.admin.listUsers();
  console.log('Users in Auth:', users.users.map(u => ({ id: u.id, email: u.email, role: u.user_metadata?.role })));

  const { data: categories } = await supabase.from('categories').select('id, name, tournament_id, format');
  console.log('Categories in DB:', categories);

  if (categories && categories.length > 0) {
    for (const cat of categories) {
      const { count: partCount } = await supabase.from('participants').select('*', { count: 'exact', head: true }).eq('category_id', cat.id).eq('status', 'ACTIVE');
      const { count: drawCount } = await supabase.from('draws').select('*', { count: 'exact', head: true }).eq('category_id', cat.id);
      const { count: matchCount } = await supabase.from('matches').select('*', { count: 'exact', head: true }).eq('category_id', cat.id);
      console.log(`Category [${cat.name}] ID: ${cat.id}, Format: ${cat.format}, Participants: ${partCount}, Draws: ${drawCount}, Matches: ${matchCount}`);
    }
  }
}

main().catch(console.error);
