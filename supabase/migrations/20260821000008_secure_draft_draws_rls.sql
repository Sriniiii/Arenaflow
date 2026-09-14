-- Secure Draft Draws and related data from public spectator access

-- Drop old select policies
drop policy if exists "Draws select policy" on public.draws;
drop policy if exists "Rounds select policy" on public.rounds;
drop policy if exists "Draw Nodes select policy" on public.draw_nodes;
drop policy if exists "Matches select policy" on public.matches;

-- Create secure draws select policy
create policy "Draws select policy" on public.draws
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and (
        (t.status = 'PUBLISHED' and public.draws.status = 'PUBLISHED')
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

-- Create secure rounds select policy
create policy "Rounds select policy" on public.rounds
  for select using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where d.id = draw_id
      and (
        (t.status = 'PUBLISHED' and d.status = 'PUBLISHED')
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

-- Create secure draw nodes select policy
create policy "Draw Nodes select policy" on public.draw_nodes
  for select using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where d.id = draw_id
      and (
        (t.status = 'PUBLISHED' and d.status = 'PUBLISHED')
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

-- Create secure matches select policy
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
        or public.is_platform_admin()
      )
    )
  );
