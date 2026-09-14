-- Fix Matches select policy to allow match-level scorers to read matches

drop policy if exists "Matches select policy" on public.matches;

create policy "Matches select policy" on public.matches
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      left join public.rounds r on r.id = round_id
      left join public.draws d on d.id = r.draw_id
      where c.id = category_id
      and (
        (t.status = 'PUBLISHED' and (d.id is null or d.status = 'PUBLISHED'))
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_match_scorer(public.matches.id)
        or public.is_platform_admin()
      )
    )
  );
