-- Fix Match Events select policy to allow match-level scorers to read match events

drop policy if exists "Match Events select policy" on public.match_events;

create policy "Match Events select policy" on public.match_events
  for select using (
    exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where m.id = match_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_match_scorer(m.id)
        or public.is_platform_admin()
      )
    )
  );
