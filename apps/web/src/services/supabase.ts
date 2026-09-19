import { createClient } from '@supabase/supabase-js';

/**
 * Normalizes Supabase project URL by removing any trailing slashes,
 * quotes, whitespace, or accidentally pasted API subpaths (/rest/v1, /auth/v1, etc.)
 */
export function getNormalizedSupabaseUrl(url?: string): string {
  if (!url) return 'https://placeholder-project.supabase.co';
  let clean = url.trim().replace(/^['"]|['"]$/g, '');
  // Strip trailing slashes and API subpaths if user pasted the full endpoint
  clean = clean.replace(/\/+(rest|auth|api)?\/?v\d+\/?$/i, '').replace(/\/+$/, '');
  return clean || 'https://placeholder-project.supabase.co';
}

export function getNormalizedSupabaseKey(key?: string): string {
  if (!key) return 'placeholder-anon-key';
  return key.trim().replace(/^['"]|['"]$/g, '');
}

const supabaseUrl = getNormalizedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = getNormalizedSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
