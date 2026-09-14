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
        process.env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      }
    });
  }
}
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function diagnose() {
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: users, error } = await adminClient.auth.admin.listUsers();
  console.log('Registered users in Supabase Auth:');
  users?.users.forEach(u => console.log(` - ${u.email} (id: ${u.id})`));

  // Test signin via Anon client
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  const testEmail = 'sriniwasp36@gmail.com';
  const { data: signinData, error: signinErr } = await anonClient.auth.signInWithPassword({
    email: testEmail,
    password: 'TestSecurePassword123!'
  });

  if (signinErr) {
    console.error(`Sign in error for ${testEmail}:`, signinErr.message);
  } else {
    console.log(`Sign in succeeded for ${testEmail}, user id:`, signinData.user?.id);
    const { data: prof, error: profErr } = await adminClient.from('profiles').select('*').eq('id', signinData.user?.id).single();
    console.log('Profile for user:', prof, 'Error:', profErr);
  }
}

diagnose().catch(console.error);
