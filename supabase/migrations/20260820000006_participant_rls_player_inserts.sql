-- Phase 2 RLS Policies for Player Self-Registration

-- 1. Participants Insert Policies
drop policy if exists "Organizer/Admin full access on participants" on public.participants;
drop policy if exists "Players can insert own inactive participants" on public.participants;

create policy "Organizer/Admin full access on participants" on public.participants
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Players can insert own inactive participants" on public.participants
  for insert with check (
    status = 'WITHDRAWN'
    and exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and t.status = 'PUBLISHED'
      and now() >= t.registration_open
      and now() <= t.registration_close
    )
  );


-- 2. Participant Members Insert/All Policies
drop policy if exists "Organizer/Admin full access on participant members" on public.participant_members;
drop policy if exists "Players can add themselves as members" on public.participant_members;
drop policy if exists "Players can add doubles partner as member" on public.participant_members;

create policy "Organizer/Admin full access on participant members" on public.participant_members
  for all using (
    exists (
      select 1 from public.participants p
      join public.categories c on p.category_id = c.id
      where p.id = participant_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Players can insert own membership" on public.participant_members
  for insert with check (
    -- Either the user is adding themselves
    player_id = auth.uid()
    -- Or they are adding a partner to a doubles category in a published tournament
    or exists (
      select 1 from public.participants p
      join public.categories c on p.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where p.id = participant_id
      and c.category_type = 'DOUBLES'
      and t.status = 'PUBLISHED'
      and now() >= t.registration_open
      and now() <= t.registration_close
    )
  );
