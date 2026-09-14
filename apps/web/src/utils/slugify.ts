import { supabase } from '../services/supabase';

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')         // Replace spaces with -
    .replace(/[^\w\-]+/g, '')     // Remove all non-word chars
    .replace(/\-\-+/g, '-')       // Replace multiple - with single -
    .replace(/^-+/, '')           // Trim - from start of text
    .replace(/-+$/, '');          // Trim - from end of text
}

export async function createTournamentWithUniqueSlug(
  tournamentData: {
    name: string;
    description?: string;
    sport_id: string;
    venue_id?: string | null;
    start_date: string;
    end_date: string;
    registration_open: string;
    registration_close: string;
    status: 'DRAFT' | 'PUBLISHED';
    organizer_id: string;
  },
  client = supabase
) {
  const baseSlug = slugify(tournamentData.name) || 'tournament';
  let slug = baseSlug;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const { data, error } = await client
      .from('tournaments')
      .insert({
        ...tournamentData,
        slug
      })
      .select()
      .single();

    if (!error) {
      return { data, error: null };
    }

    const isUniqueViolation = error.code === '23505';
    if (isUniqueViolation) {
      attempts++;
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      slug = `${baseSlug}-${randomSuffix}`;
      console.log(`Slug collision detected. Retrying with: ${slug}`);
    } else {
      return { data: null, error };
    }
  }

  return { data: null, error: { message: `Failed to resolve unique slug after ${maxAttempts} attempts.` } };
}
