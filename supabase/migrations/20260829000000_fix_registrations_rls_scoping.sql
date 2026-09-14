-- Migration: 20260829000000_fix_registrations_rls_scoping.sql
-- Fix unqualified column scoping in registrations RLS policies so player membership checks correctly filter by the target registration.

drop policy if exists "Registrations select policy" on public.registrations;
drop policy if exists "Registrations write policy" on public.registrations;

create policy "Registrations select policy" on public.registrations
  for select using (
    exists (
      select 1 from public.categories c
      where c.id = registrations.category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
    or exists (
      select 1 from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where pm.participant_id = registrations.participant_id
      and pl.user_id = auth.uid()
    )
  );

create policy "Registrations write policy" on public.registrations
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = registrations.category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
    or exists (
      select 1 from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where pm.participant_id = registrations.participant_id
      and pl.user_id = auth.uid()
    )
  );
