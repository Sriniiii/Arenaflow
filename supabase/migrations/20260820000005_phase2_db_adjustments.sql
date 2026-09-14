-- Phase 2 Database Schema and Policy Adjustments

-- 1. Venues ownership additions
alter table public.venues
  add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete set null;

-- Re-define RLS policies for Venues
drop policy if exists "Venues modifiable by Organizers and Platform Admins" on public.venues;

create policy "Venues insert policy" on public.venues
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('ORGANIZER', 'PLATFORM_ADMIN')
    )
  );

create policy "Venues update/delete policy" on public.venues
  for all using (
    owner_id = auth.uid()
    or public.is_platform_admin()
  );

-- Re-define RLS policies for Courts
drop policy if exists "Courts manageable by venue Organizer or Platform Admin" on public.courts;

create policy "Courts write policy" on public.courts
  for all using (
    exists (
      select 1 from public.venues v
      where v.id = venue_id
      and v.owner_id = auth.uid()
    )
    or public.is_platform_admin()
  );


-- 2. Sport-neutral category settings
alter table public.categories
  add column if not exists age_group text,
  add column if not exists skill_level text,
  add column if not exists registration_fee numeric default 0 check (registration_fee >= 0);
