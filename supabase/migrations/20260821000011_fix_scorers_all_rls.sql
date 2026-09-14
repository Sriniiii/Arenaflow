-- Security Definer helper functions to check match-related permissions without RLS propagation errors

-- 1. can_view_match
create or replace function public.can_view_match(m_id uuid, u_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.matches m
    join public.categories c on m.category_id = c.id
    join public.tournaments t on c.tournament_id = t.id
    left join public.rounds r on r.id = m.round_id
    left join public.draws d on d.id = r.draw_id
    where m.id = m_id
    and (
      (t.status = 'PUBLISHED' and (d.id is null or d.status = 'PUBLISHED'))
      or t.organizer_id = u_id
      or public.is_tournament_admin(t.id)
      or public.is_tournament_scorer(t.id)
      or public.is_match_scorer(m_id)
      or public.is_platform_admin()
    )
  );
end;
$$ language plpgsql security definer;

-- 2. can_view_match_data (for games and match events select)
create or replace function public.can_view_match_data(m_id uuid, u_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.matches m
    join public.categories c on m.category_id = c.id
    join public.tournaments t on c.tournament_id = t.id
    where m.id = m_id
    and (
      t.status = 'PUBLISHED'
      or t.organizer_id = u_id
      or public.is_tournament_admin(t.id)
      or public.is_tournament_scorer(t.id)
      or public.is_match_scorer(m_id)
      or public.is_platform_admin()
    )
  );
end;
$$ language plpgsql security definer;

-- 3. can_score_match (for games and match events insert/update)
create or replace function public.can_score_match(m_id uuid, u_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.matches m
    join public.categories c on m.category_id = c.id
    join public.tournaments t on c.tournament_id = t.id
    where m.id = m_id
    and (
      t.organizer_id = u_id
      or public.is_tournament_admin(t.id)
      or public.is_tournament_scorer(t.id)
      or public.is_match_scorer(m_id)
      or public.is_platform_admin()
    )
  );
end;
$$ language plpgsql security definer;


-- Drop old policies
drop policy if exists "Matches select policy" on public.matches;
drop policy if exists "Games select policy" on public.games;
drop policy if exists "Games write policy" on public.games;
drop policy if exists "Match Events select policy" on public.match_events;
drop policy if exists "Match Events insert policy" on public.match_events;

-- Recreate Matches select policy
create policy "Matches select policy" on public.matches
  for select using (
    public.can_view_match(id, auth.uid())
  );

-- Recreate Games select policy
create policy "Games select policy" on public.games
  for select using (
    public.can_view_match_data(match_id, auth.uid())
  );

-- Recreate Games write policy
create policy "Games write policy" on public.games
  for all using (
    public.can_score_match(match_id, auth.uid())
  );

-- Recreate Match Events select policy
create policy "Match Events select policy" on public.match_events
  for select using (
    public.can_view_match_data(match_id, auth.uid())
  );

-- Recreate Match Events insert policy
create policy "Match Events insert policy" on public.match_events
  for insert with check (
    public.can_score_match(match_id, auth.uid())
  );
